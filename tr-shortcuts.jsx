// tr-shortcuts.jsx — global keyboard shortcuts for TradeWatch
// Exports: window.installTRShortcuts(setTab, refreshFn) -> cleanup()
//
// Keys:
//   1-9, 0         -> switch to Nth tab (0 = 10th) from window.TR_TABS_META
//   /  or  Cmd+K   -> CustomEvent('tr:open-cmdk')   (palette handled elsewhere)
//   R              -> refreshFn?.()
//   Cmd+, / Ctrl+, -> window.openTRSettings?.()
//
// Ignores key events when focus is inside <input>, <textarea>, <select>,
// or any contentEditable element.

(function () {
  'use strict';

  function isTypingTarget(el) {
    if (!el) return false;
    if (el.isContentEditable) return true;
    var tag = (el.tagName || '').toUpperCase();
    if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return true;
    // also respect role=textbox
    var role = el.getAttribute && el.getAttribute('role');
    if (role === 'textbox' || role === 'searchbox' || role === 'combobox') return true;
    return false;
  }

  function dispatchOpenCmdK() {
    try {
      window.dispatchEvent(new CustomEvent('tr:open-cmdk'));
    } catch (e) {
      // IE-ish fallback (not expected in this stack, but cheap safety)
      var ev = document.createEvent('Event');
      ev.initEvent('tr:open-cmdk', true, true);
      window.dispatchEvent(ev);
    }
  }

  function installTRShortcuts(setTab, refreshFn) {
    if (typeof setTab !== 'function') {
      console.warn('[TRShortcuts] setTab is not a function; tab switching disabled.');
    }

    function onKeyDown(e) {
      // Skip if user is typing
      if (isTypingTarget(e.target)) return;

      var meta = e.metaKey || e.ctrlKey;
      var key = e.key;

      // Cmd/Ctrl+K -> command palette
      if (meta && (key === 'k' || key === 'K')) {
        e.preventDefault();
        dispatchOpenCmdK();
        return;
      }

      // Cmd/Ctrl+, -> settings
      if (meta && key === ',') {
        e.preventDefault();
        if (typeof window.openTRSettings === 'function') {
          try { window.openTRSettings(); }
          catch (err) { console.error('[TRShortcuts] openTRSettings threw:', err); }
        }
        return;
      }

      // Anything else with a modifier: ignore (don't steal browser shortcuts)
      if (meta || e.altKey) return;

      // "/" -> palette
      if (key === '/') {
        e.preventDefault();
        dispatchOpenCmdK();
        return;
      }

      // R -> refresh (case-insensitive, no shift requirement)
      if (key === 'r' || key === 'R') {
        if (typeof refreshFn === 'function') {
          e.preventDefault();
          try { refreshFn(); }
          catch (err) { console.error('[TRShortcuts] refreshFn threw:', err); }
        }
        return;
      }

      // 1-9, 0 -> switch tab
      if (key.length === 1 && key >= '0' && key <= '9') {
        var tabs = (window.TR_TABS_META && window.TR_TABS_META.length)
          ? window.TR_TABS_META : [];
        if (!tabs.length || typeof setTab !== 'function') return;

        var idx = (key === '0') ? 9 : (parseInt(key, 10) - 1);
        if (idx < 0 || idx >= tabs.length) return;

        var tab = tabs[idx];
        if (!tab || !tab.key) return;

        e.preventDefault();
        try { setTab(tab.key); }
        catch (err) { console.error('[TRShortcuts] setTab threw:', err); }
        return;
      }
    }

    window.addEventListener('keydown', onKeyDown, false);

    return function cleanup() {
      window.removeEventListener('keydown', onKeyDown, false);
    };
  }

  window.installTRShortcuts = installTRShortcuts;
})();
