// tr-wsb-panel.jsx — TradeRadar r/wallstreetbets sentiment leaderboard.
//
// Ranks $TICKER mentions on WSB's top posts (24h or 7d), weighted by upvotes.
// Fast risers (1d mention rate ≥ 2× 7d average) get gold highlight.
//
// Exposes:
//   window.TRWSBPanel   — React modal ({ open, onClose })
//   window.openTRWSB()  — dispatches CustomEvent('tr:open-wsb')
//
// Depends on:
//   window.WSBSentiment    (engine/wsb.js)
//   window.useAutoUpdate   (tr-hooks.jsx)

(function () {
  const T = {
    ink000: '#07090C', ink100: '#0B0E13', ink200: '#10141B', ink300: '#171C24',
    edge: 'rgba(255,255,255,0.06)', edgeHi: 'rgba(255,255,255,0.10)',
    text: '#ffffff', textMid: 'rgba(180,188,200,0.75)', textDim: 'rgba(130,138,150,0.55)',
    signal: '#c9a227', bull: '#6FCF8E', bear: '#D96B6B',
    mono: '"JetBrains Mono", ui-monospace, "SF Mono", Menlo, Consolas, monospace',
  };

  function fmtN(n) {
    if (!isFinite(n) || n <= 0) return '—';
    if (n >= 1e6) return (n / 1e6).toFixed(1) + 'M';
    if (n >= 1e3) return (n / 1e3).toFixed(1) + 'K';
    return String(Math.round(n));
  }

  function Sparkline({ values, width = 80, height = 22, color }) {
    if (!Array.isArray(values) || values.length < 2) return null;
    const w = width, h = height;
    const max = Math.max.apply(null, values);
    const min = Math.min.apply(null, values);
    const span = Math.max(1, max - min);
    const pts = values.map((v, i) => {
      const x = (i / (values.length - 1)) * (w - 2) + 1;
      const y = h - 1 - ((v - min) / span) * (h - 2);
      return `${x.toFixed(1)},${y.toFixed(1)}`;
    }).join(' ');
    return (
      <svg width={w} height={h} viewBox={`0 0 ${w} ${h}`}>
        <polyline fill="none" stroke={color || T.signal} strokeWidth="1.2" points={pts} />
      </svg>
    );
  }

  window.openTRWSB = function openTRWSB() {
    try { window.dispatchEvent(new CustomEvent('tr:open-wsb')); } catch (_) {}
  };

  const useAuto = (window.useAutoUpdate || (() => ({ data: null, loading: false })));

  // ====================================================================
  // TRWSBPanel
  // ====================================================================
  function TRWSBPanel({ open, onClose }) {
    const [timeframe, setTimeframe] = React.useState('1d'); // '1d'|'7d'
    const [refreshTick, setRefreshTick] = React.useState(0);

    // Pull 7d always so we can compute risers + render sparklines, regardless
    // of which timeframe the user is viewing.
    const { data: weekRows } = useAuto(
      `wsb-7d-${refreshTick}`,
      async () => {
        if (!window.WSBSentiment) return null;
        // Prime the week cache first, then return top-50 7d list
        await window.WSBSentiment._fetchPosts(7, false).catch(() => {});
        return window.WSBSentiment.getTopTickers({ days: 7, limit: 50 });
      },
      { refreshKey: 'signals-panel' }
    );

    const { data: dayRows, loading } = useAuto(
      `wsb-1d-${refreshTick}`,
      async () => {
        if (!window.WSBSentiment) return null;
        return window.WSBSentiment.getTopTickers({ days: 1, limit: 50 });
      },
      { refreshKey: 'signals-panel' }
    );

    if (!open) return null;

    const active = timeframe === '7d' ? (weekRows || []) : (dayRows || []);
    const top15  = active.slice(0, 15);

    // Build sparkline: use day-of-week bucket counts in 7d set
    const weekMap = new Map((weekRows || []).map(r => [r.ticker, r]));
    function spark(tkr) {
      const r = weekMap.get(tkr);
      if (!r) return null;
      // Build 7 daily buckets from post.created timestamps
      const bins = [0, 0, 0, 0, 0, 0, 0];
      const now = Math.floor(Date.now() / 1000);
      (r.posts || []).forEach(p => {
        const age = (now - (p.created || now)) / 86400;
        const idx = Math.max(0, Math.min(6, 6 - Math.floor(age)));
        bins[idx] += 1;
      });
      return bins;
    }

    const Pill = ({ id, label, active, onClick }) => (
      <div
        onClick={onClick}
        style={{
          padding: '5px 12px',
          fontFamily: T.mono, fontSize: 10.5, fontWeight: 600, letterSpacing: 0.5,
          background: active ? T.signal : T.ink200,
          color: active ? T.ink000 : T.textMid,
          border: `1px solid ${active ? T.signal : T.edge}`,
          borderRadius: 5, cursor: 'pointer',
        }}
      >{label}</div>
    );

    return (
      <div onClick={onClose} style={{
        position: 'fixed', inset: 0, background: 'rgba(7,9,12,0.8)',
        backdropFilter: 'blur(12px) saturate(150%)',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        zIndex: 120, padding: 40,
      }}>
        <div onClick={e => e.stopPropagation()} style={{
          width: 1000, maxHeight: '92%', overflow: 'hidden',
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
              r/WallStreetBets Leaderboard
            </div>
            <div style={{
              padding: '2px 8px', fontFamily: T.mono, fontSize: 9.5, fontWeight: 600,
              letterSpacing: 0.6, color: T.signal,
              background: 'rgba(201,162,39,0.10)',
              borderRadius: 4, border: '0.5px solid rgba(201,162,39,0.4)',
            }}>
              REDDIT PUBLIC JSON
            </div>
            <div style={{ fontFamily: T.mono, fontSize: 9.5, color: T.textDim, letterSpacing: 0.4 }}>
              {loading ? 'LOADING…' : `${active.length} tickers · 10m cache`}
            </div>
            <div style={{ marginLeft: 'auto', display: 'flex', gap: 8 }}>
              <Pill label="24H" active={timeframe === '1d'} onClick={() => setTimeframe('1d')} />
              <Pill label="7D"  active={timeframe === '7d'} onClick={() => setTimeframe('7d')} />
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

          {/* Table header */}
          <div style={{
            padding: '10px 22px',
            display: 'grid',
            gridTemplateColumns: '40px 90px 80px 80px 100px 1.4fr',
            gap: 10,
            fontFamily: T.mono, fontSize: 9, letterSpacing: 0.8,
            color: T.textDim, textTransform: 'uppercase', fontWeight: 600,
            borderBottom: `1px solid ${T.edge}`,
          }}>
            <div>#</div>
            <div>TICKER</div>
            <div style={{ textAlign: 'right' }}>MENTIONS</div>
            <div style={{ textAlign: 'right' }}>UPVOTES</div>
            <div>7D TREND</div>
            <div>TOP COMMENT / POST</div>
          </div>

          {/* Body */}
          <div style={{ flex: 1, overflow: 'auto' }}>
            {!top15.length && (
              <div style={{
                padding: '40px 22px', textAlign: 'center',
                fontFamily: T.mono, fontSize: 11, color: T.textDim,
              }}>
                {loading ? 'Pulling WSB…' : 'No tickers found. Reddit may be rate-limiting.'}
              </div>
            )}

            {top15.map((r, i) => {
              const riser = !!r.riser;
              const bins = spark(r.ticker) || [];
              const topP = r.topPost || {};
              return (
                <div key={r.ticker + i}
                  onClick={() => topP.url && window.open(topP.url, '_blank', 'noopener')}
                  style={{
                    padding: '10px 22px',
                    display: 'grid',
                    gridTemplateColumns: '40px 90px 80px 80px 100px 1.4fr',
                    gap: 10, alignItems: 'center',
                    fontFamily: T.mono, fontSize: 11,
                    borderBottom: `1px solid ${T.edge}`,
                    cursor: topP.url ? 'pointer' : 'default',
                    background: riser ? 'rgba(201,162,39,0.07)' : (i % 2 === 0 ? 'transparent' : 'rgba(255,255,255,0.015)'),
                  }}
                  onMouseEnter={e => { e.currentTarget.style.background = 'rgba(201,162,39,0.10)'; }}
                  onMouseLeave={e => {
                    e.currentTarget.style.background = riser
                      ? 'rgba(201,162,39,0.07)'
                      : (i % 2 === 0 ? 'transparent' : 'rgba(255,255,255,0.015)');
                  }}
                >
                  <div style={{ color: T.textDim }}>{i + 1}</div>
                  <div style={{
                    color: T.text, fontWeight: 700, letterSpacing: 0.4,
                    display: 'flex', alignItems: 'center', gap: 6,
                  }}>
                    {riser && <span style={{
                      fontSize: 8, letterSpacing: 0.8, padding: '1px 5px',
                      background: 'rgba(201,162,39,0.22)', color: T.signal,
                      border: '0.5px solid rgba(201,162,39,0.6)', borderRadius: 3,
                    }}>▲</span>}
                    ${r.ticker}
                  </div>
                  <div style={{ color: T.bull, fontWeight: 700, textAlign: 'right' }}>{fmtN(r.mentions)}</div>
                  <div style={{ color: T.textMid, textAlign: 'right' }}>{fmtN(r.upvotes)}</div>
                  <div>
                    <Sparkline values={bins} color={riser ? T.signal : T.textMid} />
                  </div>
                  <div style={{
                    color: T.textMid,
                    whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
                  }} title={topP.title || ''}>
                    {topP.flair ? <span style={{
                      fontSize: 9, padding: '1px 5px', marginRight: 6,
                      color: T.signal, background: 'rgba(201,162,39,0.10)',
                      border: '0.5px solid rgba(201,162,39,0.3)', borderRadius: 3,
                    }}>{topP.flair}</span> : null}
                    {topP.title || '—'}
                  </div>
                </div>
              );
            })}
          </div>

          {/* Footer */}
          <div style={{
            padding: '10px 22px',
            borderTop: `1px solid ${T.edge}`,
            fontFamily: T.mono, fontSize: 9.5, color: T.textDim, letterSpacing: 0.3,
            display: 'flex', alignItems: 'center', gap: 12,
          }}>
            <span>Source · reddit.com/r/wallstreetbets/top.json (public, no auth)</span>
            <span style={{ color: T.signal }}>▲ = fast riser (1d rate ≥ 2× 7d avg)</span>
            <span style={{ marginLeft: 'auto' }}>Click row → open top post</span>
          </div>

        </div>
      </div>
    );
  }
  window.TRWSBPanel = TRWSBPanel;
})();
