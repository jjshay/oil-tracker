// tr-keyboard-shortcuts.jsx — global keyboard shortcuts for TradeRadar power users.
//
// Self-registering: loading this script attaches a document-level keydown listener
// and mounts a cheatsheet modal to document.body (same pattern as tr-selftest.jsx).
//
// Shortcut map (no modifier keys unless noted):
//   1-9  → switch to tabs in window.TR_TABS_META order (first 9 tabs)
//   w    → open Watchlist (navigates to 'prices' tab)
//   j    → window.openTRJournal()
//   s    → window.openTRScenarios()
//   t    → dispatch 'tr:focus-trade-of-day'
//   p    → window.openTRPrepForOpen()  (guarded)
//   c    → window.openTRCorrelation()
//   g    → window.openTRSizing()
//   /    → window.openTRCmdK()
//   ?    → open this cheatsheet
//   Esc  → close cheatsheet / open modal
//
// Constraints:
//   - Ignored when the active element is <input>, <textarea>, <select>, or contentEditable
//   - Ignored when meta/ctrl/alt are held (don't steal browser shortcuts)
//   - Shift+<number> is NOT bound (would conflict with browser tab switching on some laptops)
//
// Public API:
//   window.TRKeyboard.register(keyOrCombo, description, handler)
//   window.TRKeyboard.openCheatsheet()
//   window.TRKeyboard.closeCheatsheet()

