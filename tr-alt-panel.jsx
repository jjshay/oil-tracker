// tr-alt-panel.jsx — Altcoin flow + dominance dashboard.
//
// Exposes:
//   window.TRAltPanel({ open, onClose })  — full modal
//   window.openTRAlt()                     — fires 'tr:open-alt' CustomEvent
//
// Depends on window.AltFlow (engine/alt-flow.js).

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

  // ---------- formatters ----------
  function fmtUsd(x) {
    if (x == null || !isFinite(x)) return '—';
    var abs = Math.abs(x);
    if (abs >= 1000)   return '$' + abs.toLocaleString(undefined, { maximumFractionDigits: 0 });
    if (abs >= 1)      return '$' + abs.toFixed(2);
    if (abs >= 0.01)   return '$' + abs.toFixed(4);
    return '$' + abs.toFixed(6);
  }
  function fmtUsdBig(x) {
    if (x == null || !isFinite(x)) return '—';
    var abs = Math.abs(x);
    if (abs >= 1e12) return '$' + (abs / 1e12).toFixed(2) + 'T';
    if (abs >= 1e9)  return '$' + (abs / 1e9).toFixed(2)  + 'B';
    if (abs >= 1e6)  return '$' + (abs / 1e6).toFixed(1)  + 'M';
    if (abs >= 1e3)  return '$' + (abs / 1e3).toFixed(1)  + 'K';
    return '$' + abs.toFixed(0);
  }
  function fmtPct(x) {
    if (x == null || !isFinite(x)) return '—';
    return (x >= 0 ? '+' : '') + x.toFixed(2) + '%';
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

  // ---------- sparkline ----------
  function Sparkline(props) {
    var data = props.data || [];
    var w = props.width || 80;
    var h = props.height || 20;
    var color = props.color || T.signal;
    if (!data.length) {
      return React.createElement('div', {
        style: { width: w, height: h, fontFamily: T.mono, fontSize: 9, color: T.textDim,
                 display: 'flex', alignItems: 'center' },
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
        points: pts.join(' '), fill: 'none', stroke: color, strokeWidth: 1.1, strokeLinejoin: 'round',
      })
    );
  }

  // ---------- main panel ----------
  function TRAltPanel(props) {
    var open = props && props.open;
    var onClose = props && props.onClose;

    var s1 = React.useState('gainers');  var tab = s1[0];       var setTab = s1[1];
    var s2 = React.useState(1);           var days = s2[0];      var setDays = s2[1];
    var s3 = React.useState(null);        var gainers = s3[0];   var setGainers = s3[1];
    var s4 = React.useState(null);        var losers  = s4[0];   var setLosers  = s4[1];
    var s5 = React.useState(null);        var trending = s5[0];  var setTrending = s5[1];
    var s6 = React.useState(null);        var dom = s6[0];       var setDom = s6[1];
    var s7 = React.useState(false);       var loading = s7[0];   var setLoading = s7[1];
    var s8 = React.useState(null);        var err = s8[0];       var setErr = s8[1];
    var s9 = React.useState(null);        var updatedAt = s9[0]; var setUpdatedAt = s9[1];
    var sA = React.useState(null);        var prevDom = sA[0];   var setPrevDom = sA[1];

    var refresh = React.useCallback(async function (force) {
      if (!window.AltFlow) { setErr('AltFlow engine missing'); return; }
      setLoading(true); setErr(null);
      try {
        if (force) { try { window.AltFlow.clearCache(); } catch (_) {} }
        var out = await Promise.all([
          window.AltFlow.getTopGainers(days, 20),
          window.AltFlow.getTopLosers(days, 20),
          window.AltFlow.getTrending(),
          window.AltFlow.getDominance(),
        ]);
        setGainers(out[0] || []);
        setLosers(out[1]  || []);
        setTrending(out[2] || []);
        // snapshot previous dominance for delta arrows
        if (dom && out[3]) setPrevDom(dom);
        setDom(out[3] || null);
        if (!out[0] && !out[2] && !out[3]) setErr('data source unreachable');
        setUpdatedAt(Date.now());
      } catch (e) {
        setErr((e && e.message) ? e.message : 'fetch failed');
      } finally {
        setLoading(false);
      }
    // eslint-disable-next-line
    }, [days]);

    React.useEffect(function () {
      if (!open) return;
      refresh(false);
      var iv = setInterval(function () { refresh(false); }, 10 * 60 * 1000);
      return function () { clearInterval(iv); };
    }, [open, refresh]);

    if (!open) return null;

    var lastUpdated = updatedAt ? fmtAge(updatedAt) : '—';

    var tabBtn = function (key, label) {
      var active = tab === key;
      return React.createElement('div', {
        key: key,
        onClick: function () { setTab(key); },
        style: {
          padding: '6px 16px', fontFamily: T.mono, fontSize: 11, fontWeight: 700,
          letterSpacing: 0.8, cursor: 'pointer', borderRadius: 6,
          color: active ? T.ink000 : T.textMid,
          background: active ? T.signal : T.ink200,
          border: '1px solid ' + T.edge,
        },
      }, label);
    };

    var dayBtn = function (d, label) {
      var active = days === d;
      return React.createElement('div', {
        key: d,
        onClick: function () { setDays(d); },
        style: {
          padding: '4px 10px', fontFamily: T.mono, fontSize: 10, fontWeight: 600,
          letterSpacing: 0.6, cursor: 'pointer', borderRadius: 4,
          color: active ? T.text : T.textDim,
          background: active ? T.ink300 : 'transparent',
          border: '1px solid ' + (active ? T.edgeHi : T.edge),
        },
      }, label);
    };

    var activeList = tab === 'gainers' ? (gainers || [])
                   : tab === 'losers'  ? (losers  || [])
                   : (trending || []);

    // Dominance deltas (BTC)
    var btcNow = dom ? dom.btc : null;
    var btcPrev = prevDom ? prevDom.btc : null;
    var btcDelta = (btcNow != null && btcPrev != null) ? (btcNow - btcPrev) : null;

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
          width: 940, maxHeight: '94%', overflow: 'auto',
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
          }, 'Altcoin Flow · CoinGecko'),
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

        // Dominance strip — BTC hero + ETH / Stable / Alt
        React.createElement('div', {
          style: {
            display: 'grid', gridTemplateColumns: '1.6fr 1fr 1fr 1fr', gap: 10,
            padding: '14px 16px',
            background: T.ink200, border: '1px solid ' + T.edge, borderRadius: 8,
            marginBottom: 14,
          },
        },
          // BTC hero
          React.createElement('div', null,
            React.createElement('div', {
              style: { fontSize: 9, letterSpacing: 0.8, color: T.textDim,
                       textTransform: 'uppercase', fontWeight: 600 },
            }, 'BTC Dominance'),
            React.createElement('div', {
              style: { display: 'flex', alignItems: 'baseline', gap: 8, marginTop: 4 },
            },
              React.createElement('div', {
                style: { fontFamily: T.mono, fontSize: 26, fontWeight: 600, color: T.signal },
              }, btcNow != null ? btcNow.toFixed(2) + '%' : '—'),
              btcDelta != null ? React.createElement('div', {
                style: { fontFamily: T.mono, fontSize: 11, fontWeight: 600,
                         color: colorForPct(btcDelta) },
              }, (btcDelta >= 0 ? '+' : '') + btcDelta.toFixed(2) + ' bp') : null
            )
          ),
          domCell('ETH',    dom ? dom.eth    : null),
          domCell('Stable', dom ? dom.stable : null),
          domCell('Alt',    dom ? dom.alt    : null)
        ),

        // Tabs + day selector
        React.createElement('div', {
          style: { display: 'flex', alignItems: 'center', gap: 8, marginBottom: 14 },
        },
          tabBtn('gainers',  'GAINERS'),
          tabBtn('losers',   'LOSERS'),
          tabBtn('trending', 'TRENDING'),
          tab !== 'trending' ? React.createElement('div', {
            style: { display: 'flex', gap: 4, marginLeft: 'auto' },
          },
            dayBtn(1,  '24H'),
            dayBtn(7,  '7D'),
            dayBtn(30, '30D')
          ) : null
        ),

        // List
        (tab === 'trending')
          ? renderTrending(trending || [])
          : renderMarketList(activeList, days)
      )
    );
  }

  function domCell(label, val) {
    return React.createElement('div', null,
      React.createElement('div', {
        style: { fontSize: 9, letterSpacing: 0.8, color: T.textDim,
                 textTransform: 'uppercase', fontWeight: 600 },
      }, label),
      React.createElement('div', {
        style: { fontFamily: T.mono, fontSize: 18, fontWeight: 600,
                 color: T.text, marginTop: 4 },
      }, val != null ? val.toFixed(2) + '%' : '—')
    );
  }

  function renderMarketList(rows, days) {
    if (!rows || !rows.length) {
      return React.createElement('div', {
        style: {
          padding: '24px 12px', textAlign: 'center',
          background: T.ink200, border: '1px solid ' + T.edge, borderRadius: 8,
          fontFamily: T.mono, fontSize: 11, color: T.textDim,
        },
      }, 'No market data.');
    }
    var d = (days === 7 || days === 30) ? days : 1;
    var header = React.createElement('div', {
      style: {
        display: 'grid',
        gridTemplateColumns: '32px 64px 1fr 120px 80px 80px 100px',
        gap: 8, padding: '8px 12px',
        fontSize: 9, letterSpacing: 0.8, color: T.textDim,
        textTransform: 'uppercase', fontWeight: 700,
        borderBottom: '1px solid ' + T.edge,
      },
    },
      React.createElement('div', null, '#'),
      React.createElement('div', null, 'Sym'),
      React.createElement('div', null, 'Name'),
      React.createElement('div', { style: { textAlign: 'right' } }, 'Price'),
      React.createElement('div', { style: { textAlign: 'right' } }, '24h'),
      React.createElement('div', { style: { textAlign: 'right' } }, d === 1 ? '7d' : d === 7 ? '7d' : '30d'),
      React.createElement('div', { style: { textAlign: 'right' } }, '7d Chart')
    );

    var list = rows.map(function (r, idx) {
      var changeSel = d === 7 ? r.change7d : d === 30 ? r.change30d : r.change24h;
      var secondary = d === 1 ? r.change7d : d === 7 ? r.change24h : r.change7d;
      return React.createElement('div', {
        key: (r.id || r.symbol) + '_' + idx,
        onClick: function () {
          if (r.id) window.open('https://www.coingecko.com/en/coins/' + r.id, '_blank');
        },
        style: {
          display: 'grid',
          gridTemplateColumns: '32px 64px 1fr 120px 80px 80px 100px',
          gap: 8, padding: '9px 12px', alignItems: 'center',
          fontFamily: T.mono, fontSize: 11,
          borderBottom: '0.5px solid ' + T.edge,
          cursor: 'pointer',
          background: idx % 2 === 0 ? 'transparent' : 'rgba(255,255,255,0.015)',
        },
      },
        React.createElement('div', {
          style: { color: T.textDim },
        }, r.mcap_rank || idx + 1),
        React.createElement('div', {
          style: { display: 'flex', alignItems: 'center', gap: 6 },
        },
          r.image ? React.createElement('img', {
            src: r.image, alt: '', width: 14, height: 14,
            style: { borderRadius: 7, background: T.ink300 },
          }) : null,
          React.createElement('span', {
            style: { color: T.text, fontWeight: 700 },
          }, r.symbol)
        ),
        React.createElement('div', {
          style: { fontFamily: T.sans, color: T.textMid, fontSize: 12,
                   whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' },
        }, r.name),
        React.createElement('div', {
          style: { textAlign: 'right', color: T.text, fontWeight: 600 },
        }, fmtUsd(r.price)),
        React.createElement('div', {
          style: { textAlign: 'right', color: colorForPct(changeSel), fontWeight: 600 },
        }, fmtPct(changeSel)),
        React.createElement('div', {
          style: { textAlign: 'right', color: colorForPct(secondary) },
        }, fmtPct(secondary)),
        React.createElement('div', {
          style: { display: 'flex', justifyContent: 'flex-end' },
        },
          React.createElement(Sparkline, {
            data: r.sparkline || [], width: 90, height: 22,
            color: changeSel >= 0 ? T.bull : T.bear,
          })
        )
      );
    });

    return React.createElement('div', {
      style: {
        background: T.ink200, border: '1px solid ' + T.edge, borderRadius: 8,
        overflow: 'hidden',
      },
    }, header, list);
  }

  function renderTrending(rows) {
    if (!rows || !rows.length) {
      return React.createElement('div', {
        style: {
          padding: '24px 12px', textAlign: 'center',
          background: T.ink200, border: '1px solid ' + T.edge, borderRadius: 8,
          fontFamily: T.mono, fontSize: 11, color: T.textDim,
        },
      }, 'No trending data.');
    }
    return React.createElement('div', {
      style: {
        display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: 10,
      },
    }, rows.slice(0, 14).map(function (r, idx) {
      return React.createElement('div', {
        key: (r.id || r.symbol) + '_' + idx,
        onClick: function () {
          if (r.id) window.open('https://www.coingecko.com/en/coins/' + r.id, '_blank');
        },
        style: {
          padding: '11px 14px',
          background: T.ink200, border: '1px solid ' + T.edge, borderRadius: 8,
          display: 'flex', alignItems: 'center', gap: 10, cursor: 'pointer',
        },
      },
        r.thumb ? React.createElement('img', {
          src: r.thumb, alt: '', width: 18, height: 18,
          style: { borderRadius: 9, background: T.ink300 },
        }) : React.createElement('div', {
          style: { width: 18, height: 18, borderRadius: 9, background: T.ink300 },
        }),
        React.createElement('div', {
          style: { fontFamily: T.mono, fontSize: 11, fontWeight: 700, color: T.text, letterSpacing: 0.6 },
        }, r.symbol),
        React.createElement('div', {
          style: { fontFamily: T.sans, fontSize: 12, color: T.textMid,
                   whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
                   flex: 1 },
        }, r.name),
        React.createElement('div', {
          style: { fontFamily: T.mono, fontSize: 10, color: T.textDim, letterSpacing: 0.4 },
        }, r.mcap_rank !== 9999 ? '#' + r.mcap_rank : '—')
      );
    }));
  }

  window.openTRAlt = function openTRAlt() {
    try { window.dispatchEvent(new CustomEvent('tr:open-alt')); } catch (_) {}
  };
  window.TRAltPanel = TRAltPanel;
})();
