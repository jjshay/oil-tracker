// tr-stables-panel.jsx — Stablecoin mint/burn intelligence panel.
//
// Exposes:
//   window.TRStablesPanel({ open, onClose })   — full-screen modal
//   window.TRStablesTile({ onOpen })           — compact header tile
//   window.openTRStables()                      — fires 'tr:open-stables'
//
// Depends on window.StableData (engine/stables.js). Degrades cleanly when
// the engine is missing or returns null (shows a "source unreachable" card
// rather than blowing up).

(function () {
  if (typeof window === 'undefined') return;

  // ---------- theme (match tr-etf-panel.jsx) ----------
  var T = {
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
  function fmtUsd(x) {
    if (x == null || !isFinite(x)) return '—';
    var sign = x < 0 ? '-' : '';
    var abs = Math.abs(x);
    if (abs >= 1e12) return sign + '$' + (abs / 1e12).toFixed(2) + 'T';
    if (abs >= 1e9)  return sign + '$' + (abs / 1e9).toFixed(2) + 'B';
    if (abs >= 1e6)  return sign + '$' + (abs / 1e6).toFixed(1) + 'M';
    if (abs >= 1e3)  return sign + '$' + (abs / 1e3).toFixed(0) + 'K';
    return sign + '$' + abs.toFixed(0);
  }
  function fmtDelta(x) {
    if (x == null || !isFinite(x)) return '—';
    var sign = x > 0 ? '+' : '';
    return sign + fmtUsd(x).replace('$-', '-$');
  }
  function fmtPct(x) {
    if (x == null || !isFinite(x)) return '—';
    var sign = x > 0 ? '+' : '';
    return sign + x.toFixed(2) + '%';
  }
  function colorFor(x) {
    if (x == null || !isFinite(x) || x === 0) return T.textDim;
    return x > 0 ? T.bull : T.bear;
  }
  function fmtDateShort(iso) {
    if (!iso) return '—';
    var m = iso.match(/^(\d{4})-(\d{2})-(\d{2})$/);
    if (!m) return iso;
    var months = ['JAN','FEB','MAR','APR','MAY','JUN','JUL','AUG','SEP','OCT','NOV','DEC'];
    return months[parseInt(m[2], 10) - 1] + ' ' + String(parseInt(m[3], 10));
  }
  function fmtAge(ts) {
    if (!ts) return '—';
    var d = Date.now() - ts;
    if (d < 60_000) return Math.round(d / 1000) + 's ago';
    if (d < 3_600_000) return Math.round(d / 60_000) + 'm ago';
    if (d < 86_400_000) return Math.round(d / 3_600_000) + 'h ago';
    return Math.round(d / 86_400_000) + 'd ago';
  }

  // ---------- bar chart (daily net issuance) ----------
  // rows = [{ date, supply }] newest-first. We compute supply[i] - supply[i+1]
  // as the daily delta for day `i`, and render oldest → newest left-to-right.
  function IssuanceBars(props) {
    var rows = (props && props.rows) || [];
    var width  = (props && props.width)  || 820;
    var height = (props && props.height) || 140;
    if (rows.length < 2) {
      return React.createElement('div', {
        style: {
          width: width, height: height, fontFamily: T.mono, fontSize: 10,
          color: T.textDim, display: 'flex', alignItems: 'center', justifyContent: 'center',
        },
      }, 'no data');
    }
    // Build deltas newest-first, then reverse for render.
    var deltas = [];
    for (var i = 0; i < rows.length - 1; i++) {
      deltas.push({
        date:  rows[i].date,
        delta: rows[i].supply - rows[i + 1].supply,
      });
    }
    var series = deltas.slice().reverse();
    var vals = series.map(function (r) { return r.delta; });
    var max  = Math.max.apply(null, vals);
    var min  = Math.min.apply(null, vals);
    var span = Math.max(Math.abs(max), Math.abs(min)) || 1;
    var mid  = height / 2;
    var step = width / series.length;
    var bw   = Math.max(2, step - 2);

    var els = [];
    for (var j = 0; j < series.length; j++) {
      var v = series[j].delta;
      var h = (Math.abs(v) / span) * (mid - 6);
      var x = j * step;
      var y = v >= 0 ? (mid - h) : mid;
      var fill = v >= 0 ? T.bull : T.bear;
      els.push(React.createElement('rect', {
        key: 'b' + j, x: x, y: y, width: bw, height: Math.max(1, h),
        fill: fill, opacity: 0.85,
      }));
    }
    els.push(React.createElement('line', {
      key: 'mid', x1: 0, x2: width, y1: mid, y2: mid,
      stroke: T.edgeHi, strokeWidth: 0.5, strokeDasharray: '3,3',
    }));
    return React.createElement('svg', {
      width: width, height: height, viewBox: '0 0 ' + width + ' ' + height,
      style: { display: 'block' },
    }, els);
  }

  // ---------- UI helpers ----------
  function supplyTile(label, data, emphasise) {
    // data: { current, delta24h, pct24h, net7d, pct7d, net30d, pct30d }
    var cur  = data ? data.current  : null;
    var d24  = data ? data.delta24h : null;
    var p24  = data ? data.pct24h   : null;
    var d7   = data ? data.net7d    : null;
    var p7   = data ? data.pct7d    : null;
    var d30  = data ? data.net30d   : null;
    var p30  = data ? data.pct30d   : null;

    return React.createElement('div', {
      style: {
        background: emphasise ? T.ink300 : T.ink200,
        border: '1px solid ' + T.edge, borderRadius: 8,
        padding: '14px 16px',
      },
    },
      React.createElement('div', {
        style: {
          fontFamily: T.mono, fontSize: 10, letterSpacing: 1.2,
          color: T.textDim, textTransform: 'uppercase', marginBottom: 6,
        },
      }, label),
      React.createElement('div', {
        style: { fontFamily: T.mono, fontSize: 22, fontWeight: 600, color: T.text },
      }, fmtUsd(cur)),
      React.createElement('div', {
        style: {
          fontFamily: T.mono, fontSize: 10.5, marginTop: 8,
          display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 4,
        },
      },
        deltaRow('24H', d24, p24),
        deltaRow('7D',  d7,  p7),
        deltaRow('30D', d30, p30)
      )
    );
  }
  function deltaRow(label, delta, pct) {
    return React.createElement('div', null,
      React.createElement('div', { style: { color: T.textDim, fontSize: 9 } }, label),
      React.createElement('div', { style: { color: colorFor(delta), fontSize: 10.5 } },
        fmtDelta(delta)
      ),
      React.createElement('div', { style: { color: colorFor(delta), fontSize: 9 } },
        fmtPct(pct)
      )
    );
  }

  // ---------- main panel ----------
  function TRStablesPanel(props) {
    var open    = props && props.open;
    var onClose = props && props.onClose;

    var h1 = React.useState(null);  var all = h1[0];     var setAll     = h1[1];
    var h2 = React.useState('USDT');var ticker = h2[0];  var setTicker  = h2[1];
    var h3 = React.useState(null);  var history = h3[0]; var setHistory = h3[1];
    var h4 = React.useState([]);    var movers = h4[0];  var setMovers  = h4[1];
    var h5 = React.useState(false); var loading = h5[0]; var setLoading = h5[1];
    var h6 = React.useState(null);  var err = h6[0];     var setErr     = h6[1];
    var h7 = React.useState(null);  var upd = h7[0];     var setUpd     = h7[1];

    var refresh = React.useCallback(async function (force) {
      if (!window.StableData) { setErr('StableData engine missing'); return; }
      setLoading(true); setErr(null);
      try {
        if (force) { try { window.StableData.clearCache(); } catch (_) {} }
        var allSnap = await window.StableData.getAllCurrent();
        setAll(allSnap);
        var hist = await window.StableData.getSupplyHistory(ticker, 30);
        if (!hist) setErr('source unreachable');
        setHistory(hist || []);
        var m = await window.StableData.getLargeMovers(100_000_000, 14);
        setMovers(m || []);
        setUpd(Date.now());
      } catch (e) {
        setErr((e && e.message) || 'fetch failed');
      } finally {
        setLoading(false);
      }
    }, [ticker]);

    React.useEffect(function () {
      if (!open) return;
      refresh(false);
      var iv = setInterval(function () { refresh(false); }, 15 * 60 * 1000);
      return function () { clearInterval(iv); };
    }, [open, refresh]);

    if (!open) return null;

    // ---- layout ----
    var tabBtn = function (key, label) {
      var active = ticker === key;
      return React.createElement('div', {
        key: 'tab-' + key,
        onClick: function () { setTicker(key); },
        style: {
          padding: '6px 14px', fontFamily: T.mono, fontSize: 11, fontWeight: 700,
          letterSpacing: 0.8, cursor: 'pointer', borderRadius: 6,
          color: active ? T.ink000 : T.textMid,
          background: active ? T.signal : T.ink200,
          border: '1px solid ' + T.edge,
        },
      }, label);
    };

    var supplyStrip = React.createElement('div', {
      style: {
        display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 10,
        padding: '12px 14px', marginBottom: 14,
        background: T.ink100, border: '1px solid ' + T.edge, borderRadius: 8,
      },
    },
      supplyTile('Total Stable Supply', all && all.TOTAL, true),
      supplyTile('USDT · Tether',       all && all.USDT),
      supplyTile('USDC · USD Coin',     all && all.USDC),
      supplyTile('DAI · Dai',           all && all.DAI)
    );

    var chartHost = React.createElement('div', {
      style: {
        background: T.ink100, border: '1px solid ' + T.edge, borderRadius: 8,
        padding: '14px 16px', marginBottom: 14,
      },
    },
      React.createElement('div', {
        style: { display: 'flex', alignItems: 'center', gap: 10, marginBottom: 10 },
      },
        React.createElement('div', {
          style: {
            fontFamily: T.mono, fontSize: 10, letterSpacing: 1.2,
            color: T.signal, textTransform: 'uppercase', fontWeight: 600,
          },
        }, 'Daily Net Issuance · 30D'),
        React.createElement('div', { style: { flex: 1 } }),
        tabBtn('USDT', 'USDT'),
        tabBtn('USDC', 'USDC'),
        tabBtn('DAI',  'DAI')
      ),
      React.createElement(IssuanceBars, { rows: history || [], width: 960, height: 150 })
    );

    // Movers table
    var moversHost = React.createElement('div', {
      style: {
        background: T.ink100, border: '1px solid ' + T.edge, borderRadius: 8,
        padding: '14px 16px',
      },
    },
      React.createElement('div', {
        style: {
          fontFamily: T.mono, fontSize: 10, letterSpacing: 1.2, color: T.signal,
          textTransform: 'uppercase', fontWeight: 600, marginBottom: 8,
        },
      }, 'Large daily movers · >|$100M| · last 14D'),
      movers.length === 0
        ? React.createElement('div', {
            style: { fontFamily: T.mono, fontSize: 11, color: T.textDim, padding: '4px 0' },
          }, 'No outsized mint/burn events in window.')
        : React.createElement('div', {
            style: { maxHeight: 240, overflowY: 'auto' },
          },
            React.createElement('div', {
              style: {
                display: 'grid',
                gridTemplateColumns: '90px 70px 110px 1fr 120px',
                gap: 0, padding: '6px 0',
                fontFamily: T.mono, fontSize: 9.5, color: T.textDim,
                letterSpacing: 0.8, textTransform: 'uppercase',
                borderBottom: '1px solid ' + T.edge,
              },
            },
              React.createElement('div', null, 'Date'),
              React.createElement('div', null, 'Ticker'),
              React.createElement('div', null, 'Direction'),
              React.createElement('div', null, 'Delta'),
              React.createElement('div', { style: { textAlign: 'right' } }, 'Post-Supply')
            ),
            movers.map(function (m, i) {
              return React.createElement('div', {
                key: 'mv' + i,
                style: {
                  display: 'grid',
                  gridTemplateColumns: '90px 70px 110px 1fr 120px',
                  padding: '8px 0', borderBottom: '1px solid ' + T.edge,
                  fontFamily: T.mono, fontSize: 11, color: T.text, alignItems: 'center',
                },
              },
                React.createElement('div', null, fmtDateShort(m.date)),
                React.createElement('div', { style: { color: T.signal, fontWeight: 600 } }, m.ticker),
                React.createElement('div', {
                  style: {
                    color: m.direction === 'mint' ? T.bull : T.bear,
                    letterSpacing: 0.6, textTransform: 'uppercase', fontSize: 10,
                  },
                }, m.direction === 'mint' ? '▲ mint' : '▼ burn'),
                React.createElement('div', { style: { color: colorFor(m.delta) } }, fmtDelta(m.delta)),
                React.createElement('div', { style: { textAlign: 'right', color: T.textMid } }, fmtUsd(m.supply))
              );
            })
          )
    );

    var overlay = {
      position: 'fixed', inset: 0, zIndex: 9000,
      background: 'rgba(4,6,10,0.82)', backdropFilter: 'blur(6px)',
      display: 'flex', alignItems: 'stretch', justifyContent: 'center',
      fontFamily: T.sans, color: T.text,
    };
    var shell = {
      flex: 1, margin: '2vh 2vw', background: T.ink100,
      border: '1px solid ' + T.edge, borderRadius: 10, overflow: 'hidden',
      display: 'flex', flexDirection: 'column',
    };
    var body = {
      flex: 1, overflowY: 'auto', padding: '16px 18px', background: T.ink000,
    };

    return React.createElement('div', { style: overlay, onClick: onClose },
      React.createElement('div', {
        style: shell,
        onClick: function (e) { e.stopPropagation(); },
      },
        // HEADER
        React.createElement('div', {
          style: {
            padding: '14px 20px', borderBottom: '1px solid ' + T.edge,
            display: 'flex', alignItems: 'center', gap: 14, background: T.ink200,
          },
        },
          React.createElement('div', null,
            React.createElement('div', {
              style: {
                fontSize: 10, letterSpacing: 1.4, color: T.signal,
                textTransform: 'uppercase', fontWeight: 600,
              },
            }, 'Stablecoin Mint / Burn · Liquidity Proxy'),
            React.createElement('div', {
              style: { fontSize: 13, color: T.text, fontWeight: 500 },
            }, 'USDT · USDC · DAI supply changes')
          ),
          React.createElement('div', { style: { flex: 1 } }),
          React.createElement('button', {
            onClick: function () { refresh(true); },
            style: {
              background: 'transparent', color: T.textMid,
              border: '1px solid ' + T.edge,
              padding: '5px 12px', borderRadius: 4, cursor: 'pointer',
              fontSize: 11, fontFamily: T.mono, letterSpacing: 0.4,
            },
          }, loading ? '…' : 'REFRESH'),
          React.createElement('div', {
            style: {
              fontFamily: T.mono, fontSize: 10, color: T.textDim,
              padding: '5px 10px',
            },
          }, 'updated ' + fmtAge(upd)),
          React.createElement('button', {
            onClick: onClose,
            style: {
              background: 'transparent', color: T.textMid,
              border: '1px solid ' + T.edge,
              padding: '5px 12px', borderRadius: 4, cursor: 'pointer',
              fontSize: 11, fontFamily: T.mono, letterSpacing: 0.4,
            },
          }, 'CLOSE ✕')
        ),
        React.createElement('div', { style: body },
          err && React.createElement('div', {
            style: {
              padding: '10px 14px', marginBottom: 14,
              background: 'rgba(217,107,107,0.08)',
              border: '1px solid rgba(217,107,107,0.25)', borderRadius: 6,
              color: T.bear, fontFamily: T.mono, fontSize: 11,
            },
          }, 'Upstream issue: ' + err + ' · showing last-known values where possible.'),
          supplyStrip,
          chartHost,
          moversHost
        )
      )
    );
  }

  // ---------- tile ----------
  function TRStablesTile(props) {
    var onOpen = props && props.onOpen;
    var h = React.useState(null); var snap = h[0]; var setSnap = h[1];

    React.useEffect(function () {
      if (!window.StableData) return;
      var mounted = true;
      window.StableData.getAllCurrent()
        .then(function (s) { if (mounted) setSnap(s); })
        .catch(function () {});
      return function () { mounted = false; };
    }, []);

    var totalDelta = snap && snap.TOTAL ? snap.TOTAL.delta24h : null;

    return React.createElement('button', {
      onClick: function () {
        if (onOpen) onOpen();
        else if (typeof window.openTRStables === 'function') window.openTRStables();
      },
      style: {
        display: 'inline-flex', alignItems: 'center', gap: 8,
        background: T.ink200, border: '1px solid ' + T.edgeHi,
        padding: '6px 12px', borderRadius: 5, cursor: 'pointer',
        fontFamily: T.mono, fontSize: 11, color: T.text, letterSpacing: 0.4,
      },
    },
      React.createElement('span', { style: { fontSize: 13 } }, '💵'),
      React.createElement('span', { style: { color: T.signal, fontWeight: 600 } }, 'STABLES'),
      React.createElement('span', { style: { color: T.textDim } }, '·'),
      React.createElement('span', { style: { color: T.textMid } }, '24H'),
      React.createElement('span', {
        style: { color: colorFor(totalDelta), fontWeight: 600 },
      }, totalDelta == null ? '—' : fmtDelta(totalDelta))
    );
  }

  // ---------- global trigger ----------
  window.openTRStables = function openTRStables() {
    try { window.dispatchEvent(new CustomEvent('tr:open-stables')); } catch (_) {}
  };
  window.TRStablesPanel = TRStablesPanel;
  window.TRStablesTile  = TRStablesTile;
})();
