// tr-defi-panel.jsx — DeFi TVL dashboard (DeFiLlama-sourced).
//
// Exposes:
//   window.TRDeFiPanel({ open, onClose })  — full modal
//   window.openTRDeFi()                     — fires 'tr:open-defi' CustomEvent
//
// Depends on window.DeFiTVL (engine/defi-tvl.js). Degrades gracefully when the
// engine is missing or the API is unreachable.

(function () {
  if (typeof window === 'undefined') return;

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

  // DeFiLlama chain names (matching /chains response).
  var CHAINS = [
    { key: 'all',       label: 'ALL' },
    { key: 'Ethereum',  label: 'ETH' },
    { key: 'Solana',    label: 'SOL' },
    { key: 'Base',      label: 'BASE' },
    { key: 'BSC',       label: 'BSC' },
    { key: 'Arbitrum',  label: 'ARB' },
    { key: 'Tron',      label: 'TRX' },
    { key: 'Polygon',   label: 'POLY' },
  ];

  // ---------- formatters ----------
  function fmtUsdBig(x) {
    if (x == null || !isFinite(x)) return '—';
    var abs = Math.abs(x);
    var sign = x < 0 ? '-' : '';
    if (abs >= 1e12) return sign + '$' + (abs / 1e12).toFixed(2) + 'T';
    if (abs >= 1e9)  return sign + '$' + (abs / 1e9).toFixed(2)  + 'B';
    if (abs >= 1e6)  return sign + '$' + (abs / 1e6).toFixed(1)  + 'M';
    if (abs >= 1e3)  return sign + '$' + (abs / 1e3).toFixed(1)  + 'K';
    return sign + '$' + abs.toFixed(0);
  }
  function fmtPct(x) {
    if (x == null || !isFinite(x)) return '—';
    var s = (x >= 0 ? '+' : '') + x.toFixed(2) + '%';
    return s;
  }
  function colorForPct(x) {
    if (x == null || !isFinite(x) || x === 0) return T.textDim;
    return x > 0 ? T.bull : T.bear;
  }
  function fmtAge(ts) {
    if (!ts) return '—';
    var d = Date.now() - ts;
    if (d < 60000) return Math.round(d / 1000) + 's ago';
    if (d < 3600000) return Math.round(d / 60000) + 'm ago';
    if (d < 86400000) return Math.round(d / 3600000) + 'h ago';
    return Math.round(d / 86400000) + 'd ago';
  }

  // ---------- sparkline (from history[]) ----------
  function Sparkline(props) {
    var data = props.data || [];
    var w = props.width || 90;
    var h = props.height || 22;
    var color = props.color || T.signal;
    if (!data.length) {
      return React.createElement('div', {
        style: { width: w, height: h, fontFamily: T.mono, fontSize: 9,
                 color: T.textDim, display: 'flex', alignItems: 'center' },
      }, '—');
    }
    var min = Infinity, max = -Infinity;
    for (var i = 0; i < data.length; i++) {
      var v = data[i];
      if (!isFinite(v)) continue;
      if (v < min) min = v; if (v > max) max = v;
    }
    if (!isFinite(min) || !isFinite(max) || max === min) max = min + 1;
    var pts = [];
    for (var j = 0; j < data.length; j++) {
      var x = (j / (data.length - 1)) * w;
      var y = h - ((data[j] - min) / (max - min)) * h;
      pts.push(x.toFixed(1) + ',' + y.toFixed(1));
    }
    return React.createElement('svg', {
      width: w, height: h, viewBox: '0 0 ' + w + ' ' + h, style: { display: 'block' },
    },
      React.createElement('polyline', {
        points: pts.join(' '), fill: 'none', stroke: color, strokeWidth: 1.2, strokeLinejoin: 'round',
      })
    );
  }

  // ---------- main panel ----------
  function TRDeFiPanel(props) {
    var open = props && props.open;
    var onClose = props && props.onClose;

    var s1 = React.useState(null);    var totalTvl = s1[0];  var setTotalTvl = s1[1];
    var s2 = React.useState(null);    var history  = s2[0];  var setHistory  = s2[1];
    var s3 = React.useState(null);    var protos   = s3[0];  var setProtos   = s3[1];
    var s4 = React.useState(null);    var chains   = s4[0];  var setChains   = s4[1];
    var s5 = React.useState('all');   var chainKey = s5[0];  var setChainKey = s5[1];
    var s6 = React.useState(false);   var loading  = s6[0];  var setLoading  = s6[1];
    var s7 = React.useState(null);    var err      = s7[0];  var setErr      = s7[1];
    var s8 = React.useState(null);    var updatedAt = s8[0]; var setUpdatedAt = s8[1];

    var refresh = React.useCallback(async function (force) {
      if (!window.DeFiTVL) { setErr('DeFiTVL engine missing'); return; }
      setLoading(true); setErr(null);
      try {
        if (force) { try { window.DeFiTVL.clearCache(); } catch (_) {} }
        var results = await Promise.all([
          window.DeFiTVL.getTotalTVL(),
          window.DeFiTVL.getHistory(30),
          window.DeFiTVL.getTopProtocols(20),
          window.DeFiTVL.getByChain(),
        ]);
        setTotalTvl(results[0]);
        setHistory(results[1] || []);
        setProtos(results[2] || []);
        setChains(results[3] || {});
        if (results[0] == null && (!results[2] || !results[2].length)) {
          setErr('data source unreachable');
        }
        setUpdatedAt(Date.now());
      } catch (e) {
        setErr((e && e.message) ? e.message : 'fetch failed');
      } finally {
        setLoading(false);
      }
    }, []);

    React.useEffect(function () {
      if (!open) return;
      refresh(false);
      var iv = setInterval(function () { refresh(false); }, 10 * 60 * 1000);
      return function () { clearInterval(iv); };
    }, [open, refresh]);

    if (!open) return null;

    // Derived numbers
    var hist = history || [];
    var delta7 = null, delta30 = null;
    if (hist.length >= 8) {
      var todayTvl = hist[hist.length - 1].tvl;
      var sevenAgo = hist[hist.length - 8].tvl;
      if (sevenAgo > 0) delta7 = ((todayTvl - sevenAgo) / sevenAgo) * 100;
    }
    if (hist.length >= 2) {
      var todayTvl2 = hist[hist.length - 1].tvl;
      var firstTvl  = hist[0].tvl;
      if (firstTvl > 0) delta30 = ((todayTvl2 - firstTvl) / firstTvl) * 100;
    }
    var sparkValues = hist.map(function (r) { return r.tvl; });
    var headerTvl = (totalTvl != null) ? totalTvl
                    : (hist.length ? hist[hist.length - 1].tvl : null);

    // Filter protocols by selected chain
    var protosShown = (protos || []).filter(function (p) {
      if (chainKey === 'all') return true;
      if (!p.chains || !p.chains.length) {
        return (p.chain || '').toLowerCase() === chainKey.toLowerCase();
      }
      for (var i = 0; i < p.chains.length; i++) {
        if (String(p.chains[i]).toLowerCase() === chainKey.toLowerCase()) return true;
      }
      return false;
    }).slice(0, 12);

    // chain-specific TVL for badge
    var chainTvl = null;
    if (chainKey !== 'all' && chains) {
      var cRow = chains[chainKey.toLowerCase()];
      if (cRow) chainTvl = cRow.tvl;
    }

    var lastUpdated = updatedAt ? fmtAge(updatedAt) : '—';

    var chainBtn = function (c) {
      var active = chainKey === c.key;
      return React.createElement('div', {
        key: c.key,
        onClick: function () { setChainKey(c.key); },
        style: {
          padding: '5px 12px', fontFamily: T.mono, fontSize: 10.5, fontWeight: 700,
          letterSpacing: 0.8, cursor: 'pointer', borderRadius: 5,
          color: active ? T.ink000 : T.textMid,
          background: active ? T.signal : T.ink200,
          border: '1px solid ' + T.edge,
        },
      }, c.label);
    };

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
          width: 960, maxHeight: '94%', overflow: 'auto',
          background: T.ink100, border: '1px solid ' + T.edgeHi, borderRadius: 14,
          padding: '22px 26px', color: T.text, fontFamily: T.sans,
          boxShadow: '0 24px 80px rgba(0,0,0,0.6)',
        },
      },
        // Header
        React.createElement('div', {
          style: { display: 'flex', alignItems: 'center', gap: 12, marginBottom: 14 },
        },
          React.createElement('div', {
            style: { fontSize: 10, letterSpacing: 1.2, color: T.textDim,
                     textTransform: 'uppercase', fontWeight: 600 },
          }, 'DeFi TVL · DeFiLlama'),
          React.createElement('div', {
            style: {
              padding: '2px 8px', fontFamily: T.mono, fontSize: 9.5, fontWeight: 600,
              letterSpacing: 0.6,
              color: loading ? T.signal : (err ? T.bear : T.bull),
              background: loading ? 'rgba(201,162,39,0.10)'
                        : err ? 'rgba(217,107,107,0.10)'
                        : 'rgba(111,207,142,0.10)',
              borderRadius: 4,
              border: '0.5px solid ' + (loading ? 'rgba(201,162,39,0.4)'
                                        : err ? 'rgba(217,107,107,0.4)'
                                        : 'rgba(111,207,142,0.4)'),
            },
          }, loading ? 'LOADING' : err ? 'OFFLINE' : 'LIVE'),
          React.createElement('div', {
            style: { fontFamily: T.mono, fontSize: 9.5, color: T.textDim, letterSpacing: 0.4 },
          }, 'UPDATED · ' + lastUpdated),
          React.createElement('div', { style: { marginLeft: 'auto', display: 'flex', gap: 8 } },
            React.createElement('div', {
              onClick: function () { refresh(true); },
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
            }, '×')
          )
        ),

        err ? React.createElement('div', {
          style: {
            padding: '9px 12px', marginBottom: 12,
            background: 'rgba(217,107,107,0.08)', border: '1px solid rgba(217,107,107,0.3)',
            borderRadius: 6, fontFamily: T.mono, fontSize: 10.5, color: T.bear, letterSpacing: 0.4,
          },
        }, 'DATA · ' + err + ' · retry later') : null,

        // Headline strip
        React.createElement('div', {
          style: {
            display: 'grid', gridTemplateColumns: '1.4fr 0.9fr 0.9fr 1.4fr', gap: 10,
            padding: '14px 16px',
            background: T.ink200, border: '1px solid ' + T.edge, borderRadius: 8,
            marginBottom: 14,
          },
        },
          // total TVL
          React.createElement('div', null,
            React.createElement('div', {
              style: { fontSize: 9, letterSpacing: 0.8, color: T.textDim,
                       textTransform: 'uppercase', fontWeight: 600 },
            }, chainKey === 'all' ? 'Total TVL' : (chainKey + ' TVL')),
            React.createElement('div', {
              style: { fontFamily: T.mono, fontSize: 22, fontWeight: 600,
                       color: T.text, marginTop: 4 },
            }, fmtUsdBig(chainKey === 'all' ? headerTvl : chainTvl))
          ),
          // 7d delta
          React.createElement('div', null,
            React.createElement('div', {
              style: { fontSize: 9, letterSpacing: 0.8, color: T.textDim,
                       textTransform: 'uppercase', fontWeight: 600 },
            }, '7d Δ'),
            React.createElement('div', {
              style: { fontFamily: T.mono, fontSize: 18, fontWeight: 600,
                       color: colorForPct(delta7), marginTop: 4 },
            }, fmtPct(delta7))
          ),
          // 30d delta
          React.createElement('div', null,
            React.createElement('div', {
              style: { fontSize: 9, letterSpacing: 0.8, color: T.textDim,
                       textTransform: 'uppercase', fontWeight: 600 },
            }, '30d Δ'),
            React.createElement('div', {
              style: { fontFamily: T.mono, fontSize: 18, fontWeight: 600,
                       color: colorForPct(delta30), marginTop: 4 },
            }, fmtPct(delta30))
          ),
          // sparkline
          React.createElement('div', { style: { display: 'flex', alignItems: 'center' } },
            React.createElement(Sparkline, { data: sparkValues, width: 220, height: 40,
              color: (delta30 != null && delta30 < 0) ? T.bear : T.bull })
          )
        ),

        // Chain toggle
        React.createElement('div', {
          style: { display: 'flex', gap: 6, marginBottom: 14, flexWrap: 'wrap' },
        }, CHAINS.map(chainBtn)),

        // Protocol grid
        React.createElement('div', {
          style: { fontSize: 9, letterSpacing: 0.8, color: T.textDim,
                   textTransform: 'uppercase', fontWeight: 600, marginBottom: 8 },
        }, 'Top 12 Protocols' + (chainKey !== 'all' ? ' · ' + chainKey : '')),

        React.createElement('div', {
          style: {
            display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 10,
          },
        }, (protosShown.length ? protosShown : []).map(function (p, idx) {
          return React.createElement('div', {
            key: (p.slug || p.name) + '_' + idx,
            style: {
              padding: '12px 14px',
              background: T.ink200, border: '1px solid ' + T.edge, borderRadius: 8,
              display: 'flex', flexDirection: 'column', gap: 6,
            },
          },
            React.createElement('div', {
              style: { display: 'flex', alignItems: 'center', gap: 8 },
            },
              p.logo ? React.createElement('img', {
                src: p.logo, alt: '', width: 18, height: 18,
                style: { borderRadius: 4, background: T.ink300 },
              }) : React.createElement('div', {
                style: { width: 18, height: 18, borderRadius: 4, background: T.ink300 },
              }),
              React.createElement('div', {
                style: { fontFamily: T.sans, fontSize: 13, fontWeight: 600, color: T.text,
                         whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' },
              }, p.name),
              p.category ? React.createElement('div', {
                style: { marginLeft: 'auto', fontFamily: T.mono, fontSize: 8.5,
                         color: T.textDim, letterSpacing: 0.5, textTransform: 'uppercase' },
              }, p.category) : null
            ),
            React.createElement('div', {
              style: { display: 'flex', alignItems: 'baseline', gap: 8 },
            },
              React.createElement('div', {
                style: { fontFamily: T.mono, fontSize: 16, fontWeight: 600, color: T.text },
              }, fmtUsdBig(p.tvl)),
              React.createElement('div', {
                style: { fontFamily: T.mono, fontSize: 11, fontWeight: 600,
                         color: colorForPct(p.change7d) },
              }, fmtPct(p.change7d) + ' 7d')
            ),
            React.createElement('div', {
              style: { display: 'flex', alignItems: 'center', justifyContent: 'space-between' },
            },
              React.createElement('div', {
                style: { fontFamily: T.mono, fontSize: 10, color: T.textDim, letterSpacing: 0.4 },
              }, '1d ' + fmtPct(p.change1d)),
              React.createElement(Sparkline, {
                data: buildSparkFromChanges(p), width: 90, height: 22,
                color: p.change7d >= 0 ? T.bull : T.bear,
              })
            )
          );
        })),

        (!protosShown.length && !loading) ? React.createElement('div', {
          style: {
            padding: '24px 12px', textAlign: 'center',
            background: T.ink200, border: '1px solid ' + T.edge, borderRadius: 8,
            fontFamily: T.mono, fontSize: 11, color: T.textDim,
          },
        }, 'No protocols match this chain.') : null
      )
    );
  }

  // Cheap synthetic sparkline from 1d / 7d / 30d changes (no per-protocol
  // history call — DeFiLlama charges for that and we want zero-key).
  function buildSparkFromChanges(p) {
    var c30 = Number(p.change30d) || 0;
    var c7  = Number(p.change7d)  || 0;
    var c1  = Number(p.change1d)  || 0;
    // 12 points from 30d ago → now. Easing via linear interp.
    var now = 100;
    var d30 = now / (1 + c30 / 100);
    var d7  = now / (1 + c7 / 100);
    var d1  = now / (1 + c1 / 100);
    return [d30, (d30 + d7) / 2, d7, (d7 * 2 + d1) / 3, d1, now];
  }

  window.openTRDeFi = function openTRDeFi() {
    try { window.dispatchEvent(new CustomEvent('tr:open-defi')); } catch (_) {}
  };
  window.TRDeFiPanel = TRDeFiPanel;
})();
