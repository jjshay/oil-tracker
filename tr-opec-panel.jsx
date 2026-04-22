// tr-opec-panel.jsx — OPEC+ production, SPR level, rig count modal.
//
// Exposes:
//   window.TROPECPanel({ open, onClose })
//   window.TROPECTile({ onOpen })
//   window.openTROPEC()                     — fires 'tr:opec:open' CustomEvent
//
// Depends on window.OPECData (engine/opec.js). EIA API key lives in
//   window.TR_SETTINGS.keys.eia   or   window.EIA_API_KEY
// Free key: https://www.eia.gov/opendata/register.php

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
    oil:    '#E4572E',
    mono:   '"JetBrains Mono", ui-monospace, "SF Mono", Menlo, Consolas, monospace',
    sans:   '"Inter Tight", system-ui, sans-serif',
  };

  function fmt(n, dp) {
    if (n == null || !isFinite(n)) return '—';
    return Number(n).toLocaleString('en-US', {
      minimumFractionDigits: dp || 0, maximumFractionDigits: dp != null ? dp : 0,
    });
  }
  function signed(n, dp) {
    if (n == null || !isFinite(n)) return '—';
    var s = n > 0 ? '+' : (n < 0 ? '-' : '');
    return s + fmt(Math.abs(n), dp || 0);
  }
  function signColor(n) {
    if (n == null || !isFinite(n) || n === 0) return T.textDim;
    return n > 0 ? T.bull : T.bear;
  }

  function Mini(props) {
    var data = (props && props.data) || [];
    var w = (props && props.width) || 160;
    var h = (props && props.height) || 34;
    if (!data.length) return (
      <div style={{
        width: w, height: h, display: 'flex', alignItems: 'center',
        justifyContent: 'center', color: T.textDim, fontSize: 10, fontFamily: T.mono,
      }}>—</div>
    );
    var vals = data.map(function (d) { return d.value; });
    var lo = Math.min.apply(null, vals);
    var hi = Math.max.apply(null, vals);
    var span = (hi - lo) || 1;
    var pts = vals.map(function (v, i) {
      var x = (i / Math.max(1, vals.length - 1)) * (w - 4) + 2;
      var y = h - 2 - ((v - lo) / span) * (h - 4);
      return x.toFixed(1) + ',' + y.toFixed(1);
    }).join(' ');
    var up = vals[vals.length - 1] >= vals[0];
    return (
      <svg width={w} height={h} style={{ display: 'block' }}>
        <polyline fill="none"
          stroke={up ? T.bull : T.bear} strokeWidth="1.5" points={pts} />
      </svg>
    );
  }

  function TROPECPanel(props) {
    var open = props && props.open;
    var onClose = props && props.onClose;

    var st_total  = React.useState(null);
    var st_byC    = React.useState({});   // { code: productionObj }
    var st_spr    = React.useState(null);
    var st_rigs   = React.useState(null);
    var st_load   = React.useState(false);
    var st_noKey  = React.useState(false);
    var st_bwSpread = React.useState(null); // { brent, wti, spread }

    // Free, no-key Brent−WTI spread (always loaded; works key or not).
    React.useEffect(function () {
      if (!open) return;
      var active = true;
      (async function () {
        try {
          var rB = await fetch('https://stooq.com/q/l/?s=cb.f&f=sohlc&h&e=csv');
          var rW = await fetch('https://stooq.com/q/l/?s=cl.f&f=sohlc&h&e=csv');
          var tB = await rB.text(), tW = await rW.text();
          var brent = parseFloat((tB.trim().split('\n')[1] || '').split(',')[4]);
          var wti = parseFloat((tW.trim().split('\n')[1] || '').split(',')[4]);
          if (!active) return;
          if (isFinite(brent) && isFinite(wti)) {
            st_bwSpread[1]({ brent: brent, wti: wti, spread: brent - wti });
          }
        } catch (_) {}
      })();
      return function () { active = false; };
    }, [open]);

    React.useEffect(function () {
      if (!open) return;
      if (!window.OPECData) return;
      var active = true;

      var hasKey = !!(
        (window.TR_SETTINGS && window.TR_SETTINGS.keys && window.TR_SETTINGS.keys.eia)
        || window.EIA_API_KEY
      );
      st_noKey[1](!hasKey);
      if (!hasKey) return;

      st_load[1](true);

      var countries = window.OPECData.COUNTRIES || [];
      // Focus grid of 7 per spec: SAU, RUS, IRQ, ARE, IRN, KWT, NGA.
      var focus = ['SAU','RUS','IRQ','ARE','IRN','KWT','NGA'];

      Promise.all([
        window.OPECData.getOPECPlusTotal(6),
        Promise.all(focus.map(function (c) {
          return window.OPECData.getProduction({ country: c, months: 6 })
            .then(function (x) { return [c, x]; });
        })),
        window.OPECData.getSPRLevel(),
        window.OPECData.getRigCount(),
      ]).then(function (vals) {
        if (!active) return;
        st_total[1](vals[0]);
        var byC = {};
        (vals[1] || []).forEach(function (pair) { byC[pair[0]] = pair[1]; });
        st_byC[1](byC);
        st_spr[1](vals[2]);
        st_rigs[1](vals[3]);
      }).catch(function (e) {
        console.warn('[TROPECPanel] load failed:', e && e.message);
      }).finally(function () {
        if (active) st_load[1](false);
      });

      return function () { active = false; };
    }, [open]);

    if (!open) return null;

    var total = st_total[0], byC = st_byC[0], spr = st_spr[0], rigs = st_rigs[0];
    var loading = st_load[0], noKey = st_noKey[0];

    var countries = (window.OPECData && window.OPECData.COUNTRIES) || [];
    var focusCodes = ['SAU','RUS','IRQ','ARE','IRN','KWT','NGA'];
    var focusList = focusCodes.map(function (c) {
      var meta = countries.find(function (x) { return x.code === c; }) || { code: c, name: c };
      return { meta: meta, prod: byC[c] };
    });

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

    return (
      <div style={overlay} onClick={onClose}>
        <div style={shell} onClick={function (e) { e.stopPropagation(); }}>
          {/* HEADER */}
          <div style={{
            padding: '14px 20px', borderBottom: '1px solid ' + T.edge,
            display: 'flex', alignItems: 'center', gap: 14, background: T.ink200,
          }}>
            <span style={{ fontSize: 18 }}>🛢️</span>
            <div>
              <div style={{
                fontSize: 10, letterSpacing: 1.4, color: T.signal,
                textTransform: 'uppercase', fontWeight: 600,
              }}>OPEC+ Production · Supply Tracker</div>
              <div style={{ fontSize: 13, color: T.text, fontWeight: 500 }}>
                EIA monthly production · US SPR · rig count
              </div>
            </div>
            <div style={{ flex: 1 }} />
            <button onClick={onClose} style={{
              background: 'transparent', color: T.textMid,
              border: '1px solid ' + T.edge,
              padding: '5px 12px', borderRadius: 4, cursor: 'pointer',
              fontSize: 11, fontFamily: T.mono, letterSpacing: 0.4,
            }}>CLOSE ✕</button>
          </div>

          {/* BODY */}
          <div style={{ flex: 1, overflowY: 'auto', padding: '20px 24px' }}>
            {noKey && (
              <div style={{
                padding: 14, background: T.ink200,
                border: '1px dashed rgba(201,162,39,0.4)', borderRadius: 6,
                marginBottom: 20, fontSize: 12, color: T.textMid, lineHeight: 1.5,
              }}>
                <div style={{ color: T.signal, fontSize: 10, fontFamily: T.mono,
                              letterSpacing: 1, textTransform: 'uppercase', marginBottom: 6 }}>
                  EIA API key required
                </div>
                Set <code style={{ color: T.text }}>window.TR_SETTINGS.keys.eia</code> or
                {' '}<code style={{ color: T.text }}>window.EIA_API_KEY</code>. Get one free at
                {' '}<a href="https://www.eia.gov/opendata/register.php" target="_blank" rel="noopener noreferrer" style={{ color: T.signal }}>eia.gov/opendata</a>.
              </div>
            )}

            {/* Top — OPEC+ total */}
            <div style={{
              background: T.ink200, border: '1px solid ' + T.edge,
              borderRadius: 8, padding: 18, marginBottom: 22,
              display: 'flex', alignItems: 'center', gap: 22, flexWrap: 'wrap',
            }}>
              <div>
                <div style={{
                  fontSize: 9.5, fontFamily: T.mono, color: T.signal,
                  letterSpacing: 1.2, textTransform: 'uppercase', marginBottom: 4,
                }}>OPEC+ total · latest month</div>
                <div style={{ fontSize: 30, fontWeight: 600, color: T.text }}>
                  {total ? fmt(total.latest, 0) + ' kb/d' : (loading ? '…' : '—')}
                </div>
                {total && (
                  <div style={{ fontSize: 11, fontFamily: T.mono, color: T.textMid, marginTop: 4 }}>
                    <span style={{ color: signColor(total.delta) }}>
                      {signed(total.delta, 0)} kb/d
                    </span>
                    {total.deltaPct != null && (
                      <span style={{ color: signColor(total.deltaPct), marginLeft: 8 }}>
                        ({signed(total.deltaPct, 2)}%)
                      </span>
                    )}
                    <span style={{ color: T.textDim, marginLeft: 10 }}>· {total.asOf}</span>
                  </div>
                )}
              </div>
              <div style={{ flex: 1 }} />
              <div>
                {total && total.history && <Mini data={total.history} width={280} height={56} />}
              </div>
            </div>

            {/* Country grid */}
            <div style={{
              fontSize: 10, letterSpacing: 1.2, color: T.signal,
              textTransform: 'uppercase', fontWeight: 600, marginBottom: 10,
            }}>Member production · 6-month trend</div>
            <div style={{
              display: 'grid', gridTemplateColumns: 'repeat(auto-fill,minmax(220px,1fr))',
              gap: 12, marginBottom: 26,
            }}>
              {focusList.map(function (row) {
                var p = row.prod;
                return (
                  <div key={row.meta.code} style={{
                    background: T.ink200, border: '1px solid ' + T.edge,
                    borderRadius: 6, padding: 12,
                  }}>
                    <div style={{
                      fontSize: 9.5, fontFamily: T.mono, color: T.textDim,
                      letterSpacing: 0.8, marginBottom: 4,
                    }}>{row.meta.code}</div>
                    <div style={{ fontSize: 13, fontWeight: 600, marginBottom: 8 }}>
                      {row.meta.name}
                    </div>
                    <div style={{ fontSize: 17, color: T.text, fontWeight: 600 }}>
                      {p ? fmt(p.latest, 0) + ' kb/d' : '—'}
                    </div>
                    {p && (
                      <div style={{ fontSize: 10.5, fontFamily: T.mono, color: T.textMid, marginTop: 3 }}>
                        <span style={{ color: signColor(p.delta) }}>{signed(p.delta, 0)}</span>
                        {p.deltaPct != null && (
                          <span style={{ color: signColor(p.deltaPct), marginLeft: 6 }}>
                            ({signed(p.deltaPct, 2)}%)
                          </span>
                        )}
                      </div>
                    )}
                    <div style={{ marginTop: 8 }}>
                      {p && p.history && <Mini data={p.history} width={180} height={30} />}
                    </div>
                  </div>
                );
              })}
            </div>

            {/* Bottom row — SPR + rig + Brent-WTI note */}
            <div style={{
              fontSize: 10, letterSpacing: 1.2, color: T.signal,
              textTransform: 'uppercase', fontWeight: 600, marginBottom: 10,
            }}>US supply-side gauges</div>
            <div style={{ display: 'flex', gap: 14, flexWrap: 'wrap' }}>
              <div style={{
                background: T.ink200, border: '1px solid ' + T.edge,
                borderRadius: 6, padding: 14, flex: 1, minWidth: 240,
              }}>
                <div style={{
                  fontSize: 9.5, fontFamily: T.mono, color: T.oil,
                  letterSpacing: 1.2, textTransform: 'uppercase', marginBottom: 6,
                }}>Strategic Petroleum Reserve</div>
                <div style={{ fontSize: 22, fontWeight: 600 }}>
                  {spr ? fmt(spr.kbbl, 0) + ' kbbl' : (loading ? '…' : '—')}
                </div>
                {spr && (
                  <div style={{ fontSize: 10.5, fontFamily: T.mono, color: T.textMid, marginTop: 3 }}>
                    as of {spr.asOf}
                  </div>
                )}
                <div style={{ marginTop: 8 }}>
                  {spr && spr.history && <Mini data={spr.history} width={220} height={34} />}
                </div>
              </div>

              <div style={{
                background: T.ink200, border: '1px solid ' + T.edge,
                borderRadius: 6, padding: 14, flex: 1, minWidth: 240,
              }}>
                <div style={{
                  fontSize: 9.5, fontFamily: T.mono, color: T.oil,
                  letterSpacing: 1.2, textTransform: 'uppercase', marginBottom: 6,
                }}>US rig count (EIA weekly)</div>
                <div style={{ fontSize: 22, fontWeight: 600 }}>
                  {rigs ? fmt(rigs.count, 0) : (loading ? '…' : '—')}
                </div>
                {rigs && (
                  <div style={{ fontSize: 10.5, fontFamily: T.mono, color: T.textMid, marginTop: 3 }}>
                    as of {rigs.asOf}
                  </div>
                )}
              </div>

              <div style={{
                background: T.ink200, border: '1px solid ' + T.edge,
                borderRadius: 6, padding: 14, flex: 1, minWidth: 240,
              }}>
                <div style={{
                  fontSize: 9.5, fontFamily: T.mono, color: T.oil,
                  letterSpacing: 1.2, textTransform: 'uppercase', marginBottom: 6,
                }}>Brent – WTI spread</div>
                <div style={{ fontSize: 13, color: T.textMid, lineHeight: 1.5 }}>
                  Live front-month spread pulls via <code style={{ color: T.text }}>window.Markets</code>
                  if available. A wider Brent-WTI (&gt;$5) typically signals
                  global-supply tightness vs US domestic; a compressed spread
                  (&lt;$2) signals US export arbitrage friction.
                </div>
              </div>
            </div>

            <div style={{
              marginTop: 22, fontSize: 10.5, fontFamily: T.mono, color: T.textDim,
            }}>
              Source: EIA Open Data v2 · monthly international production + weekly petroleum series.
            </div>
          </div>
        </div>
      </div>
    );
  }

  function TROPECTile(props) {
    var onOpen = props && props.onOpen;
    return (
      <button onClick={function () {
        if (onOpen) return onOpen();
        if (window.openTROPEC) window.openTROPEC();
      }} style={{
        display: 'inline-flex', alignItems: 'center', gap: 8,
        background: T.ink200, border: '1px solid ' + T.edgeHi,
        padding: '6px 12px', borderRadius: 5, cursor: 'pointer',
        fontFamily: T.mono, fontSize: 11, color: T.text, letterSpacing: 0.4,
      }}>
        <span style={{ fontSize: 14 }}>🛢️</span>
        <span style={{ color: T.signal, fontWeight: 600 }}>OPEC+ SUPPLY</span>
        <span style={{ color: T.textDim }}>·</span>
        <span style={{ color: T.textMid }}>EIA · SPR · RIGS</span>
      </button>
    );
  }

  window.TROPECPanel = TROPECPanel;
  window.TROPECTile  = TROPECTile;
  window.openTROPEC  = function () {
    try { window.dispatchEvent(new CustomEvent('tr:opec:open')); }
    catch (e) { console.warn('openTROPEC failed', e); }
  };
})();
