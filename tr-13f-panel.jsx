// tr-13f-panel.jsx — TradeRadar SEC 13F-HR hedge-fund tracker.
//
// Shows top-10 positions for tracked mega-funds (Berkshire, Bridgewater,
// Renaissance, Citadel, Point72, Soros, Millennium, Two Sigma, D.E. Shaw,
// Vanguard, BlackRock). NEW / ADDED / REDUCED / SOLD flags are computed
// against the prior quarter's filing.
//
// Exposes:
//   window.TR13FPanel   — React modal ({ open, onClose })
//   window.openTR13F()  — dispatches CustomEvent('tr:open-13f')
//
// Depends on:
//   window.EDGAR13F       (engine/edgar-13f.js)
//   window.useAutoUpdate  (tr-hooks.jsx)

(function () {
  const T = {
    ink000: '#07090C', ink100: '#0B0E13', ink200: '#10141B', ink300: '#171C24',
    edge: 'rgba(255,255,255,0.06)', edgeHi: 'rgba(255,255,255,0.10)',
    text: '#ffffff', textMid: 'rgba(180,188,200,0.75)', textDim: 'rgba(130,138,150,0.55)',
    signal: '#c9a227', bull: '#6FCF8E', bear: '#D96B6B',
    mono: '"JetBrains Mono", ui-monospace, "SF Mono", Menlo, Consolas, monospace',
  };

  function fmt$(n) {
    if (!isFinite(n) || n === 0) return '—';
    const abs = Math.abs(n);
    const s = abs >= 1e9 ? '$' + (abs / 1e9).toFixed(2) + 'B'
            : abs >= 1e6 ? '$' + (abs / 1e6).toFixed(1) + 'M'
            : abs >= 1e3 ? '$' + Math.round(abs / 1e3) + 'K'
            : '$' + Math.round(abs);
    return n < 0 ? '-' + s : s;
  }
  function fmtShares(n) {
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

  window.openTR13F = function openTR13F() {
    try { window.dispatchEvent(new CustomEvent('tr:open-13f')); } catch (_) {}
  };

  const useAuto = (window.useAutoUpdate || (() => ({ data: null, loading: false })));

  // ====================================================================
  // TR13FPanel
  // ====================================================================
  function TR13FPanel({ open, onClose }) {
    const FUNDS = (window.EDGAR13F && window.EDGAR13F.FUNDS) || [];
    const [activeKey, setActiveKey] = React.useState(FUNDS[0] ? FUNDS[0].key : 'berkshire');
    const [refreshTick, setRefreshTick] = React.useState(0);

    const { data: detail, loading } = useAuto(
      `13f-panel-${activeKey}-${refreshTick}`,
      async () => {
        if (!window.EDGAR13F) return null;
        return window.EDGAR13F.getLatestForFund(activeKey);
      },
      { refreshKey: 'signals-panel' }
    );

    if (!open) return null;

    const holdings  = (detail && detail.holdings) || [];
    const sold      = (detail && detail.soldPositions) || [];
    const filing    = (detail && detail.filing) || null;
    const fund      = (detail && detail.fund) || FUNDS.find(f => f.key === activeKey) || null;
    const top10     = holdings.slice(0, 10);

    return (
      <div onClick={onClose} style={{
        position: 'fixed', inset: 0, background: 'rgba(7,9,12,0.8)',
        backdropFilter: 'blur(12px) saturate(150%)',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        zIndex: 120, padding: 40,
      }}>
        <div onClick={e => e.stopPropagation()} style={{
          width: 1080, maxHeight: '92%', overflow: 'hidden',
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
              13F Tracker
            </div>
            <div style={{
              padding: '2px 8px', fontFamily: T.mono, fontSize: 9.5, fontWeight: 600,
              letterSpacing: 0.6, color: T.signal,
              background: 'rgba(201,162,39,0.10)',
              borderRadius: 4, border: '0.5px solid rgba(201,162,39,0.4)',
            }}>
              SEC EDGAR · 13F-HR
            </div>
            <div style={{ fontFamily: T.mono, fontSize: 9.5, color: T.textDim, letterSpacing: 0.4 }}>
              {loading ? 'LOADING…' : (filing ? `filed ${fmtDate(filing.filedDate)} · period ${fmtDate(filing.periodEnding)}` : '—')}
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

          {/* Fund tabs */}
          <div style={{
            padding: '10px 22px',
            display: 'flex', gap: 6, flexWrap: 'wrap',
            borderBottom: `1px solid ${T.edge}`,
          }}>
            {FUNDS.map(f => (
              <div key={f.key}
                onClick={() => setActiveKey(f.key)}
                style={{
                  padding: '5px 11px',
                  fontFamily: T.mono, fontSize: 10.5, fontWeight: 600, letterSpacing: 0.4,
                  background: activeKey === f.key ? T.signal : T.ink200,
                  color: activeKey === f.key ? T.ink000 : T.textMid,
                  border: `1px solid ${activeKey === f.key ? T.signal : T.edge}`,
                  borderRadius: 5, cursor: 'pointer',
                }}
                title={`${f.name} · ${f.manager}`}
              >
                {f.name.split(/ |\./)[0].toUpperCase()}
              </div>
            ))}
          </div>

          {/* Sub-header */}
          <div style={{
            padding: '10px 22px',
            display: 'flex', alignItems: 'baseline', gap: 10,
            borderBottom: `1px solid ${T.edge}`,
            background: T.ink200,
          }}>
            <div style={{ fontSize: 13, fontWeight: 600, color: T.text }}>
              {fund ? fund.name : '—'}
            </div>
            <div style={{ fontSize: 10.5, fontFamily: T.mono, color: T.textMid }}>
              {fund ? fund.manager : ''}
            </div>
            <div style={{ marginLeft: 'auto', fontFamily: T.mono, fontSize: 10, color: T.textDim, letterSpacing: 0.4 }}>
              {holdings.length
                ? `${holdings.length} positions · total ${fmt$(holdings.reduce((a, b) => a + (b.value || 0), 0))}`
                : '—'}
            </div>
          </div>

          {/* Table: top-10 */}
          <div style={{
            padding: '10px 22px',
            display: 'grid',
            gridTemplateColumns: '40px 90px 2fr 1fr 1fr 0.9fr 0.9fr',
            gap: 10,
            fontFamily: T.mono, fontSize: 9, letterSpacing: 0.8,
            color: T.textDim, textTransform: 'uppercase', fontWeight: 600,
            borderBottom: `1px solid ${T.edge}`,
          }}>
            <div>#</div>
            <div>TICKER</div>
            <div>ISSUER</div>
            <div style={{ textAlign: 'right' }}>VALUE</div>
            <div style={{ textAlign: 'right' }}>SHARES</div>
            <div style={{ textAlign: 'right' }}>Δ vs PRIOR</div>
            <div style={{ textAlign: 'right' }}>STATUS</div>
          </div>

          <div style={{ flex: 1, overflow: 'auto' }}>
            {!top10.length && (
              <div style={{
                padding: '40px 22px', textAlign: 'center',
                fontFamily: T.mono, fontSize: 11, color: T.textDim,
              }}>
                {loading ? 'Loading 13F information table…' : 'No holdings parsed.'}
              </div>
            )}

            {top10.map((h, i) => {
              const isNew     = h.status === 'new';
              const added     = h.status === 'added';
              const reduced   = h.status === 'reduced';
              const statusClr = isNew ? T.signal : added ? T.bull : reduced ? T.bear : T.textMid;
              return (
                <div key={(h.cusip || h.name) + i} style={{
                  padding: '10px 22px',
                  display: 'grid',
                  gridTemplateColumns: '40px 90px 2fr 1fr 1fr 0.9fr 0.9fr',
                  gap: 10, alignItems: 'center',
                  fontFamily: T.mono, fontSize: 11,
                  borderBottom: `1px solid ${T.edge}`,
                  background: isNew ? 'rgba(201,162,39,0.07)' : (i % 2 === 0 ? 'transparent' : 'rgba(255,255,255,0.015)'),
                }}>
                  <div style={{ color: T.textDim }}>{i + 1}</div>
                  <div style={{
                    color: T.text, fontWeight: 700, letterSpacing: 0.4,
                    display: 'flex', alignItems: 'center', gap: 6,
                  }}>
                    {isNew && <span style={{
                      fontSize: 8, letterSpacing: 0.8, padding: '1px 5px',
                      background: 'rgba(201,162,39,0.22)', color: T.signal,
                      border: '0.5px solid rgba(201,162,39,0.6)', borderRadius: 3,
                    }}>NEW</span>}
                    {h.ticker || '—'}
                  </div>
                  <div style={{
                    color: T.text,
                    whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
                  }}>{h.name || '—'}</div>
                  <div style={{ color: T.text, fontWeight: 700, textAlign: 'right' }}>{fmt$(h.value)}</div>
                  <div style={{ color: T.textMid, textAlign: 'right' }}>{fmtShares(h.shares)}</div>
                  <div style={{
                    color: (h.changeFromPrior || 0) > 0 ? T.bull : (h.changeFromPrior || 0) < 0 ? T.bear : T.textMid,
                    fontWeight: 600, textAlign: 'right',
                  }}>
                    {(h.changeFromPrior || 0) > 0 ? '+' : ''}{fmt$(h.changeFromPrior)}
                  </div>
                  <div style={{
                    color: statusClr, fontWeight: 600, textAlign: 'right',
                    textTransform: 'uppercase', letterSpacing: 0.5,
                  }}>{h.status || 'held'}</div>
                </div>
              );
            })}

            {/* Sold positions section */}
            {sold.length > 0 && (
              <div style={{
                padding: '16px 22px 6px 22px',
                fontFamily: T.mono, fontSize: 10, letterSpacing: 0.6,
                color: T.bear, fontWeight: 600, textTransform: 'uppercase',
                borderTop: `1px solid ${T.edge}`,
              }}>
                Sold positions ({sold.length})
              </div>
            )}
            {sold.slice(0, 10).map((h, i) => (
              <div key={'sold-' + (h.cusip || h.name) + i} style={{
                padding: '7px 22px',
                display: 'grid',
                gridTemplateColumns: '40px 90px 2fr 1fr 1fr 0.9fr 0.9fr',
                gap: 10, alignItems: 'center',
                fontFamily: T.mono, fontSize: 10.5,
                borderBottom: `1px solid ${T.edge}`,
                color: T.textMid,
                background: 'rgba(217,107,107,0.05)',
              }}>
                <div>—</div>
                <div style={{ fontWeight: 700, color: T.textMid }}>{h.ticker || '—'}</div>
                <div style={{ whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{h.name || '—'}</div>
                <div style={{ textAlign: 'right', color: T.textDim }}>{fmt$(h.value)}</div>
                <div style={{ textAlign: 'right', color: T.textDim }}>{fmtShares(h.shares)}</div>
                <div style={{ textAlign: 'right', color: T.bear, fontWeight: 600 }}>{fmt$(h.changeFromPrior)}</div>
                <div style={{ textAlign: 'right', color: T.bear, fontWeight: 600, letterSpacing: 0.5 }}>SOLD</div>
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
            <span>Source · SEC EDGAR 13F-HR (information table XML)</span>
            <span style={{ color: T.signal }}>NEW = position initiated this quarter</span>
            <span style={{ marginLeft: 'auto' }}>Long US-equity holdings · filed T+45 after quarter-end</span>
          </div>

        </div>
      </div>
    );
  }
  window.TR13FPanel = TR13FPanel;
})();
