// tr-gdelt-panel.jsx — GDELT global events stream modal.
// Theme chips on the left, article list sorted by conflict intensity
// (Goldstein Scale, most conflictual first), SVG world heatmap on the right.
//
// Exposes:
//   window.TRGDELTPanel({ open, onClose })
//   window.openTRGDELT()
//
// Coordinator wires the tile.

(function () {
  const T = {
    ink000: '#07090C', ink100: '#0B0E13', ink200: '#10141B', ink300: '#171C24',
    edge:   'rgba(255,255,255,0.06)', edgeHi: 'rgba(255,255,255,0.10)',
    text:   '#ffffff', textMid: 'rgba(180,188,200,0.75)', textDim: 'rgba(130,138,150,0.55)',
    signal: '#c9a227', bull: '#6FCF8E', bear: '#D96B6B',
    mono:   '"JetBrains Mono", ui-monospace, "SF Mono", Menlo, Consolas, monospace',
    ui:     'InterTight, -apple-system, BlinkMacSystemFont, "SF Pro Text", system-ui, sans-serif',
  };

  const TIMESPANS = [
    { key: '1h',  label: '1H'  },
    { key: '6h',  label: '6H'  },
    { key: '1d',  label: '24H' },
    { key: '3d',  label: '3D'  },
    { key: '1w',  label: '7D'  },
  ];

  const MAP_W = 1000, MAP_H = 500;
  function projectXY(lat, lon) {
    const x = ((lon + 180) / 360) * MAP_W;
    const y = ((90 - lat) / 180) * MAP_H;
    return [x, y];
  }

  // Country → approx centroid for the heatmap. Coarse on purpose — the
  // heatmap only needs to look plausible at global zoom. GDELT returns
  // source-country names (English), so we key by lowercase name.
  const COUNTRY_CENTROIDS = {
    'united states': [39.8, -98.5],  'usa': [39.8, -98.5],
    'united kingdom': [54.0, -2.0],  'uk': [54.0, -2.0],
    'china': [35.0, 104.0],          'russia': [61.5, 105.3],
    'ukraine': [48.4, 31.1],         'iran': [32.4, 53.7],
    'israel': [31.0, 34.8],          'saudi arabia': [23.9, 45.1],
    'india': [20.6, 78.9],           'japan': [36.2, 138.2],
    'south korea': [36.5, 127.9],    'north korea': [40.3, 127.5],
    'taiwan': [23.7, 120.9],         'germany': [51.2, 10.4],
    'france': [46.2, 2.2],           'italy': [41.9, 12.6],
    'spain': [40.5, -3.7],           'canada': [56.1, -106.3],
    'mexico': [23.6, -102.5],        'brazil': [-14.2, -51.9],
    'argentina': [-38.4, -63.6],     'turkey': [38.9, 35.2],
    'egypt': [26.8, 30.8],           'south africa': [-30.6, 22.9],
    'australia': [-25.3, 133.8],     'indonesia': [-0.8, 113.9],
    'pakistan': [30.4, 69.3],        'afghanistan': [33.9, 67.7],
    'iraq': [33.2, 43.7],            'syria': [34.8, 38.9],
    'lebanon': [33.8, 35.9],         'yemen': [15.5, 48.5],
    'qatar': [25.4, 51.2],           'uae': [23.4, 53.8],
    'oman': [21.5, 55.9],            'poland': [51.9, 19.1],
    'romania': [45.9, 24.9],         'belarus': [53.7, 27.9],
    'finland': [61.9, 25.7],         'sweden': [60.1, 18.6],
    'norway': [60.5, 8.4],           'venezuela': [6.4, -66.6],
    'colombia': [4.5, -74.3],        'nigeria': [9.1, 8.7],
    'ethiopia': [9.1, 40.5],         'sudan': [12.8, 30.2],
    'greece': [39.1, 21.8],          'netherlands': [52.1, 5.3],
  };

  const CONTINENT_PATHS = [
    'M470,130 Q500,110 540,115 L580,105 Q620,110 635,135 L640,170 Q615,205 608,240 L595,290 Q585,335 545,365 L515,355 Q495,335 500,305 L470,280 Q450,245 462,200 Z',
    'M630,110 Q680,90 760,100 Q830,105 880,130 Q910,160 895,195 Q880,220 835,215 L790,220 Q750,230 720,215 L680,200 Q645,175 630,150 Z',
    'M160,115 Q205,100 245,110 Q275,135 260,175 Q240,215 220,255 L215,305 Q230,355 255,385 Q240,410 205,400 Q175,385 170,355 L160,310 Q145,270 150,225 Q140,175 160,140 Z',
    'M790,335 Q830,325 870,335 Q895,355 885,380 Q860,400 820,395 Q795,385 790,360 Z',
  ];

  function fmtAgo(ts) {
    if (!ts) return '—';
    const d = Date.now() - ts;
    if (d < 0) return 'now';
    if (d < 60_000)       return Math.round(d / 1000) + 's ago';
    if (d < 3_600_000)    return Math.round(d / 60_000) + 'm ago';
    if (d < 86_400_000)   return Math.round(d / 3_600_000) + 'h ago';
    return Math.round(d / 86_400_000) + 'd ago';
  }
  function toneColor(tone) {
    if (tone == null) return T.textDim;
    if (tone <= -3) return T.bear;
    if (tone >= 3)  return T.bull;
    return T.textMid;
  }
  function goldsteinColor(g) {
    if (g == null) return T.textDim;
    if (g <= -4) return T.bear;
    if (g <= -1) return T.signal;
    if (g >=  4) return T.bull;
    return T.textMid;
  }

  function TRGDELTPanel({ open, onClose }) {
    const [chipKey, setChipKey] = React.useState('all');
    const [timespan, setTimespan] = React.useState('1d');
    const [articles, setArticles] = React.useState([]);
    const [loading, setLoading] = React.useState(false);
    const [lastFetch, setLastFetch] = React.useState(null);

    const chips = (window.GDELTData && window.GDELTData.DEFAULT_CHIPS) || [{ key: 'all', label: 'All', query: '' }];

    React.useEffect(() => {
      if (!open) return;
      let alive = true;
      async function load() {
        setLoading(true);
        try {
          const gd = window.GDELTData;
          if (!gd) return;
          const chip = chips.find(c => c.key === chipKey) || chips[0];
          const out = await gd.search(chip.query, { timespan, maxrecords: 100, sort: 'hybridrel' });
          if (!alive) return;
          // Sort by Goldstein asc (most conflictual first).
          const sorted = (out || []).slice().sort((a, b) => {
            const ga = a.goldstein == null ?  99 : a.goldstein;
            const gb = b.goldstein == null ?  99 : b.goldstein;
            return ga - gb;
          });
          setArticles(sorted);
          setLastFetch(Date.now());
        } finally {
          if (alive) setLoading(false);
        }
      }
      load();
      const id = setInterval(load, 5 * 60_000);
      return () => { alive = false; clearInterval(id); };
    }, [open, chipKey, timespan]);

    if (!open) return null;

    // Heatmap buckets: country -> count
    const buckets = React.useMemo(() => {
      const m = new Map();
      for (const a of articles) {
        if (!a.country) continue;
        const k = a.country.toLowerCase();
        if (!COUNTRY_CENTROIDS[k]) continue;
        m.set(k, (m.get(k) || 0) + 1);
      }
      return Array.from(m.entries()).map(([name, count]) => ({
        name, count, coord: COUNTRY_CENTROIDS[name],
      })).sort((a, b) => b.count - a.count);
    }, [articles]);

    const maxBucket = Math.max(1, buckets[0] ? buckets[0].count : 1);

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
            <span style={{ fontSize: 18 }}>🌐</span>
            <div>
              <div style={{
                fontSize: 10, letterSpacing: 1.4, color: T.signal,
                textTransform: 'uppercase', fontWeight: 600,
              }}>GDELT · Global Events Stream</div>
              <div style={{ fontSize: 13, color: T.text, fontWeight: 500 }}>
                Conflict intensity sorted · live from gdeltproject.org
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
              UPDATED · {fmtAgo(lastFetch)} · {articles.length} ARTICLES
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
            display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap', background: T.ink200,
          }}>
            <div style={{ fontSize: 9.5, fontFamily: T.mono, color: T.textDim, letterSpacing: 0.8, textTransform: 'uppercase' }}>
              Theme
            </div>
            {chips.map(c => {
              const active = c.key === chipKey;
              return (
                <div key={c.key} onClick={() => setChipKey(c.key)} style={{
                  padding: '3px 10px', fontFamily: T.mono, fontSize: 10, fontWeight: 600,
                  background: active ? T.signal : T.ink300,
                  color: active ? T.ink000 : T.textMid,
                  border: `1px solid ${active ? T.signal : T.edge}`,
                  borderRadius: 4, cursor: 'pointer', letterSpacing: 0.4,
                }}>{c.label.toUpperCase()}</div>
              );
            })}
            <div style={{ width: 1, height: 16, background: T.edgeHi, margin: '0 6px' }} />
            <div style={{ fontSize: 9.5, fontFamily: T.mono, color: T.textDim, letterSpacing: 0.8, textTransform: 'uppercase' }}>
              Span
            </div>
            {TIMESPANS.map(s => {
              const active = s.key === timespan;
              return (
                <div key={s.key} onClick={() => setTimespan(s.key)} style={{
                  padding: '3px 10px', fontFamily: T.mono, fontSize: 10, fontWeight: 600,
                  background: active ? T.signal : T.ink300,
                  color: active ? T.ink000 : T.textMid,
                  border: `1px solid ${active ? T.signal : T.edge}`,
                  borderRadius: 4, cursor: 'pointer', letterSpacing: 0.4,
                }}>{s.label}</div>
              );
            })}
          </div>

          {/* BODY */}
          <div style={{ flex: 1, display: 'flex', minHeight: 0 }}>
            {/* LIST (left) */}
            <div style={{ flex: 1, overflowY: 'auto', background: T.ink100 }}>
              <div style={{
                padding: '10px 18px 6px', fontSize: 10, letterSpacing: 1.2,
                color: T.textDim, textTransform: 'uppercase', fontWeight: 600,
                display: 'flex', alignItems: 'center', gap: 8,
              }}>
                <span>Conflict-ranked · {articles.length}</span>
                <span style={{ color: T.bear }}>● conflict</span>
                <span style={{ color: T.signal }}>● tense</span>
                <span style={{ color: T.bull }}>● cooperative</span>
              </div>
              {articles.length === 0 && !loading && (
                <div style={{ padding: '18px', fontSize: 11, color: T.textDim }}>
                  No articles returned. Try another theme or widen the time span.
                </div>
              )}
              {loading && articles.length === 0 && (
                <div style={{ padding: '18px', fontSize: 11, color: T.textDim }}>
                  Loading GDELT stream…
                </div>
              )}
              {articles.slice(0, 120).map((a, i) => (
                <GDELTRow key={i} a={a} T={T} />
              ))}
            </div>

            {/* HEATMAP (right) */}
            <div style={{
              width: 480, background: T.ink200, borderLeft: `1px solid ${T.edge}`,
              display: 'flex', flexDirection: 'column', overflow: 'hidden',
            }}>
              <div style={{
                padding: '14px 18px 6px', fontSize: 10, letterSpacing: 1.4,
                color: T.signal, textTransform: 'uppercase', fontWeight: 600,
              }}>Event density · source country</div>
              <div style={{ padding: '6px 14px' }}>
                <svg viewBox={`0 0 ${MAP_W} ${MAP_H}`} preserveAspectRatio="xMidYMid meet"
                     style={{ width: '100%', height: 260, display: 'block', background: T.ink000, borderRadius: 6 }}>
                  <rect x="0" y="0" width={MAP_W} height={MAP_H} fill={T.ink000} />
                  {[1,2,3,4].map(i => (
                    <line key={'lat'+i} x1="0" x2={MAP_W}
                      y1={(i * MAP_H) / 5} y2={(i * MAP_H) / 5}
                      stroke="rgba(255,255,255,0.04)" strokeWidth="1" />
                  ))}
                  {CONTINENT_PATHS.map((d, i) => (
                    <path key={i} d={d} fill="rgba(255,255,255,0.05)" stroke="rgba(255,255,255,0.10)" strokeWidth="0.6" />
                  ))}
                  {buckets.map((b, i) => {
                    const [lat, lon] = b.coord;
                    const [x, y] = projectXY(lat, lon);
                    const pct = b.count / maxBucket;
                    const r = 4 + pct * 28;
                    return (
                      <g key={i}>
                        <circle cx={x} cy={y} r={r}
                          fill={T.signal} fillOpacity={0.12 + pct * 0.3}
                          stroke={T.signal} strokeOpacity={0.5 + pct * 0.5} strokeWidth="1" />
                        <circle cx={x} cy={y} r={2} fill={T.signal} />
                      </g>
                    );
                  })}
                </svg>
              </div>
              {/* top countries list */}
              <div style={{ flex: 1, overflowY: 'auto', padding: '4px 18px 18px' }}>
                <div style={{
                  fontSize: 9.5, letterSpacing: 1.2, color: T.textDim,
                  textTransform: 'uppercase', fontWeight: 600, margin: '10px 0 6px',
                }}>Top source countries</div>
                {buckets.slice(0, 12).map((b, i) => {
                  const pct = b.count / maxBucket;
                  return (
                    <div key={i} style={{
                      display: 'grid', gridTemplateColumns: '1fr 60px 40px',
                      alignItems: 'center', gap: 8,
                      padding: '5px 0', borderBottom: `1px solid ${T.edge}`,
                    }}>
                      <div style={{ fontSize: 11, color: T.text, textTransform: 'capitalize' }}>
                        {b.name}
                      </div>
                      <div style={{
                        position: 'relative', height: 5, background: T.ink000,
                        borderRadius: 3, overflow: 'hidden',
                      }}>
                        <div style={{
                          position: 'absolute', left: 0, top: 0, bottom: 0,
                          width: (pct * 100) + '%', background: T.signal, opacity: 0.8,
                        }} />
                      </div>
                      <div style={{
                        fontFamily: T.mono, fontSize: 10, color: T.textMid,
                        textAlign: 'right',
                      }}>{b.count}</div>
                    </div>
                  );
                })}
                {buckets.length === 0 && (
                  <div style={{ fontSize: 11, color: T.textDim, padding: '10px 0' }}>
                    No country data yet.
                  </div>
                )}
              </div>
            </div>
          </div>
        </div>
      </div>
    );
  }

  function GDELTRow({ a, T }) {
    const gCol = goldsteinColor(a.goldstein);
    const tCol = toneColor(a.tone);
    const ts = window.GDELTData ? window.GDELTData.parseSeenDate(a.seendate) : 0;
    return (
      <a href={a.url} target="_blank" rel="noopener noreferrer" style={{
        display: 'grid', gridTemplateColumns: '50px 1fr 140px',
        alignItems: 'center', gap: 12,
        padding: '10px 18px', borderBottom: `1px solid ${T.edge}`,
        textDecoration: 'none', color: T.text,
      }}>
        {/* Goldstein cell */}
        <div style={{
          fontFamily: T.mono, fontSize: 14, fontWeight: 700,
          color: gCol, textAlign: 'center',
          background: 'rgba(255,255,255,0.02)', borderRadius: 4,
          padding: '6px 0', border: `1px solid ${T.edge}`,
        }}>
          {a.goldstein == null ? '—' : (a.goldstein > 0 ? '+' : '') + a.goldstein.toFixed(1)}
        </div>
        <div style={{ minWidth: 0 }}>
          <div style={{
            fontSize: 12.5, color: T.text, lineHeight: 1.4,
            display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical',
            overflow: 'hidden', textOverflow: 'ellipsis',
          }}>{a.title || '(no title)'}</div>
          <div style={{
            marginTop: 3, display: 'flex', gap: 8, alignItems: 'center',
            fontFamily: T.mono, fontSize: 9.5, color: T.textDim, letterSpacing: 0.3,
          }}>
            <span style={{ textTransform: 'uppercase' }}>{a.domain || 'source'}</span>
            <span>·</span>
            <span style={{ textTransform: 'capitalize' }}>{a.country || '—'}</span>
            <span>·</span>
            <span>{fmtAgo(ts)}</span>
          </div>
        </div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 4, alignItems: 'flex-end' }}>
          <div style={{
            fontSize: 9, letterSpacing: 0.6, fontWeight: 700,
            padding: '2px 6px', borderRadius: 3,
            color: tCol, background: 'rgba(255,255,255,0.03)',
            border: `0.5px solid ${T.edge}`,
          }}>
            TONE {a.tone == null ? '—' : (a.tone > 0 ? '+' : '') + a.tone.toFixed(1)}
          </div>
          <div style={{
            fontSize: 8.5, letterSpacing: 0.5, color: T.textDim, fontFamily: T.mono,
          }}>
            {(a.language || '').toUpperCase()}
          </div>
        </div>
      </a>
    );
  }

  window.TRGDELTPanel = TRGDELTPanel;
  window.openTRGDELT = function () {
    try { window.dispatchEvent(new CustomEvent('tr:gdelt:open')); }
    catch (e) { console.warn('openTRGDELT failed', e); }
  };
})();
