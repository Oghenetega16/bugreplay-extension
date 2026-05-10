/**
 * rrweb-lite.js — BugReplay's self-contained DOM recorder
 *
 * Implements the same external API as rrweb so it can be swapped for the
 * real rrweb library when network access is available:
 *
 *   const stop = BugReplayRecorder.record({ emit(event) { ... } });
 *   stop(); // stops recording
 *
 * Event schema mirrors rrweb's event types:
 *   type 2 → FullSnapshot  (initial serialised DOM + initial scroll/viewport)
 *   type 3 → IncrementalSnapshot  (mutations, mouse, input, scroll)
 *
 * The replayer in replayer.js understands this schema and reconstructs a
 * sandboxed iframe from these events.
 *
 * Limitations vs real rrweb:
 *  - Canvas, video, shadow DOM, and custom elements are not replayed visually
 *  - CSS @import and cross-origin stylesheets are serialised as empty
 *  - iframes inside the recorded page are not captured
 *
 * These are acceptable for v1. Real rrweb can replace this file entirely.
 */

(function (global) {
  'use strict';

  // ── Node type constants (mirrors rrweb/rrdom) ──────────────────────────────
  var NodeType = { Document: 0, DocumentType: 1, Element: 2, Text: 3, CDATA: 4, Comment: 5 };

  // ── Incremental source constants (mirrors rrweb) ───────────────────────────
  var IncrementalSource = {
    Mutation:     0,
    MouseMove:    1,
    MouseInteraction: 2,
    Scroll:       3,
    ViewportResize: 4,
    Input:        5,
    TouchMove:    6,
    MediaInteraction: 7,
    StyleSheetRule: 8,
  };

  var MouseInteractions = { MouseUp:0, MouseDown:1, Click:2, ContextMenu:3, DblClick:4, Focus:5, Blur:6 };

  // ── ID manager ────────────────────────────────────────────────────────────
  var _id = 1;
  var nodeToId = new WeakMap();
  var idToNode = new Map();

  function getId(node) {
    if (!nodeToId.has(node)) {
      nodeToId.set(node, _id);
      idToNode.set(_id, node);
      _id++;
    }
    return nodeToId.get(node);
  }

  function resetIds() {
    _id = 1;
    nodeToId = new WeakMap();
    idToNode = new Map();
  }

  // ── DOM serialiser ────────────────────────────────────────────────────────
  function isSensitiveAttr(name) {
    return /^(value|placeholder)$/i.test(name);
  }

  function serializeNode(node, options) {
    options = options || {};
    switch (node.nodeType) {
      case Node.DOCUMENT_NODE:
        return { type: NodeType.Document, childNodes: [] };

      case Node.DOCUMENT_TYPE_NODE:
        return {
          type: NodeType.DocumentType,
          name: node.name,
          publicId: node.publicId,
          systemId: node.systemId
        };

      case Node.ELEMENT_NODE: {
        var el = node;
        var tagName = el.tagName.toLowerCase();

        // Skip script tags — we don't want to re-execute JS
        if (tagName === 'script') return null;

        var attrs = {};
        for (var i = 0; i < el.attributes.length; i++) {
          var attr = el.attributes[i];
          var attrName = attr.name;
          var attrVal  = attr.value;

          // Inline styles: keep as-is
          // Src/href: keep (may be relative — replayer resolves against base)
          // Value on inputs: capture live value, not HTML attribute
          attrs[attrName] = attrVal;
        }

        // For inputs, capture the LIVE value (not the defaultValue in HTML)
        if (tagName === 'input' || tagName === 'textarea' || tagName === 'select') {
          var liveVal = el.value;
          // Scrub sensitive fields
          if (isSensitiveInput(el)) liveVal = '';
          attrs['__live_value'] = liveVal;
        }

        // Inline <style> content
        var inlineStyleText = null;
        if (tagName === 'style') {
          try {
            var sheet = el.sheet;
            if (sheet && sheet.cssRules) {
              var rules = [];
              for (var r = 0; r < sheet.cssRules.length; r++) {
                try { rules.push(sheet.cssRules[r].cssText); } catch(e) {}
              }
              inlineStyleText = rules.join('\n');
            }
          } catch(e) {}
        }

        return {
          type: NodeType.Element,
          tagName: tagName,
          attributes: attrs,
          childNodes: [],
          isSVG: el instanceof SVGElement,
          inlineStyleText: inlineStyleText
        };
      }

      case Node.TEXT_NODE: {
        var textContent = node.textContent || '';
        // Don't capture content of script nodes
        if (node.parentNode && node.parentNode.nodeName === 'SCRIPT') return null;
        return { type: NodeType.Text, textContent: textContent, isStyle: node.parentNode && node.parentNode.nodeName === 'STYLE' };
      }

      case Node.COMMENT_NODE:
        return { type: NodeType.Comment, textContent: node.textContent || '' };

      default:
        return null;
    }
  }

  function isSensitiveInput(el) {
    var SENSITIVE = /password|passwd|pwd|secret|token|auth|card|cvv|ssn|pin/i;
    var name = el.name || el.id || el.autocomplete || el.type || '';
    return SENSITIVE.test(name) || el.type === 'password';
  }

  function serializeNodeWithId(node, map) {
    var serialized = serializeNode(node);
    if (!serialized) return null;
    var id = getId(node);
    serialized.id = id;
    map[id] = serialized;

    // Recurse into children
    if (node.childNodes) {
      for (var i = 0; i < node.childNodes.length; i++) {
        var child = serializeNodeWithId(node.childNodes[i], map);
        if (child) serialized.childNodes.push(child);
      }
    }

    return serialized;
  }

  function takeFullSnapshot(doc) {
    resetIds();
    var nodeMap = {};
    var tree = serializeNodeWithId(doc, nodeMap);
    return {
      node: tree,
      initialOffset: {
        top: doc.documentElement ? doc.documentElement.scrollTop : 0,
        left: doc.documentElement ? doc.documentElement.scrollLeft : 0
      }
    };
  }

  // ── MutationObserver adapter ──────────────────────────────────────────────
  function serializeMutations(mutations) {
    var adds = [], removes = [], attrs = [], texts = [];
    var addedSet = new Set();

    mutations.forEach(function(m) {
      if (m.type === 'childList') {
        m.removedNodes.forEach(function(node) {
          if (!addedSet.has(node)) {
            removes.push({
              parentId: getId(m.target),
              id: getId(node)
            });
          }
        });
        m.addedNodes.forEach(function(node) {
          addedSet.add(node);
          var nodeMap = {};
          var ser = serializeNodeWithId(node, nodeMap);
          if (ser) {
            adds.push({
              parentId: getId(m.target),
              nextId: m.nextSibling ? getId(m.nextSibling) : null,
              node: ser
            });
          }
        });
      } else if (m.type === 'attributes') {
        var val = m.target.getAttribute(m.attributeName);
        attrs.push({
          id: getId(m.target),
          attributes: { [m.attributeName]: val }
        });
      } else if (m.type === 'characterData') {
        texts.push({
          id: getId(m.target),
          value: m.target.textContent
        });
      }
    });

    return { adds: adds, removes: removes, attributes: attrs, texts: texts };
  }

  // ── Main record() function ────────────────────────────────────────────────
  function record(options) {
    var emit = options.emit;
    var doc  = options.doc || document;
    var t0   = Date.now();

    function ts() { return Date.now() - t0; }
    function emitEvent(type, data) {
      emit({ type: type, data: data, timestamp: Date.now() });
    }

    // 1. Full snapshot
    var snapshot = takeFullSnapshot(doc);
    emitEvent(2, snapshot); // type 2 = FullSnapshot

    // 2. MutationObserver for incremental DOM changes
    var mo = new MutationObserver(function(mutations) {
      var data = serializeMutations(mutations);
      // Only emit if something actually changed
      if (data.adds.length || data.removes.length || data.attributes.length || data.texts.length) {
        emitEvent(3, { source: IncrementalSource.Mutation, ...data });
      }
    });

    mo.observe(doc.documentElement, {
      childList: true,
      subtree: true,
      attributes: true,
      characterData: true
    });

    // 3. Mouse moves (throttled)
    var lastMouseEmit = 0;
    function onMouseMove(e) {
      if (Date.now() - lastMouseEmit < 50) return;
      lastMouseEmit = Date.now();
      emitEvent(3, {
        source: IncrementalSource.MouseMove,
        positions: [{ x: e.clientX, y: e.clientY, id: e.target ? getId(e.target) : -1, timeOffset: ts() }]
      });
    }

    // 4. Mouse clicks
    function onMouseClick(e) {
      emitEvent(3, {
        source: IncrementalSource.MouseInteraction,
        type: MouseInteractions.Click,
        id: e.target ? getId(e.target) : -1,
        x: e.clientX,
        y: e.clientY
      });
    }

    // 5. Scroll
    var lastScrollEmit = 0;
    function onScroll(e) {
      if (Date.now() - lastScrollEmit < 100) return;
      lastScrollEmit = Date.now();
      var target = e.target === doc ? doc.documentElement : e.target;
      emitEvent(3, {
        source: IncrementalSource.Scroll,
        id: target ? getId(target) : -1,
        x: target ? target.scrollLeft : 0,
        y: target ? target.scrollTop : 0
      });
    }

    // 6. Input
    function onInput(e) {
      var target = e.target;
      if (!target || !target.tagName) return;
      var value = isSensitiveInput(target) ? '' : (target.value || '');
      emitEvent(3, {
        source: IncrementalSource.Input,
        id: getId(target),
        text: value,
        isChecked: target.checked || false
      });
    }

    // 7. Viewport resize (throttled)
    var lastResizeEmit = 0;
    function onResize() {
      if (Date.now() - lastResizeEmit < 200) return;
      lastResizeEmit = Date.now();
      emitEvent(3, {
        source: IncrementalSource.ViewportResize,
        width: window.innerWidth,
        height: window.innerHeight
      });
    }

    doc.addEventListener('mousemove', onMouseMove, { capture: true, passive: true });
    doc.addEventListener('click', onMouseClick, { capture: true, passive: true });
    doc.addEventListener('scroll', onScroll, { capture: true, passive: true });
    doc.addEventListener('input', onInput, { capture: true, passive: true });
    doc.addEventListener('change', onInput, { capture: true, passive: true });
    window.addEventListener('resize', onResize, { passive: true });

    // Return stop function
    return function stopRecording() {
      mo.disconnect();
      doc.removeEventListener('mousemove', onMouseMove, { capture: true });
      doc.removeEventListener('click', onMouseClick, { capture: true });
      doc.removeEventListener('scroll', onScroll, { capture: true });
      doc.removeEventListener('input', onInput, { capture: true });
      doc.removeEventListener('change', onInput, { capture: true });
      window.removeEventListener('resize', onResize);
    };
  }

  // Expose
  global.BugReplayRecorder = { record: record };

})(typeof window !== 'undefined' ? window : this);
