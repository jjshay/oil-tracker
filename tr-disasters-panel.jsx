// tr-disasters-panel.jsx — OSINT disaster modal.
// Pairs with engine/disasters.js. Shows a simple SVG world map with plotted
// dots (earthquakes + wildfires + GDACS red/orange alerts) plus a filterable
// list below.
//
// Exposes:
//   window.TRDisastersPanel({ open, onClose })
//   window.openTRDisasters()
//
// Coordinator wires the tile. Does not touch index.html / screens.

(function () {
  const T = {
    ink000: '#07090C', ink100: '#0B0E13', ink200: '#10141B', ink300: '#171C24',
    edge:   'rgba(255,255,255,0.06)', edgeHi: 'rgba(255,255,255,0.10)',
    text:   '#ffffff', textMid: 'rgba(180,188,200,0.75)', textDim: 'rgba(130,138,150,0.55)',
    signal: '#c9a227', bull: '#6FCF8E', bear: '#D96B6B',
    quake:  '#D96B6B', fire: '#f38a32', gdacs: '#c9a227',
    mono:   '"JetBrains Mono", ui-monospace, "SF Mono", Menlo, Consolas, monospace',
    ui:     'InterTight, -apple-system, BlinkMacSystemFont, "SF Pro Text", system-ui, sans-serif',
  };

  const CATEGORIES = ['All', 'Earthquake', 'Wildfire', 'Other'];
  const REGION_OPTS = [
    { key: 'world',          label: 'World' },
    { key: 'middle_east',    label: 'Middle East' },
    { key: 'caspian',        label: 'Caspian' },
    { key: 'russia_ukraine', label: 'Russia-Ukraine' },
    { key: 'us_gulf',        label: 'US Gulf' },
    { key: 'us_alaska',      label: 'Alaska' },
    { key: 'americas',       label: 'Americas' },
    { key: 'europe',         label: 'Europe' },
  ];

  // ---------- helpers ----------
  function fmtAgo(ts) {
    if (!ts) return '—';
    const d = Date.now() - ts;
    if (d < 0) return 'now';
    if (d < 60_000)       return Math.round(d / 1000) + 's ago';
    if (d < 3_600_000)    return Math.round(d / 60_000) + 'm ago';
    if (d < 86_400_000)   return Math.round(d / 3_600_000) + 'h ago';
    return Math.round(d / 86_400_000) + 'd ago';
  }
  function magColor(m) {
    if (m == null) return T.textDim;
    if (m >= 7) return '#ff3b30';
    if (m >= 6) return T.bear;
    if (m >= 5) return T.signal;
    return T.textMid;
  }
  function magRadius(m) {
    if (m == null) return 3;
    return Math.min(14, Math.max(3, (m - 3) * 2.2));
  }

  // Equirectangular projection into an SVG viewBox (0..1000 x 0..500).
  const MAP_W = 1000, MAP_H = 500;
  function projectXY(lat, lon) {
    const x = ((lon + 180) / 360) * MAP_W;
    const y = ((90 - lat) / 180) * MAP_H;
    return [x, y];
  }

  // Very low-detail continent silhouettes — purely decorative so the map
  // reads as "world" without a heavy GeoJSON dependency.
  const CONTINENT_PATHS = [
    // Africa + Middle East + Europe blob
    'M470,130 Q500,110 540,115 L580,105 Q620,110 635,135 L640,170 Q615,205 608,240 L595,290 Q585,335 545,365 L515,355 Q495,335 500,305 L470,280 Q450,245 462,200 Z',
    // Asia blob
    'M630,110 Q680,90 760,100 Q830,105 880,130 Q910,160 895,195 Q880,220 835,215 L790,220 Q750,230 720,215 L680,200 Q645,175 630,150 Z',
    // Americas
    'M160,115 Q205,100 245,110 Q275,135 260,175 Q240,215 220,255 L215,305 Q230,355 255,385 Q240,410 205,400 Q175,385 170,355 L160,310 Q145,270 150,225 Q140,175 160,140 Z',
    // Australia
    'M790,335 Q830,325 870,335 Q895,355 885,380 Q860,400 820,395 Q795,385 790,360 Z',
  ];

  function usePoll(fn, ms = 300_000, deps = []) {
    const [data, setData] = React.useState(null);
    const [loading, setLoading] = React.useState(false);
    const [lastFetch, setLastFetch] = React.useState(null);
    React.useEffect(() => {
      let alive = true;
      async function tick() {
        setLoading(true);
        try {
          const d = await fn();
          if (!alive) return;
          setData(d);
          setLastFetch(Date.now());
        } finally {
          if (alive) setLoading(false);
        }
      }
      tick();
      const id = setInterval(tick, ms);
      return () => { alive = false; clearInterval(id); };
      // eslint-disable-next-line
    }, deps);
    return { data, loading, lastFetch };
  }

  // ---------- panel ----------
  function TRDisastersPanel({ open, onClose }) {
    const [region, setRegion] = React.useState('world');
    const [category, setCategory] = React.useState('All');
    const [selected, setSelected] = React.useState(null);

    const quakesQ = usePoll(async () => {
      const dd = window.DisasterData;
      if (!dd) return [];
      if (region === 'world') return await dd.getEarthquakesGlobal(4.5);
      return await dd.getEarthquakesByRegion(region, 4.5, 7);
    }, 15 * 60_000, [region]);

    const firesQ = usePoll(async () => {
      const dd = window.DisasterData;
      if (!dd) return { fires: [], hasKey: false };
      return await dd.getWildfiresActive(region);
    }, 15 * 60_000, [region]);

    const gdacsQ = usePoll(async () => {
      const dd = window.DisasterData;
      if (!dd) return [];
      return await dd.getGDACSFeed();
    }, 15 * 60_000, []);

    if (!open) return null;

    const quakes = quakesQ.data || [];
    const firesRaw = (firesQ.data && firesQ.data.fires) || [];
    const firesHasKey = !!(firesQ.data && firesQ.data.hasKey);
    const gdacs = (gdacsQ.data || []).filter(g => {
      if (!g) return false;
      const bbox = window.DisasterData && window.DisasterData.REGIONS[region];
      if (!bbox || region === 'world') return true;
      if (g.lat == null || g.lon == null) return true;
      return window.DisasterData.bboxContains(bbox, g.lat, g.lon);
    });

    // Cap fires to 400 for render sanity.
    const fires = firesRaw.slice(0, 400);

    // Flat feed for the list.
    const feed = React.useMemo(() => {
      const out = [];
      for (const q of quakes) {
        out.push({ kind: 'Earthquake', time: q.time || 0, payload: q });
      }
      for (const f of fires) {
        // FIRMS gives acq_date + acq_time ("HHMM" UTC). Build an epoch.
        let t = 0;
        if (f.acqDate) {
          const hh = (f.acqTime || '0000').padStart(4, '0');
          const iso = `${f.acqDate}T${hh.slice(0,2)}:${hh.slice(2,4)}:00Z`;
          const d = new Date(iso);
          if (!isNaN(d.getTime())) t = d.getTime();
        }
        out.push({ kind: 'Wildfire', time: t, payload: f });
      }
      for (const g of gdacs) {
        out.push({ kind: 'Other', time: g.time || 0, payload: g });
      }
      out.sort((a, b) => (b.time || 0) - (a.time || 0));
      return out;
    }, [quakes, fires, gdacs]);

    const filtered = category === 'All' ? feed : feed.filter(r => r.kind === category);
    const counts = {
      All: feed.length,
      Earthquake: quakes.length,
      Wildfire: fires.length,
      Other: gdacs.length,
    };

    const loading = !!(quakesQ.loading || firesQ.loading || gdacsQ.loading);
    const lastFetch = Math.max(quakesQ.lastFetch || 0, firesQ.lastFetch || 0, gdacsQ.lastFetch || 0) || null;

    return (
      <div onClick={onClose} style={{
        position: 'fixed', inset: 0, zIndex: 9000,
        background: 'rgba(4,6,10,0.82)', backdropFilter: 'blur(6px)',
        display: 'flex', alignItems: 'stretch', justifyContent: 'center',
        fontFamily: T.ui, color: T.text,
      }}>
        <div onClick={e => e.stopPropagation()} style={{
          flex: 1, margin: '2vh 2vw', background: T.ink100,
          border: `1px solid ${T.edge}`, borderRadius: 10, overflow: 'hidden',
          display: 'flex', flexDirection: 'column',
        }}>
          {/* HEADER */}
          <div style={{
            padding: '14px 20px', borderBottom: `1px solid ${T.edge}`,
            display: 'flex', alignItems: 'center', gap: 14, background: T.ink200,
          }}>
            <span style={{ fontSize: 18 }}>🌋</span>
            <div>
              <div style={{
                fontSize: 10, letterSpacing: 1.4, color: T.signal,
                textTransform: 'uppercase', fontWeight: 600,
              }}>Disasters · OSINT</div>
              <div style={{ fontSize: 13, color: T.text, fontWeight: 500 }}>
                Quakes · Wildfires · GDACS alerts
              </div>
            </div>
            <div style={{ flex: 1 }} />
            <div style={{
              padding: '2px 8px', fontFamily: T.mono, fontSize: 9.5, fontWeight: 600, letterSpacing: 0.6,
              color: loading ? T.signal : T.bull,
              background: loading ? 'rgba(201,162,39,0.10)' : 'rgba(111,207,142,0.10)',
              borderRadius: 4,
              border: `0.5px solid ${loading ? 'rgba(201,162,39,0.4)' : 'rgba(111,207,142,0.4)'}`,
            }}>{loading ? 'REFRESH' : 'LIVE'}</div>
            <div style={{ fontFamily: T.mono, fontSize: 9.5, color: T.textDim, letterSpacing: 0.4 }}>
              UPDATED · {fmtAgo(lastFetch)}
            </div>
            <button onClick={onClose} style={{
              background: 'transparent', color: T.textMid, border: `1px solid ${T.edge}`,
              padding: '5px 12px', borderRadius: 4, cursor: 'pointer',
              fontSize: 11, fontFamily: T.mono, letterSpacing: 0.4,
            }}>CLOSE ✕</button>
          </div>

          {/* FILTER BAR */}
          <div style={{
            padding: '10px 20px', borderBottom: `1px solid ${T.edge}`,
            display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap', background: T.ink200,
          }}>
            <div style={{ fontSize: 9.5, fontFamily: T.mono, color: T.textDim, letterSpacing: 0.8, textTransform: 'uppercase' }}>
              Region
            </div>
            {REGION_OPTS.map(r => {
              const active = r.key === region;
              return (
                <div key={r.key} onClick={() => setRegion(r.key)} style={{
                  padding: '3px 10px', fontFamily: T.mono, fontSize: 10, fontWeight: 600,
                  background: active ? T.signal : T.ink300,
                  color: active ? T.ink000 : T.textMid,
                  border: `1px solid ${active ? T.signal : T.edge}`,
                  borderRadius: 4, cursor: 'pointer', letterSpacing: 0.4,
                }}>{r.label.toUpperCase()}</div>
              );
            })}
            <div style={{ width: 1, height: 16, background: T.edgeHi, margin: '0 6px' }} />
            <div style={{ fontSize: 9.5, fontFamily: T.mono, color: T.textDim, letterSpacing: 0.8, textTransform: 'uppercase' }}>
              Category
            </div>
            {CATEGORIES.map(c => {
              const active = c === category;
              return (
                <div key={c} onClick={() => setCategory(c)} style={{
                  padding: '3px 10px', fontFamily: T.mono, fontSize: 10, fontWeight: 600,
                  background: active ? T.signal : T.ink300,
                  color: active ? T.ink000 : T.textMid,
                  border: `1px solid ${active ? T.signal : T.edge}`,
                  borderRadius: 4, cursor: 'pointer', letterSpacing: 0.4,
                  display: 'flex', alignItems: 'center', gap: 5,
                }}>
                  <span>{c.toUpperCase()}</span>
                  <span style={{ opacity: 0.6, fontSize: 9 }}>{counts[c] || 0}</span>
                </div>
              );
            })}
          </div>

          {/* MAP */}
          <div style={{ height: 360, background: T.ink200, borderBottom: `1px solid ${T.edge}`, position: 'relative' }}>
            <svg viewBox={`0 0 ${MAP_W} ${MAP_H}`} preserveAspectRatio="xMidYMid meet"
                 style={{ width: '100%', height: '100%', display: 'block' }}>
              <rect x="0" y="0" width={MAP_W} height={MAP_H} fill={T.ink200} />
              {/* gridlines */}
              {[1,2,3,4].map(i => (
                <line key={'lat'+i} x1="0" x2={MAP_W}
                  y1={(i * MAP_H) / 5} y2={(i * MAP_H) / 5}
                  stroke="rgba(255,255,255,0.04)" strokeWidth="1" />
              ))}
              {[1,2,3,4,5,6,7].map(i => (
                <line key={'lon'+i} y1="0" y2={MAP_H}
                  x1={(i * MAP_W) / 8} x2={(i * MAP_W) / 8}
                  stroke="rgba(255,255,255,0.04)" strokeWidth="1" />
              ))}
              {/* continents */}
              {CONTINENT_PATHS.map((d, i) => (
                <path key={i} d={d} fill="rgba(255,255,255,0.05)" stroke="rgba(255,255,255,0.12)" strokeWidth="0.6" />
              ))}
              {/* wildfires */}
              {(category === 'All' || category === 'Wildfire') && fires.map((f, i) => {
                const [x, y] = projectXY(f.lat, f.lon);
                return <circle key={'f'+i} cx={x} cy={y} r={1.6} fill={T.fire} fillOpacity="0.75" />;
              })}
              {/* gdacs */}
              {(category === 'All' || category === 'Other') && gdacs.map((g, i) => {
                if (g.lat == null || g.lon == null) return null;
                const [x, y] = projectXY(g.lat, g.lon);
                const col = g.alertLevel === 'red' ? T.bear
                          : g.alertLevel === 'orange' ? T.signal
                          : T.textMid;
                return <circle key={'g'+i} cx={x} cy={y} r={4} fill="transparent" stroke={col} strokeWidth="1.5" />;
              })}
              {/* quakes */}
              {(category === 'All' || category === 'Earthquake') && quakes.map((q, i) => {
                if (q.lat == null || q.lon == null) return null;
                const [x, y] = projectXY(q.lat, q.lon);
                return (
                  <circle key={'q'+i} cx={x} cy={y} r={magRadius(q.mag)}
                    fill={magColor(q.mag)} fillOpacity="0.35"
                    stroke={magColor(q.mag)} strokeWidth="1"
                    style={{ cursor: 'pointer' }}
                    onClick={() => setSelected({ kind: 'Earthquake', payload: q })}
                  >
                    <title>{`M${q.mag} — ${q.place}`}</title>
                  </circle>
                );
              })}
            </svg>
            {/* legend */}
            <div style={{
              position: 'absolute', bottom: 10, left: 10,
              background: 'rgba(7,9,12,0.7)', backdropFilter: 'blur(6px)',
              padding: '6px 10px', borderRadius: 6,
              border: '0.5px solid rgba(255,255,255,0.12)',
              fontFamily: T.mono, fontSize: 9.5, color: T.textMid,
              display: 'flex', gap: 12, alignItems: 'center',
            }}>
              <span style={{ color: T.quake }}>● M4.5+</span>
              <span style={{ color: T.fire }}>● Wildfire (VIIRS)</span>
              <span style={{ color: T.gdacs }}>○ GDACS</span>
              {!firesHasKey && (
                <span style={{
                  padding: '2px 7px', borderRadius: 999,
                  fontFamily: T.mono, fontSize: 8.5, letterSpacing: 0.8,
                  textTransform: 'uppercase', color: T.fire,
                  background: 'rgba(243,138,50,0.10)',
                  border: '1px solid rgba(243,138,50,0.35)',
                  lineHeight: 1,
                }}>🔐 Unlock FIRMS</span>
              )}
            </div>
          </div>

          {/* BODY — list + selected row detail */}
          <div style={{ flex: 1, display: 'flex', minHeight: 0 }}>
            {/* LIST */}
            <div style={{ flex: 1, overflowY: 'auto', background: T.ink100 }}>
              <div style={{
                padding: '10px 18px 6px', fontSize: 10, letterSpacing: 1.2,
                color: T.textDim, textTransform: 'uppercase', fontWeight: 600,
              }}>
                {filtered.length} events · {category.toUpperCase()} · {REGION_OPTS.find(r => r.key === region).label}
              </div>

              {/* Wildfire unlock hero — surfaces inside the list ONLY for Wildfire view / All */}
              {!firesHasKey && (category === 'Wildfire' || category === 'All') && (
                <div style={{
                  margin: '8px 16px 12px',
                  background: 'linear-gradient(180deg, rgba(243,138,50,0.10) 0%, rgba(243,138,50,0.03) 100%)',
                  border: '1px solid rgba(243,138,50,0.35)',
                  borderRadius: 10, padding: '14px 16px',
                }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 6 }}>
                    <span style={{ fontSize: 13 }}>🔐</span>
                    <span style={{
                      padding: '3px 8px', borderRadius: 999,
                      fontFamily: T.mono, fontSize: 9.5, letterSpacing: 0.8,
                      textTransform: 'uppercase', color: T.fire,
                      background: 'rgba(243,138,50,0.10)',
                      border: '1px solid rgba(243,138,50,0.35)',
                      lineHeight: 1,
                    }}>Key needed</span>
                    <span style={{ fontSize: 13, fontWeight: 600, color: T.text }}>
                      Unlock NASA FIRMS wildfire hotspots
                    </span>
                  </div>
                  <div style={{ fontSize: 11.5, color: T.textMid, lineHeight: 1.5, marginBottom: 12 }}>
                    Get a free MAP_KEY from <strong style={{ color: T.text }}>NASA FIRMS</strong> (30
                    seconds, no credit card) to see live VIIRS/MODIS fire hotspots worldwide.
                    Earthquakes + GDACS alerts are already loaded without a key.
                  </div>
                  <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                    <a href="https://firms.modaps.eosdis.nasa.gov/api/map_key/"
                       target="_blank" rel="noopener noreferrer" style={{
                      padding: '7px 12px', fontFamily: T.mono, fontSize: 10.5, fontWeight: 700,
                      color: T.ink000, background: T.fire,
                      borderRadius: 6, textDecoration: 'none', letterSpacing: 0.5,
                      textTransform: 'uppercase',
                    }}>Get free key →</a>
                    <button onClick={() => {
                      try { window.dispatchEvent(new CustomEvent('tr:open-settings')); } catch (_) {}
                    }} style={{
                      padding: '7px 12px', fontFamily: T.mono, fontSize: 10.5, fontWeight: 500,
                      color: T.textMid, background: 'transparent',
                      border: `1px solid ${T.edgeHi}`, borderRadius: 6,
                      cursor: 'pointer', letterSpacing: 0.5, textTransform: 'uppercase',
                    }}>Paste into Settings ⚙</button>
                  </div>
                </div>
              )}

              {filtered.length === 0 && (
                <div style={{ padding: '18px', fontSize: 11, color: T.textDim }}>
                  {loading ? 'Loading disaster feeds…' : 'No events matched for this filter.'}
                </div>
              )}
              {filtered.slice(0, 200).map((row, i) => (
                <DisasterRow key={i} row={row} T={T} onClick={() => setSelected(row)} />
              ))}
            </div>

            {/* DETAIL */}
            <div style={{
              width: 380, background: T.ink200, borderLeft: `1px solid ${T.edge}`,
              overflowY: 'auto', padding: '18px 20px',
            }}>
              <div style={{
                fontSize: 10, letterSpacing: 1.4, color: T.signal,
                textTransform: 'uppercase', fontWeight: 600, marginBottom: 10,
              }}>Event Detail</div>
              {!selected && (
                <div style={{ fontSize: 12, color: T.textDim }}>
                  Click an earthquake on the map (or a row in the list) to see location, magnitude, and nearest energy infrastructure.
                </div>
              )}
              {selected && <DetailCard row={selected} T={T} />}
            </div>
          </div>
        </div>
      </div>
    );
  }

  // ---------- row ----------
  function DisasterRow({ row, T, onClick }) {
    const k = row.kind;
    const p = row.payload;
    let title = '', meta = '', tint = T.textMid;
    if (k === 'Earthquake') {
      title = `M${(p.mag || 0).toFixed(1)} — ${p.place}`;
      meta = `${p.depthKm != null ? p.depthKm.toFixed(0) + 'km deep · ' : ''}${fmtAgo(p.time)}`;
      tint = magColor(p.mag);
    } else if (k === 'Wildfire') {
      title = `Wildfire hotspot · ${p.lat.toFixed(2)}, ${p.lon.toFixed(2)}`;
      meta = `FRP ${(p.frp || 0).toFixed(0)} · conf ${p.confidence || '—'} · ${p.dayNight || ''} · ${p.acqDate} ${p.acqTime}`;
      tint = T.fire;
    } else if (k === 'Other') {
      title = p.title || 'GDACS alert';
      meta = `${(p.eventType || 'ALT').toUpperCase()} · ${p.country || '—'} · ${fmtAgo(p.time)}`;
      tint = p.alertLevel === 'red' ? T.bear
           : p.alertLevel === 'orange' ? T.signal
           : T.textMid;
    }
    return (
      <div onClick={onClick} style={{
        display: 'grid', gridTemplateColumns: '8px 1fr 90px',
        alignItems: 'center', gap: 10,
        padding: '10px 18px',
        borderBottom: `1px solid ${T.edge}`, cursor: 'pointer',
      }}>
        <div style={{ width: 6, height: 6, borderRadius: 3, background: tint, margin: '0 auto' }} />
        <div style={{ minWidth: 0 }}>
          <div style={{
            fontSize: 12, color: T.text, whiteSpace: 'nowrap',
            overflow: 'hidden', textOverflow: 'ellipsis',
          }}>{title}</div>
          <div style={{
            fontFamily: T.mono, fontSize: 9.5, color: T.textDim,
            letterSpacing: 0.3, marginTop: 2,
          }}>{meta}</div>
        </div>
        <div style={{
          fontFamily: T.mono, fontSize: 9.5, color: tint,
          letterSpacing: 0.4, textAlign: 'right', textTransform: 'uppercase',
        }}>{k}</div>
      </div>
    );
  }

  // ---------- detail card ----------
  function DetailCard({ row, T }) {
    const p = row.payload;
    if (row.kind === 'Earthquake') {
      const infra = (window.DisasterData && p.lat != null)
        ? window.DisasterData.nearestInfra(p.lat, p.lon, 600) : null;
      return (
        <div style={{ fontSize: 12, color: T.text, lineHeight: 1.5 }}>
          <div style={{
            fontFamily: T.mono, fontSize: 28, fontWeight: 700,
            color: magColor(p.mag), letterSpacing: -0.5, lineHeight: 1,
          }}>M{(p.mag || 0).toFixed(1)}</div>
          <div style={{ marginTop: 6, color: T.textMid }}>{p.place}</div>
          <div style={{ marginTop: 10, fontFamily: T.mono, fontSize: 10.5, color: T.textDim, lineHeight: 1.8 }}>
            <div>TIME · {p.time ? new Date(p.time).toISOString().replace('T',' ').slice(0,19) + ' UTC' : '—'}</div>
            <div>DEPTH · {p.depthKm != null ? p.depthKm.toFixed(0) + ' km' : '—'}</div>
            <div>FELT · {p.felt || 0} reports</div>
            <div>TSUNAMI · {p.tsunami ? 'yes' : 'no'}</div>
            {p.alert && <div>ALERT · {p.alert.toUpperCase()}</div>}
            <div>COORD · {p.lat != null ? p.lat.toFixed(2) : '—'}, {p.lon != null ? p.lon.toFixed(2) : '—'}</div>
          </div>
          {infra && (
            <div style={{
              marginTop: 14, padding: '10px 12px', borderRadius: 6,
              background: T.ink300, border: `1px solid ${T.edgeHi}`,
            }}>
              <div style={{
                fontSize: 9.5, letterSpacing: 1.2, color: T.signal,
                textTransform: 'uppercase', fontWeight: 600, marginBottom: 4,
              }}>Nearest Oil/Gas Infra</div>
              <div style={{ fontSize: 12, color: T.text }}>{infra.name}</div>
              <div style={{ fontSize: 10.5, color: T.textMid, fontFamily: T.mono, marginTop: 2 }}>
                {infra.country} · {infra.type} · {infra.distanceKm} km
              </div>
            </div>
          )}
          {p.url && (
            <a href={p.url} target="_blank" rel="noopener noreferrer" style={{
              display: 'inline-block', marginTop: 14,
              fontFamily: T.mono, fontSize: 10.5, color: T.signal,
              textDecoration: 'none', letterSpacing: 0.4,
            }}>USGS event page →</a>
          )}
        </div>
      );
    }
    if (row.kind === 'Wildfire') {
      const infra = (window.DisasterData) ? window.DisasterData.nearestInfra(p.lat, p.lon, 300) : null;
      return (
        <div style={{ fontSize: 12, color: T.text, lineHeight: 1.5 }}>
          <div style={{ fontFamily: T.mono, fontSize: 22, fontWeight: 700, color: T.fire }}>
            FRP {(p.frp || 0).toFixed(0)}
          </div>
          <div style={{ marginTop: 6, color: T.textMid }}>
            {p.satellite} · confidence {p.confidence || '—'} · {p.dayNight || ''}
          </div>
          <div style={{ marginTop: 10, fontFamily: T.mono, fontSize: 10.5, color: T.textDim, lineHeight: 1.8 }}>
            <div>ACQ · {p.acqDate} {p.acqTime} UTC</div>
            <div>COORD · {p.lat.toFixed(3)}, {p.lon.toFixed(3)}</div>
          </div>
          {infra && (
            <div style={{
              marginTop: 14, padding: '10px 12px', borderRadius: 6,
              background: T.ink300, border: `1px solid ${T.edgeHi}`,
            }}>
              <div style={{
                fontSize: 9.5, letterSpacing: 1.2, color: T.signal,
                textTransform: 'uppercase', fontWeight: 600, marginBottom: 4,
              }}>Nearest Oil/Gas Infra</div>
              <div style={{ fontSize: 12, color: T.text }}>{infra.name}</div>
              <div style={{ fontSize: 10.5, color: T.textMid, fontFamily: T.mono, marginTop: 2 }}>
                {infra.country} · {infra.type} · {infra.distanceKm} km
              </div>
            </div>
          )}
        </div>
      );
    }
    // GDACS
    return (
      <div style={{ fontSize: 12, color: T.text, lineHeight: 1.5 }}>
        <div style={{ fontSize: 14, color: T.text, fontWeight: 600 }}>{p.title}</div>
        <div style={{ marginTop: 6, color: T.textMid, fontSize: 11 }}>{p.country || ''}</div>
        <div style={{ marginTop: 10, fontFamily: T.mono, fontSize: 10.5, color: T.textDim, lineHeight: 1.8 }}>
          <div>TYPE · {p.eventType || '—'}</div>
          <div>ALERT · {(p.alertLevel || '—').toUpperCase()}</div>
          <div>TIME · {p.time ? new Date(p.time).toISOString().replace('T',' ').slice(0,19) + ' UTC' : '—'}</div>
          {p.lat != null && p.lon != null && <div>COORD · {p.lat.toFixed(2)}, {p.lon.toFixed(2)}</div>}
        </div>
        {p.description && (
          <div style={{ marginTop: 10, fontSize: 11, color: T.textMid, lineHeight: 1.5 }}>
            {p.description.slice(0, 400)}
          </div>
        )}
        {p.link && (
          <a href={p.link} target="_blank" rel="noopener noreferrer" style={{
            display: 'inline-block', marginTop: 14,
            fontFamily: T.mono, fontSize: 10.5, color: T.signal,
            textDecoration: 'none', letterSpacing: 0.4,
          }}>GDACS page →</a>
        )}
      </div>
    );
  }

  window.TRDisastersPanel = TRDisastersPanel;
  window.openTRDisasters = function () {
    try { window.dispatchEvent(new CustomEvent('tr:disasters:open')); }
    catch (e) { console.warn('openTRDisasters failed', e); }
  };
})();
