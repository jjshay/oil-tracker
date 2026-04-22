// tr-weather-panel.jsx — NOAA weather + NHC hurricane intelligence modal.
//
// Exposes:
//   window.TRWeatherPanel({ open, onClose })
//   window.TRWeatherTile({ onOpen })
//   window.openTRWeather()                  — fires 'tr:weather:open' CustomEvent
//
// Depends on window.WeatherIntel (engine/weather.js). Degrades gracefully
// when absent or when fetches fail (NWS can hiccup without warning).

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
    storm:  '#7b6cff',
    mono:   '"JetBrains Mono", ui-monospace, "SF Mono", Menlo, Consolas, monospace',
    sans:   '"Inter Tight", system-ui, sans-serif',
  };

  function riskColor(r) {
    if (r === 'high')     return T.bear;
    if (r === 'elevated') return T.signal;
    return T.bull;
  }

  function fmtTime(iso) {
    if (!iso) return '—';
    try {
      var d = new Date(iso);
      if (isNaN(d.getTime())) return iso;
      return d.toLocaleString('en-US', {
        month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit',
      });
    } catch (e) { return iso; }
  }

  function classificationLabel(c) {
    // NHC short codes: HU, TS, TD, PT, STS, etc.
    var map = {
      HU: 'Hurricane', TS: 'Tropical Storm', TD: 'Tropical Depression',
      PT: 'Post-Tropical', STS: 'Subtropical Storm', SD: 'Subtropical Dep.',
    };
    return map[c] || c || 'System';
  }

  function TRWeatherPanel(props) {
    var open = props && props.open;
    var onClose = props && props.onClose;

    var st_alerts   = React.useState([]);
    var alerts      = st_alerts[0], setAlerts = st_alerts[1];
    var st_storms   = React.useState([]);
    var storms      = st_storms[0], setStorms = st_storms[1];
    var st_gulf     = React.useState([]);
    var gulfAlerts  = st_gulf[0], setGulf = st_gulf[1];
    var st_corr     = React.useState(null);
    var corr        = st_corr[0], setCorr = st_corr[1];
    var st_loading  = React.useState(false);
    var loading     = st_loading[0], setLoading = st_loading[1];

    React.useEffect(function () {
      if (!open) return;
      if (!window.WeatherIntel) return;
      var active = true;
      setLoading(true);
      Promise.all([
        window.WeatherIntel.getActiveAlerts({ severity: 'Severe' }),
        window.WeatherIntel.getActiveAlerts({ severity: 'Extreme' }),
        window.WeatherIntel.getHurricanes(),
        window.WeatherIntel.getGulfAlerts(),
        window.WeatherIntel.getCorrelation(),
      ]).then(function (vals) {
        if (!active) return;
        var sev = vals[0] || [], ext = vals[1] || [];
        var seen = {}, merged = [];
        var pushAll = function (arr) {
          for (var i = 0; i < arr.length; i++) {
            if (seen[arr[i].id]) continue;
            seen[arr[i].id] = true;
            merged.push(arr[i]);
          }
        };
        pushAll(ext); pushAll(sev);
        setAlerts(merged);
        setStorms(vals[2] || []);
        setGulf(vals[3] || []);
        setCorr(vals[4] || null);
      }).catch(function (e) {
        console.warn('[TRWeatherPanel] load failed:', e && e.message);
      }).finally(function () {
        if (active) setLoading(false);
      });
      return function () { active = false; };
    }, [open]);

    if (!open) return null;

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
            <span style={{ fontSize: 18 }}>⛈️</span>
            <div>
              <div style={{
                fontSize: 10, letterSpacing: 1.4, color: T.signal,
                textTransform: 'uppercase', fontWeight: 600,
              }}>NOAA Weather · NHC Hurricanes</div>
              <div style={{ fontSize: 13, color: T.text, fontWeight: 500 }}>
                Severe alerts + active tropical systems · energy-market overlay
              </div>
            </div>
            <div style={{ flex: 1 }} />
            {corr && (
              <div style={{
                fontFamily: T.mono, fontSize: 10.5, color: T.textMid,
                padding: '5px 10px', background: T.ink300, borderRadius: 4,
                border: '0.5px solid ' + T.edgeHi, display: 'flex', gap: 10,
              }}>
                <span>OIL <span style={{ color: riskColor(corr.oilRisk) }}>{String(corr.oilRisk || '').toUpperCase()}</span></span>
                <span>NATGAS <span style={{ color: riskColor(corr.natgasRisk) }}>{String(corr.natgasRisk || '').toUpperCase()}</span></span>
              </div>
            )}
            <button onClick={onClose} style={{
              background: 'transparent', color: T.textMid,
              border: '1px solid ' + T.edge,
              padding: '5px 12px', borderRadius: 4, cursor: 'pointer',
              fontSize: 11, fontFamily: T.mono, letterSpacing: 0.4,
            }}>CLOSE ✕</button>
          </div>

          {/* BODY */}
          <div style={{ flex: 1, display: 'flex', minHeight: 0 }}>
            {/* LEFT — Hurricanes + Gulf */}
            <div style={{ flex: 1.2, overflowY: 'auto', padding: '18px 22px' }}>
              {/* Hurricanes */}
              <div style={{
                fontSize: 10, letterSpacing: 1.2, color: T.signal,
                textTransform: 'uppercase', fontWeight: 600, marginBottom: 10,
              }}>Active tropical systems · {storms.length}</div>
              {loading && !storms.length && (
                <div style={{ fontSize: 12, color: T.textDim, fontStyle: 'italic' }}>
                  Loading NHC feed…
                </div>
              )}
              {!loading && storms.length === 0 && (
                <div style={{
                  fontSize: 12, color: T.textDim,
                  padding: 14, background: T.ink200, borderRadius: 6,
                  border: '1px dashed ' + T.edge,
                }}>
                  No active tropical systems on NHC watchlist right now.
                </div>
              )}
              <div style={{
                display: 'grid', gridTemplateColumns: 'repeat(auto-fill,minmax(280px,1fr))',
                gap: 10, marginBottom: 24,
              }}>
                {storms.map(function (s, i) {
                  var inGulf = window.WeatherIntel
                    && s.lat >= window.WeatherIntel.GULF_BBOX.latMin
                    && s.lat <= window.WeatherIntel.GULF_BBOX.latMax
                    && s.lon >= window.WeatherIntel.GULF_BBOX.lonMin
                    && s.lon <= window.WeatherIntel.GULF_BBOX.lonMax;
                  return (
                    <div key={s.id || i} style={{
                      background: T.ink200, borderRadius: 6,
                      border: '1px solid ' + (inGulf ? T.signal : T.edge),
                      padding: 12, position: 'relative',
                    }}>
                      {inGulf && (
                        <div style={{
                          position: 'absolute', top: 8, right: 8,
                          fontSize: 9, fontFamily: T.mono, color: T.signal,
                          letterSpacing: 0.6,
                        }}>GULF</div>
                      )}
                      <div style={{
                        fontSize: 9.5, fontFamily: T.mono, color: T.storm,
                        letterSpacing: 0.6, marginBottom: 4,
                      }}>{classificationLabel(s.classification).toUpperCase()}</div>
                      <div style={{ fontSize: 15, fontWeight: 600, marginBottom: 6 }}>
                        {s.name}
                      </div>
                      <div style={{
                        display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 4,
                        fontSize: 11, fontFamily: T.mono, color: T.textMid,
                      }}>
                        <div>Wind: <span style={{ color: T.text }}>{s.intensity || '—'} kt</span></div>
                        <div>Pres: <span style={{ color: T.text }}>{s.pressure || '—'} mb</span></div>
                        <div>Lat: <span style={{ color: T.text }}>{s.lat ? s.lat.toFixed(1) : '—'}</span></div>
                        <div>Lon: <span style={{ color: T.text }}>{s.lon ? s.lon.toFixed(1) : '—'}</span></div>
                        <div>Move: <span style={{ color: T.text }}>{s.movementDir || '—'}</span></div>
                        <div>Spd: <span style={{ color: T.text }}>{s.movementSpeed || '—'} kt</span></div>
                      </div>
                      {(s.graphicUrl || s.publicAdvisory) && (
                        <div style={{ marginTop: 8, display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                          {s.graphicUrl && (
                            <a href={s.graphicUrl} target="_blank" rel="noopener noreferrer" style={{
                              fontSize: 10, fontFamily: T.mono, color: T.signal,
                              textDecoration: 'none',
                              border: '1px solid ' + T.edgeHi,
                              padding: '3px 7px', borderRadius: 3,
                            }}>5-DAY CONE →</a>
                          )}
                          {s.publicAdvisory && (
                            <a href={s.publicAdvisory} target="_blank" rel="noopener noreferrer" style={{
                              fontSize: 10, fontFamily: T.mono, color: T.signal,
                              textDecoration: 'none',
                              border: '1px solid ' + T.edgeHi,
                              padding: '3px 7px', borderRadius: 3,
                            }}>ADVISORY →</a>
                          )}
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>

              {/* Gulf-focused block */}
              <div style={{
                fontSize: 10, letterSpacing: 1.2, color: T.signal,
                textTransform: 'uppercase', fontWeight: 600, marginBottom: 10,
              }}>Gulf of Mexico oil-production zone · {gulfAlerts.length}</div>
              <div style={{
                background: 'linear-gradient(180deg, rgba(201,162,39,0.06), rgba(201,162,39,0.00))',
                border: '1px solid rgba(201,162,39,0.25)',
                borderRadius: 6, padding: 12, marginBottom: 18,
              }}>
                <div style={{ fontSize: 11, color: T.textMid, lineHeight: 1.5, marginBottom: 8 }}>
                  The Gulf produces ~30% of US crude + ~5% of natgas. Active
                  alerts or storms inside this bbox can trigger shut-ins
                  (operators evacuate rigs 48–72h ahead).
                </div>
                {gulfAlerts.length === 0 ? (
                  <div style={{ fontSize: 11, color: T.textDim, fontStyle: 'italic' }}>
                    No severe/extreme alerts in the Gulf zone.
                  </div>
                ) : (
                  gulfAlerts.slice(0, 6).map(function (a, i) {
                    return (
                      <div key={a.id || i} style={{
                        padding: '8px 0',
                        borderTop: i === 0 ? 'none' : '1px solid ' + T.edge,
                        fontSize: 11.5,
                      }}>
                        <div style={{ color: T.text, fontWeight: 500 }}>{a.event}</div>
                        <div style={{ color: T.textMid, fontSize: 10.5 }}>{a.areaDesc}</div>
                      </div>
                    );
                  })
                )}
              </div>

              {/* Correlation notes */}
              <div style={{
                fontSize: 10, letterSpacing: 1.2, color: T.signal,
                textTransform: 'uppercase', fontWeight: 600, marginBottom: 10,
              }}>Natgas demand · weather correlation</div>
              <div style={{
                background: T.ink200, border: '1px solid ' + T.edge,
                borderRadius: 6, padding: 12, fontSize: 11.5, color: T.text,
                lineHeight: 1.55,
              }}>
                {corr && corr.notes && corr.notes.length ? (
                  <ul style={{ margin: 0, paddingLeft: 18 }}>
                    {corr.notes.map(function (n, i) {
                      return <li key={i} style={{ marginBottom: 4 }}>{n}</li>;
                    })}
                  </ul>
                ) : (
                  <span style={{ color: T.textDim }}>Pulling correlation context…</span>
                )}
              </div>
            </div>

            {/* RIGHT — All severe alerts */}
            <div style={{
              width: 420, background: T.ink100, borderLeft: '1px solid ' + T.edge,
              display: 'flex', flexDirection: 'column', overflow: 'hidden',
            }}>
              <div style={{
                padding: '12px 18px 8px', fontSize: 10, letterSpacing: 1.2,
                color: T.signal, textTransform: 'uppercase', fontWeight: 600,
              }}>Active severe + extreme alerts · {alerts.length}</div>
              <div style={{ flex: 1, overflowY: 'auto' }}>
                {loading && !alerts.length && (
                  <div style={{ padding: '10px 18px', fontSize: 11, color: T.textDim, fontStyle: 'italic' }}>
                    Loading api.weather.gov/alerts/active…
                  </div>
                )}
                {!loading && alerts.length === 0 && (
                  <div style={{ padding: '10px 18px', fontSize: 11, color: T.textDim }}>
                    No severe or extreme alerts active.
                  </div>
                )}
                {alerts.map(function (a, i) {
                  var sevColor = a.severity === 'Extreme' ? T.bear
                               : a.severity === 'Severe'  ? T.signal
                               : T.textMid;
                  return (
                    <div key={a.id || i} style={{
                      padding: '10px 18px',
                      borderBottom: '1px solid ' + T.edge,
                    }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 3 }}>
                        <span style={{
                          fontSize: 9, fontFamily: T.mono, color: sevColor,
                          letterSpacing: 0.6,
                        }}>{String(a.severity || '').toUpperCase()}</span>
                        <span style={{ fontSize: 9, fontFamily: T.mono, color: T.textDim }}>
                          · {fmtTime(a.sent)}
                        </span>
                      </div>
                      <div style={{ fontSize: 12, color: T.text, lineHeight: 1.4 }}>
                        {a.event}
                      </div>
                      <div style={{ fontSize: 10.5, color: T.textMid, marginTop: 2 }}>
                        {a.areaDesc}
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          </div>
        </div>
      </div>
    );
  }

  function TRWeatherTile(props) {
    var onOpen = props && props.onOpen;
    return (
      <button onClick={function () {
        if (onOpen) return onOpen();
        if (window.openTRWeather) window.openTRWeather();
      }} style={{
        display: 'inline-flex', alignItems: 'center', gap: 8,
        background: T.ink200, border: '1px solid ' + T.edgeHi,
        padding: '6px 12px', borderRadius: 5, cursor: 'pointer',
        fontFamily: T.mono, fontSize: 11, color: T.text, letterSpacing: 0.4,
      }}>
        <span style={{ fontSize: 14 }}>⛈️</span>
        <span style={{ color: T.signal, fontWeight: 600 }}>WEATHER + HURRICANES</span>
        <span style={{ color: T.textDim }}>·</span>
        <span style={{ color: T.textMid }}>NOAA</span>
      </button>
    );
  }

  window.TRWeatherPanel = TRWeatherPanel;
  window.TRWeatherTile  = TRWeatherTile;
  window.openTRWeather  = function () {
    try { window.dispatchEvent(new CustomEvent('tr:weather:open')); }
    catch (e) { console.warn('openTRWeather failed', e); }
  };
})();
