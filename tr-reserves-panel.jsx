// tr-reserves-panel.jsx — Exchange BTC reserves intelligence panel.
//
// Thesis: total BTC / USD sitting on centralized exchanges is a proxy for
// "sell-ready" supply. Reserves shrinking = accumulation / cold-storage
// move = typically bullish. Reserves growing = distribution = bearish.
//
// Exposes:
//   window.TRReservesPanel({ open, onClose })  — full-screen modal
//   window.TRReservesTile({ onOpen })          — compact header tile
//   window.openTRReserves()                    — fires 'tr:open-reserves'
//
// Depends on window.ExchangeReserves (engine/exchange-reserves.js). On
// fetch failure the panel shows an in-panel escape hatch with links to
// public Dune dashboards and CryptoQuant so the user isn't left blind.

(function () {
  if (typeof window === 'undefined') return;

  // ---------- theme ----------
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

  // Public fallback dashboards (free, no auth). Shown when the API chain
  // fully fails so the user still gets signal.
  var PUBLIC_DASHBOARDS = [
    { name: 'Dune · BTC on CEX',       url: 'https://dune.com/bollingerbands/Exchange-balances-real-time' },
    { name: 'CryptoQuant · BTC Reserves', url: 'https://cryptoquant.com/asset/btc/chart/exchange-flows/reserve' },
    { name: 'Glassnode · Balance on Exchanges', url: 'https://studio.glassnode.com/metrics?a=BTC&m=distribution.BalanceExchanges' },
    { name: 'DeFiLlama · CEX Transparency', url: 'https://defillama.com/cexs' },
  ];

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
  function fmtBtc(x) {
    if (x == null || !isFinite(x)) return '—';
    if (Math.abs(x) >= 1e6) return (x / 1e6).toFixed(2) + 'M BTC';
    if (Math.abs(x) >= 1e3) return (x / 1e3).toFixed(1) + 'k BTC';
    return x.toFixed(0) + ' BTC';
  }
  function fmtPct(x) {
    if (x == null || !isFinite(x)) return '—';
    var sign = x > 0 ? '+' : '';
    return sign + x.toFixed(2) + '%';
  }
  function fmtDelta(x) {
    if (x == null || !isFinite(x)) return '—';
    var sign = x > 0 ? '+' : '';
    return sign + fmtUsd(x).replace('$-', '-$');
  }
  // For reserves: an INFLOW (positive inflow) is distribution → bearish,
  // an OUTFLOW (negative) is accumulation → bullish.  Color inverts.
  function colorForFlow(x) {
    if (x == null || !isFinite(x) || x === 0) return T.textDim;
    return x > 0 ? T.bear : T.bull;
  }
  function fmtAge(ts) {
    if (!ts) return '—';
    var d = Date.now() - ts;
    if (d < 60_000) return Math.round(d / 1000) + 's ago';
    if (d < 3_600_000) return Math.round(d / 60_000) + 'm ago';
    if (d < 86_400_000) return Math.round(d / 3_600_000) + 'h ago';
    return Math.round(d / 86_400_000) + 'd ago';
  }

  // ---------- sparkline (per-exchange tile) ----------
  function Spark(props) {
    var pts = (props && props.pts) || [];
    var w = (props && props.w) || 80;
    var h = (props && props.h) || 22;
    if (pts.length < 2) return null;
    var min = Math.min.apply(null, pts);
    var max = Math.max.apply(null, pts);
    var span = (max - min) || 1;
    var step = w / (pts.length - 1);
    var d = '';
    for (var i = 0; i < pts.length; i++) {
      var x = i * step;
      var y = h - ((pts[i] - min) / span) * h;
      d += (i === 0 ? 'M' : 'L') + x.toFixed(1) + ',' + y.toFixed(1) + ' ';
    }
    var trending = pts[pts.length - 1] < pts[0]; // down == outflow == bull color
    return React.createElement('svg', {
      width: w, height: h, viewBox: '0 0 ' + w + ' ' + h,
      style: { display: 'block' },
    }, React.createElement('path', {
      d: d, fill: 'none',
      stroke: trending ? T.bull : T.bear, strokeWidth: 1.2,
    }));
  }

  // ---------- 30d line chart (total reserves) ----------
  function ReservesLine(props) {
    var rows = (props && props.rows) || [];
    var width  = (props && props.width)  || 960;
    var height = (props && props.height) || 180;
    if (rows.length < 2) {
      return React.createElement('div', {
        style: {
          width: width, height: height, fontFamily: T.mono, fontSize: 10,
          color: T.textDim, display: 'flex', alignItems: 'center', justifyContent: 'center',
        },
      }, 'no data');
    }
    var vals = rows.map(function (r) { return r.total; });
    var min  = Math.min.apply(null, vals);
    var max  = Math.max.apply(null, vals);
    var span = (max - min) || 1;
    // Pad vertical scale 5% each side.
    var vMin = min - span * 0.05;
    var vMax = max + span * 0.05;
    var vSpan = vMax - vMin;
    var pad = 28;
    var chartW = width - pad * 2;
    var chartH = height - 26;
    var step = chartW / (rows.length - 1);

    var segs = [];
    var prevAccum = null;
    // Accumulation (line going down) vs Distribution (line going up) zones.
    // Color-fill under line based on the local slope.
    var areaD = '';
    var lineD = '';
    for (var i = 0; i < rows.length; i++) {
      var x = pad + i * step;
      var y = 10 + (1 - (rows[i].total - vMin) / vSpan) * chartH;
      lineD += (i === 0 ? 'M' : 'L') + x.toFixed(1) + ',' + y.toFixed(1) + ' ';
      if (i === 0) areaD += 'M' + x.toFixed(1) + ',' + (chartH + 10).toFixed(1) + ' L' + x.toFixed(1) + ',' + y.toFixed(1) + ' ';
      else areaD += 'L' + x.toFixed(1) + ',' + y.toFixed(1) + ' ';
    }
    areaD += 'L' + (pad + (rows.length - 1) * step).toFixed(1) + ',' + (chartH + 10).toFixed(1) + ' Z';

    // Baseline line
    segs.push(React.createElement('line', {
      key: 'base', x1: pad, x2: pad + chartW, y1: chartH + 10, y2: chartH + 10,
      stroke: T.edgeHi, strokeWidth: 0.5, strokeDasharray: '3,3',
    }));
    // Area fill — colored by the 30d net direction.
    var netDown = rows[rows.length - 1].total < rows[0].total;
    segs.push(React.createElement('path', {
      key: 'area', d: areaD,
      fill: netDown ? 'rgba(111,207,142,0.08)' : 'rgba(217,107,107,0.08)',
    }));
    segs.push(React.createElement('path', {
      key: 'line', d: lineD, fill: 'none',
      stroke: netDown ? T.bull : T.bear, strokeWidth: 1.4,
    }));

    // Endpoint markers
    segs.push(React.createElement('text', {
      key: 'lblStart', x: pad + 2, y: 14,
      fill: T.textDim, fontSize: 9, fontFamily: T.mono,
    }, rows[0].date + ' · ' + fmtUsd(rows[0].total)));
    segs.push(React.createElement('text', {
      key: 'lblEnd', x: pad + chartW - 2, y: 14,
      textAnchor: 'end', fill: T.textMid, fontSize: 9, fontFamily: T.mono,
    }, rows[rows.length - 1].date + ' · ' + fmtUsd(rows[rows.length - 1].total)));

    return React.createElement('svg', {
      width: width, height: height, viewBox: '0 0 ' + width + ' ' + height,
      style: { display: 'block' },
    }, segs);
  }

  // ---------- main panel ----------
  function TRReservesPanel(props) {
    var open    = props && props.open;
    var onClose = props && props.onClose;

    var h1 = React.useState(null);  var data = h1[0];     var setData    = h1[1];
    var h2 = React.useState(null);  var hist = h2[0];     var setHist    = h2[1];
    var h3 = React.useState(false); var loading = h3[0];  var setLoading = h3[1];
    var h4 = React.useState(null);  var err = h4[0];      var setErr     = h4[1];
    var h5 = React.useState(null);  var upd = h5[0];      var setUpd     = h5[1];

    var refresh = React.useCallback(async function (force) {
      if (!window.ExchangeReserves) {
        setErr('ExchangeReserves engine missing');
        return;
      }
      setLoading(true); setErr(null);
      try {
        if (force) { try { window.ExchangeReserves.clearCache(); } catch (_) {} }
        var snap = await window.ExchangeReserves.getBTCReserves();
        if (!snap) {
          setErr('Data source unreachable — see public dashboards below.');
          setData(null);
          setHist(null);
        } else {
          setData(snap);
          var rows = await window.ExchangeReserves.getHistory(30);
          setHist(rows);
        }
        setUpd(Date.now());
      } catch (e) {
        setErr((e && e.message) || 'fetch failed');
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

    // ---- top strip ----
    var topStrip = React.createElement('div', {
      style: {
        display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 10,
        padding: '12px 14px', marginBottom: 14,
        background: T.ink100, border: '1px solid ' + T.edge, borderRadius: 8,
      },
    },
      bigTile('Total on CEX · USD',
        data ? fmtUsd(data.total) : '—',
        data ? fmtBtc(data.totalBtc) : null,
        null,
        true),
      bigTile('24H Flow',
        data && data.trend24h ? fmtDelta(data.trend24h.usd) : '—',
        data && data.trend24h ? fmtPct(data.trend24h.pct)   : null,
        data && data.trend24h ? data.trend24h.usd           : null),
      bigTile('7D Flow',
        data && data.trend7d ? fmtDelta(data.trend7d.usd) : '—',
        data && data.trend7d ? fmtPct(data.trend7d.pct)   : null,
        data && data.trend7d ? data.trend7d.usd           : null),
      bigTile('30D Flow',
        data && data.trend30d ? fmtDelta(data.trend30d.usd) : '—',
        data && data.trend30d ? fmtPct(data.trend30d.pct)   : null,
        data && data.trend30d ? data.trend30d.usd           : null)
    );

    // ---- per-exchange grid ----
    var rows = [];
    if (data && data.byExchange) {
      var order = Object.keys(data.byExchange);
      for (var i = 0; i < order.length; i++) {
        var name = order[i];
        var ex   = data.byExchange[name];
        rows.push(exchangeCard(name, ex, hist));
      }
    }
    var grid = React.createElement('div', {
      style: {
        display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(220px, 1fr))',
        gap: 10, marginBottom: 14,
      },
    }, rows);

    // ---- 30d line chart ----
    var lineHost = React.createElement('div', {
      style: {
        background: T.ink100, border: '1px solid ' + T.edge, borderRadius: 8,
        padding: '14px 16px', marginBottom: 14,
      },
    },
      React.createElement('div', {
        style: {
          fontFamily: T.mono, fontSize: 10, letterSpacing: 1.2, color: T.signal,
          textTransform: 'uppercase', fontWeight: 600, marginBottom: 10,
        },
      }, 'Total CEX reserves · 30D · ' + ((hist && hist[0] && hist[0].synth) ? 'interpolated' : 'actual')),
      React.createElement(ReservesLine, { rows: hist || [], width: 960, height: 180 }),
      React.createElement('div', {
        style: { marginTop: 10, display: 'flex', gap: 16, fontSize: 10, fontFamily: T.mono, color: T.textDim },
      },
        React.createElement('span', null,
          React.createElement('span', { style: { color: T.bull, marginRight: 5 } }, '▼'),
          'reserves shrinking → accumulation'),
        React.createElement('span', null,
          React.createElement('span', { style: { color: T.bear, marginRight: 5 } }, '▲'),
          'reserves growing → distribution')
      )
    );

    // ---- fallback dashboards strip ----
    var fallbacks = React.createElement('div', {
      style: {
        background: T.ink100, border: '1px solid ' + T.edge, borderRadius: 8,
        padding: '10px 14px',
      },
    },
      React.createElement('div', {
        style: {
          fontFamily: T.mono, fontSize: 10, letterSpacing: 1, color: T.textDim,
          textTransform: 'uppercase', marginBottom: 8,
        },
      }, 'External deep-dive dashboards'),
      React.createElement('div', {
        style: { display: 'flex', flexWrap: 'wrap', gap: 8 },
      }, PUBLIC_DASHBOARDS.map(function (d) {
        return React.createElement('a', {
          key: d.name, href: d.url, target: '_blank', rel: 'noopener noreferrer',
          style: {
            background: T.ink300, color: T.text,
            border: '1px solid ' + T.edgeHi,
            padding: '5px 10px', borderRadius: 4,
            fontSize: 10.5, fontFamily: T.mono,
            letterSpacing: 0.3, textDecoration: 'none',
          },
        }, d.name + ' →');
      }))
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
            }, 'Exchange Reserves · Accumulation / Distribution'),
            React.createElement('div', {
              style: { fontSize: 13, color: T.text, fontWeight: 500 },
            }, 'Spot-ready supply on centralized venues')
          ),
          React.createElement('div', { style: { flex: 1 } }),
          data && data.source && React.createElement('div', {
            style: {
              fontFamily: T.mono, fontSize: 10, color: T.textMid,
              padding: '5px 10px', background: T.ink300, borderRadius: 4,
              border: '0.5px solid ' + T.edgeHi,
            },
          }, 'src · ' + data.source),
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
          }, err),
          topStrip,
          rows.length > 0 ? grid : null,
          hist && hist.length > 1 ? lineHost : null,
          fallbacks
        )
      )
    );
  }

  // ---------- helper: big tile for the top strip ----------
  function bigTile(label, primary, secondary, flowVal, emphasise) {
    var color = flowVal == null ? T.text : colorForFlow(flowVal);
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
        style: { fontFamily: T.mono, fontSize: 22, fontWeight: 600, color: color },
      }, primary),
      secondary && React.createElement('div', {
        style: { fontFamily: T.mono, fontSize: 11, color: T.textMid, marginTop: 4 },
      }, secondary)
    );
  }

  // ---------- helper: per-exchange card ----------
  function exchangeCard(name, ex, hist) {
    if (!ex) {
      return React.createElement('div', {
        key: name,
        style: {
          background: T.ink200, border: '1px solid ' + T.edge, borderRadius: 8,
          padding: '12px 14px',
        },
      },
        React.createElement('div', {
          style: { fontFamily: T.mono, fontSize: 11, color: T.textDim },
        }, name),
        React.createElement('div', {
          style: { fontFamily: T.mono, fontSize: 10, color: T.textDim, marginTop: 6 },
        }, 'no data')
      );
    }
    // Tiny sparkline built from the synthesised global history, scaled by
    // each exchange's share of total (rough but gives visual motion).
    var sparkPts = null;
    if (hist && hist.length) {
      var totalNow = hist[hist.length - 1].total || 1;
      var share = ex.tvlUsd ? ex.tvlUsd / totalNow : 0;
      sparkPts = hist.map(function (r) { return r.total * share; });
    }
    return React.createElement('div', {
      key: name,
      style: {
        background: T.ink200, border: '1px solid ' + T.edge, borderRadius: 8,
        padding: '12px 14px',
      },
    },
      React.createElement('div', {
        style: {
          display: 'flex', alignItems: 'center', justifyContent: 'space-between',
          marginBottom: 6,
        },
      },
        React.createElement('div', {
          style: { fontFamily: T.sans, fontSize: 12, fontWeight: 600, color: T.text },
        }, ex.name || name),
        sparkPts ? React.createElement(Spark, { pts: sparkPts, w: 70, h: 20 }) : null
      ),
      React.createElement('div', {
        style: { fontFamily: T.mono, fontSize: 16, fontWeight: 600, color: T.text },
      }, fmtUsd(ex.tvlUsd)),
      React.createElement('div', {
        style: { fontFamily: T.mono, fontSize: 10, color: T.textDim, marginTop: 2 },
      }, fmtBtc(ex.tvlBtc)),
      React.createElement('div', {
        style: {
          marginTop: 8, display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 3,
          fontFamily: T.mono, fontSize: 10,
        },
      },
        miniRow('24H', ex.in24hUsd, ex.pct24h),
        miniRow('7D',  ex.in1wUsd, ex.pct7d),
        miniRow('30D', ex.in1mUsd, ex.pct30d)
      )
    );
  }
  function miniRow(label, usd, pct) {
    return React.createElement('div', null,
      React.createElement('div', { style: { color: T.textDim, fontSize: 9 } }, label),
      React.createElement('div', { style: { color: colorForFlow(usd) } },
        fmtDelta(usd)
      ),
      React.createElement('div', { style: { color: colorForFlow(usd), fontSize: 9 } },
        fmtPct(pct)
      )
    );
  }

  // ---------- tile ----------
  function TRReservesTile(props) {
    var onOpen = props && props.onOpen;
    var h = React.useState(null); var snap = h[0]; var setSnap = h[1];
    React.useEffect(function () {
      if (!window.ExchangeReserves) return;
      var mounted = true;
      window.ExchangeReserves.getBTCReserves()
        .then(function (s) { if (mounted) setSnap(s); })
        .catch(function () {});
      return function () { mounted = false; };
    }, []);
    var trend7 = snap && snap.trend7d ? snap.trend7d.usd : null;
    return React.createElement('button', {
      onClick: function () {
        if (onOpen) onOpen();
        else if (typeof window.openTRReserves === 'function') window.openTRReserves();
      },
      style: {
        display: 'inline-flex', alignItems: 'center', gap: 8,
        background: T.ink200, border: '1px solid ' + T.edgeHi,
        padding: '6px 12px', borderRadius: 5, cursor: 'pointer',
        fontFamily: T.mono, fontSize: 11, color: T.text, letterSpacing: 0.4,
      },
    },
      React.createElement('span', { style: { fontSize: 13 } }, '🏦'),
      React.createElement('span', { style: { color: T.signal, fontWeight: 600 } }, 'CEX RESERVES'),
      React.createElement('span', { style: { color: T.textDim } }, '·'),
      React.createElement('span', { style: { color: T.textMid } }, '7D'),
      React.createElement('span', {
        style: { color: colorForFlow(trend7), fontWeight: 600 },
      }, trend7 == null ? '—' : fmtDelta(trend7))
    );
  }

  // ---------- global trigger ----------
  window.openTRReserves = function openTRReserves() {
    try { window.dispatchEvent(new CustomEvent('tr:open-reserves')); } catch (_) {}
  };
  window.TRReservesPanel = TRReservesPanel;
  window.TRReservesTile  = TRReservesTile;
})();
