// tr-gtrends-panel.jsx — TradeRadar public-interest panel.
//
// Wikipedia pageviews as a proxy for public search interest on tickers/topics.
// Google Trends has no free public API; pageviews are free, key-less, and
// reliably correlate with retail attention (NVDA article pageviews spike
// around earnings, IBIT/Bitcoin pageviews spike around ETF inflow news).
// Includes Google Trends daily trending-search RSS below the chart.
//
// Exposes:
//   window.TRTrendsPanel   — React modal ({ open, onClose })
//   window.openTRTrends()  — dispatches CustomEvent('tr:open-trends')
//
// Depends on:
//   window.PublicInterest  (engine/gtrends.js)
//   window.useAutoUpdate   (tr-hooks.jsx)

(function () {
  const T = {
    ink000: '#07090C', ink100: '#0B0E13', ink200: '#10141B', ink300: '#171C24',
    edge: 'rgba(255,255,255,0.06)', edgeHi: 'rgba(255,255,255,0.10)',
    text: '#ffffff', textMid: 'rgba(180,188,200,0.75)', textDim: 'rgba(130,138,150,0.55)',
    signal: '#c9a227', bull: '#6FCF8E', bear: '#D96B6B',
    mono: '"JetBrains Mono", ui-monospace, "SF Mono", Menlo, Consolas, monospace',
  };

  const SELECTABLE = ['SPY', 'NVDA', 'TSLA', 'BTC', 'ETH', 'IBIT', 'MSTR'];

  function fmtN(n) {
    if (!isFinite(n) || n <= 0) return '—';
    if (n >= 1e6) return (n / 1e6).toFixed(1) + 'M';
    if (n >= 1e3) return (n / 1e3).toFixed(1) + 'K';
    return String(Math.round(n));
  }

  function TrendChart({ points, width = 880, height = 180 }) {
    if (!Array.isArray(points) || points.length < 2) {
      return (
        <div style={{
          height, display: 'flex', alignItems: 'center', justifyContent: 'center',
          color: T.textDim, fontFamily: T.mono, fontSize: 11,
        }}>No pageview data available.</div>
      );
    }
    const w = width, h = height, padL = 42, padR = 10, padT = 14, padB = 22;
    const iw = w - padL - padR, ih = h - padT - padB;
    const vals = points.map(p => p.views);
    const max = Math.max.apply(null, vals);
    const min = 0;
    const span = Math.max(1, max - min);

    const pts = points.map((p, i) => {
      const x = padL + (i / (points.length - 1)) * iw;
      const y = padT + ih - ((p.views - min) / span) * ih;
      return [x, y];
    });

    const line = pts.map(([x, y], i) => `${i === 0 ? 'M' : 'L'}${x.toFixed(1)} ${y.toFixed(1)}`).join(' ');
    const area = `${line} L${pts[pts.length - 1][0].toFixed(1)} ${(padT + ih).toFixed(1)} L${pts[0][0].toFixed(1)} ${(padT + ih).toFixed(1)} Z`;

    // Y-axis gridlines (4)
    const grid = [];
    for (let i = 0; i <= 4; i++) {
      const y = padT + (i / 4) * ih;
      const v = max - (i / 4) * span;
      grid.push({ y, v });
    }

    // X-axis: first, mid, last date labels
    const labels = [];
    labels.push({ i: 0, p: points[0] });
    labels.push({ i: Math.floor(points.length / 2), p: points[Math.floor(points.length / 2)] });
    labels.push({ i: points.length - 1, p: points[points.length - 1] });

    return (
      <svg width={w} height={h} viewBox={`0 0 ${w} ${h}`} style={{ display: 'block' }}>
        <defs>
          <linearGradient id="trendFill" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%"   stopColor={T.signal} stopOpacity="0.28" />
            <stop offset="100%" stopColor={T.signal} stopOpacity="0" />
          </linearGradient>
        </defs>

        {grid.map((g, i) => (
          <g key={i}>
            <line x1={padL} x2={w - padR} y1={g.y} y2={g.y}
                  stroke="rgba(255,255,255,0.05)" strokeWidth="1" />
            <text x={padL - 6} y={g.y + 3} textAnchor="end"
                  fontFamily={T.mono} fontSize="9" fill={T.textDim}>
              {fmtN(g.v)}
            </text>
          </g>
        ))}

        <path d={area} fill="url(#trendFill)" />
        <path d={line} stroke={T.signal} strokeWidth="1.8" fill="none" />

        {labels.map((l, i) => {
          const x = padL + (l.i / (points.length - 1)) * iw;
          return (
            <text key={i} x={x} y={h - 6}
                  textAnchor={i === 0 ? 'start' : i === labels.length - 1 ? 'end' : 'middle'}
                  fontFamily={T.mono} fontSize="9" fill={T.textDim}>
              {l.p.date}
            </text>
          );
        })}
      </svg>
    );
  }

  window.openTRTrends = function openTRTrends() {
    try { window.dispatchEvent(new CustomEvent('tr:open-trends')); } catch (_) {}
  };

  const useAuto = (window.useAutoUpdate || (() => ({ data: null, loading: false })));

  // ====================================================================
  // TRTrendsPanel
  // ====================================================================
  function TRTrendsPanel({ open, onClose }) {
    const [ticker, setTicker] = React.useState('NVDA');
    const [refreshTick, setRefreshTick] = React.useState(0);

    const { data: interest, loading } = useAuto(
      `trends-ticker-${ticker}-${refreshTick}`,
      async () => {
        if (!window.PublicInterest) return null;
        return window.PublicInterest.getTickerInterest(ticker, 30);
      },
      { refreshKey: 'signals-panel' }
    );

    const { data: trending } = useAuto(
      `trends-rss-${refreshTick}`,
      async () => {
        if (!window.PublicInterest) return null;
        return window.PublicInterest.getTrending();
      },
      { refreshKey: 'signals-panel' }
    );

    if (!open) return null;

    const points = (interest && interest.points) || [];
    const items  = (trending && trending.items) || [];

    const Pill = ({ label, active, onClick }) => (
      <div onClick={onClick} style={{
        padding: '5px 12px',
        fontFamily: T.mono, fontSize: 10.5, fontWeight: 600, letterSpacing: 0.5,
        background: active ? T.signal : T.ink200,
        color: active ? T.ink000 : T.textMid,
        border: `1px solid ${active ? T.signal : T.edge}`,
        borderRadius: 5, cursor: 'pointer',
      }}>{label}</div>
    );

    return (
      <div onClick={onClose} style={{
        position: 'fixed', inset: 0, background: 'rgba(7,9,12,0.8)',
        backdropFilter: 'blur(12px) saturate(150%)',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        zIndex: 120, padding: 40,
      }}>
        <div onClick={e => e.stopPropagation()} style={{
          width: 1000, maxHeight: '94%', overflow: 'hidden',
          display: 'flex', flexDirection: 'column',
          background: T.ink100, border: `1px solid ${T.edgeHi}`, borderRadius: 14,
          color: T.text,
          fontFamily: '"Inter Tight", system-ui, sans-serif',
          boxShadow: '0 24px 80px rgba(0,0,0,0.6)',
        }}>

          {/* Header */}
          <div style={{
            padding: '18px 22px 12px 22px',
            borderBottom: `1px solid ${T.edge}`,
            display: 'flex', alignItems: 'center', gap: 12,
          }}>
            <div style={{ fontSize: 10, letterSpacing: 1.2, color: T.textDim, textTransform: 'uppercase', fontWeight: 600 }}>
              Public Interest
            </div>
            <div style={{
              padding: '2px 8px', fontFamily: T.mono, fontSize: 9.5, fontWeight: 600,
              letterSpacing: 0.6, color: T.signal,
              background: 'rgba(201,162,39,0.10)',
              borderRadius: 4, border: '0.5px solid rgba(201,162,39,0.4)',
            }}>
              WIKIPEDIA PAGEVIEWS · GOOGLE TRENDS RSS
            </div>
            <div style={{ fontFamily: T.mono, fontSize: 9.5, color: T.textDim, letterSpacing: 0.4 }}>
              {loading ? 'LOADING…' : '30-day daily views'}
            </div>
            <div style={{ marginLeft: 'auto', display: 'flex', gap: 8 }}>
              <div onClick={() => setRefreshTick(x => x + 1)} style={{
                padding: '5px 12px', fontFamily: T.mono, fontSize: 10.5, fontWeight: 600,
                background: T.ink200, color: T.textMid,
                border: `1px solid ${T.edge}`, borderRadius: 5,
                cursor: 'pointer', letterSpacing: 0.4,
              }}>REFRESH</div>
              <div onClick={onClose} style={{
                width: 28, height: 28, borderRadius: 7,
                background: T.ink200, border: `1px solid ${T.edge}`,
                display: 'flex', alignItems: 'center', justifyContent: 'center',
                cursor: 'pointer', color: T.textMid, fontSize: 16,
              }}>×</div>
            </div>
          </div>

          {/* Ticker selector */}
          <div style={{
            padding: '12px 22px',
            display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap',
            borderBottom: `1px solid ${T.edge}`,
          }}>
            {SELECTABLE.map(sym => (
              <Pill key={sym} label={sym} active={ticker === sym} onClick={() => setTicker(sym)} />
            ))}
            <div style={{ flex: 1 }} />
            {interest && interest.article && (
              <div style={{ fontFamily: T.mono, fontSize: 10, color: T.textDim }}>
                article: <span style={{ color: T.textMid }}>{decodeURIComponent(interest.article)}</span>
              </div>
            )}
          </div>

          {/* Stats strip */}
          <div style={{
            padding: '10px 22px',
            display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 16,
            borderBottom: `1px solid ${T.edge}`,
            background: T.ink200,
          }}>
            {[
              ['TOTAL 30D', fmtN(interest ? interest.total : 0)],
              ['AVG / DAY', fmtN(interest ? interest.avg : 0)],
              ['PEAK',      fmtN(interest ? interest.max : 0)],
              ['LATEST',    fmtN(points.length ? points[points.length - 1].views : 0)],
            ].map(([lbl, val]) => (
              <div key={lbl}>
                <div style={{ fontFamily: T.mono, fontSize: 9, letterSpacing: 0.8, color: T.textDim, fontWeight: 600 }}>{lbl}</div>
                <div style={{ fontSize: 18, fontWeight: 700, color: T.text }}>{val}</div>
              </div>
            ))}
          </div>

          {/* Chart */}
          <div style={{ padding: '14px 22px', borderBottom: `1px solid ${T.edge}` }}>
            <TrendChart points={points} />
          </div>

          {/* Google Trends RSS */}
          <div style={{
            padding: '10px 22px',
            display: 'flex', alignItems: 'baseline', gap: 10,
            borderBottom: `1px solid ${T.edge}`,
          }}>
            <div style={{ fontSize: 11, fontWeight: 600, color: T.text, letterSpacing: 0.4, textTransform: 'uppercase' }}>
              Google Trends · Daily Trending Searches (US)
            </div>
            <div style={{ marginLeft: 'auto', fontFamily: T.mono, fontSize: 10, color: T.textDim }}>
              {items.length ? `${items.length} trending` : '—'}
            </div>
          </div>

          <div style={{ flex: 1, overflow: 'auto', padding: '4px 0' }}>
            {!items.length && (
              <div style={{
                padding: '24px 22px', textAlign: 'center',
                fontFamily: T.mono, fontSize: 11, color: T.textDim,
              }}>Trends RSS unavailable.</div>
            )}
            {items.map((it, i) => (
              <div key={i}
                onClick={() => it.link && window.open(it.link, '_blank', 'noopener')}
                style={{
                  padding: '9px 22px',
                  display: 'grid',
                  gridTemplateColumns: '40px 1fr 120px',
                  gap: 10, alignItems: 'center',
                  fontFamily: T.mono, fontSize: 11,
                  borderBottom: `1px solid ${T.edge}`,
                  cursor: it.link ? 'pointer' : 'default',
                  background: i % 2 === 0 ? 'transparent' : 'rgba(255,255,255,0.015)',
                }}
              >
                <div style={{ color: T.textDim }}>{i + 1}</div>
                <div style={{ color: T.text, fontWeight: 600 }}>{it.title || '—'}</div>
                <div style={{ color: T.signal, textAlign: 'right', fontWeight: 600 }}>
                  {it.traffic || ''}
                </div>
              </div>
            ))}
          </div>

          {/* Footer */}
          <div style={{
            padding: '10px 22px',
            borderTop: `1px solid ${T.edge}`,
            fontFamily: T.mono, fontSize: 9.5, color: T.textDim, letterSpacing: 0.3,
            display: 'flex', alignItems: 'center', gap: 12,
          }}>
            <span>Source · wikimedia.org pageviews API + trends.google.com/trending/rss</span>
            <span style={{ marginLeft: 'auto' }}>Pageviews lag ~24h · RSS refreshes hourly</span>
          </div>

        </div>
      </div>
    );
  }
  window.TRTrendsPanel = TRTrendsPanel;
})();
