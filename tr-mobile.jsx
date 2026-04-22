/**
 * tr-mobile.jsx
 * Mobile-friendly navigation for TradeWatch (viewports <= 900px).
 *
 * Exports (attached to window):
 *   - window.useIsMobile()   : React hook returning true when viewport <= 900px
 *   - window.TRMobileNav     : Bottom tab bar with 5 pinned tabs + More drawer
 *   - window.TRMobileToolbar : Floating top-right button stack (cmdK, alerts, settings, panels)
 *
 * Palette matches the existing TradeWatch dark theme:
 *   ink100  = #0b0f14 (deep background)
 *   ink90   = #111821 (bar bg)
 *   ink80   = #1a2330 (active slot)
 *   fg      = #e7ecf3
 *   muted   = #7b8698
 *   gold    = #c9a227 (active accent, matches Global Gauntlet brand)
 *   border  = rgba(255,255,255,0.08)
 *
 * This file does NOT mount itself. Consumers (index.html or a screen) import
 * window.TRMobileNav / window.TRMobileToolbar / window.useIsMobile.
 */
(function () {
  'use strict';

  // React is loaded globally in TradeWatch's index.html via CDN.
  var React = window.React;
  if (!React) {
    console.warn('[tr-mobile] React not found on window — mobile nav will not register.');
    return;
  }
  var useState = React.useState;
  var useEffect = React.useEffect;
  var useCallback = React.useCallback;

  // ------------------------------------------------------------------
  // Palette tokens (kept local so this file has zero imports)
  // ------------------------------------------------------------------
  var TOKENS = {
    ink100: '#0b0f14',
    ink90: '#111821',
    ink80: '#1a2330',
    fg: '#e7ecf3',
    muted: '#7b8698',
    gold: '#c9a227',
    border: 'rgba(255,255,255,0.08)',
    borderStrong: 'rgba(255,255,255,0.14)'
  };

  var MOBILE_QUERY = '(max-width: 900px)';

  // ------------------------------------------------------------------
  // useIsMobile — matchMedia hook
  // ------------------------------------------------------------------
  function useIsMobile() {
    var initial = false;
    try {
      if (typeof window !== 'undefined' && window.matchMedia) {
        initial = window.matchMedia(MOBILE_QUERY).matches;
      }
    } catch (e) { initial = false; }

    var state = useState(initial);
    var isMobile = state[0];
    var setIsMobile = state[1];

    useEffect(function () {
      if (typeof window === 'undefined' || !window.matchMedia) return undefined;
      var mql = window.matchMedia(MOBILE_QUERY);
      var handler = function (e) { setIsMobile(!!e.matches); };
      // Sync once (in case SSR default diverged from real viewport)
      setIsMobile(mql.matches);
      // Cross-browser addListener fallback
      if (mql.addEventListener) {
        mql.addEventListener('change', handler);
        return function () { mql.removeEventListener('change', handler); };
      }
      mql.addListener(handler);
      return function () { mql.removeListener(handler); };
    }, []);

    return isMobile;
  }

  // ------------------------------------------------------------------
  // Tab catalog
  // 5 pinned tabs (chosen for highest daily-driver value on mobile):
  //   Drivers  — real-time "why is the market moving" — most frequently opened
  //   Summary  — headline dashboard — default landing view
  //   News     — GDELT/headlines — primary swipe-through content
  //   Prices   — quotes/tickers — checked constantly during trading hours
  //   Flights  — geopolitical flight tracking — signature TradeWatch feature
  // All other panels (13F, COT, ETF, OPEC, Reserves, Weather, etc.) live in the
  // "More" drawer so the bottom bar stays readable on a 375px iPhone.
  // ------------------------------------------------------------------
  var PINNED_TABS = [
    { key: 'drivers',  label: 'Drivers',  icon: '\uD83C\uDFAF' }, // 🎯
    { key: 'summary',  label: 'Summary',  icon: '\uD83D\uDCCA' }, // 📊
    { key: 'news',     label: 'News',     icon: '\uD83D\uDCF0' }, // 📰
    { key: 'prices',   label: 'Prices',   icon: '\uD83D\uDCB9' }, // 💹
    { key: 'flights',  label: 'Flights',  icon: '\u2708'         } // ✈
  ];

  var MORE_TABS = [
    { key: 'alerts',    label: 'Alerts',     icon: '\uD83D\uDD14' },
    { key: 'earnings',  label: 'Earnings',   icon: '\uD83D\uDCB0' },
    { key: 'congress',  label: 'Congress',   icon: '\uD83C\uDFDB' },
    { key: 'insider',   label: 'Insider',    icon: '\uD83D\uDD75' },
    { key: '13f',       label: '13F',        icon: '\uD83D\uDCC8' },
    { key: 'cot',       label: 'COT',        icon: '\uD83D\uDCDC' },
    { key: 'etf',       label: 'ETF Flow',   icon: '\uD83D\uDCB8' },
    { key: 'opec',      label: 'OPEC',       icon: '\uD83D\uDEE2' },
    { key: 'shipping',  label: 'Shipping',   icon: '\uD83D\uDEA2' },
    { key: 'weather',   label: 'Weather',    icon: '\u26C8' },
    { key: 'disasters', label: 'Disasters',  icon: '\uD83C\uDF0B' }
  ];

  // ------------------------------------------------------------------
  // TRMobileNav
  // Props:
  //   activeKey : string  — current tab key
  //   onNav     : (key)=>void
  //   visible   : bool?   — override; by default auto-hides on desktop
  // ------------------------------------------------------------------
  function TRMobileNav(props) {
    var activeKey = (props && props.activeKey) || 'summary';
    var onNav = (props && props.onNav) || function () {};
    var forced = props && typeof props.visible === 'boolean' ? props.visible : null;

    var isMobile = useIsMobile();
    var visible = forced === null ? isMobile : forced;

    var drawerState = useState(false);
    var drawerOpen = drawerState[0];
    var setDrawerOpen = drawerState[1];

    var handleTap = useCallback(function (key) {
      if (key === '__more__') { setDrawerOpen(true); return; }
      setDrawerOpen(false);
      try { onNav(key); } catch (e) { /* swallow */ }
    }, [onNav]);

    if (!visible) return null;

    // ----- bar styles -----
    var barStyle = {
      position: 'fixed',
      left: 0,
      right: 0,
      bottom: 0,
      zIndex: 9000,
      height: 56,
      paddingBottom: 'env(safe-area-inset-bottom)',
      background: TOKENS.ink100,
      borderTop: '1px solid ' + TOKENS.border,
      display: 'flex',
      alignItems: 'stretch',
      justifyContent: 'space-around',
      boxShadow: '0 -4px 14px rgba(0,0,0,0.35)',
      fontFamily: 'system-ui, -apple-system, "Segoe UI", Roboto, sans-serif'
    };

    var slotStyle = function (isActive) {
      return {
        flex: '1 1 0',
        minWidth: 0,
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        gap: 2,
        padding: '6px 2px 4px',
        color: isActive ? TOKENS.gold : TOKENS.muted,
        background: 'transparent',
        border: 'none',
        cursor: 'pointer',
        position: 'relative',
        WebkitTapHighlightColor: 'transparent'
      };
    };

    var iconStyle = function (isActive) {
      return {
        width: 48,
        height: 28,
        lineHeight: '28px',
        fontSize: 20,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        filter: isActive ? 'drop-shadow(0 0 4px rgba(201,162,39,0.55))' : 'none',
        opacity: isActive ? 1 : 0.85,
        transform: isActive ? 'translateY(-1px)' : 'none',
        transition: 'transform 120ms ease, opacity 120ms ease'
      };
    };

    var labelStyle = function (isActive) {
      return {
        fontSize: 8,
        lineHeight: '8px',
        letterSpacing: 0.3,
        textTransform: 'uppercase',
        fontWeight: isActive ? 700 : 500,
        color: isActive ? TOKENS.gold : TOKENS.muted,
        marginTop: 2,
        whiteSpace: 'nowrap',
        overflow: 'hidden',
        textOverflow: 'ellipsis',
        maxWidth: '100%'
      };
    };

    var underlineStyle = {
      position: 'absolute',
      left: '25%',
      right: '25%',
      bottom: 2,
      height: 2,
      borderRadius: 2,
      background: TOKENS.gold,
      boxShadow: '0 0 6px rgba(201,162,39,0.7)'
    };

    // ----- render pinned tabs + more -----
    var slots = PINNED_TABS.map(function (t) {
      var isActive = activeKey === t.key;
      return React.createElement(
        'button',
        {
          key: t.key,
          type: 'button',
          'aria-label': t.label,
          'aria-current': isActive ? 'page' : undefined,
          onClick: function () { handleTap(t.key); },
          style: slotStyle(isActive)
        },
        React.createElement('span', { style: iconStyle(isActive), 'aria-hidden': true }, t.icon),
        React.createElement('span', { style: labelStyle(isActive) }, t.label),
        isActive ? React.createElement('span', { style: underlineStyle }) : null
      );
    });

    slots.push(
      React.createElement(
        'button',
        {
          key: '__more__',
          type: 'button',
          'aria-label': 'More tabs',
          'aria-expanded': drawerOpen,
          onClick: function () { handleTap('__more__'); },
          style: slotStyle(drawerOpen)
        },
        React.createElement('span', { style: iconStyle(drawerOpen), 'aria-hidden': true }, '\u22EF'),
        React.createElement('span', { style: labelStyle(drawerOpen) }, 'More'),
        drawerOpen ? React.createElement('span', { style: underlineStyle }) : null
      )
    );

    // ----- drawer -----
    var drawerBackdropStyle = {
      position: 'fixed',
      inset: 0,
      zIndex: 9100,
      background: 'rgba(0,0,0,0.55)',
      backdropFilter: 'blur(3px)',
      WebkitBackdropFilter: 'blur(3px)',
      display: drawerOpen ? 'block' : 'none'
    };
    var drawerPanelStyle = {
      position: 'fixed',
      left: 0, right: 0, bottom: 0,
      zIndex: 9110,
      background: TOKENS.ink90,
      borderTop: '1px solid ' + TOKENS.borderStrong,
      borderTopLeftRadius: 14,
      borderTopRightRadius: 14,
      padding: '14px 14px calc(20px + env(safe-area-inset-bottom))',
      color: TOKENS.fg,
      maxHeight: '70vh',
      overflowY: 'auto',
      display: drawerOpen ? 'block' : 'none',
      boxShadow: '0 -10px 30px rgba(0,0,0,0.6)'
    };
    var drawerHeadStyle = {
      display: 'flex', alignItems: 'center', justifyContent: 'space-between',
      marginBottom: 10
    };
    var drawerTitleStyle = {
      fontSize: 13, fontWeight: 700, letterSpacing: 0.4,
      textTransform: 'uppercase', color: TOKENS.fg
    };
    var drawerCloseStyle = {
      border: '1px solid ' + TOKENS.border,
      background: TOKENS.ink80,
      color: TOKENS.fg,
      borderRadius: 8,
      padding: '4px 10px',
      fontSize: 12,
      cursor: 'pointer'
    };
    var drawerGridStyle = {
      display: 'grid',
      gridTemplateColumns: 'repeat(4, minmax(0,1fr))',
      gap: 8
    };
    var drawerItemStyle = function (isActive) {
      return {
        display: 'flex', flexDirection: 'column', alignItems: 'center',
        justifyContent: 'center', gap: 4,
        padding: '12px 4px',
        background: isActive ? TOKENS.ink80 : 'transparent',
        border: '1px solid ' + (isActive ? TOKENS.gold : TOKENS.border),
        borderRadius: 10,
        color: isActive ? TOKENS.gold : TOKENS.fg,
        fontSize: 10,
        cursor: 'pointer',
        WebkitTapHighlightColor: 'transparent'
      };
    };

    var drawerItems = PINNED_TABS.concat(MORE_TABS).map(function (t) {
      var isActive = activeKey === t.key;
      return React.createElement(
        'button',
        {
          key: t.key,
          type: 'button',
          onClick: function () { handleTap(t.key); },
          style: drawerItemStyle(isActive),
          'aria-label': t.label
        },
        React.createElement('span', { style: { fontSize: 22, lineHeight: '22px' }, 'aria-hidden': true }, t.icon),
        React.createElement('span', { style: { fontSize: 10, fontWeight: 600 } }, t.label)
      );
    });

    return React.createElement(
      React.Fragment,
      null,
      React.createElement(
        'nav',
        { role: 'navigation', 'aria-label': 'Primary mobile', style: barStyle },
        slots
      ),
      React.createElement('div', {
        style: drawerBackdropStyle,
        onClick: function () { setDrawerOpen(false); },
        'aria-hidden': true
      }),
      React.createElement(
        'div',
        { role: 'dialog', 'aria-label': 'All tabs', style: drawerPanelStyle },
        React.createElement(
          'div',
          { style: drawerHeadStyle },
          React.createElement('div', { style: drawerTitleStyle }, 'All Tabs'),
          React.createElement(
            'button',
            { type: 'button', style: drawerCloseStyle, onClick: function () { setDrawerOpen(false); } },
            'Close'
          )
        ),
        React.createElement('div', { style: drawerGridStyle }, drawerItems)
      )
    );
  }

  // ------------------------------------------------------------------
  // TRMobileToolbar — floating top-right stack
  // Props:
  //   onCmdK, onAlerts, onSettings, onPanels : () => void
  //   visible : bool? (override)
  //   top     : number? (default 10)
  // ------------------------------------------------------------------
  function TRMobileToolbar(props) {
    var p = props || {};
    var forced = typeof p.visible === 'boolean' ? p.visible : null;
    var isMobile = useIsMobile();
    var visible = forced === null ? isMobile : forced;
    if (!visible) return null;

    var wrapStyle = {
      position: 'fixed',
      top: (typeof p.top === 'number' ? p.top : 10) + 'px',
      right: 8,
      zIndex: 9050,
      display: 'flex',
      flexDirection: 'column',
      gap: 6,
      pointerEvents: 'auto'
    };
    var btnStyle = {
      width: 36, height: 36,
      borderRadius: 10,
      background: TOKENS.ink90,
      border: '1px solid ' + TOKENS.border,
      color: TOKENS.fg,
      fontSize: 15,
      lineHeight: '15px',
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      cursor: 'pointer',
      boxShadow: '0 2px 8px rgba(0,0,0,0.35)',
      WebkitTapHighlightColor: 'transparent',
      padding: 0
    };

    function mkBtn(key, label, glyph, handler) {
      return React.createElement(
        'button',
        {
          key: key,
          type: 'button',
          'aria-label': label,
          title: label,
          style: btnStyle,
          onClick: function () { if (typeof handler === 'function') handler(); }
        },
        glyph
      );
    }

    return React.createElement(
      'div',
      { style: wrapStyle, role: 'toolbar', 'aria-label': 'Mobile quick actions' },
      mkBtn('cmdk',     'Command palette', '\u2318K',            p.onCmdK),
      mkBtn('alerts',   'Alerts',          '\uD83D\uDD14',       p.onAlerts),
      mkBtn('settings', 'Settings',        '\u2699',              p.onSettings),
      mkBtn('panels',   'Panel launcher',  '\u29C7',              p.onPanels)
    );
  }

  // ------------------------------------------------------------------
  // Export to window
  // ------------------------------------------------------------------
  window.useIsMobile = useIsMobile;
  window.TRMobileNav = TRMobileNav;
  window.TRMobileToolbar = TRMobileToolbar;
  window.TR_MOBILE_TABS = { pinned: PINNED_TABS, more: MORE_TABS };
})();
