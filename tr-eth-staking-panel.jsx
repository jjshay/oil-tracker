// tr-eth-staking-panel.jsx — Ethereum validator + LSD dashboard.
//
// Exposes:
//   window.TRETHStakingPanel({ open, onClose })  — full modal
//   window.openTRETHStaking()                     — fires 'tr:open-eth-staking'
//
// Depends on window.ETHStaking (engine/eth-staking.js).

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
  function fmtEthBig(x) {
    if (x == null || !isFinite(x)) return '—';
    var abs = Math.abs(x);
    var sign = x < 0 ? '-' : '';
    if (abs >= 1e6) return sign + (abs / 1e6).toFixed(2) + 'M';
    if (abs >= 1e3) return sign + (abs / 1e3).toFixed(1) + 'K';
    return sign + abs.toFixed(0);
  }
  function fmtUsdBig(x) {
    if (x == null || !isFinite(x)) return '—';
    var abs = Math.abs(x);
    var sign = x < 0 ? '-' : '';
    if (abs >= 1e12) return sign + '$' + (abs / 1e12).toFixed(2) + 'T';
    if (abs >= 1e9)  return sign + '$' + (abs / 1e9).toFixed(2)  + 'B';
    if (abs >= 1e6)  return sign + '$' + (abs / 1e6).toFixed(1)  + 'M';
    return sign + '$' + abs.toFixed(0);
  }
  function fmtPct(x, digits) {
    if (x == null || !isFinite(x)) return '—';
    var d = (digits == null) ? 2 : digits;
    return (x >= 0 ? '' : '') + x.toFixed(d) + '%';
  }
  function fmtNum(x) {
    if (x == null || !isFinite(x)) return '—';
    return Math.round(x).toLocaleString();
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

  // ---------- LSD horizontal bar chart ----------
  function LSDBars(props) {
    var rows = props.rows || [];
    if (!rows.length) {
      return React.createElement('div', {
        style: { padding: '20px', fontFamily: T.mono, fontSize: 11,
                 color: T.textDim, textAlign: 'center' },
      }, 'no LSD data');
    }
    var top = rows.slice(0, 8);
    var maxTvl = 0;
    for (var i = 0; i < top.length; i++) if (top[i].tvl > maxTvl) maxTvl = top[i].tvl;

    return React.createElement('div', {
      style: { display: 'flex', flexDirection: 'column', gap: 6 },
    }, top.map(function (r, idx) {
      var barPct = maxTvl > 0 ? (r.tvl / maxTvl) * 100 : 0;
      var isLido = /lido/i.test(r.name);
      var fill = isLido ? T.signal : T.bull;
      return React.createElement('div', {
        key: (r.name || '') + '_' + idx,
        style: { display: 'grid', gridTemplateColumns: '130px 1fr 110px 70px',
                 gap: 10, alignItems: 'center' },
      },
        React.createElement('div', {
          style: { fontFamily: T.sans, fontSize: 12, fontWeight: 600, color: T.text,
                   whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' },
        }, r.name),
        React.createElement('div', {
          style: { height: 14, background: T.ink300, borderRadius: 3, overflow: 'hidden',
                   border: '0.5px solid ' + T.edge },
        },
          React.createElement('div', {
            style: { width: barPct + '%', height: '100%', background: fill, opacity: 0.85 },
          })
        ),
        React.createElement('div', {
          style: { fontFamily: T.mono, fontSize: 11, color: T.text, textAlign: 'right',
                   fontWeight: 600 },
        }, fmtUsdBig(r.tvl)),
        React.createElement('div', {
          style: { fontFamily: T.mono, fontSize: 10, color: T.textMid, textAlign: 'right' },
        }, r.marketShare != null ? r.marketShare.toFixed(1) + '%' : '—')
      );
    }));
  }

  // ---------- queue bar (activation vs exit) ----------
  function QueueChart(props) {
    var queued  = Number(props.queued)  || 0;
    var exiting = Number(props.exiting) || 0;
    var max = Math.max(queued, exiting, 1);
    var qPct = (queued / max) * 100;
    var ePct = (exiting / max) * 100;
    return React.createElement('div', {
      style: { display: 'flex', flexDirection: 'column', gap: 10 },
    },
      React.createElement('div', null,
        React.createElement('div', {
          style: { display: 'flex', justifyContent: 'space-between',
                   fontFamily: T.mono, fontSize: 10, color: T.textMid,
                   letterSpacing: 0.5, marginBottom: 4 },
        },
          React.createElement('span', null, 'ACTIVATION QUEUE'),
          React.createElement('span', { style: { color: T.bull, fontWeight: 600 } },
                              fmtNum(queued) + ' validators')
        ),
        React.createElement('div', {
          style: { height: 10, background: T.ink300, borderRadius: 3, overflow: 'hidden' },
        },
          React.createElement('div', {
            style: { width: qPct + '%', height: '100%', background: T.bull, opacity: 0.85 },
          })
        )
      ),
      React.createElement('div', null,
        React.createElement('div', {
          style: { display: 'flex', justifyContent: 'space-between',
                   fontFamily: T.mono, fontSize: 10, color: T.textMid,
                   letterSpacing: 0.5, marginBottom: 4 },
        },
          React.createElement('span', null, 'EXIT QUEUE'),
          React.createElement('span', { style: { color: T.bear, fontWeight: 600 } },
                              fmtNum(exiting) + ' validators')
        ),
        React.createElement('div', {
          style: { height: 10, background: T.ink300, borderRadius: 3, overflow: 'hidden' },
        },
          React.createElement('div', {
            style: { width: ePct + '%', height: '100%', background: T.bear, opacity: 0.85 },
          })
        )
      )
    );
  }

  // ---------- main panel ----------
  function TRETHStakingPanel(props) {
    var open = props && props.open;
    var onClose = props && props.onClose;

    var s1 = React.useState(null);   var stats   = s1[0];  var setStats   = s1[1];
    var s2 = React.useState(null);   var lsds    = s2[0];  var setLsds    = s2[1];
    var s3 = React.useState(false);  var loading = s3[0];  var setLoading = s3[1];
    var s4 = React.useState(null);   var err     = s4[0];  var setErr     = s4[1];
    var s5 = React.useState(null);   var updatedAt = s5[0]; var setUpdatedAt = s5[1];

    var refresh = React.useCallback(async function (force) {
      if (!window.ETHStaking) { setErr('ETHStaking engine missing'); return; }
      setLoading(true); setErr(null);
      try {
        if (force) { try { window.ETHStaking.clearCache(); } catch (_) {} }
        var out = await Promise.all([
          window.ETHStaking.getValidatorStats(),
          window.ETHStaking.getLSDBreakdown(),
        ]);
        setStats(out[0]);
        setLsds(out[1] || []);
        if (!out[0] && (!out[1] || !out[1].length)) setErr('data source unreachable');
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

    var lastUpdated = updatedAt ? fmtAge(updatedAt) : '—';

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
          width: 880, maxHeight: '94%', overflow: 'auto',
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
          }, 'ETH Staking · Beaconcha.in + DeFiLlama'),
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

        // Headline grid
        React.createElement('div', {
          style: {
            display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 10,
            padding: '14px 16px',
            background: T.ink200, border: '1px solid ' + T.edge, borderRadius: 8,
            marginBottom: 16,
          },
        },
          bigCell('Staked ETH',     stats ? fmtEthBig(stats.total_staked_eth) : '—', T.text),
          bigCell('% of Supply',    stats && stats.pct_of_supply != null
                                     ? stats.pct_of_supply.toFixed(2) + '%' : '—', T.signal),
          bigCell('Net APR',        stats && stats.apr != null
                                     ? stats.apr.toFixed(2) + '%' : '—', T.bull),
          bigCell('Active Validators',
                  stats ? fmtNum(stats.total_active) : '—', T.text)
        ),

        // LSD breakdown
        React.createElement('div', {
          style: {
            padding: '14px 16px', marginBottom: 16,
            background: T.ink200, border: '1px solid ' + T.edge, borderRadius: 8,
          },
        },
          React.createElement('div', {
            style: { fontSize: 9, letterSpacing: 0.8, color: T.textDim,
                     textTransform: 'uppercase', fontWeight: 600, marginBottom: 10 },
          }, 'Liquid Staking Derivatives · TVL'),
          React.createElement(LSDBars, { rows: lsds || [] })
        ),

        // Queue
        React.createElement('div', {
          style: {
            padding: '14px 16px',
            background: T.ink200, border: '1px solid ' + T.edge, borderRadius: 8,
          },
        },
          React.createElement('div', {
            style: { fontSize: 9, letterSpacing: 0.8, color: T.textDim,
                     textTransform: 'uppercase', fontWeight: 600, marginBottom: 10 },
          }, 'Validator Queue'),
          React.createElement(QueueChart, {
            queued:  stats ? stats.queued  : 0,
            exiting: stats ? stats.exiting : 0,
          }),
          stats && stats.finalized_epoch ? React.createElement('div', {
            style: { marginTop: 10, fontFamily: T.mono, fontSize: 9.5,
                     color: T.textDim, letterSpacing: 0.4 },
          }, 'Finalized Epoch · ' + fmtNum(stats.finalized_epoch)
            + (stats.avg_balance ? ' · Avg Balance ' + stats.avg_balance.toFixed(3) + ' ETH' : '')) : null
        )
      )
    );
  }

  function bigCell(label, val, color) {
    return React.createElement('div', { style: { display: 'flex', flexDirection: 'column', gap: 4 } },
      React.createElement('div', {
        style: { fontSize: 9, letterSpacing: 0.8, color: T.textDim,
                 textTransform: 'uppercase', fontWeight: 600 },
      }, label),
      React.createElement('div', {
        style: { fontFamily: T.mono, fontSize: 18, fontWeight: 600,
                 color: color || T.text, letterSpacing: 0.3 },
      }, val)
    );
  }

  window.openTRETHStaking = function openTRETHStaking() {
    try { window.dispatchEvent(new CustomEvent('tr:open-eth-staking')); } catch (_) {}
  };
  window.TRETHStakingPanel = TRETHStakingPanel;
})();
