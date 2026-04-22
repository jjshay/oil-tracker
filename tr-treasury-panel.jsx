// tr-treasury-panel.jsx — Treasury auctions + yield-curve panel.
//
// Exposes:
//   window.TRTreasuryPanel({ open, onClose })   — modal with 2 tabs
//     • "Auctions"   — table of recent Treasury securities (avg interest rates)
//     • "Yield Curve"— SVG curve viz (today vs ~30-day-ago)
//   window.openTRTreasury()                      — fires 'tr:open-treasury' CustomEvent.
//
// Depends on window.TreasuryData (engine/treasury.js).

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

  function fmtPct(x, d) {
    if (x == null || !isFinite(x)) return '—';
    return x.toFixed(d == null ? 3 : d) + '%';
  }
  function fmtDate(iso) {
    if (!iso) return '—';
    var m = iso.match(/^(\d{4})-(\d{2})-(\d{2})$/);
    if (!m) return iso;
    var months = ['JAN','FEB','MAR','APR','MAY','JUN','JUL','AUG','SEP','OCT','NOV','DEC'];
    return months[parseInt(m[2], 10) - 1] + ' ' + String(parseInt(m[3], 10)) + ' ' + m[1].slice(2);
  }
  function fmtAge(ts) {
    if (!ts) return '—';
    var d = Date.now() - ts;
    if (d < 60_000) return Math.round(d / 1000) + 's ago';
    if (d < 3_600_000) return Math.round(d / 60_000) + 'm ago';
    if (d < 86_400_000) return Math.round(d / 3_600_000) + 'h ago';
    return Math.round(d / 86_400_000) + 'd ago';
  }

  // ---------- yield-curve SVG ----------
  function YieldCurveChart(props) {
    var today = props.today;
    var prior = props.prior;
    var width = props.width || 820;
    var height = props.height || 340;

    if (!today || !today.points || !today.points.length) {
      return React.createElement('div', {
        style: { width: width, height: height, fontFamily: T.mono, fontSize: 10,
                 color: T.textDim, display: 'flex', alignItems: 'center', justifyContent: 'center' },
      }, 'no curve data');
    }

    var marginL = 52, marginR = 16, marginT = 24, marginB = 40;
    var innerW = width - marginL - marginR;
    var innerH = height - marginT - marginB;

    // Collect all yields to compute y-range.
    var allY = [];
    function collect(curve) {
      if (!curve || !curve.points) return;
      for (var i = 0; i < curve.points.length; i++) allY.push(curve.points[i].yield);
    }
    collect(today); collect(prior);
    var minY = Math.min.apply(null, allY);
    var maxY = Math.max.apply(null, allY);
    var pad = (maxY - minY) * 0.15 || 0.1;
    minY = Math.max(0, minY - pad);
    maxY = maxY + pad;

    // X axis: use months (log-ish scale feels wrong here — use ordinal by tenor
    // order so points space evenly across the fixed tenor set).
    function xForIdx(i, total) {
      if (total <= 1) return innerW / 2;
      return (i / (total - 1)) * innerW;
    }
    function yFor(v) {
      return innerH - ((v - minY) / (maxY - minY || 1)) * innerH;
    }

    // Build path for a curve using today's tenor ordering as the x axis.
    var tenors = today.points.map(function (p) { return p.tenor; });
    function pathFor(curve, strokeColor, isPrior) {
      if (!curve || !curve.points) return null;
      var byTenor = {};
      for (var i = 0; i < curve.points.length; i++) byTenor[curve.points[i].tenor] = curve.points[i].yield;
      var d = '';
      var pts = [];
      for (var j = 0; j < tenors.length; j++) {
        var y = byTenor[tenors[j]];
        if (y == null) continue;
        var x = xForIdx(j, tenors.length);
        pts.push({ x: x, y: yFor(y), raw: y, tenor: tenors[j] });
      }
      if (!pts.length) return null;
      for (var k = 0; k < pts.length; k++) {
        d += (k === 0 ? 'M' : 'L') + pts[k].x.toFixed(1) + ' ' + pts[k].y.toFixed(1) + ' ';
      }
      return { d: d, pts: pts, color: strokeColor, isPrior: !!isPrior };
    }

    var todayLine = pathFor(today, T.signal, false);
    var priorLine = pathFor(prior, T.textMid, true);

    // Gridlines (horizontal)
    var gridCount = 5;
    var gridLines = [];
    for (var g = 0; g <= gridCount; g++) {
      var gy = (g / gridCount) * innerH;
      var yVal = maxY - (g / gridCount) * (maxY - minY);
      gridLines.push(
        React.createElement('line', {
          key: 'g' + g, x1: 0, x2: innerW, y1: gy, y2: gy,
          stroke: T.edge, strokeWidth: 0.5, strokeDasharray: '2,3',
        }),
        React.createElement('text', {
          key: 'gl' + g, x: -8, y: gy + 3,
          fill: T.textDim, fontSize: 9, fontFamily: T.mono, textAnchor: 'end',
        }, yVal.toFixed(2) + '%')
      );
    }

    // X-axis tenor labels
    var xLabels = tenors.map(function (tn, i) {
      return React.createElement('text', {
        key: 'x' + i,
        x: xForIdx(i, tenors.length), y: innerH + 16,
        fill: T.textMid, fontSize: 9.5, fontFamily: T.mono, textAnchor: 'middle', fontWeight: 600,
      }, tn);
    });

    // Data dots + value labels for today only (keep chart readable).
    var todayDots = (todayLine ? todayLine.pts : []).map(function (p, i) {
      return React.createElement('g', { key: 'pt' + i },
        React.createElement('circle', {
          cx: p.x, cy: p.y, r: 3, fill: T.signal, stroke: T.ink000, strokeWidth: 1,
        }),
        React.createElement('text', {
          x: p.x, y: p.y - 9,
          fill: T.text, fontSize: 9, fontFamily: T.mono, textAnchor: 'middle', fontWeight: 600,
        }, p.raw.toFixed(2))
      );
    });

    return React.createElement('svg', {
      width: width, height: height, viewBox: '0 0 ' + width + ' ' + height,
      style: { display: 'block' },
    },
      React.createElement('g', { transform: 'translate(' + marginL + ',' + marginT + ')' },
        gridLines,
        priorLine ? React.createElement('path', {
          d: priorLine.d, fill: 'none', stroke: priorLine.color,
          strokeWidth: 1.4, strokeDasharray: '4,3', opacity: 0.7,
        }) : null,
        todayLine ? React.createElement('path', {
          d: todayLine.d, fill: 'none', stroke: todayLine.color,
          strokeWidth: 2, strokeLinejoin: 'round', strokeLinecap: 'round',
        }) : null,
        todayDots,
        xLabels
      )
    );
  }

  // ---------- auctions table ----------
  function AuctionsTable(props) {
    var rows = props.rows || [];
    if (!rows.length) {
      return React.createElement('div', {
        style: {
          padding: '20px 12px', textAlign: 'center',
          background: T.ink200, border: '1px solid ' + T.edge, borderRadius: 8,
          fontFamily: T.mono, fontSize: 11, color: T.textDim,
        },
      }, 'No auction data available.');
    }
    var headerRow = React.createElement('div', {
      style: {
        display: 'grid',
        gridTemplateColumns: '120px 1fr 110px 110px',
        gap: 4, padding: '8px 12px',
        fontSize: 9.5, letterSpacing: 0.8, color: T.textDim,
        textTransform: 'uppercase', fontWeight: 700,
        borderBottom: '1px solid ' + T.edge,
      },
    },
      React.createElement('div', null, 'Record Date'),
      React.createElement('div', null, 'Security'),
      React.createElement('div', { style: { textAlign: 'right' } }, 'Type'),
      React.createElement('div', { style: { textAlign: 'right' } }, 'Avg Rate')
    );

    var dataRows = rows.slice(0, 20).map(function (r, idx) {
      return React.createElement('div', {
        key: r.date + '_' + r.security + '_' + idx,
        style: {
          display: 'grid',
          gridTemplateColumns: '120px 1fr 110px 110px',
          gap: 4, padding: '8px 12px',
          fontFamily: T.mono, fontSize: 11,
          borderBottom: '0.5px solid ' + T.edge,
          background: idx % 2 === 0 ? 'transparent' : 'rgba(255,255,255,0.015)',
        },
      },
        React.createElement('div', { style: { color: T.textMid } }, fmtDate(r.date)),
        React.createElement('div', { style: { color: T.text, fontWeight: 500 } }, r.security || '—'),
        React.createElement('div', { style: { textAlign: 'right', color: T.textMid } }, r.type || '—'),
        React.createElement('div', {
          style: { textAlign: 'right', color: T.signal, fontWeight: 600 },
        }, fmtPct(r.rate, 3))
      );
    });
    return React.createElement('div', {
      style: {
        background: T.ink200, border: '1px solid ' + T.edge, borderRadius: 8,
        overflow: 'hidden',
      },
    }, headerRow, dataRows);
  }

  // ---------- panel ----------
  function TRTreasuryPanel(props) {
    var open = props && props.open;
    var onClose = props && props.onClose;

    var tState = React.useState('auctions');     var tab = tState[0];        var setTab = tState[1];
    var aState = React.useState(null);             var auctions = aState[0];   var setAuctions = aState[1];
    var yState = React.useState(null);             var curve = yState[0];      var setCurve = yState[1];
    var lState = React.useState(false);             var loading = lState[0];    var setLoading = lState[1];
    var eState = React.useState(null);              var err = eState[0];        var setErr = eState[1];
    var uState = React.useState(null);              var updatedAt = uState[0];  var setUpdatedAt = uState[1];

    var refresh = React.useCallback(async function (force) {
      if (!window.TreasuryData) { setErr('TreasuryData engine missing'); return; }
      setLoading(true); setErr(null);
      try {
        if (force) { try { window.TreasuryData.clearCache(); } catch (_) {} }
        var pair = await Promise.all([
          window.TreasuryData.getRecentAuctions(20),
          window.TreasuryData.getYieldCurve(),
        ]);
        setAuctions(pair[0] || []);
        setCurve(pair[1] || null);
        setUpdatedAt(Date.now());
        if (!pair[0] && !pair[1]) setErr('data unreachable');
      } catch (e) {
        setErr((e && e.message) ? e.message : 'fetch failed');
      } finally { setLoading(false); }
    }, []);

    React.useEffect(function () {
      if (!open) return;
      refresh(false);
      var iv = setInterval(function () { refresh(false); }, 30 * 60 * 1000);
      return function () { clearInterval(iv); };
    }, [open, refresh]);

    if (!open) return null;

    var lastUpdated = updatedAt ? fmtAge(updatedAt) : '—';

    var tabBtn = function (key, label) {
      var active = tab === key;
      return React.createElement('div', {
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
          }, 'U.S. Treasury · FiscalData + home.treasury.gov'),
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

        // Tabs
        React.createElement('div', {
          style: { display: 'flex', gap: 8, marginBottom: 14 },
        },
          tabBtn('auctions', 'AUCTIONS'),
          tabBtn('curve',    'YIELD CURVE')
        ),

        // Error banner
        err ? React.createElement('div', {
          style: {
            padding: '9px 12px', marginBottom: 12,
            background: 'rgba(217,107,107,0.08)', border: '1px solid rgba(217,107,107,0.3)',
            borderRadius: 6, fontFamily: T.mono, fontSize: 10.5, color: T.bear, letterSpacing: 0.4,
          },
        }, 'DATA · ' + err) : null,

        // Body
        tab === 'auctions'
          ? React.createElement('div', null,
              React.createElement('div', {
                style: {
                  fontSize: 10, letterSpacing: 0.8, color: T.textDim,
                  textTransform: 'uppercase', fontWeight: 600, marginBottom: 8,
                },
              }, 'Recent Treasury marketable securities · avg interest rates'),
              React.createElement(AuctionsTable, { rows: auctions || [] })
            )
          : React.createElement('div', null,
              React.createElement('div', {
                style: {
                  display: 'flex', alignItems: 'center', gap: 16, marginBottom: 10,
                  fontFamily: T.mono, fontSize: 10.5, color: T.textMid, letterSpacing: 0.4,
                },
              },
                React.createElement('div', { style: { display: 'flex', alignItems: 'center', gap: 6 } },
                  React.createElement('div', {
                    style: { width: 18, height: 2, background: T.signal, borderRadius: 1 },
                  }),
                  React.createElement('span', null, 'TODAY · ' + (curve && curve.today ? fmtDate(curve.today.date) : '—'))
                ),
                React.createElement('div', { style: { display: 'flex', alignItems: 'center', gap: 6 } },
                  React.createElement('div', {
                    style: { width: 18, height: 2, background: T.textMid, borderRadius: 1,
                             borderTop: '1px dashed ' + T.textMid, opacity: 0.7 },
                  }),
                  React.createElement('span', null, '~30D AGO · ' + (curve && curve.priorMo ? fmtDate(curve.priorMo.date) : '—'))
                )
              ),
              React.createElement('div', {
                style: {
                  padding: '14px 18px',
                  background: T.ink200, border: '1px solid ' + T.edge, borderRadius: 8,
                },
              },
                React.createElement(YieldCurveChart, {
                  today: curve ? curve.today : null,
                  prior: curve ? curve.priorMo : null,
                  width: 880, height: 340,
                })
              )
            ),

        React.createElement('div', {
          style: {
            marginTop: 14, fontFamily: T.mono, fontSize: 9.5, color: T.textDim,
            letterSpacing: 0.4, textAlign: 'right',
          },
        }, 'Source: api.fiscaldata.treasury.gov · home.treasury.gov daily par yield curve')
      )
    );
  }

  window.openTRTreasury = function openTRTreasury() {
    try { window.dispatchEvent(new CustomEvent('tr:open-treasury')); } catch (_) {}
  };
  window.TRTreasuryPanel = TRTreasuryPanel;
})();
