// tr-cot-panel.jsx — CFTC COT (Commitment of Traders) speculator positioning.
//
// Exposes:
//   window.TRCOTPanel({ open, onClose })   — modal with category tabs + commodity grid.
//   window.openTRCOT()                      — fires 'tr:open-cot' CustomEvent.
//
// Depends on window.COTData (engine/cot.js).

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

  function fmtK(n) {
    if (n == null || !isFinite(n)) return '—';
    var sign = n < 0 ? '-' : '';
    var abs = Math.abs(n);
    if (abs >= 1_000_000) return sign + (abs / 1_000_000).toFixed(2) + 'M';
    if (abs >= 10_000) return sign + (abs / 1000).toFixed(0) + 'K';
    if (abs >= 1_000) return sign + (abs / 1000).toFixed(1) + 'K';
    return sign + abs.toFixed(0);
  }
  function fmtDelta(n) {
    if (n == null || !isFinite(n)) return '—';
    var sign = n > 0 ? '+' : n < 0 ? '-' : '';
    var abs = Math.abs(n);
    if (abs >= 10_000) return sign + (abs / 1000).toFixed(0) + 'K';
    if (abs >= 1_000) return sign + (abs / 1000).toFixed(1) + 'K';
    return sign + abs.toFixed(0);
  }
  function colorForNet(n) {
    if (n == null || !isFinite(n) || n === 0) return T.textDim;
    return n > 0 ? T.bull : T.bear;
  }
  function colorForDelta(n) {
    if (n == null || !isFinite(n) || n === 0) return T.textDim;
    return n > 0 ? T.bull : T.bear;
  }
  function fmtDate(iso) {
    if (!iso) return '—';
    var m = iso.match(/^(\d{4})-(\d{2})-(\d{2})/);
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

  // Multi-week sparkline from `recent` rows (newest-first). Draws oldest-left.
  function NetSparkline(props) {
    var rows = props.rows || [];
    var width = props.width || 200;
    var height = props.height || 36;
    if (!rows.length) {
      return React.createElement('div', {
        style: { width: width, height: height, fontFamily: T.mono, fontSize: 9,
                 color: T.textDim, display: 'flex', alignItems: 'center' },
      }, '—');
    }
    var series = rows.slice().reverse().map(function (r) { return r.net; });
    var min = Math.min.apply(null, series);
    var max = Math.max.apply(null, series);
    var span = max - min || 1;
    var step = series.length > 1 ? width / (series.length - 1) : 0;

    // Zero-line reference.
    var zeroY = null;
    if (min < 0 && max > 0) {
      zeroY = height - ((0 - min) / span) * (height - 2) - 1;
    }

    var path = '';
    var areaPath = '';
    for (var i = 0; i < series.length; i++) {
      var x = i * step;
      var y = height - ((series[i] - min) / span) * (height - 2) - 1;
      path += (i === 0 ? 'M' : 'L') + x.toFixed(1) + ' ' + y.toFixed(1) + ' ';
      areaPath += (i === 0 ? 'M' : 'L') + x.toFixed(1) + ' ' + y.toFixed(1) + ' ';
    }
    var last = series[series.length - 1];
    var strokeColor = last >= 0 ? T.bull : T.bear;

    var els = [];
    if (zeroY != null) {
      els.push(React.createElement('line', {
        key: 'zero', x1: 0, x2: width, y1: zeroY, y2: zeroY,
        stroke: T.edgeHi, strokeWidth: 0.5, strokeDasharray: '3,3',
      }));
    }
    els.push(React.createElement('path', {
      key: 'p', d: path, fill: 'none',
      stroke: strokeColor, strokeWidth: 1.3,
      strokeLinejoin: 'round', strokeLinecap: 'round',
    }));

    return React.createElement('svg', {
      width: width, height: height, viewBox: '0 0 ' + width + ' ' + height,
      style: { display: 'block' },
    }, els);
  }

  function Card(props) {
    var def = props.def;
    var entry = props.entry;
    var delta = entry ? entry.delta : null;
    var latest = delta ? delta.latest : null;
    var net = latest ? latest.net : null;
    var dNet = delta ? delta.deltaNet : null;
    var reportDate = latest ? latest.date : null;

    return React.createElement('div', {
      style: {
        padding: '14px 16px', background: T.ink200, border: '1px solid ' + T.edge,
        borderRadius: 10, display: 'flex', flexDirection: 'column', gap: 8,
        minHeight: 150,
      },
    },
      // Header
      React.createElement('div', {
        style: { display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', gap: 6 },
      },
        React.createElement('div', {
          style: { fontSize: 10.5, letterSpacing: 0.6, color: T.text, fontWeight: 700,
                   textTransform: 'uppercase' },
        }, def.label),
        React.createElement('div', {
          style: { fontFamily: T.mono, fontSize: 8.5, letterSpacing: 0.6, color: T.textDim },
        }, def.category)
      ),

      // Net spec position (big mono)
      React.createElement('div', {
        style: { fontFamily: T.mono, fontSize: 22, fontWeight: 600,
                 color: colorForNet(net), letterSpacing: 0.3 },
      }, fmtK(net)),
      React.createElement('div', {
        style: { fontSize: 9, color: T.textDim, letterSpacing: 0.6,
                 textTransform: 'uppercase', fontWeight: 600 },
      }, 'Net spec position · ' + fmtDate(reportDate)),

      // WoW delta chip
      React.createElement('div', { style: { display: 'flex', alignItems: 'center', gap: 6 } },
        React.createElement('div', {
          style: {
            fontFamily: T.mono, fontSize: 10, fontWeight: 600,
            padding: '2px 7px', borderRadius: 4,
            color: colorForDelta(dNet),
            background: dNet == null ? T.ink300
                      : dNet > 0 ? 'rgba(111,207,142,0.10)'
                      : dNet < 0 ? 'rgba(217,107,107,0.10)'
                      : T.ink300,
            border: '0.5px solid ' + T.edge,
          },
        }, fmtDelta(dNet)),
        React.createElement('div', {
          style: { fontFamily: T.mono, fontSize: 9, color: T.textDim, letterSpacing: 0.4 },
        }, 'WoW Δ')
      ),

      // Sparkline
      React.createElement('div', { style: { marginTop: 'auto' } },
        React.createElement(NetSparkline, {
          rows: entry ? entry.recent : [],
          width: 260, height: 36,
        })
      )
    );
  }

  // ---------- main panel ----------
  function TRCOTPanel(props) {
    var open = props && props.open;
    var onClose = props && props.onClose;

    var cState = React.useState('All');           var cat = cState[0];           var setCat = cState[1];
    var bState = React.useState(null);             var bundle = bState[0];        var setBundle = bState[1];
    var lState = React.useState(false);             var loading = lState[0];       var setLoading = lState[1];
    var eState = React.useState(null);              var err = eState[0];           var setErr = eState[1];
    var uState = React.useState(null);              var updatedAt = uState[0];     var setUpdatedAt = uState[1];

    var refresh = React.useCallback(async function (force) {
      if (!window.COTData) { setErr('COTData engine missing'); return; }
      setLoading(true); setErr(null);
      try {
        if (force) { try { window.COTData.clearCache(); } catch (_) {} }
        var b = await window.COTData.getBundle();
        setBundle(b || {});
        setUpdatedAt(Date.now());
        var anyData = false;
        for (var k in (b || {})) {
          if (Object.prototype.hasOwnProperty.call(b, k) && b[k] && b[k].recent && b[k].recent.length) {
            anyData = true; break;
          }
        }
        if (!anyData) setErr('no COT rows returned');
      } catch (e) {
        setErr((e && e.message) ? e.message : 'fetch failed');
      } finally { setLoading(false); }
    }, []);

    React.useEffect(function () {
      if (!open) return;
      refresh(false);
      var iv = setInterval(function () { refresh(false); }, 6 * 60 * 60 * 1000);
      return function () { clearInterval(iv); };
    }, [open, refresh]);

    if (!open) return null;

    var COMMODITIES = (window.COTData && window.COTData.COMMODITIES) || [];
    var CATEGORIES  = (window.COTData && window.COTData.CATEGORIES)  || [];
    var TABS = ['All'].concat(CATEGORIES);

    var filtered = cat === 'All'
      ? COMMODITIES
      : COMMODITIES.filter(function (c) { return c.category === cat; });

    var lastUpdated = updatedAt ? fmtAge(updatedAt) : '—';

    var tabBtn = function (key, label) {
      var active = cat === key;
      return React.createElement('div', {
        onClick: function () { setCat(key); },
        key: key,
        style: {
          padding: '6px 14px', fontFamily: T.mono, fontSize: 10.5, fontWeight: 700,
          letterSpacing: 0.8, cursor: 'pointer', borderRadius: 6,
          color: active ? T.ink000 : T.textMid,
          background: active ? T.signal : T.ink200,
          border: '1px solid ' + T.edge,
        },
      }, (label || key).toUpperCase());
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
          width: 1060, maxHeight: '94%', overflow: 'auto',
          background: T.ink100, border: '1px solid ' + T.edgeHi, borderRadius: 14,
          padding: '22px 26px', color: T.text,
          fontFamily: T.sans,
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
          }, 'CFTC COT · speculator net positioning'),
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

        // Category tabs
        React.createElement('div', {
          style: { display: 'flex', gap: 6, marginBottom: 14, flexWrap: 'wrap' },
        }, TABS.map(function (key) { return tabBtn(key, key); })),

        // Error banner
        err ? React.createElement('div', {
          style: {
            padding: '9px 12px', marginBottom: 12,
            background: 'rgba(217,107,107,0.08)', border: '1px solid rgba(217,107,107,0.3)',
            borderRadius: 6, fontFamily: T.mono, fontSize: 10.5, color: T.bear, letterSpacing: 0.4,
          },
        }, 'DATA · ' + err) : null,

        // Grid
        React.createElement('div', {
          style: {
            display: 'grid',
            gridTemplateColumns: 'repeat(3, 1fr)',
            gap: 10,
          },
        },
          filtered.map(function (def) {
            return React.createElement(Card, {
              key: def.key,
              def: def,
              entry: bundle ? bundle[def.key] : null,
            });
          })
        ),

        React.createElement('div', {
          style: {
            marginTop: 16, fontFamily: T.mono, fontSize: 9.5, color: T.textDim,
            letterSpacing: 0.4, textAlign: 'right',
          },
        }, 'Source: publicreporting.cftc.gov · Net = (Lev. Money + Asset Mgr + Other Rept) Long − Short · weekly Tue close')
      )
    );
  }

  window.openTRCOT = function openTRCOT() {
    try { window.dispatchEvent(new CustomEvent('tr:open-cot')); } catch (_) {}
  };
  window.TRCOTPanel = TRCOTPanel;
})();
