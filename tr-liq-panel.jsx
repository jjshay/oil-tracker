// tr-liq-panel.jsx — crypto-derivatives liquidation heatmap UI.
//
// Exposes:
//   window.TRLiqPanel({ open, onClose })  — full modal
//   window.TRLiqTile({ onOpen })          — compact Signals-lane tile
//   window.openTRLiq()                     — global trigger (fires
//                                            'tr:open-liq' CustomEvent
//                                            so the coordinator can mount)
//
// Depends on window.Liquidations (engine/liquidations.js).

(function () {
  if (typeof window === 'undefined') return;

  // ---------- theme (mirrors tr-funding-panel.jsx) ----------
  const T = {
    ink000: '#07090C', ink100: '#0B0E13', ink200: '#10141B', ink300: '#171C24',
    edge:   'rgba(255,255,255,0.06)',
    edgeHi: 'rgba(255,255,255,0.10)',
    text:   '#ffffff',
    textMid:'rgba(180,188,200,0.75)',
    textDim:'rgba(130,138,150,0.55)',
    signal: '#c9a227',
    bull:   '#6FCF8E',
    bear:   '#D96B6B',
    mono:   '"JetBrains Mono", ui-monospace, "SF Mono", Menlo, Consolas, monospace',
    sans:   '"Inter Tight", system-ui, sans-serif',
  };

  // ---------- formatters ----------
  function fmtUsd(x, withCents) {
    if (x == null || !isFinite(x)) return '—';
    if (Math.abs(x) >= 1e9) return '$' + (x / 1e9).toFixed(2) + 'B';
    if (Math.abs(x) >= 1e6) return '$' + (x / 1e6).toFixed(2) + 'M';
    if (Math.abs(x) >= 1e3) return '$' + (x / 1e3).toFixed(1) + 'K';
    return '$' + (withCents ? x.toFixed(2) : Math.round(x).toLocaleString());
  }
  function fmtPrice(x) {
    if (x == null || !isFinite(x)) return '—';
    if (Math.abs(x) >= 1000) return x.toLocaleString(undefined, { maximumFractionDigits: 1 });
    if (Math.abs(x) >= 10)   return x.toFixed(2);
    return x.toFixed(4);
  }
  function fmtAgo(ts) {
    if (!ts || !isFinite(ts)) return '—';
    const diff = Date.now() - ts;
    if (diff < 0) return 'just now';
    const s = Math.floor(diff / 1000);
    if (s < 60) return s + 's ago';
    const m = Math.floor(s / 60);
    if (m < 60) return m + 'm ago';
    const h = Math.floor(m / 60);
    return h + 'h ago';
  }
  function fmtPct(x) {
    if (x == null || !isFinite(x)) return '—';
    return (x >= 0 ? '+' : '') + x.toFixed(1) + '%';
  }

  // ---------- long/short split bar ----------
  function SplitBar({ longs, shorts }) {
    const total = (longs || 0) + (shorts || 0);
    if (total <= 0) {
      return React.createElement('div', {
        style: {
          height: 10, borderRadius: 5, background: T.ink300,
          border: '1px solid ' + T.edge,
        },
      });
    }
    const lp = (longs / total) * 100;
    const sp = 100 - lp;
    return React.createElement('div', {
      style: {
        display: 'flex', height: 10, borderRadius: 5, overflow: 'hidden',
        border: '1px solid ' + T.edge, background: T.ink300,
      },
    },
      React.createElement('div', {
        style: { width: lp + '%', background: T.bear, transition: 'width 0.4s' },
      }),
      React.createElement('div', {
        style: { width: sp + '%', background: T.bull, transition: 'width 0.4s' },
      })
    );
  }

  // ---------- cluster price chart (SVG) ----------
  function ClusterChart({ clusters, width, height }) {
    const w = width || 780;
    const h = height || 220;
    if (!clusters || !clusters.levels || !clusters.levels.length || !clusters.price) {
      return React.createElement('div', {
        style: {
          width: '100%', height: h,
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          fontFamily: T.mono, fontSize: 11, color: T.textDim,
          background: T.ink200, border: '1px solid ' + T.edge, borderRadius: 10,
        },
      }, 'no cluster data');
    }
    const price = clusters.price;
    const win = clusters.window || [price * 0.8, price * 1.2];
    const lo = win[0], hi = win[1];
    const levels = clusters.levels;
    const maxN = Math.max.apply(null, levels.map(function (l) { return l.notional_usd; })) || 1;
    const pad = 30;
    const innerH = h - pad * 2;

    const priceToY = function (p) {
      // hi at top, lo at bottom
      return pad + ((hi - p) / (hi - lo)) * innerH;
    };
    const curY = priceToY(price);

    // Horizontal bars proportional to notional; left-aligned for shorts,
    // right-aligned for longs, anchored at the center line.
    const centerX = w / 2;
    const maxBar = (w / 2) - 90; // leave 90px gutter on each side for labels

    return React.createElement('svg', {
      width: '100%', viewBox: '0 0 ' + w + ' ' + h,
      style: { display: 'block', background: T.ink200,
               border: '1px solid ' + T.edge, borderRadius: 10 },
    },
      // legend
      React.createElement('text', {
        x: 10, y: 14, fill: T.textDim, fontFamily: T.mono, fontSize: 9,
        letterSpacing: 0.8,
      }, 'LONG LIQS'),
      React.createElement('text', {
        x: w - 10, y: 14, fill: T.textDim, fontFamily: T.mono, fontSize: 9,
        letterSpacing: 0.8, textAnchor: 'end',
      }, 'SHORT LIQS'),

      // price axis ticks at 80/90/100/110/120% of price
      [0.80, 0.90, 1.00, 1.10, 1.20].map(function (mult, i) {
        const p = price * mult;
        const y = priceToY(p);
        const isMark = mult === 1.00;
        return React.createElement('g', { key: 'tick-' + i },
          React.createElement('line', {
            x1: 0, x2: w, y1: y, y2: y,
            stroke: isMark ? T.signal : T.edge,
            strokeWidth: isMark ? 1 : 0.5,
            strokeDasharray: isMark ? '0' : '2,3',
          }),
          React.createElement('text', {
            x: 6, y: y - 3, fill: isMark ? T.signal : T.textDim,
            fontFamily: T.mono, fontSize: 9,
          }, fmtPrice(p) + (isMark ? '  · MARK' : '  ' + fmtPct((mult - 1) * 100)))
        );
      }),

      // cluster bars
      levels.map(function (lv, i) {
        const y = priceToY(lv.price);
        const barW = (lv.notional_usd / maxN) * maxBar;
        const color = lv.side === 'long' ? T.bear : T.bull;
        const isLong = lv.side === 'long';
        const x = isLong ? (centerX - barW) : centerX;
        return React.createElement('g', { key: 'bar-' + i },
          React.createElement('rect', {
            x, y: y - 3, width: barW, height: 6,
            fill: color, opacity: 0.55, rx: 1,
          }),
          React.createElement('title', null,
            lv.side.toUpperCase() + ' @ ' + fmtPrice(lv.price) +
            '  (' + fmtPct(lv.distancePct) + ')  · ' + fmtUsd(lv.notional_usd))
        );
      }),

      // current-price anchor line
      React.createElement('line', {
        x1: centerX, x2: centerX, y1: pad, y2: h - pad,
        stroke: T.edgeHi, strokeWidth: 1,
      }),
      React.createElement('circle', {
        cx: centerX, cy: curY, r: 4, fill: T.signal,
      })
    );
  }

  // ---------- main panel ----------
  function TRLiqPanel(props) {
    const open = props && props.open;
    const onClose = props && props.onClose;

    const [symbol, setSymbol]   = React.useState('BTC');
    const [recent, setRecent]   = React.useState([]);
    const [totals, setTotals]   = React.useState(null);
    const [clusters, setClusters] = React.useState(null);
    const [loading, setLoading] = React.useState(false);
    const [err, setErr]         = React.useState(null);

    const refresh = React.useCallback(async function () {
      if (!window.Liquidations) { setErr('Liquidations engine missing'); return; }
      setLoading(true); setErr(null);
      try {
        const [r, t, c] = await Promise.all([
          window.Liquidations.getRecent(symbol, 60),
          window.Liquidations.getTotals24h(symbol),
          window.Liquidations.getClusterLevels(symbol),
        ]);
        setRecent(r || []);
        setTotals(t || null);
        setClusters(c || null);
      } catch (e) {
        setErr(e && e.message ? e.message : 'fetch failed');
      } finally {
        setLoading(false);
      }
    }, [symbol]);

    React.useEffect(function () {
      if (!open) return;
      refresh();
      const iv = setInterval(refresh, 20000);
      return function () { clearInterval(iv); };
    }, [open, refresh]);

    if (!open) return null;

    const tabBtn = function (key, label) {
      const active = symbol === key;
      return React.createElement('div', {
        onClick: function () { setSymbol(key); },
        style: {
          padding: '6px 14px', fontFamily: T.mono, fontSize: 11, fontWeight: 600,
          letterSpacing: 0.8, cursor: 'pointer', borderRadius: 6,
          color: active ? T.ink000 : T.textMid,
          background: active ? T.signal : T.ink200,
          border: '1px solid ' + T.edge,
        },
      }, label);
    };

    const longs  = totals ? totals.longs_liquidated_usd  : 0;
    const shorts = totals ? totals.shorts_liquidated_usd : 0;
    const totalUsd = longs + shorts;
    const dominant = longs > shorts ? 'LONGS HURT' : shorts > longs ? 'SHORTS HURT' : 'BALANCED';
    const dominantColor = longs > shorts ? T.bear : shorts > longs ? T.bull : T.signal;

    return React.createElement('div', {
      onClick: onClose,
      style: {
        position: 'fixed', inset: 0, background: 'rgba(7,9,12,0.8)',
        backdropFilter: 'blur(12px) saturate(150%)',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        zIndex: 120, padding: 40,
      },
    },
      React.createElement('div', {
        onClick: function (e) { e.stopPropagation(); },
        style: {
          width: 920, maxHeight: '94%', overflow: 'auto',
          background: T.ink100, border: '1px solid ' + T.edgeHi, borderRadius: 14,
          padding: '22px 26px', color: T.text, fontFamily: T.sans,
          boxShadow: '0 24px 80px rgba(0,0,0,0.6)',
        },
      },
        // Header
        React.createElement('div', {
          style: { display: 'flex', alignItems: 'center', gap: 12, marginBottom: 16 },
        },
          React.createElement('div', {
            style: { fontSize: 10, letterSpacing: 1.2, color: T.textDim,
                     textTransform: 'uppercase', fontWeight: 600 },
          }, 'Liquidation Heatmap · Perp Futures'),
          React.createElement('div', {
            style: { padding: '2px 8px', fontFamily: T.mono, fontSize: 9.5,
                     fontWeight: 600, letterSpacing: 0.6,
                     color: loading ? T.signal : T.bull,
                     background: loading ? 'rgba(201,162,39,0.10)' : 'rgba(111,207,142,0.10)',
                     borderRadius: 4,
                     border: '0.5px solid ' + (loading ? 'rgba(201,162,39,0.4)' : 'rgba(111,207,142,0.4)') },
          }, loading ? 'LOADING' : 'LIVE'),
          React.createElement('div', {
            style: { marginLeft: 'auto', display: 'flex', gap: 8 },
          },
            React.createElement('div', {
              onClick: refresh,
              style: {
                padding: '5px 12px', fontFamily: T.mono, fontSize: 10.5, fontWeight: 600,
                background: T.ink200, color: T.textMid,
                border: '1px solid ' + T.edge, borderRadius: 5,
                cursor: 'pointer', letterSpacing: 0.4,
              },
            }, 'REFRESH'),
            React.createElement('div', {
              onClick: onClose,
              style: {
                width: 28, height: 28, borderRadius: 7,
                background: T.ink200, border: '1px solid ' + T.edge,
                display: 'flex', alignItems: 'center', justifyContent: 'center',
                cursor: 'pointer', color: T.textMid, fontSize: 16,
              },
            }, '\u00d7')
          )
        ),

        // Symbol tabs
        React.createElement('div', {
          style: { display: 'flex', gap: 8, marginBottom: 16 },
        },
          tabBtn('BTC', 'BTC'),
          tabBtn('ETH', 'ETH')
        ),

        // Error banner
        err && React.createElement('div', {
          style: {
            padding: '10px 14px', background: 'rgba(217,107,107,0.08)',
            border: '1px solid rgba(217,107,107,0.3)', borderRadius: 8,
            color: T.bear, fontSize: 11, fontFamily: T.mono, marginBottom: 12,
          },
        }, 'Error: ' + err),

        // Top strip: 24h totals + split bar
        React.createElement('div', {
          style: {
            padding: '14px 18px', background: T.ink200,
            border: '1px solid ' + T.edgeHi, borderRadius: 10, marginBottom: 14,
          },
        },
          React.createElement('div', {
            style: { display: 'flex', alignItems: 'center', gap: 22, flexWrap: 'wrap',
                     marginBottom: 10 },
          },
            React.createElement('div', null,
              React.createElement('div', {
                style: { fontSize: 9, letterSpacing: 0.8, color: T.textDim,
                         textTransform: 'uppercase', fontWeight: 600, marginBottom: 4 },
              }, '24h Liquidated (Observed)'),
              React.createElement('div', {
                style: { fontFamily: T.mono, fontSize: 22, fontWeight: 600, color: T.text },
              }, totals ? fmtUsd(totalUsd) : '—')
            ),
            React.createElement('div', null,
              React.createElement('div', {
                style: { fontSize: 9, letterSpacing: 0.8, color: T.textDim,
                         textTransform: 'uppercase', fontWeight: 600, marginBottom: 4 },
              }, 'Longs Wiped'),
              React.createElement('div', {
                style: { fontFamily: T.mono, fontSize: 15, color: T.bear },
              }, totals ? fmtUsd(longs) : '—')
            ),
            React.createElement('div', null,
              React.createElement('div', {
                style: { fontSize: 9, letterSpacing: 0.8, color: T.textDim,
                         textTransform: 'uppercase', fontWeight: 600, marginBottom: 4 },
              }, 'Shorts Wiped'),
              React.createElement('div', {
                style: { fontFamily: T.mono, fontSize: 15, color: T.bull },
              }, totals ? fmtUsd(shorts) : '—')
            ),
            React.createElement('div', null,
              React.createElement('div', {
                style: { fontSize: 9, letterSpacing: 0.8, color: T.textDim,
                         textTransform: 'uppercase', fontWeight: 600, marginBottom: 4 },
              }, 'Events'),
              React.createElement('div', {
                style: { fontFamily: T.mono, fontSize: 15, color: T.text },
              }, totals ? totals.count.toLocaleString() : '—')
            ),
            React.createElement('div', { style: { marginLeft: 'auto' } },
              React.createElement('div', {
                style: { fontSize: 9, letterSpacing: 0.8, color: T.textDim,
                         textTransform: 'uppercase', fontWeight: 600, marginBottom: 4,
                         textAlign: 'right' },
              }, 'Verdict'),
              React.createElement('div', {
                style: { fontFamily: T.mono, fontSize: 14, fontWeight: 700,
                         letterSpacing: 0.8, color: dominantColor },
              }, totals && totalUsd > 0 ? dominant : '—')
            )
          ),
          React.createElement(SplitBar, { longs, shorts })
        ),

        // Middle: live stream
        React.createElement('div', {
          style: {
            padding: '14px 0px 0px 0px', marginBottom: 14,
          },
        },
          React.createElement('div', {
            style: { fontSize: 10, letterSpacing: 1.0, color: T.textDim,
                     textTransform: 'uppercase', fontWeight: 600, marginBottom: 8,
                     padding: '0 2px' },
          }, 'Live Liquidation Stream'),
          React.createElement('div', {
            style: {
              maxHeight: 220, overflow: 'auto',
              background: T.ink200, border: '1px solid ' + T.edge, borderRadius: 10,
            },
          },
            recent.length === 0
              ? React.createElement('div', {
                  style: { padding: '20px', textAlign: 'center',
                           fontFamily: T.mono, fontSize: 11, color: T.textDim },
                }, loading ? 'loading…' : 'no recent liquidations')
              : recent.map(function (row, i) {
                  const sideColor = row.side === 'long' ? T.bear : T.bull;
                  return React.createElement('div', {
                    key: (row.exchange || '') + ':' + row.time + ':' + i,
                    style: {
                      display: 'grid',
                      gridTemplateColumns: '75px 80px 70px 1fr 120px 90px',
                      alignItems: 'center',
                      padding: '8px 14px', gap: 10,
                      borderBottom: i === recent.length - 1 ? 'none' : '1px solid ' + T.edge,
                      fontFamily: T.mono, fontSize: 11,
                    },
                  },
                    React.createElement('div', {
                      style: { fontSize: 9, letterSpacing: 0.8, color: T.textDim,
                               textTransform: 'uppercase' },
                    }, row.exchange),
                    React.createElement('div', { style: { color: T.textMid, fontSize: 9.5 } },
                      row.symbol),
                    React.createElement('div', {
                      style: { color: sideColor, fontWeight: 700, letterSpacing: 0.6 },
                    }, row.side === 'long' ? 'LONG' : 'SHORT'),
                    React.createElement('div', { style: { color: T.text } },
                      fmtPrice(row.price)),
                    React.createElement('div', {
                      style: { color: sideColor, fontWeight: 600, textAlign: 'right' },
                    }, fmtUsd(row.notional)),
                    React.createElement('div', {
                      style: { color: T.textDim, fontSize: 10, textAlign: 'right' },
                    }, fmtAgo(row.time))
                  );
                })
          )
        ),

        // Bottom: cluster chart
        React.createElement('div', null,
          React.createElement('div', {
            style: { fontSize: 10, letterSpacing: 1.0, color: T.textDim,
                     textTransform: 'uppercase', fontWeight: 600, marginBottom: 8 },
          }, 'Price Cluster Heatmap · ±20% from mark'),
          React.createElement(ClusterChart, { clusters, width: 860, height: 220 })
        ),

        // Footnote
        React.createElement('div', {
          style: {
            marginTop: 12, fontFamily: T.mono, fontSize: 9.5,
            color: T.textDim, letterSpacing: 0.3, lineHeight: 1.5,
          },
        },
          'Sources: BitMEX /api/v1/liquidation + Binance /fapi/v1/allForceOrders. ' +
          'Clusters bin observed liq prices (heuristic — no paid OI-by-leverage feed). ' +
          'Refreshes every 20s.')
      )
    );
  }

  // ---------- compact signals-lane tile ----------
  function TRLiqTile(props) {
    const onOpen = props && props.onOpen;
    const [sym, setSym] = React.useState('BTC');
    const [totals, setTotals] = React.useState(null);
    const [loading, setLoading] = React.useState(true);

    React.useEffect(function () {
      let alive = true;
      function load() {
        if (!window.Liquidations) return;
        window.Liquidations.getTotals24h(sym).then(function (d) {
          if (!alive) return;
          setTotals(d); setLoading(false);
        }).catch(function () { if (alive) setLoading(false); });
      }
      load();
      const iv = setInterval(load, 60_000);
      return function () { alive = false; clearInterval(iv); };
    }, [sym]);

    const total = totals ? ((totals.longs_liquidated_usd || 0) + (totals.shorts_liquidated_usd || 0)) : 0;
    const dominant = !totals ? null
      : totals.longs_liquidated_usd > totals.shorts_liquidated_usd ? 'LONGS'
      : 'SHORTS';
    const dColor = !totals ? T.textDim
      : totals.longs_liquidated_usd > totals.shorts_liquidated_usd ? T.bear : T.bull;

    const handleOpen = function () {
      if (typeof onOpen === 'function') onOpen();
      else if (typeof window.openTRLiq === 'function') window.openTRLiq();
    };

    return React.createElement('div', {
      onClick: handleOpen,
      style: {
        cursor: 'pointer', padding: '10px 14px',
        background: T.ink200, border: '1px solid ' + T.edge, borderRadius: 8,
        display: 'flex', alignItems: 'center', gap: 12, minHeight: 44,
        fontFamily: T.sans,
      },
    },
      React.createElement('div', {
        onClick: function (e) {
          e.stopPropagation();
          setSym(sym === 'BTC' ? 'ETH' : 'BTC');
        },
        style: {
          padding: '3px 8px', fontFamily: T.mono, fontSize: 9.5, fontWeight: 700,
          letterSpacing: 0.8, color: T.signal,
          background: 'rgba(201,162,39,0.10)',
          border: '0.5px solid rgba(201,162,39,0.3)', borderRadius: 4,
        },
      }, sym),
      React.createElement('div', {
        style: { fontSize: 10, letterSpacing: 0.6, color: T.textDim,
                 textTransform: 'uppercase', fontWeight: 600 },
      }, 'Liqs · 24h'),
      React.createElement('div', {
        style: { fontFamily: T.mono, fontSize: 13, fontWeight: 600,
                 color: T.text, marginLeft: 'auto' },
      }, loading ? '…' : fmtUsd(total)),
      React.createElement('div', {
        style: { fontFamily: T.mono, fontSize: 9.5, fontWeight: 700, letterSpacing: 0.8,
                 color: dColor },
      }, dominant || '—')
    );
  }

  // ---------- global trigger ----------
  window.openTRLiq = function openTRLiq() {
    try { window.dispatchEvent(new CustomEvent('tr:open-liq')); } catch (_) {}
  };

  window.TRLiqPanel = TRLiqPanel;
  window.TRLiqTile  = TRLiqTile;
})();
