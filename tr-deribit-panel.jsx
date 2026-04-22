// tr-deribit-panel.jsx — Deribit options flow + DVOL + skew intelligence UI.
//
// Exposes:
//   window.TRDeribitPanel({ open, onClose })  — full modal
//   window.TRDeribitTile({ onOpen })          — compact Signals-lane tile
//   window.openTRDeribit()                     — global trigger (fires
//                                                'tr:open-deribit' CustomEvent
//                                                so the coordinator can mount)
//
// Depends on window.DeribitData (engine/deribit.js).

(function () {
  if (typeof window === 'undefined') return;

  // ---------- theme ----------
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
  function fmtUsd(x) {
    if (x == null || !isFinite(x)) return '—';
    if (Math.abs(x) >= 1e9) return '$' + (x / 1e9).toFixed(2) + 'B';
    if (Math.abs(x) >= 1e6) return '$' + (x / 1e6).toFixed(2) + 'M';
    if (Math.abs(x) >= 1e3) return '$' + (x / 1e3).toFixed(1) + 'K';
    return '$' + Math.round(x).toLocaleString();
  }
  function fmtPct1(x) {
    if (x == null || !isFinite(x)) return '—';
    return x.toFixed(1) + '%';
  }
  function fmtPct2(x) {
    if (x == null || !isFinite(x)) return '—';
    return x.toFixed(2) + '%';
  }
  function fmtNum(x, digits) {
    if (x == null || !isFinite(x)) return '—';
    const d = digits == null ? 2 : digits;
    return x.toFixed(d);
  }
  function fmtStrike(x) {
    if (x == null || !isFinite(x)) return '—';
    if (Math.abs(x) >= 1000) return Math.round(x).toLocaleString();
    return x.toFixed(0);
  }
  function fmtDays(d) {
    if (d == null || !isFinite(d)) return '—';
    if (d < 1) return Math.round(d * 24) + 'h';
    return Math.round(d) + 'd';
  }

  // ---------- DVOL sparkline ----------
  function DVOLSparkline({ series, width, height }) {
    const w = width || 220;
    const h = height || 44;
    if (!series || !series.length) {
      return React.createElement('div', {
        style: { width: w, height: h, fontFamily: T.mono,
                 fontSize: 9, color: T.textDim,
                 display: 'flex', alignItems: 'center' },
      }, '—');
    }
    const vals = series.map(function (r) { return r.c; });
    const min = Math.min.apply(null, vals);
    const max = Math.max.apply(null, vals);
    const range = (max - min) || 1;
    const step = vals.length > 1 ? w / (vals.length - 1) : 0;
    const pts = vals.map(function (v, i) {
      const x = i * step;
      const y = h - ((v - min) / range) * (h - 4) - 2;
      return x.toFixed(1) + ',' + y.toFixed(1);
    }).join(' ');
    const last = vals[vals.length - 1];
    const first = vals[0];
    const stroke = last >= first ? T.bull : T.bear;
    return React.createElement('svg', {
      width: w, height: h, viewBox: '0 0 ' + w + ' ' + h,
      style: { display: 'block' },
    },
      React.createElement('polyline', {
        points: pts, fill: 'none', stroke, strokeWidth: 1.4,
        strokeLinecap: 'round', strokeLinejoin: 'round',
      })
    );
  }

  // ---------- curve chart (term structure / skew) ----------
  function CurveChart({ points, yKey, label, color, width, height, ySuffix }) {
    const w = width || 380;
    const h = height || 180;
    if (!points || !points.length) {
      return React.createElement('div', {
        style: { width: '100%', height: h,
                 background: T.ink200, border: '1px solid ' + T.edge, borderRadius: 10,
                 display: 'flex', alignItems: 'center', justifyContent: 'center',
                 fontFamily: T.mono, fontSize: 11, color: T.textDim },
      }, 'no data');
    }
    const pad = { l: 44, r: 14, t: 22, b: 26 };
    const iw = w - pad.l - pad.r;
    const ih = h - pad.t - pad.b;

    const xs = points.map(function (p) { return p.daysToExp; });
    const ys = points.map(function (p) { return p[yKey]; }).filter(isFinite);
    if (!ys.length) {
      return React.createElement('div', {
        style: { width: '100%', height: h, background: T.ink200,
                 border: '1px solid ' + T.edge, borderRadius: 10,
                 display: 'flex', alignItems: 'center', justifyContent: 'center',
                 fontFamily: T.mono, fontSize: 11, color: T.textDim },
      }, 'no data');
    }
    const xMin = Math.min.apply(null, xs);
    const xMax = Math.max.apply(null, xs);
    let yMin = Math.min.apply(null, ys);
    let yMax = Math.max.apply(null, ys);
    const pad5 = (yMax - yMin) * 0.1 || 1;
    yMin -= pad5; yMax += pad5;
    const xRange = (xMax - xMin) || 1;
    const yRange = (yMax - yMin) || 1;

    const toX = function (d) { return pad.l + ((d - xMin) / xRange) * iw; };
    const toY = function (v) { return pad.t + ih - ((v - yMin) / yRange) * ih; };

    const poly = points
      .filter(function (p) { return isFinite(p[yKey]); })
      .map(function (p) { return toX(p.daysToExp).toFixed(1) + ',' + toY(p[yKey]).toFixed(1); })
      .join(' ');

    // y-axis ticks: 4 evenly spaced
    const yTicks = [0, 1, 2, 3].map(function (i) {
      const v = yMin + (i / 3) * (yRange);
      return { v, y: toY(v) };
    });
    // zero line if skew crosses zero
    const zeroY = (0 >= yMin && 0 <= yMax) ? toY(0) : null;

    return React.createElement('svg', {
      width: '100%', viewBox: '0 0 ' + w + ' ' + h,
      style: { display: 'block',
               background: T.ink200, border: '1px solid ' + T.edge, borderRadius: 10 },
    },
      React.createElement('text', {
        x: pad.l, y: 14, fill: T.textDim, fontFamily: T.mono,
        fontSize: 9, letterSpacing: 0.8, textTransform: 'uppercase',
      }, label || ''),
      yTicks.map(function (t, i) {
        return React.createElement('g', { key: 'yt' + i },
          React.createElement('line', {
            x1: pad.l, x2: w - pad.r, y1: t.y, y2: t.y,
            stroke: T.edge, strokeWidth: 0.5,
          }),
          React.createElement('text', {
            x: pad.l - 6, y: t.y + 3, fill: T.textDim,
            fontFamily: T.mono, fontSize: 9, textAnchor: 'end',
          }, t.v.toFixed(1) + (ySuffix || ''))
        );
      }),
      zeroY != null && React.createElement('line', {
        x1: pad.l, x2: w - pad.r, y1: zeroY, y2: zeroY,
        stroke: T.signal, strokeWidth: 0.8, strokeDasharray: '3,3',
      }),
      React.createElement('polyline', {
        points: poly, fill: 'none',
        stroke: color || T.signal, strokeWidth: 1.8,
        strokeLinecap: 'round', strokeLinejoin: 'round',
      }),
      points
        .filter(function (p) { return isFinite(p[yKey]); })
        .map(function (p, i) {
          return React.createElement('circle', {
            key: 'pt' + i, cx: toX(p.daysToExp), cy: toY(p[yKey]), r: 2.5,
            fill: color || T.signal,
          });
        }),
      // x-axis tick labels: first, middle, last
      (function () {
        const pts = points.filter(function (p) { return isFinite(p[yKey]); });
        if (!pts.length) return null;
        const picks = [pts[0], pts[Math.floor(pts.length / 2)], pts[pts.length - 1]];
        return picks.map(function (p, i) {
          return React.createElement('text', {
            key: 'xt' + i, x: toX(p.daysToExp), y: h - 8, fill: T.textDim,
            fontFamily: T.mono, fontSize: 9, textAnchor: 'middle',
          }, fmtDays(p.daysToExp));
        });
      })()
    );
  }

  // ---------- main panel ----------
  function TRDeribitPanel(props) {
    const open = props && props.open;
    const onClose = props && props.onClose;

    const [currency, setCurrency] = React.useState('BTC');
    const [dvol, setDVOL] = React.useState(null);
    const [pcr, setPCR] = React.useState(null);
    const [term, setTerm] = React.useState([]);
    const [skew, setSkew] = React.useState([]);
    const [flows, setFlows] = React.useState([]);
    const [loading, setLoading] = React.useState(false);
    const [err, setErr] = React.useState(null);

    const refresh = React.useCallback(async function () {
      if (!window.DeribitData) { setErr('DeribitData engine missing'); return; }
      setLoading(true); setErr(null);
      try {
        const [d, p, t, s, f] = await Promise.all([
          window.DeribitData.getDVOL(currency, 30),
          window.DeribitData.getPutCallRatio(currency),
          window.DeribitData.getTermStructure(currency),
          window.DeribitData.getSkewAll(currency),
          window.DeribitData.getBiggestFlows(currency, 15),
        ]);
        setDVOL(d); setPCR(p); setTerm(t || []); setSkew(s || []); setFlows(f || []);
      } catch (e) {
        setErr(e && e.message ? e.message : 'fetch failed');
      } finally {
        setLoading(false);
      }
    }, [currency]);

    React.useEffect(function () {
      if (!open) return;
      refresh();
      const iv = setInterval(refresh, 60_000);
      return function () { clearInterval(iv); };
    }, [open, refresh]);

    if (!open) return null;

    const tabBtn = function (key, label) {
      const active = currency === key;
      return React.createElement('div', {
        onClick: function () { setCurrency(key); },
        style: {
          padding: '6px 14px', fontFamily: T.mono, fontSize: 11, fontWeight: 600,
          letterSpacing: 0.8, cursor: 'pointer', borderRadius: 6,
          color: active ? T.ink000 : T.textMid,
          background: active ? T.signal : T.ink200,
          border: '1px solid ' + T.edge,
        },
      }, label);
    };

    const ivVsHv = (dvol && isFinite(dvol.atmIv) && isFinite(dvol.hv30))
      ? (dvol.atmIv - dvol.hv30) : null;
    const ivVsHvColor = ivVsHv == null ? T.textDim
      : ivVsHv > 3 ? T.bear : ivVsHv < -3 ? T.bull : T.signal;

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
          width: 980, maxHeight: '94%', overflow: 'auto',
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
          }, 'Deribit Options · DVOL, Skew, OI'),
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

        // Currency tabs
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

        // Top strip: DVOL big number + sparkline + ATM IV vs HV chip
        React.createElement('div', {
          style: {
            padding: '16px 20px', background: T.ink200,
            border: '1px solid ' + T.edgeHi, borderRadius: 10, marginBottom: 14,
            display: 'flex', alignItems: 'center', gap: 24, flexWrap: 'wrap',
          },
        },
          React.createElement('div', null,
            React.createElement('div', {
              style: { fontSize: 9, letterSpacing: 0.8, color: T.textDim,
                       textTransform: 'uppercase', fontWeight: 600, marginBottom: 4 },
            }, 'DVOL (' + currency + ')'),
            React.createElement('div', {
              style: { fontFamily: T.mono, fontSize: 26, fontWeight: 600, color: T.signal },
            }, dvol && isFinite(dvol.current) ? fmtPct1(dvol.current) : '—')
          ),
          React.createElement('div', null,
            React.createElement('div', {
              style: { fontSize: 9, letterSpacing: 0.8, color: T.textDim,
                       textTransform: 'uppercase', fontWeight: 600, marginBottom: 6 },
            }, '30d Sparkline'),
            React.createElement(DVOLSparkline, {
              series: dvol ? dvol.series : [], width: 220, height: 40,
            })
          ),
          React.createElement('div', null,
            React.createElement('div', {
              style: { fontSize: 9, letterSpacing: 0.8, color: T.textDim,
                       textTransform: 'uppercase', fontWeight: 600, marginBottom: 4 },
            }, 'ATM IV (Near Exp)'),
            React.createElement('div', {
              style: { fontFamily: T.mono, fontSize: 16, fontWeight: 600, color: T.text },
            }, dvol && isFinite(dvol.atmIv) ? fmtPct1(dvol.atmIv) : '—')
          ),
          React.createElement('div', null,
            React.createElement('div', {
              style: { fontSize: 9, letterSpacing: 0.8, color: T.textDim,
                       textTransform: 'uppercase', fontWeight: 600, marginBottom: 4 },
            }, 'HV30 (DVOL)'),
            React.createElement('div', {
              style: { fontFamily: T.mono, fontSize: 16, fontWeight: 600, color: T.text },
            }, dvol && isFinite(dvol.hv30) ? fmtPct1(dvol.hv30) : '—')
          ),
          React.createElement('div', { style: { marginLeft: 'auto' } },
            React.createElement('div', {
              style: { fontSize: 9, letterSpacing: 0.8, color: T.textDim,
                       textTransform: 'uppercase', fontWeight: 600, marginBottom: 4,
                       textAlign: 'right' },
            }, 'IV − HV'),
            React.createElement('div', {
              style: { fontFamily: T.mono, fontSize: 15, fontWeight: 700,
                       letterSpacing: 0.6, color: ivVsHvColor, textAlign: 'right' },
            }, ivVsHv == null ? '—' : (ivVsHv >= 0 ? '+' : '') + ivVsHv.toFixed(1) + 'pt')
          )
        ),

        // Middle row: term structure + skew
        React.createElement('div', {
          style: {
            display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12, marginBottom: 14,
          },
        },
          React.createElement('div', null,
            React.createElement('div', {
              style: { fontSize: 10, letterSpacing: 1.0, color: T.textDim,
                       textTransform: 'uppercase', fontWeight: 600, marginBottom: 6 },
            }, 'Term Structure · ATM IV by Expiry'),
            React.createElement(CurveChart, {
              points: term, yKey: 'atmIv', label: 'ATM IV %',
              color: T.signal, width: 430, height: 200, ySuffix: '%',
            })
          ),
          React.createElement('div', null,
            React.createElement('div', {
              style: { fontSize: 10, letterSpacing: 1.0, color: T.textDim,
                       textTransform: 'uppercase', fontWeight: 600, marginBottom: 6 },
            }, '25-Delta Skew · Put IV − Call IV'),
            React.createElement(CurveChart, {
              points: skew, yKey: 'skew', label: 'Skew (pts)',
              color: skew && skew.length && skew[0].skew > 0 ? T.bear : T.bull,
              width: 430, height: 200, ySuffix: '',
            })
          )
        ),

        // Bottom: PCR tile + biggest OI table
        React.createElement('div', {
          style: {
            display: 'grid', gridTemplateColumns: '220px 1fr', gap: 12,
          },
        },
          // PCR tile
          React.createElement('div', {
            style: {
              padding: '14px 16px', background: T.ink200,
              border: '1px solid ' + T.edge, borderRadius: 10,
              display: 'flex', flexDirection: 'column', gap: 12,
            },
          },
            React.createElement('div', {
              style: { fontSize: 10, letterSpacing: 1.0, color: T.textDim,
                       textTransform: 'uppercase', fontWeight: 600 },
            }, 'Put / Call Ratio'),
            React.createElement('div', null,
              React.createElement('div', {
                style: { fontSize: 9, letterSpacing: 0.8, color: T.textDim, marginBottom: 3 },
              }, 'OI-weighted'),
              React.createElement('div', {
                style: { fontFamily: T.mono, fontSize: 22, fontWeight: 600,
                         color: pcr && pcr.oiRatio > 0.75 ? T.bear
                               : pcr && pcr.oiRatio < 0.5 ? T.bull : T.signal },
              }, pcr && isFinite(pcr.oiRatio) ? fmtNum(pcr.oiRatio, 2) : '—')
            ),
            React.createElement('div', null,
              React.createElement('div', {
                style: { fontSize: 9, letterSpacing: 0.8, color: T.textDim, marginBottom: 3 },
              }, 'Volume-weighted'),
              React.createElement('div', {
                style: { fontFamily: T.mono, fontSize: 15, color: T.text },
              }, pcr && isFinite(pcr.volRatio) ? fmtNum(pcr.volRatio, 2) : '—')
            ),
            React.createElement('div', {
              style: { fontFamily: T.mono, fontSize: 10, color: T.textDim,
                       letterSpacing: 0.3, lineHeight: 1.5, marginTop: 'auto' },
            }, 'Puts OI: ' + (pcr && isFinite(pcr.puts_oi) ? Math.round(pcr.puts_oi).toLocaleString() : '—') +
               ' · Calls OI: ' + (pcr && isFinite(pcr.calls_oi) ? Math.round(pcr.calls_oi).toLocaleString() : '—'))
          ),

          // Biggest OI table
          React.createElement('div', {
            style: {
              background: T.ink200, border: '1px solid ' + T.edge, borderRadius: 10,
              overflow: 'hidden',
            },
          },
            React.createElement('div', {
              style: {
                padding: '12px 14px',
                fontSize: 10, letterSpacing: 1.0, color: T.textDim,
                textTransform: 'uppercase', fontWeight: 600,
                borderBottom: '1px solid ' + T.edge,
              },
            }, 'Biggest Open Interest · Top 15'),
            React.createElement('div', {
              style: {
                display: 'grid',
                gridTemplateColumns: '80px 50px 90px 70px 70px 1fr',
                gap: 8, padding: '8px 14px',
                fontFamily: T.mono, fontSize: 9, letterSpacing: 0.8,
                color: T.textDim, textTransform: 'uppercase',
                borderBottom: '1px solid ' + T.edge,
              },
            },
              React.createElement('div', null, 'STRIKE'),
              React.createElement('div', null, 'C/P'),
              React.createElement('div', null, 'EXP'),
              React.createElement('div', { style: { textAlign: 'right' } }, 'OI'),
              React.createElement('div', { style: { textAlign: 'right' } }, 'IV'),
              React.createElement('div', { style: { textAlign: 'right' } }, 'NOTIONAL')
            ),
            React.createElement('div', {
              style: { maxHeight: 280, overflow: 'auto' },
            },
              flows.length === 0
                ? React.createElement('div', {
                    style: { padding: '20px', textAlign: 'center',
                             fontFamily: T.mono, fontSize: 11, color: T.textDim },
                  }, loading ? 'loading…' : 'no data')
                : flows.map(function (r, i) {
                    const typeColor = r.type === 'P' ? T.bear : T.bull;
                    return React.createElement('div', {
                      key: r.instrument,
                      style: {
                        display: 'grid',
                        gridTemplateColumns: '80px 50px 90px 70px 70px 1fr',
                        gap: 8, padding: '7px 14px',
                        fontFamily: T.mono, fontSize: 10.5,
                        borderBottom: i === flows.length - 1 ? 'none' : '1px solid ' + T.edge,
                        alignItems: 'center',
                      },
                    },
                      React.createElement('div', { style: { color: T.text } },
                        fmtStrike(r.strike)),
                      React.createElement('div', {
                        style: { color: typeColor, fontWeight: 700 },
                      }, r.type),
                      React.createElement('div', { style: { color: T.textMid } },
                        r.expiry + ' · ' + fmtDays(r.daysToExp)),
                      React.createElement('div', {
                        style: { color: T.text, textAlign: 'right' },
                      }, isFinite(r.oi) ? Math.round(r.oi).toLocaleString() : '—'),
                      React.createElement('div', {
                        style: { color: T.signal, textAlign: 'right' },
                      }, fmtPct1(r.iv)),
                      React.createElement('div', {
                        style: { color: T.text, textAlign: 'right', fontWeight: 600 },
                      }, fmtUsd(r.notional_usd))
                    );
                  })
            )
          )
        ),

        // Footnote
        React.createElement('div', {
          style: {
            marginTop: 14, fontFamily: T.mono, fontSize: 9.5,
            color: T.textDim, letterSpacing: 0.3, lineHeight: 1.5,
          },
        }, 'Source: Deribit public API (no key). DVOL resolution: 1h. Term structure uses strike closest to index as ATM proxy. ' +
           '25-delta strikes estimated from mark ≈ 0.25×underlying (proxy, no greeks). Refresh: 60s.')
      )
    );
  }

  // ---------- compact tile ----------
  function TRDeribitTile(props) {
    const onOpen = props && props.onOpen;
    const [ccy, setCcy] = React.useState('BTC');
    const [dvol, setDVOL] = React.useState(null);
    const [loading, setLoading] = React.useState(true);

    React.useEffect(function () {
      let alive = true;
      function load() {
        if (!window.DeribitData) return;
        window.DeribitData.getDVOL(ccy, 7).then(function (d) {
          if (!alive) return;
          setDVOL(d); setLoading(false);
        }).catch(function () { if (alive) setLoading(false); });
      }
      load();
      const iv = setInterval(load, 120_000);
      return function () { alive = false; clearInterval(iv); };
    }, [ccy]);

    const cur = dvol && isFinite(dvol.current) ? dvol.current : null;

    const handleOpen = function () {
      if (typeof onOpen === 'function') onOpen();
      else if (typeof window.openTRDeribit === 'function') window.openTRDeribit();
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
          setCcy(ccy === 'BTC' ? 'ETH' : 'BTC');
        },
        style: {
          padding: '3px 8px', fontFamily: T.mono, fontSize: 9.5, fontWeight: 700,
          letterSpacing: 0.8, color: T.signal,
          background: 'rgba(201,162,39,0.10)',
          border: '0.5px solid rgba(201,162,39,0.3)', borderRadius: 4,
        },
      }, ccy),
      React.createElement('div', {
        style: { fontSize: 10, letterSpacing: 0.6, color: T.textDim,
                 textTransform: 'uppercase', fontWeight: 600 },
      }, 'Deribit DVOL'),
      React.createElement('div', {
        style: { fontFamily: T.mono, fontSize: 13, fontWeight: 600,
                 color: T.signal, marginLeft: 'auto' },
      }, loading ? '…' : (cur != null ? fmtPct1(cur) : '—'))
    );
  }

  // ---------- global trigger ----------
  window.openTRDeribit = function openTRDeribit() {
    try { window.dispatchEvent(new CustomEvent('tr:open-deribit')); } catch (_) {}
  };

  window.TRDeribitPanel = TRDeribitPanel;
  window.TRDeribitTile  = TRDeribitTile;
})();
