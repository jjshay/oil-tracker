// tr-earnings-panel.jsx — Earnings calendar + surprise tracker modal.
//
// Tabs:
//   Upcoming  — next 7 days (sorted ascending by date)
//   Recent    — last 7 days with actuals, sorted descending
//
// Row: TICKER · DATE · TIME · EPS EST · ACTUAL · SURPRISE%
// BTC-adjacent, mega-cap tech, and energy names are highlighted.
//
// Exposes:
//   window.TREarningsPanel({ open, onClose })
//   window.openTREarnings()
//
// Depends on:
//   window.EarningsData (engine/earnings.js)

(function () {
  const T = {
    ink000: '#07090C', ink100: '#0B0E13', ink200: '#10141B', ink300: '#171C24',
    edge: 'rgba(255,255,255,0.06)', edgeHi: 'rgba(255,255,255,0.10)',
    text: '#ffffff', textMid: 'rgba(180,188,200,0.75)', textDim: 'rgba(130,138,150,0.55)',
    signal: '#c9a227', bull: '#6FCF8E', bear: '#D96B6B', accent: '#60a5fa',
    btc:    '#f7931a', mega: '#a78bfa', energy: '#e67e22',
    mono: '"JetBrains Mono", ui-monospace, "SF Mono", Menlo, Consolas, monospace',
    ui: '"Inter Tight", system-ui, -apple-system, sans-serif',
  };

  window.openTREarnings = function openTREarnings() {
    try { window.dispatchEvent(new CustomEvent('tr:open-earnings')); } catch (_) {}
  };

  function classify(symbol) {
    var H = (window.EarningsData && window.EarningsData.HIGHLIGHT_SYMBOLS) || {};
    var s = (symbol || '').toUpperCase();
    if ((H.btc || []).indexOf(s) !== -1)     return { key: 'btc',    color: T.btc,    label: 'BTC' };
    if ((H.megacap || []).indexOf(s) !== -1) return { key: 'mega',   color: T.mega,   label: 'MEGA' };
    if ((H.energy || []).indexOf(s) !== -1)  return { key: 'energy', color: T.energy, label: 'ENRG' };
    return null;
  }

  function fmtNum(n, digits) {
    if (n == null || !isFinite(n)) return '—';
    if (Math.abs(n) >= 1e9) return '$' + (n / 1e9).toFixed(2) + 'B';
    if (Math.abs(n) >= 1e6) return '$' + (n / 1e6).toFixed(2) + 'M';
    return n.toFixed(digits == null ? 2 : digits);
  }

  function fmtEps(n) {
    if (n == null || !isFinite(n)) return '—';
    return (n >= 0 ? '$' : '-$') + Math.abs(n).toFixed(2);
  }

  function fmtHour(h) {
    if (!h) return '—';
    var s = String(h).toLowerCase();
    if (s === 'bmo') return 'PRE';
    if (s === 'amc') return 'POST';
    if (s === 'dmh') return 'MID';
    return s.toUpperCase();
  }

  function Tab({ id, label, active, onClick, count }) {
    return (
      <div onClick={onClick} style={{
        padding: '8px 16px', cursor: 'pointer',
        borderBottom: `2px solid ${active ? T.signal : 'transparent'}`,
        color: active ? T.text : T.textMid,
        fontFamily: T.mono, fontSize: 11, fontWeight: 600, letterSpacing: 0.8,
      }}>
        {label}
        {count != null && (
          <span style={{
            marginLeft: 8, fontFamily: T.mono, color: T.textDim, fontWeight: 500,
          }}>{count}</span>
        )}
      </div>
    );
  }

  function Row({ row, tab }) {
    const cls = classify(row.symbol);
    const surp = row.surprise_pct;
    const beat = surp != null && surp > 0;
    const miss = surp != null && surp < 0;

    return (
      <div style={{
        display: 'grid',
        gridTemplateColumns: '110px 120px 70px 90px 90px 110px',
        alignItems: 'center', gap: 10,
        padding: '10px 18px',
        borderBottom: `1px solid ${T.edge}`,
        fontFamily: T.mono, fontSize: 11.5,
        background: cls ? 'rgba(255,255,255,0.02)' : 'transparent',
      }}>
        {/* Ticker + badge */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
          <span style={{
            color: cls ? cls.color : T.text, fontWeight: 700, fontSize: 12,
          }}>{row.symbol || '—'}</span>
          {cls && (
            <span style={{
              fontSize: 8.5, padding: '1px 5px', borderRadius: 3,
              background: cls.color + '22', color: cls.color,
              letterSpacing: 0.4,
            }}>{cls.label}</span>
          )}
        </div>
        <div style={{ color: T.textMid }}>{row.date || '—'}</div>
        <div style={{ color: T.textDim }}>{fmtHour(row.hour)}</div>
        <div style={{ color: T.text, textAlign: 'right' }}>{fmtEps(row.epsEstimate)}</div>
        <div style={{
          color: row.epsActual == null ? T.textDim : T.text,
          textAlign: 'right', fontWeight: 600,
        }}>{fmtEps(row.epsActual)}</div>
        <div style={{
          color: beat ? T.bull : miss ? T.bear : T.textDim,
          fontWeight: 700, textAlign: 'right',
        }}>
          {surp == null ? '—' : (surp > 0 ? '+' : '') + surp.toFixed(1) + '%'}
        </div>
      </div>
    );
  }

  function TREarningsPanel({ open, onClose }) {
    const [tab, setTab]         = React.useState('upcoming'); // upcoming | recent
    const [upcoming, setUp]     = React.useState([]);
    const [recent, setRecent]   = React.useState([]);
    const [loading, setLoading] = React.useState(false);
    const [beatFilter, setBF]   = React.useState(null); // null | true | false
    const [tick, setTick]       = React.useState(0);

    React.useEffect(() => {
      if (!open) return;
      let active = true;
      setLoading(true);
      (async () => {
        try {
          if (!window.EarningsData) return;
          const [up, rec] = await Promise.all([
            window.EarningsData.getUpcoming({ days: 7 }),
            window.EarningsData.getRecent({ days: 7, beats: beatFilter }),
          ]);
          if (!active) return;
          setUp(up || []);
          setRecent(rec || []);
        } catch (e) {
          console.warn('[TREarningsPanel] load failed', e && e.message);
        } finally {
          if (active) setLoading(false);
        }
      })();
      return () => { active = false; };
    }, [open, tick, beatFilter]);

    if (!open) return null;

    const list = tab === 'upcoming' ? upcoming : recent;

    const hasFinnhub = !!(window.TR_SETTINGS && window.TR_SETTINGS.keys && window.TR_SETTINGS.keys.finnhub);

    return (
      <div onClick={onClose} style={{
        position: 'fixed', inset: 0, background: 'rgba(4,6,10,0.82)',
        backdropFilter: 'blur(8px)', zIndex: 9000,
        display: 'flex', alignItems: 'stretch', justifyContent: 'center',
        fontFamily: T.ui, color: T.text,
      }}>
        <div onClick={e => e.stopPropagation()} style={{
          flex: 1, margin: '2vh 2vw', background: T.ink100,
          border: `1px solid ${T.edge}`, borderRadius: 12, overflow: 'hidden',
          display: 'flex', flexDirection: 'column',
        }}>

          {/* Header */}
          <div style={{
            padding: '14px 22px', borderBottom: `1px solid ${T.edge}`,
            display: 'flex', alignItems: 'center', gap: 14, background: T.ink200,
          }}>
            <div>
              <div style={{
                fontSize: 10, letterSpacing: 1.4, color: T.signal,
                textTransform: 'uppercase', fontWeight: 700,
              }}>EARNINGS · Calendar + surprises</div>
              <div style={{ fontSize: 13, color: T.text, fontWeight: 500 }}>
                Next 7d · Last 7d beats/misses
              </div>
            </div>
            <div style={{ flex: 1 }} />
            <div style={{ fontFamily: T.mono, fontSize: 10, color: T.textDim }}>
              {loading ? 'LOADING…' : (hasFinnhub ? 'FINNHUB' : 'NASDAQ FALLBACK')}
            </div>
            <div onClick={() => setTick(t => t + 1)} style={{
              padding: '5px 12px', fontFamily: T.mono, fontSize: 10.5, fontWeight: 600,
              background: T.ink300, color: T.textMid, border: `1px solid ${T.edgeHi}`,
              borderRadius: 5, cursor: 'pointer', letterSpacing: 0.4,
            }}>REFRESH</div>
            <button onClick={onClose} style={{
              background: 'transparent', color: T.textMid, border: `1px solid ${T.edge}`,
              padding: '5px 12px', borderRadius: 5, cursor: 'pointer',
              fontSize: 11, fontFamily: T.mono, letterSpacing: 0.4,
            }}>CLOSE ✕</button>
          </div>

          {/* Tabs */}
          <div style={{
            display: 'flex', alignItems: 'center', gap: 4,
            padding: '0 14px', borderBottom: `1px solid ${T.edge}`,
            background: T.ink100,
          }}>
            <Tab id="upcoming" label="UPCOMING"
              active={tab === 'upcoming'} count={upcoming.length}
              onClick={() => setTab('upcoming')} />
            <Tab id="recent"   label="RECENT"
              active={tab === 'recent'} count={recent.length}
              onClick={() => setTab('recent')} />

            <div style={{ flex: 1 }} />
            {tab === 'recent' && (
              <div style={{ display: 'flex', gap: 6, padding: '6px 0' }}>
                {[
                  { id: null,  label: 'ALL' },
                  { id: true,  label: 'BEATS', color: T.bull },
                  { id: false, label: 'MISSES', color: T.bear },
                ].map(f => (
                  <div key={String(f.id)} onClick={() => setBF(f.id)} style={{
                    padding: '4px 10px', fontFamily: T.mono, fontSize: 10, fontWeight: 600,
                    background: beatFilter === f.id ? (f.color || T.signal) : T.ink200,
                    color: beatFilter === f.id ? T.ink000 : T.textMid,
                    border: `1px solid ${beatFilter === f.id ? (f.color || T.signal) : T.edge}`,
                    borderRadius: 4, cursor: 'pointer', letterSpacing: 0.4,
                  }}>{f.label}</div>
                ))}
              </div>
            )}
          </div>

          {/* Column header */}
          <div style={{
            display: 'grid',
            gridTemplateColumns: '110px 120px 70px 90px 90px 110px',
            gap: 10, padding: '8px 18px',
            borderBottom: `1px solid ${T.edge}`,
            fontFamily: T.mono, fontSize: 9.5, color: T.textDim,
            letterSpacing: 0.8, textTransform: 'uppercase',
          }}>
            <div>Ticker</div>
            <div>Date</div>
            <div>Time</div>
            <div style={{ textAlign: 'right' }}>EPS Est</div>
            <div style={{ textAlign: 'right' }}>Actual</div>
            <div style={{ textAlign: 'right' }}>Surprise</div>
          </div>

          {/* Rows */}
          <div style={{ flex: 1, overflowY: 'auto' }}>
            {!loading && !list.length && (
              <div style={{ padding: '30px 22px', fontSize: 12, color: T.textDim }}>
                {hasFinnhub
                  ? 'No earnings in this window.'
                  : 'No Finnhub key set — falling back to NASDAQ. Set TR_SETTINGS.keys.finnhub for the full calendar.'}
              </div>
            )}
            {list.map((r, i) => (
              <Row key={(r.symbol || '') + (r.date || '') + i} row={r} tab={tab} />
            ))}
          </div>

          {/* Footer */}
          <div style={{
            padding: '10px 22px', borderTop: `1px solid ${T.edge}`,
            background: T.ink200,
            fontFamily: T.mono, fontSize: 9.5, color: T.textDim, letterSpacing: 0.4,
            display: 'flex', gap: 14, flexWrap: 'wrap',
          }}>
            <span>Source: Finnhub · NASDAQ fallback · 10-min cache</span>
            <span style={{ color: T.btc }}>■ BTC-adjacent</span>
            <span style={{ color: T.mega }}>■ Mega-cap</span>
            <span style={{ color: T.energy }}>■ Energy</span>
          </div>
        </div>
      </div>
    );
  }

  window.TREarningsPanel = TREarningsPanel;
})();