(function () {
  'use strict';

  // ─────────────────────────────────────────────────────────────
  // Input-field bypass
  // ─────────────────────────────────────────────────────────────
  function isTypingTarget(el) {
    if (!el) return false;
    if (el.isContentEditable) return true;
    var tag = (el.tagName || '').toUpperCase();
    if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return true;
    var role = el.getAttribute && el.getAttribute('role');
    if (role === 'textbox' || role === 'searchbox' || role === 'combobox') return true;
    return false;
  }

  // ─────────────────────────────────────────────────────────────
  // Tab navigation
  // ─────────────────────────────────────────────────────────────
  function navigateToTab(tabKey) {
    if (!tabKey) return;
    window.TR_CURRENT_TAB = tabKey;
    try {
      window.dispatchEvent(new CustomEvent('tr:nav', { detail: { tab: tabKey } }));
    } catch (e) {
      var ev = document.createEvent('Event');
      ev.initEvent('tr:nav', true, true);
      ev.detail = { tab: tabKey };
      window.dispatchEvent(ev);
    }
    try {
      window.dispatchEvent(new CustomEvent('tr:tab-changed', { detail: { tab: tabKey } }));
    } catch (e) {
      var ev2 = document.createEvent('Event');
      ev2.initEvent('tr:tab-changed', true, true);
      ev2.detail = { tab: tabKey };
      window.dispatchEvent(ev2);
    }
    // Best-effort internal router call
    try {
      if (typeof window.trSetTab === 'function') window.trSetTab(tabKey);
    } catch (e) { /* ignore */ }
  }

  function switchTabByIndex(n) {
    var tabs = Array.isArray(window.TR_TABS_META) ? window.TR_TABS_META : [];
    if (n < 1 || n > 9) return;
    if (n - 1 >= tabs.length) return;
    var t = tabs[n - 1];
    if (!t || !t.key) return;
    navigateToTab(t.key);
  }

  // ─────────────────────────────────────────────────────────────
  // Cheatsheet modal state (vanilla pub/sub, React component below)
  // ─────────────────────────────────────────────────────────────
  var cheatsheetState = { open: false };
  var cheatsheetListeners = [];
  function setCheatsheetOpen(v) {
    cheatsheetState.open = !!v;
    cheatsheetListeners.forEach(function (l) { l(cheatsheetState.open); });
  }

  function openCheatsheet() { setCheatsheetOpen(true); }
  function closeCheatsheet() { setCheatsheetOpen(false); }

  // ─────────────────────────────────────────────────────────────
  // Esc → close any open modal/cheatsheet
  // ─────────────────────────────────────────────────────────────
  function dispatchEscape() {
    if (cheatsheetState.open) {
      closeCheatsheet();
      return;
    }
    try {
      window.dispatchEvent(new CustomEvent('tr:esc'));
    } catch (e) { /* ignore */ }
    // Best-effort: call common closers if present
    var closers = [
      'closeTRCmdK', 'closeTRJournal', 'closeTRScenarios',
      'closeTRCorrelation', 'closeTRSizing', 'closeTRPrepForOpen',
      'closeTRSelfTest',
    ];
    for (var i = 0; i < closers.length; i++) {
      var fn = window[closers[i]];
      if (typeof fn === 'function') {
        try { fn(); } catch (e) { /* ignore */ }
      }
    }
  }

  // ─────────────────────────────────────────────────────────────
  // Shortcut registry (runtime-extensible)
  // ─────────────────────────────────────────────────────────────
  var REGISTRY = Object.create(null);

  function register(key, description, handler) {
    if (!key || typeof handler !== 'function') return;
    REGISTRY[key] = { description: description || '', handler: handler };
  }

  // Built-in bindings
  register('1', 'Go to tab 1', function () { switchTabByIndex(1); });
  register('2', 'Go to tab 2', function () { switchTabByIndex(2); });
  register('3', 'Go to tab 3', function () { switchTabByIndex(3); });
  register('4', 'Go to tab 4', function () { switchTabByIndex(4); });
  register('5', 'Go to tab 5', function () { switchTabByIndex(5); });
  register('6', 'Go to tab 6', function () { switchTabByIndex(6); });
  register('7', 'Go to tab 7', function () { switchTabByIndex(7); });
  register('8', 'Go to tab 8', function () { switchTabByIndex(8); });
  register('9', 'Go to tab 9', function () { switchTabByIndex(9); });
  register('w', 'Watchlist (Prices tab)', function () { navigateToTab('prices'); });

  register('j', 'Open Journal',     function () { if (typeof window.openTRJournal     === 'function') window.openTRJournal(); });
  register('s', 'Open Scenarios',   function () { if (typeof window.openTRScenarios   === 'function') window.openTRScenarios(); });
  register('t', 'Focus Trade of the Day', function () {
    try { window.dispatchEvent(new CustomEvent('tr:focus-trade-of-day')); } catch (e) { /* ignore */ }
  });
  register('p', 'Prep for Open',    function () { if (typeof window.openTRPrepForOpen === 'function') window.openTRPrepForOpen(); });
  register('c', 'Correlation tool', function () { if (typeof window.openTRCorrelation === 'function') window.openTRCorrelation(); });
  register('g', 'Sizing / Gauntlet', function () { if (typeof window.openTRSizing     === 'function') window.openTRSizing(); });

  register('/', 'Command palette', function () { if (typeof window.openTRCmdK === 'function') window.openTRCmdK(); });
  register('?', 'Show this cheatsheet', function () { openCheatsheet(); });
  register('Escape', 'Close open modal', function () { dispatchEscape(); });

  // ─────────────────────────────────────────────────────────────
  // Keydown dispatcher
  // ─────────────────────────────────────────────────────────────
  function onKeyDown(e) {
    // Always allow Escape even in input fields (to bail out)
    if (e.key === 'Escape') {
      if (cheatsheetState.open) {
        e.preventDefault();
        dispatchEscape();
      } else {
        dispatchEscape();
      }
      return;
    }

    // Skip when typing
    if (isTypingTarget(e.target)) return;
    // Don't steal browser shortcuts
    if (e.metaKey || e.ctrlKey || e.altKey) return;

    var key = e.key;

    // Number keys 1-9: explicitly skip Shift+<number>
    if (key >= '1' && key <= '9') {
      if (e.shiftKey) return;
      var entry = REGISTRY[key];
      if (entry) {
        e.preventDefault();
        try { entry.handler(e); } catch (err) { /* ignore */ }
      }
      return;
    }

    // "?" requires Shift on most keyboards; that's fine.
    // "/" is produced without Shift.
    // All other letter shortcuts: plain lowercase only.
    var lookup = key;
    if (key && key.length === 1 && key !== '?' && key !== '/') {
      // letter shortcuts: ignore uppercase (Shift+letter) unless registered
      if (e.shiftKey) return;
      lookup = key.toLowerCase();
    }

    var hit = REGISTRY[lookup];
    if (hit) {
      e.preventDefault();
      try { hit.handler(e); } catch (err) { /* ignore */ }
    }
  }

  document.addEventListener('keydown', onKeyDown, false);

  // ─────────────────────────────────────────────────────────────
  // Cheatsheet modal (React)
  // ─────────────────────────────────────────────────────────────
  function TRCheatsheetModal(props) {
    var open = props.open;
    var onClose = props.onClose;

    var T = {
      ink000: '#07090C', ink100: '#0B0E13', ink200: '#10141B', ink300: '#171C24',
      edge: 'rgba(255,255,255,0.06)', edgeHi: 'rgba(255,255,255,0.10)',
      text: '#ffffff', textMid: 'rgba(180,188,200,0.75)', textDim: 'rgba(130,138,150,0.55)',
      signal: '#c9a227',
      mono: '"JetBrains Mono", ui-monospace, "SF Mono", Menlo, Consolas, monospace',
      ui: '"Inter Tight", InterTight, -apple-system, BlinkMacSystemFont, system-ui, sans-serif',
    };

    if (!open) return null;

    var groups = [
      {
        title: 'Navigation',
        rows: [
          { k: '1-9', d: 'Switch to tab 1–9 (TR_TABS_META order)' },
          { k: 'w',   d: 'Watchlist (Prices tab)' },
        ],
      },
      {
        title: 'Tools',
        rows: [
          { k: 'j', d: 'Journal' },
          { k: 's', d: 'Scenarios' },
          { k: 't', d: 'Focus Trade of the Day' },
          { k: 'p', d: 'Prep for Open' },
          { k: 'c', d: 'Correlation' },
          { k: 'g', d: 'Sizing (Gauntlet / risk calc)' },
        ],
      },
      {
        title: 'Global',
        rows: [
          { k: '/',   d: 'Command palette' },
          { k: '?',   d: 'Show this cheatsheet' },
          { k: 'Esc', d: 'Close any open modal' },
        ],
      },
    ];

    var glyphStyle = {
      display: 'inline-block',
      minWidth: 22,
      textAlign: 'center',
      fontFamily: T.mono,
      fontSize: 11,
      color: T.text,
      background: T.ink300,
      border: '0.5px solid ' + T.edge,
      borderRadius: 4,
      padding: '2px 6px',
    };

    return (
      <div onClick={onClose} style={{
        position: 'fixed', inset: 0, background: 'rgba(7,9,12,0.78)',
        backdropFilter: 'blur(14px) saturate(150%)',
        WebkitBackdropFilter: 'blur(14px) saturate(150%)',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        zIndex: 9600, padding: 40, fontFamily: T.ui,
      }}>
        <div onClick={function (e) { e.stopPropagation(); }} style={{
          width: 480, maxHeight: '86%', display: 'flex', flexDirection: 'column',
          background: T.ink100, border: '1px solid ' + T.edgeHi, borderRadius: 12,
          boxShadow: '0 24px 80px rgba(0,0,0,0.6)', overflow: 'hidden',
        }}>
          <div style={{
            padding: '18px 22px', borderBottom: '1px solid ' + T.edge,
          }}>
            <div style={{
              fontSize: 10, letterSpacing: 1.2, color: T.signal,
              textTransform: 'uppercase', fontWeight: 700, fontFamily: T.mono,
              marginBottom: 4,
            }}>Keyboard Shortcuts</div>
            <div style={{ fontSize: 12, color: T.textMid }}>Press any key to try</div>
          </div>

          <div style={{ flex: 1, overflowY: 'auto', padding: '12px 22px 8px' }}>
            {groups.map(function (g, gi) {
              return (
                <div key={g.title} style={{ marginBottom: gi < groups.length - 1 ? 16 : 6 }}>
                  <div style={{
                    fontSize: 9, letterSpacing: 1.4, color: T.textDim,
                    textTransform: 'uppercase', fontWeight: 700, fontFamily: T.mono,
                    marginBottom: 8,
                  }}>{g.title}</div>
                  <div style={{
                    display: 'grid',
                    gridTemplateColumns: '70px 1fr',
                    rowGap: 6, columnGap: 12, alignItems: 'center',
                  }}>
                    {g.rows.map(function (r) {
                      return [
                        <div key={r.k + '-k'}>
                          <span style={glyphStyle}>{r.k}</span>
                        </div>,
                        <div key={r.k + '-d'} style={{
                          fontSize: 12, color: T.text, lineHeight: 1.4,
                        }}>{r.d}</div>,
                      ];
                    })}
                  </div>
                </div>
              );
            })}
          </div>

          <div style={{
            padding: '10px 22px', borderTop: '1px solid ' + T.edge,
            fontFamily: T.mono, fontSize: 10, color: T.textDim, letterSpacing: 0.4,
            textAlign: 'right',
          }}>Esc to close</div>
        </div>
      </div>
    );
  }

  // ─────────────────────────────────────────────────────────────
  // Mount the cheatsheet React root
  // ─────────────────────────────────────────────────────────────
  function MountCheatsheet() {
    var useState = React.useState;
    var useEffect = React.useEffect;
    var state = useState(cheatsheetState.open);
    var open = state[0];
    var setOpen = state[1];
    useEffect(function () {
      cheatsheetListeners.push(setOpen);
      return function () {
        cheatsheetListeners = cheatsheetListeners.filter(function (l) { return l !== setOpen; });
      };
    }, []);
    return React.createElement(TRCheatsheetModal, { open: open, onClose: closeCheatsheet });
  }

  function mountCheatsheet() {
    if (document.getElementById('tr-keyboard-cheatsheet-root')) return;
    if (typeof React === 'undefined' || typeof ReactDOM === 'undefined') return;
    var div = document.createElement('div');
    div.id = 'tr-keyboard-cheatsheet-root';
    document.body.appendChild(div);
    if (ReactDOM.createRoot) {
      ReactDOM.createRoot(div).render(React.createElement(MountCheatsheet));
    } else if (ReactDOM.render) {
      ReactDOM.render(React.createElement(MountCheatsheet), div);
    }
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', mountCheatsheet);
  } else {
    mountCheatsheet();
  }

  // ─────────────────────────────────────────────────────────────
  // Public surface
  // ─────────────────────────────────────────────────────────────
  window.TRKeyboard = {
    register: register,
    openCheatsheet: openCheatsheet,
    closeCheatsheet: closeCheatsheet,
    _registry: REGISTRY, // debug hook
  };
})();
