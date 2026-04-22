// tr-insider-panel.jsx — TradeRadar SEC Form 4 insider-buying panel.
//
// Documented alpha: open-market purchases ("P") by CEOs/CFOs/Directors >$500k
// often precede positive catalysts (earnings, guidance raises, M&A). Routine
// 10b5-1 sales ("S") are noisy and down-weighted in the UI.
//
// Exposes:
//   window.TRInsiderPanel   — React modal ({ open, onClose })
//   window.openTRInsider()  — dispatches CustomEvent('tr:open-insider')
//
// Depends on:
//   window.InsiderData     (engine/insiders.js)
//   window.useAutoUpdate   (tr-hooks.jsx)

(function () {
  const T = {
    ink000: '#07090C', ink100: '#0B0E13', ink200: '#10141B', ink300: '#171C24',
    edge: 'rgba(255,255,255,0.06)', edgeHi: 'rgba(255,255,255,0.10)',
    text: '#ffffff', textMid: 'rgba(180,188,200,0.75)', textDim: 'rgba(130,138,150,0.55)',
    signal: '#c9a227', bull: '#6FCF8E', bear: '#D96B6B',
    mono: '"JetBrains Mono", ui-monospace, "SF Mono", Menlo, Consolas, monospace',
  };

  function fmt$(n) {
    if (!isFinite(n) || n <= 0) return '—';
    if (n >= 1e9) return '$' + (n / 1e9).toFixed(1) + 'B';
    if (n >= 1e6) return '$' + (n / 1e6).toFixed(1) + 'M';
    if (n >= 1e3) return '$' + Math.round(n / 1e3) + 'K';
    return '$' + Math.round(n);
  }
  function fmtN(n) {
    if (!isFinite(n) || n <= 0) return '—';
    if (n >= 1e6) return (n / 1e6).toFixed(1) + 'M';
    if (n >= 1e3) return (n / 1e3).toFixed(0) + 'K';
    return String(Math.round(n));
  }
  function fmtDate(d) {
    if (!d) return '—';
    try {
      const dt = new Date(d);
      if (!isFinite(dt.getTime())) return String(d).slice(0, 10);
      return dt.toISOString().slice(0, 10);
    } catch (_) { return String(d).slice(0, 10); }
  }

  window.openTRInsider = function openTRInsider() {
    try { window.dispatchEvent(new CustomEvent('tr:open-insider')); } catch (_) {}
  };

  const useAuto = (window.useAutoUpdate || (() => ({ data: null, loading: false })));

  // ====================================================================
  // TRInsiderPanel
  // ====================================================================
  function TRInsiderPanel({ open, onClose }) {
    const [tab, setTab]         = React.useState('buys'); // 'buys'|'all'
    const [sort, setSort]       = React.useState('value'); // 'value'|'date'
    const [query, setQuery]     = React.useState('');
    const [refreshTick, setRefreshTick] = React.useState(0);

    const { data: rows, loading } = useAuto(
      `insider-panel-${refreshTick}`,
      async () => {
        if (!window.InsiderData) return null;
        return window.InsiderData.getRecent({ limit: 300 });
      },
      { refreshKey: 'signals-panel' }
    );

    if (!open) return null;

    const all = Array.isArray(rows) ? rows : [];
    const q = query.trim().toLowerCase();

    // Tab filter
    let list = all;
    if (tab === 'buys') {
      // Recent Purchases (P > $100k)
      list = all.filter(r => r.transactionCode === 'P' && (r.value || 0) > 100000);
    }
    if (q) {
      list = list.filter(r =>
        (r.symbol || '').toLowerCase().indexOf(q) !== -1 ||
        (r.filerName || '').toLowerCase().indexOf(q) !== -1 ||
        (r.relation  || '').toLowerCase().indexOf(q) !== -1
      );
    }
    // Sort
    const sorted = list.slice().sort((a, b) => {
      if (sort === 'value') return (b.value || 0) - (a.value || 0);
      const da = a.filingDate ? new Date(a.filingDate).getTime() : 0;
      const db = b.filingDate ? new Date(b.filingDate).getTime() : 0;
      return db - da;
    });

    const countBuys  = all.filter(r => r.transactionCode === 'P' && (r.value || 0) > 100000).length;

    const Pill = ({ id, label, active, count, color, onClick }) => (
      <div
        onClick={onClick}
        style={{
          padding: '5px 12px',
          fontFamily: T.mono, fontSize: 10.5, fontWeight: 600, letterSpacing: 0.5,
          background: active ? (color || T.signal) : T.ink200,
          color: active ? T.ink000 : T.textMid,
          border: `1px solid ${active ? (color || T.signal) : T.edge}`,
          borderRadius: 5, cursor: 'pointer',
        }}
      >
        {label}
        {typeof count === 'number' && (
          <span style={{ marginLeft: 6, opacity: 0.7, fontWeight: 500 }}>{count}</span>
        )}
      </div>
    );

    return (
      <div onClick={onClose} style={{
        position: 'fixed', inset: 0, background: 'rgba(7,9,12,0.8)',
        backdropFilter: 'blur(12px) saturate(150%)',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        zIndex: 120, padding: 40,
      }}>
        <div onClick={e => e.stopPropagation()} style={{
          width: 1040, maxHeight: '92%', overflow: 'hidden',
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
              Insider Trades
            </div>
            <div style={{
              padding: '2px 8px', fontFamily: T.mono, fontSize: 9.5, fontWeight: 600,
              letterSpacing: 0.6, color: T.signal,
              background: 'rgba(201,162,39,0.10)',
              borderRadius: 4, border: '0.5px solid rgba(201,162,39,0.4)',
            }}>
              SEC FORM 4 · FINNHUB
            </div>
            <div style={{ fontFamily: T.mono, fontSize: 9.5, color: T.textDim, letterSpacing: 0.4 }}>
              {loading ? 'LOADING…' : (all.length + ' filings · 20m cache')}
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

          {/* Filter bar */}
          <div style={{
            padding: '12px 22px',
            display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap',
            borderBottom: `1px solid ${T.edge}`,
          }}>
            <Pill id="buys" label="RECENT PURCHASES" active={tab === 'buys'}
                  count={countBuys} color={T.bull} onClick={() => setTab('buys')} />
            <Pill id="all"  label="ALL FORM 4"       active={tab === 'all'}
                  count={all.length} onClick={() => setTab('all')} />
            <div style={{ width: 1, height: 20, background: T.edge, margin: '0 6px' }} />
            <Pill id="sv" label="SORT: VALUE" active={sort === 'value'} onClick={() => setSort('value')} />
            <Pill id="sd" label="SORT: DATE"  active={sort === 'date'}  onClick={() => setSort('date')} />
            <div style={{ flex: 1 }} />
            <input
              type="text"
              placeholder="Search ticker / filer…"
              value={query}
              onChange={e => setQuery(e.target.value)}
              style={{
                padding: '6px 10px', fontFamily: T.mono, fontSize: 11,
                background: T.ink000, border: `1px solid ${T.edge}`,
                color: T.text, borderRadius: 6, outline: 'none',
                width: 260,
              }}
            />
          </div>

          {/* Table header */}
          <div style={{
            padding: '10px 22px',
            display: 'grid',
            gridTemplateColumns: '80px 1.5fr 1fr 0.8fr 0.9fr 0.9fr 0.9fr',
            gap: 10,
            fontFamily: T.mono, fontSize: 9, letterSpacing: 0.8,
            color: T.textDim, textTransform: 'uppercase', fontWeight: 600,
            borderBottom: `1px solid ${T.edge}`,
          }}>
            <div>TICKER</div>
            <div>FILER</div>
            <div>TITLE</div>
            <div style={{ textAlign: 'right' }}>SHARES</div>
            <div style={{ textAlign: 'right' }}>VALUE</div>
            <div style={{ textAlign: 'right' }}>TX DATE</div>
            <div style={{ textAlign: 'right' }}>FILED</div>
          </div>

          {/* Body */}
          <div style={{ flex: 1, overflow: 'auto' }}>
            {!sorted.length && (
              <div style={{
                padding: '40px 22px', textAlign: 'center',
                fontFamily: T.mono, fontSize: 11, color: T.textDim,
              }}>
                {loading ? 'Loading Form 4 filings…'
                        : 'No filings matched. Try another tab or clear the search.'}
              </div>
            )}

            {sorted.map((r, i) => {
              const buy  = r.transactionCode === 'P';
              const sell = r.transactionCode === 'S';
              const gold = !!r.gold;
              return (
                <div key={(r.id || '') + i} style={{
                  padding: '9px 22px',
                  display: 'grid',
                  gridTemplateColumns: '80px 1.5fr 1fr 0.8fr 0.9fr 0.9fr 0.9fr',
                  gap: 10, alignItems: 'center',
                  fontFamily: T.mono, fontSize: 11,
                  borderBottom: `1px solid ${T.edge}`,
                  background: gold ? 'rgba(201,162,39,0.07)' : (i % 2 === 0 ? 'transparent' : 'rgba(255,255,255,0.015)'),
                }}>
                  <div style={{
                    color: T.text, fontWeight: 700, letterSpacing: 0.4,
                    display: 'flex', alignItems: 'center', gap: 6,
                  }}>
                    {gold && <span style={{
                      fontSize: 8, letterSpacing: 0.8, padding: '1px 5px',
                      background: 'rgba(201,162,39,0.22)', color: T.signal,
                      border: '0.5px solid rgba(201,162,39,0.6)', borderRadius: 3,
                    }}>★</span>}
                    {r.symbol || '—'}
                  </div>
                  <div style={{
                    color: T.text,
                    whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
                  }}>
                    {r.filerName}
                  </div>
                  <div style={{ color: T.textMid }}>{r.relation || '—'}</div>
                  <div style={{
                    color: buy ? T.bull : sell ? T.bear : T.textMid,
                    fontWeight: 600, textAlign: 'right',
                  }}>
                    {(buy ? '+' : sell ? '-' : '') + fmtN(r.shares)}
                  </div>
                  <div style={{
                    color: buy ? T.bull : sell ? T.bear : T.text,
                    fontWeight: 700, textAlign: 'right',
                  }}>
                    {fmt$(r.value)}
                  </div>
                  <div style={{ color: T.textMid, textAlign: 'right' }}>{fmtDate(r.transactionDate)}</div>
                  <div style={{ color: T.textDim, textAlign: 'right' }}>{fmtDate(r.filingDate)}</div>
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
            <span>Source · Finnhub /stock/insider-transactions (SEC Form 4)</span>
            <span style={{ color: T.signal }}>★ = CEO/CFO/Director BUY ≥ $500k</span>
            <span style={{ marginLeft: 'auto' }}>Codes: P=buy · S=sell · A=award · M=exercise · F=tax · G=gift</span>
          </div>

        </div>
      </div>
    );
  }
  window.TRInsiderPanel = TRInsiderPanel;
})();
