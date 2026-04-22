// tr-ui.jsx — Shared UI helpers library for TradeWatch panels.
//
// Exposes on window:
//   TRPanelChrome, TRShimmer, TRLoadingDots, TRStatusChip,
//   TREmptyState, TRSectionHeader, TRValueTile, TRBtn
//
// A single palette drives all components. Panels adopt this library
// incrementally — zero external deps, zero required globals aside from React.

(function () {
  if (typeof window === 'undefined') return;

  var React = window.React;
  if (!React) {
    console.error('[tr-ui] React not found on window.');
    return;
  }

  // ---- Shared palette ---------------------------------------------------
  var T = {
    ink000:  '#07090C',
    ink100:  '#0B0E13',
    ink200:  '#10141B',
    ink300:  '#171C24',
    ink400:  '#1F2633',
    edge:    'rgba(255,255,255,0.06)',
    edgeHi:  'rgba(255,255,255,0.10)',
    edgeTop: 'rgba(255,255,255,0.05)',
    text:    '#E6E8EC',
    textMid: 'rgba(180,188,200,0.75)',
    textDim: 'rgba(130,138,150,0.55)',
    signal:  '#c9a227',
    signalBg:'rgba(201,162,39,0.12)',
    bull:    '#6FCF8E',
    bullBg:  'rgba(111,207,142,0.12)',
    bear:    '#D96B6B',
    bearBg:  'rgba(217,107,107,0.12)',
    mono:    '"JetBrains Mono", ui-monospace, "SF Mono", Menlo, Consolas, monospace',
    sans:    '"Inter Tight", system-ui, -apple-system, sans-serif',
  };

  // ---- Keyframes injection (once) --------------------------------------
  var STYLE_ID = 'tr-ui-keyframes';
  function ensureKeyframes() {
    if (typeof document === 'undefined') return;
    if (document.getElementById(STYLE_ID)) return;
    var el = document.createElement('style');
    el.id = STYLE_ID;
    el.textContent = [
      '@keyframes tr-shimmer { 0% { background-position: -200% 0; } 100% { background-position: 200% 0; } }',
      '@keyframes tr-dot-fade { 0%, 80%, 100% { opacity: 0.2; } 40% { opacity: 1; } }',
      '@keyframes tr-fade-in { from { opacity: 0; transform: translateY(4px); } to { opacity: 1; transform: translateY(0); } }',
    ].join('\n');
    document.head.appendChild(el);
  }
  ensureKeyframes();

  var h = React.createElement;

  // ---- TRShimmer -------------------------------------------------------
  var TRShimmer = React.forwardRef(function TRShimmer(props, ref) {
    ensureKeyframes();
    var width = props.width != null ? props.width : '100%';
    var height = props.height != null ? props.height : 12;
    var rounded = props.rounded != null ? props.rounded : 4;
    var style = Object.assign({
      display: 'block',
      width: typeof width === 'number' ? width + 'px' : width,
      height: typeof height === 'number' ? height + 'px' : height,
      borderRadius: typeof rounded === 'number' ? rounded + 'px' : rounded,
      background: 'linear-gradient(90deg, ' + T.ink200 + ' 0%, ' + T.ink300 + ' 50%, ' + T.ink200 + ' 100%)',
      backgroundSize: '200% 100%',
      animation: 'tr-shimmer 1.2s linear infinite',
    }, props.style || {});
    return h('div', { ref: ref, style: style, 'aria-hidden': true });
  });

  // ---- TRLoadingDots ---------------------------------------------------
  var TRLoadingDots = React.forwardRef(function TRLoadingDots(props, ref) {
    ensureKeyframes();
    var label = props.label || 'LOADING';
    var color = props.color || T.textMid;
    var dotStyle = function (delay) {
      return {
        display: 'inline-block',
        width: 4, height: 4, borderRadius: '50%',
        background: color, marginLeft: 2,
        animation: 'tr-dot-fade 1.2s ease-in-out infinite',
        animationDelay: delay + 's',
      };
    };
    return h('span', {
      ref: ref,
      style: Object.assign({
        fontFamily: T.mono,
        fontSize: 10,
        letterSpacing: 1.2,
        color: color,
        textTransform: 'uppercase',
        display: 'inline-flex',
        alignItems: 'center',
      }, props.style || {}),
    },
      label,
      h('span', { key: 'd1', style: dotStyle(0) }),
      h('span', { key: 'd2', style: dotStyle(0.2) }),
      h('span', { key: 'd3', style: dotStyle(0.4) })
    );
  });

  // ---- TRStatusChip ----------------------------------------------------
  function statusColors(status) {
    switch (status) {
      case 'live':
        return { fg: T.bull, bg: 'rgba(111,207,142,0.12)', border: 'rgba(111,207,142,0.40)' };
      case 'stale':
        return { fg: T.signal, bg: 'rgba(201,162,39,0.12)', border: 'rgba(201,162,39,0.40)' };
      case 'offline':
        return { fg: T.bear, bg: 'rgba(217,107,107,0.12)', border: 'rgba(217,107,107,0.40)' };
      case 'key-needed':
        return { fg: T.signal, bg: 'rgba(201,162,39,0.10)', border: 'rgba(201,162,39,0.35)' };
      case 'loading':
        return { fg: T.textMid, bg: 'rgba(180,188,200,0.08)', border: 'rgba(180,188,200,0.25)' };
      default:
        return { fg: T.textMid, bg: 'rgba(180,188,200,0.08)', border: 'rgba(180,188,200,0.25)' };
    }
  }
  var TRStatusChip = React.forwardRef(function TRStatusChip(props, ref) {
    var status = props.status || 'loading';
    var c = statusColors(status);
    var label = props.label || status.toUpperCase();
    var dotColor = status === 'live' ? T.bull
      : status === 'offline' ? T.bear
      : status === 'stale' || status === 'key-needed' ? T.signal
      : T.textMid;
    var content = [];
    if (status === 'key-needed') {
      content.push(h('span', {
        key: 'lock', style: { fontSize: 9, marginRight: 4 }
      }, '\u{1F512}'));
    } else if (status === 'loading') {
      content.push(h(TRLoadingDots, {
        key: 'dots',
        label: '',
        color: c.fg,
        style: { fontSize: 9 }
      }));
    } else {
      content.push(h('span', {
        key: 'dot',
        style: {
          display: 'inline-block', width: 6, height: 6, borderRadius: '50%',
          background: dotColor, marginRight: 6,
          boxShadow: status === 'live' ? '0 0 6px ' + dotColor : 'none',
        }
      }));
    }
    content.push(h('span', { key: 'lbl' }, label));
    return h('span', {
      ref: ref,
      style: Object.assign({
        display: 'inline-flex', alignItems: 'center',
        padding: '3px 8px', borderRadius: 999,
        fontFamily: T.mono, fontSize: 9.5, letterSpacing: 0.8,
        textTransform: 'uppercase',
        color: c.fg, background: c.bg,
        border: '1px solid ' + c.border,
        lineHeight: 1,
      }, props.style || {}),
    }, content);
  });

  // ---- TRPanelChrome ---------------------------------------------------
  var TRPanelChrome = React.forwardRef(function TRPanelChrome(props, ref) {
    var open = props.open !== false;
    var onClose = props.onClose || function () {};
    var width = props.width || 720;

    React.useEffect(function () {
      if (!open) return undefined;
      function onKey(e) { if (e.key === 'Escape') { try { onClose(); } catch (_) {} } }
      window.addEventListener('keydown', onKey);
      return function () { window.removeEventListener('keydown', onKey); };
    }, [open, onClose]);

    if (!open) return null;

    function onBackdropClick(e) {
      if (e.target === e.currentTarget) {
        try { onClose(); } catch (_) {}
      }
    }

    var header = h('div', {
      key: 'hdr',
      style: {
        display: 'flex', alignItems: 'center', gap: 12,
        padding: '14px 18px 12px',
        borderBottom: '1px solid ' + T.edge,
        flexShrink: 0,
      },
    },
      h('div', { key: 'titles', style: { flex: 1, minWidth: 0 } },
        props.kicker ? h('div', {
          key: 'k',
          style: {
            fontFamily: T.mono, fontSize: 9.5, letterSpacing: 1.2,
            textTransform: 'uppercase', color: T.signal, marginBottom: 3,
          },
        }, props.kicker) : null,
        h('div', {
          key: 't',
          style: {
            fontFamily: T.sans, fontSize: 17, fontWeight: 600,
            color: T.text, letterSpacing: -0.2,
            whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
          },
        }, props.title || '')
      ),
      props.status ? h(TRStatusChip, { key: 'st', status: props.status }) : null,
      props.right ? h('div', {
        key: 'r', style: { display: 'flex', alignItems: 'center', gap: 8 }
      }, props.right) : null,
      h('button', {
        key: 'x',
        onClick: onClose,
        'aria-label': 'Close',
        style: {
          width: 28, height: 28, padding: 0, marginLeft: 4,
          border: '1px solid ' + T.edgeHi, background: T.ink200,
          color: T.textMid, borderRadius: 6, cursor: 'pointer',
          fontFamily: T.mono, fontSize: 14, lineHeight: '26px',
        },
      }, '\u2715')
    );

    var body = h('div', {
      key: 'body',
      style: {
        padding: '14px 18px 18px',
        overflowY: 'auto', flex: '1 1 auto', minHeight: 0,
      },
    }, props.children);

    var card = h('div', {
      ref: ref,
      onClick: function (e) { e.stopPropagation(); },
      style: {
        position: 'relative',
        width: typeof width === 'number' ? Math.min(width, window.innerWidth - 32) : width,
        maxWidth: 'calc(100vw - 32px)',
        maxHeight: 'calc(100vh - 64px)',
        display: 'flex', flexDirection: 'column',
        background: T.ink100,
        border: '1px solid ' + T.edgeHi,
        borderRadius: 14,
        boxShadow: '0 24px 60px rgba(0,0,0,0.5), 0 0 0 1px ' + T.edgeTop + ' inset',
        overflow: 'hidden',
        animation: 'tr-fade-in 180ms ease-out',
        fontFamily: T.sans, color: T.text,
      },
    }, header, body);

    return h('div', {
      onClick: onBackdropClick,
      style: {
        position: 'fixed', inset: 0, zIndex: 9000,
        background: 'rgba(4,6,10,0.62)',
        backdropFilter: 'blur(8px)',
        WebkitBackdropFilter: 'blur(8px)',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        padding: 16,
      },
    }, card);
  });

  // ---- TREmptyState ----------------------------------------------------
  var TREmptyState = React.forwardRef(function TREmptyState(props, ref) {
    var icon = props.icon || '\u2205';
    var title = props.title || 'Nothing here yet';
    var body = props.body || '';
    var actionLabel = props.actionLabel;
    var onAction = props.onAction;

    return h('div', {
      ref: ref,
      style: Object.assign({
        display: 'flex', flexDirection: 'column',
        alignItems: 'center', justifyContent: 'center',
        textAlign: 'center', gap: 10,
        padding: '32px 24px',
        border: '1px dashed ' + T.edgeHi, borderRadius: 10,
        background: T.ink200, color: T.text, fontFamily: T.sans,
      }, props.style || {}),
    },
      h('div', {
        key: 'icon',
        style: {
          fontSize: 28, color: T.textMid, lineHeight: 1,
          fontFamily: T.mono,
        }
      }, icon),
      h('div', {
        key: 'title',
        style: { fontSize: 15, fontWeight: 600, color: T.text }
      }, title),
      body ? h('div', {
        key: 'body',
        style: {
          fontSize: 12, color: T.textMid, maxWidth: 360, lineHeight: 1.5,
        }
      }, body) : null,
      actionLabel ? h(TRBtn, {
        key: 'cta', variant: 'primary', onClick: onAction,
        style: { marginTop: 4 },
      }, actionLabel) : null
    );
  });

  // ---- TRSectionHeader -------------------------------------------------
  var TRSectionHeader = React.forwardRef(function TRSectionHeader(props, ref) {
    return h('div', {
      ref: ref,
      style: Object.assign({
        display: 'flex', alignItems: 'flex-end',
        gap: 10, marginBottom: 8,
      }, props.style || {}),
    },
      h('div', { key: 'left', style: { flex: 1, minWidth: 0 } },
        h('div', {
          key: 'lbl',
          style: {
            fontFamily: T.mono, fontSize: 10, letterSpacing: 1.2,
            textTransform: 'uppercase', color: T.signal,
          },
        }, props.label || ''),
        props.kicker ? h('div', {
          key: 'kick',
          style: {
            fontFamily: T.sans, fontSize: 11.5,
            color: T.textMid, marginTop: 2, lineHeight: 1.4,
          },
        }, props.kicker) : null
      ),
      props.right ? h('div', {
        key: 'right',
        style: { display: 'flex', alignItems: 'center', gap: 6 },
      }, props.right) : null
    );
  });

  // ---- TRValueTile -----------------------------------------------------
  var TRValueTile = React.forwardRef(function TRValueTile(props, ref) {
    var signal = props.signal; // 'bull' | 'bear' | 'neutral' | undefined
    var deltaColor =
      signal === 'bull' ? T.bull :
      signal === 'bear' ? T.bear :
      T.textMid;

    var clickable = typeof props.onClick === 'function';

    return h('div', {
      ref: ref,
      onClick: props.onClick,
      style: Object.assign({
        display: 'flex', flexDirection: 'column', gap: 4,
        padding: '10px 12px',
        background: T.ink200,
        border: '1px solid ' + T.edge,
        borderRadius: 8,
        cursor: clickable ? 'pointer' : 'default',
        transition: 'border-color 140ms ease, background 140ms ease',
        fontFamily: T.sans, color: T.text,
        minWidth: 0,
      }, props.style || {}),
      onMouseEnter: clickable ? function (e) {
        e.currentTarget.style.borderColor = T.edgeHi;
        e.currentTarget.style.background = T.ink300;
      } : undefined,
      onMouseLeave: clickable ? function (e) {
        e.currentTarget.style.borderColor = T.edge;
        e.currentTarget.style.background = T.ink200;
      } : undefined,
    },
      h('div', {
        key: 'lbl',
        style: {
          fontFamily: T.mono, fontSize: 9.5, letterSpacing: 1,
          textTransform: 'uppercase', color: T.textMid,
          whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
        }
      }, props.label || ''),
      h('div', {
        key: 'val',
        style: {
          fontFamily: T.mono, fontSize: 18, fontWeight: 600,
          color: T.text, lineHeight: 1.1,
          whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
        }
      }, props.value != null ? props.value : '\u2014'),
      (props.delta != null || props.kicker) ? h('div', {
        key: 'meta',
        style: {
          display: 'flex', alignItems: 'center', gap: 6,
          fontFamily: T.mono, fontSize: 10, color: T.textMid,
        }
      },
        props.delta != null ? h('span', {
          key: 'd',
          style: { color: deltaColor, fontWeight: 600 }
        }, props.delta) : null,
        props.kicker ? h('span', { key: 'k' }, props.kicker) : null
      ) : null
    );
  });

  // ---- TRBtn -----------------------------------------------------------
  function btnStyles(variant) {
    switch (variant) {
      case 'primary':
        return {
          base: {
            background: T.signal, color: T.ink000,
            border: '1px solid ' + T.signal,
            padding: '6px 12px', borderRadius: 6,
            fontFamily: T.mono, fontSize: 11, fontWeight: 600,
            letterSpacing: 0.5, textTransform: 'uppercase',
            cursor: 'pointer', lineHeight: 1.2,
          },
          hover: { background: '#d9b437', borderColor: '#d9b437' },
        };
      case 'danger':
        return {
          base: {
            background: T.bearBg, color: T.bear,
            border: '1px solid rgba(217,107,107,0.45)',
            padding: '6px 12px', borderRadius: 6,
            fontFamily: T.mono, fontSize: 11, fontWeight: 600,
            letterSpacing: 0.5, textTransform: 'uppercase',
            cursor: 'pointer', lineHeight: 1.2,
          },
          hover: { background: 'rgba(217,107,107,0.22)' },
        };
      case 'icon':
        return {
          base: {
            width: 28, height: 28, padding: 0,
            background: T.ink200, color: T.textMid,
            border: '1px solid ' + T.edgeHi,
            borderRadius: 6, cursor: 'pointer',
            fontFamily: T.mono, fontSize: 12,
            display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
          },
          hover: { background: T.ink300, color: T.text },
        };
      case 'ghost':
      default:
        return {
          base: {
            background: 'transparent', color: T.textMid,
            border: '1px solid ' + T.edgeHi,
            padding: '6px 12px', borderRadius: 6,
            fontFamily: T.mono, fontSize: 11, fontWeight: 500,
            letterSpacing: 0.5, textTransform: 'uppercase',
            cursor: 'pointer', lineHeight: 1.2,
          },
          hover: { background: T.ink200, color: T.text, borderColor: 'rgba(255,255,255,0.18)' },
        };
    }
  }
  var TRBtn = React.forwardRef(function TRBtn(props, ref) {
    var variant = props.variant || 'ghost';
    var styles = btnStyles(variant);
    var disabled = !!props.disabled;
    var style = Object.assign({}, styles.base, props.style || {});
    if (disabled) {
      style.opacity = 0.5;
      style.cursor = 'not-allowed';
    }
    return h('button', {
      ref: ref,
      type: props.type || 'button',
      disabled: disabled,
      title: props.title,
      onClick: disabled ? undefined : props.onClick,
      onMouseEnter: disabled ? undefined : function (e) {
        Object.keys(styles.hover).forEach(function (k) {
          e.currentTarget.style[k] = styles.hover[k];
        });
      },
      onMouseLeave: disabled ? undefined : function (e) {
        Object.keys(styles.hover).forEach(function (k) {
          e.currentTarget.style[k] = styles.base[k] != null ? styles.base[k] : '';
        });
      },
      style: style,
    }, props.children);
  });

  // ---- Export ----------------------------------------------------------
  window.TRPanelChrome  = TRPanelChrome;
  window.TRShimmer      = TRShimmer;
  window.TRLoadingDots  = TRLoadingDots;
  window.TRStatusChip   = TRStatusChip;
  window.TREmptyState   = TREmptyState;
  window.TRSectionHeader= TRSectionHeader;
  window.TRValueTile    = TRValueTile;
  window.TRBtn          = TRBtn;

  window.TRUIPalette = T;
})();
