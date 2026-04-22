// tr-shipping-panel.jsx — Chokepoints + BDI dashboard modal.
//
// Exposes:
//   window.TRShippingPanel({ open, onClose })
//   window.TRShippingTile({ onOpen })
//   window.openTRShipping()                 — fires 'tr:shipping:open' CustomEvent
//
// Depends on window.ShippingIntel (engine/shipping.js). Graceful degradation
// if any tile fails (chokepoints always render; they are static links).

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

  function fmtNum(n, dp) {
    if (n == null || !isFinite(n)) return '—';
    return Number(n).toLocaleString('en-US', {
      minimumFractionDigits: dp || 0, maximumFractionDigits: dp != null ? dp : 0,
    });
  }
  function signColor(n) {
    if (n == null || !isFinite(n) || n === 0) return T.textDim;
    return n > 0 ? T.bull : T.bear;
  }
  function fmtAge(ts) {
    if (!ts) return '—';
    var d = Date.now() - ts;
    if (d < 60000) return Math.round(d / 1000) + 's ago';
    if (d < 3600000) return Math.round(d / 60000) + 'm ago';
    if (d < 86400000) return Math.round(d / 3600000) + 'h ago';
    return Math.round(d / 86400000) + 'd ago';
  }

  // Minimal SVG sparkline for BDI. Takes an array of { close }.
  function Sparkline(props) {
    var data = (props && props.data) || [];
    var w = (props && props.width) || 220;
    var h = (props && props.height) || 44;
    if (!data.length) return (
      <div style={{
        width: w, height: h, display: 'flex', alignItems: 'center',
        justifyContent: 'center', color: T.textDim, fontFamily: T.mono, fontSize: 10,
      }}>no history</div>
    );
    var closes = data.map(function (d) { return d.close; });
    var lo = Math.min.apply(null, closes);
    var hi = Math.max.apply(null, closes);
    var span = (hi - lo) || 1;
    var pts = closes.map(function (c, i) {
      var x = (i / Math.max(1, closes.length - 1)) * (w - 4) + 2;
      var y = h - 2 - ((c - lo) / span) * (h - 4);
      return x.toFixed(1) + ',' + y.toFixed(1);
    }).join(' ');
    var lastUp = closes[closes.length - 1] >= closes[0];
    return (
      <svg width={w} height={h} style={{ display: 'block' }}>
        <polyline fill="none"
          stroke={lastUp ? T.bull : T.bear} strokeWidth="1.5" points={pts} />
      </svg>
    );
  }

  function StatTile(props) {
    var label = props.label, value = props.value, sub = props.sub;
    var accent = props.accent || T.signal;
    var children = props.children;
    return (
      <div style={{
        background: T.ink200, border: '1px solid ' + T.edge,
        borderRadius: 6, padding: 14, minWidth: 200, flex: 1,
      }}>
        <div style={{
          fontSize: 9.5, fontFamily: T.mono, color: accent,
          letterSpacing: 1.2, textTransform: 'uppercase', marginBottom: 6,
        }}>{label}</div>
        <div style={{ fontSize: 22, fontWeight: 600, color: T.text, marginBottom: 4 }}>
          {value}
        </div>
        {sub && (
          <div style={{ fontSize: 10.5, fontFamily: T.mono, color: T.textMid }}>
            {sub}
          </div>
        )}
        {children}
      </div>
    );
  }

  function TRShippingPanel(props) {
    var open = props && props.open;
    var onClose = props && props.onClose;

    var st_p = React.useState(null);
    var st_s = React.useState(null);
    var st_b = React.useState(null);
    var st_l = React.useState(false);

    React.useEffect(function () {
      if (!open) return;
      if (!window.ShippingIntel) return;
      var active = true;
      st_l[1](true);
      Promise.all([
        window.ShippingIntel.getPanamaTransits(),
        window.ShippingIntel.getSuezTransits(),
        window.ShippingIntel.getBDI(),
      ]).then(function (vals) {
        if (!active) return;
        st_p[1](vals[0]);
        st_s[1](vals[1]);
        st_b[1](vals[2]);
      }).catch(function (e) {
        console.warn('[TRShippingPanel] load failed:', e && e.message);
      }).finally(function () {
        if (active) st_l[1](false);
      });
      return function () { active = false; };
    }, [open]);

    if (!open) return null;

    var panama = st_p[0], suez = st_s[0], bdi = st_b[0], loading = st_l[0];
    var chokepoints = (window.ShippingIntel && window.ShippingIntel.CHOKEPOINTS) || [];

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
            <span style={{ fontSize: 18 }}>🚢</span>
            <div>
              <div style={{
                fontSize: 10, letterSpacing: 1.4, color: T.signal,
                textTransform: 'uppercase', fontWeight: 600,
              }}>Global Shipping · Chokepoints</div>
              <div style={{ fontSize: 13, color: T.text, fontWeight: 500 }}>
                Panama + Suez transits · Baltic Dry Index · 6 chokepoint AIS links
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
            {/* Top row — Panama, Suez, BDI */}
            <div style={{ display: 'flex', gap: 14, flexWrap: 'wrap', marginBottom: 22 }}>
              <StatTile
                label="Panama Canal · Daily transits"
                value={panama ? fmtNum(panama.daily, 0) : (loading ? '…' : '—')}
                sub={panama ? (
                  (panama.avg30d != null ? '30d avg ' + fmtNum(panama.avg30d, 1) : '')
                  + (panama.delta != null ? '  ·  Δ ' + (panama.delta >= 0 ? '+' : '') + fmtNum(panama.delta, 1) : '')
                ) : 'scraping pancanal.com'}
              />
              <StatTile
                label="Suez Canal · Daily transits"
                value={suez ? fmtNum(suez.daily, 0) : (loading ? '…' : '—')}
                sub={suez ? (
                  (suez.avg30d != null ? '30d avg ' + fmtNum(suez.avg30d, 1) : '')
                  + (suez.delta != null ? '  ·  Δ ' + (suez.delta >= 0 ? '+' : '') + fmtNum(suez.delta, 1) : '')
                ) : 'scraping suezcanal.gov.eg'}
              />
              <StatTile
                label="Baltic Dry Index (BDI)"
                value={bdi ? fmtNum(bdi.last, 0) : (loading ? '…' : '—')}
                sub={bdi ? (
                  (bdi.change != null
                    ? (bdi.change >= 0 ? '+' : '') + fmtNum(bdi.change, 0)
                    : '')
                  + (bdi.changePct != null
                    ? '  ·  ' + (bdi.changePct >= 0 ? '+' : '') + fmtNum(bdi.changePct, 2) + '%'
                    : '')
                ) : 'Stooq ^BDI'}
              >
                <div style={{ marginTop: 10 }}>
                  {bdi && bdi.history && <Sparkline data={bdi.history} width={220} height={40} />}
                </div>
              </StatTile>
            </div>

            {/* Context band */}
            <div style={{
              fontSize: 11.5, color: T.textMid, lineHeight: 1.6, marginBottom: 20,
              padding: '10px 12px', background: T.ink200,
              border: '1px solid ' + T.edge, borderRadius: 6,
            }}>
              Panama Canal runs ~36 transits/day normal; drought-restricted
              regimes have dropped it to 22–24. Suez runs ~50–55/day normal;
              Red Sea attacks have forced reroutes via Cape of Good Hope
              (adds ~10 days + ~$1M fuel). BDI is a proxy for dry-bulk freight
              demand (iron ore, coal, grain) and leads commodity exporters.
            </div>

            {/* Chokepoint grid */}
            <div style={{
              fontSize: 10, letterSpacing: 1.2, color: T.signal,
              textTransform: 'uppercase', fontWeight: 600, marginBottom: 10,
            }}>Live AIS density · chokepoints</div>
            <div style={{
              display: 'grid', gridTemplateColumns: 'repeat(auto-fill,minmax(240px,1fr))',
              gap: 12,
            }}>
              {chokepoints.map(function (cp) {
                return (
                  <div key={cp.id} style={{
                    background: T.ink200, border: '1px solid ' + T.edge,
                    borderRadius: 6, padding: 12,
                  }}>
                    <div style={{
                      fontSize: 9.5, fontFamily: T.mono, color: T.textDim,
                      letterSpacing: 0.6, marginBottom: 4,
                    }}>{cp.lat.toFixed(2)}, {cp.lon.toFixed(2)}</div>
                    <div style={{ fontSize: 13, fontWeight: 600, marginBottom: 10 }}>
                      {cp.name}
                    </div>
                    <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                      <a href={cp.marineTrafficUrl} target="_blank" rel="noopener noreferrer" style={{
                        fontSize: 10, fontFamily: T.mono, color: T.signal,
                        textDecoration: 'none', border: '1px solid ' + T.edgeHi,
                        padding: '4px 8px', borderRadius: 3,
                      }}>MarineTraffic →</a>
                      <a href={cp.vesselFinderUrl} target="_blank" rel="noopener noreferrer" style={{
                        fontSize: 10, fontFamily: T.mono, color: T.signal,
                        textDecoration: 'none', border: '1px solid ' + T.edgeHi,
                        padding: '4px 8px', borderRadius: 3,
                      }}>VesselFinder →</a>
                    </div>
                  </div>
                );
              })}
            </div>

            {/* Footer age */}
            <div style={{
              marginTop: 20, fontFamily: T.mono, fontSize: 10, color: T.textDim,
              display: 'flex', gap: 16, flexWrap: 'wrap',
            }}>
              {panama && <span>Panama · {fmtAge(panama.fetchedAt)}</span>}
              {suez && <span>Suez · {fmtAge(suez.fetchedAt)}</span>}
              {bdi && <span>BDI · {fmtAge(bdi.fetchedAt)}</span>}
            </div>
          </div>
        </div>
      </div>
    );
  }

  function TRShippingTile(props) {
    var onOpen = props && props.onOpen;
    return (
      <button onClick={function () {
        if (onOpen) return onOpen();
        if (window.openTRShipping) window.openTRShipping();
      }} style={{
        display: 'inline-flex', alignItems: 'center', gap: 8,
        background: T.ink200, border: '1px solid ' + T.edgeHi,
        padding: '6px 12px', borderRadius: 5, cursor: 'pointer',
        fontFamily: T.mono, fontSize: 11, color: T.text, letterSpacing: 0.4,
      }}>
        <span style={{ fontSize: 14 }}>🚢</span>
        <span style={{ color: T.signal, fontWeight: 600 }}>CHOKEPOINTS</span>
        <span style={{ color: T.textDim }}>·</span>
        <span style={{ color: T.textMid }}>PANAMA · SUEZ · BDI</span>
      </button>
    );
  }

  window.TRShippingPanel = TRShippingPanel;
  window.TRShippingTile  = TRShippingTile;
  window.openTRShipping  = function () {
    try { window.dispatchEvent(new CustomEvent('tr:shipping:open')); }
    catch (e) { console.warn('openTRShipping failed', e); }
  };
})();
