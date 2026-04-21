// tr-header-extras.jsx — shared header components reused by every screen.
// Exposes window.TRLiveStripInline (BTC + F&G polled every 60s) and
// window.TRGearInline (⚙ → opens Settings sheet).

function TRLiveStripInline() {
  const T = {
    text: '#ffffff', textMid: 'rgba(180,188,200,0.75)', textDim: 'rgba(130,138,150,0.55)',
    mono: '"JetBrains Mono", ui-monospace, "SF Mono", Menlo, Consolas, monospace',
  };
  const [btc, setBtc] = React.useState(null);
  const [fng, setFng] = React.useState(null);

  React.useEffect(() => {
    let active = true;
    async function tick() {
      try {
        if (typeof LiveData !== 'undefined') {
          const prices = await LiveData.getCryptoPrices();
          if (active && prices && prices.bitcoin) {
            setBtc({ price: prices.bitcoin.usd, change24h: prices.bitcoin.usd_24h_change });
          }
          const fg = await LiveData.getFearGreed();
          if (active && fg && fg.data && fg.data[0]) {
            setFng({ value: parseInt(fg.data[0].value, 10), classification: fg.data[0].value_classification });
          }
        }
      } catch (_) {}
    }
    tick();
    const iv = setInterval(tick, 60_000);
    return () => { active = false; clearInterval(iv); };
  }, []);

  if (!btc && !fng) return null;
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 12, fontFamily: T.mono, fontSize: 11 }}>
      {btc && (
        <div style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
          <span style={{ color: '#F7931A', fontSize: 10 }}>●</span>
          <span style={{ color: T.textDim, letterSpacing: 0.4 }}>BTC</span>
          <span style={{ color: T.text, fontWeight: 600 }}>
            ${Math.round(btc.price).toLocaleString('en-US')}
          </span>
          <span style={{ color: btc.change24h >= 0 ? '#6FCF8E' : '#D96B6B', fontSize: 10.5 }}>
            {btc.change24h >= 0 ? '+' : ''}{btc.change24h.toFixed(2)}%
          </span>
        </div>
      )}
      {fng && (
        <div style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
          <span style={{ color: T.textDim, letterSpacing: 0.4 }}>F&amp;G</span>
          <span style={{ color: T.text, fontWeight: 600 }}>{fng.value}</span>
        </div>
      )}
    </div>
  );
}

function TRGearInline() {
  return (
    <div
      onClick={() => window.openTRSettings && window.openTRSettings()}
      title="Settings · refresh · API keys"
      style={{
        width: 28, height: 28, borderRadius: 7,
        background: '#10141B', border: '1px solid rgba(255,255,255,0.08)',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        cursor: 'pointer', color: 'rgba(180,188,200,0.75)', fontSize: 14,
      }}>⚙</div>
  );
}

// Last-fetched badge for a specific refreshKey in Settings.
function TRLastFetchedBadge({ lastFetch, label = 'updated' }) {
  const [, tick] = React.useState(0);
  React.useEffect(() => {
    const iv = setInterval(() => tick(t => t + 1), 30_000);
    return () => clearInterval(iv);
  }, []);
  if (!lastFetch) return null;
  const secs = Math.round((Date.now() - lastFetch.getTime()) / 1000);
  const txt = secs < 60 ? `${secs}s ago`
            : secs < 3600 ? `${Math.round(secs / 60)}m ago`
            : `${Math.round(secs / 3600)}h ago`;
  return (
    <div style={{
      fontFamily: '"JetBrains Mono", ui-monospace, monospace',
      fontSize: 9.5, color: 'rgba(180,188,200,0.55)', letterSpacing: 0.3,
    }}>{label} {txt}</div>
  );
}

// Tradier options chain — modal. Opens from anywhere via window.openTROptions().
function TROptionsChain({ open, onClose }) {
  const T = {
    ink000: '#07090C', ink100: '#0B0E13', ink200: '#10141B', ink300: '#171C24',
    edge: 'rgba(255,255,255,0.06)', edgeHi: 'rgba(255,255,255,0.10)',
    text: '#ffffff', textMid: 'rgba(180,188,200,0.75)', textDim: 'rgba(130,138,150,0.55)',
    signal: '#c9a227', bull: '#6FCF8E', bear: '#D96B6B',
    mono: '"JetBrains Mono", ui-monospace, "SF Mono", Menlo, Consolas, monospace',
  };
  const POPULAR = ['SPY', 'QQQ', 'IBIT', 'NVDA', 'MSTR', 'COIN', 'MARA', 'AAPL', 'TSLA'];
  const [symbol, setSymbol] = React.useState('SPY');
  const [expirations, setExpirations] = React.useState([]);
  const [selectedExp, setSelectedExp] = React.useState('');
  const [chain, setChain] = React.useState(null);
  const [loading, setLoading] = React.useState(false);
  const [quote, setQuote] = React.useState(null);

  React.useEffect(() => {
    if (!open || !symbol) return;
    let active = true;
    (async () => {
      setLoading(true); setChain(null); setQuote(null);
      const [exps, q] = await Promise.all([
        window.TradierAPI ? window.TradierAPI.getExpirations(symbol) : null,
        window.TradierAPI ? window.TradierAPI.getQuote(symbol) : null,
      ]);
      if (!active) return;
      setExpirations(exps || []);
      setQuote(q);
      if (exps && exps.length) setSelectedExp(exps[0]);
      setLoading(false);
    })();
    return () => { active = false; };
  }, [open, symbol]);

  React.useEffect(() => {
    if (!open || !symbol || !selectedExp) return;
    let active = true;
    (async () => {
      setLoading(true);
      const c = window.TradierAPI ? await window.TradierAPI.getChain(symbol, selectedExp) : null;
      if (!active) return;
      setChain(c);
      setLoading(false);
    })();
    return () => { active = false; };
  }, [symbol, selectedExp, open]);

  if (!open) return null;

  // Split chain into calls + puts; keep ATM ±10 strikes
  let calls = [], puts = [];
  if (chain && quote) {
    const spot = quote.last || quote.close || 0;
    const filtered = chain.filter(o => Math.abs(o.strike - spot) < Math.max(spot * 0.25, 20));
    calls = filtered.filter(o => o.option_type === 'call').sort((a, b) => a.strike - b.strike);
    puts  = filtered.filter(o => o.option_type === 'put' ).sort((a, b) => a.strike - b.strike);
  }

  const Row = ({ o, isCall }) => (
    <tr style={{ borderBottom: `0.5px solid ${T.edge}` }}>
      <td style={{ padding: '4px 6px', fontFamily: T.mono, fontSize: 10.5, color: T.text, fontWeight: 500, textAlign: isCall ? 'right' : 'left' }}>
        ${(o.bid || 0).toFixed(2)}
      </td>
      <td style={{ padding: '4px 6px', fontFamily: T.mono, fontSize: 10.5, color: T.textMid, textAlign: isCall ? 'right' : 'left' }}>
        ${(o.ask || 0).toFixed(2)}
      </td>
      <td style={{ padding: '4px 6px', fontFamily: T.mono, fontSize: 10, color: T.textDim, textAlign: isCall ? 'right' : 'left' }}>
        {o.volume || 0}
      </td>
      <td style={{ padding: '4px 6px', fontFamily: T.mono, fontSize: 10, color: T.textDim, textAlign: isCall ? 'right' : 'left' }}>
        {o.open_interest || 0}
      </td>
    </tr>
  );

  return (
    <div
      onClick={onClose}
      style={{
        position: 'fixed', inset: 0, background: 'rgba(7,9,12,0.8)',
        backdropFilter: 'blur(12px) saturate(150%)',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        zIndex: 100, padding: 40,
      }}>
      <div onClick={e => e.stopPropagation()} style={{
        width: 920, maxHeight: '90%', overflow: 'auto',
        background: T.ink100, border: `1px solid ${T.edgeHi}`, borderRadius: 14,
        padding: '22px 26px', color: T.text,
        fontFamily: '"Inter Tight", system-ui, sans-serif',
        boxShadow: '0 24px 80px rgba(0,0,0,0.6)',
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 16 }}>
          <div style={{ fontSize: 10, letterSpacing: 1.2, color: T.textDim, textTransform: 'uppercase', fontWeight: 600 }}>Tradier Options Chain</div>
          <div style={{
            padding: '2px 8px', fontFamily: T.mono, fontSize: 9.5, fontWeight: 600, letterSpacing: 0.6,
            color: T.signal, background: 'rgba(201,162,39,0.12)', borderRadius: 4,
            border: '0.5px solid rgba(201,162,39,0.4)',
          }}>{(window.TR_SETTINGS?.meta?.tradierMode || 'sandbox').toUpperCase()}</div>
          <div onClick={onClose} style={{
            marginLeft: 'auto', width: 28, height: 28, borderRadius: 7,
            background: T.ink300, border: `1px solid ${T.edge}`,
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            cursor: 'pointer', color: T.textMid, fontSize: 13,
          }}>✕</div>
        </div>

        {/* Symbol picker + quote */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 14, flexWrap: 'wrap' }}>
          {POPULAR.map(s => {
            const on = s === symbol;
            return (
              <div key={s} onClick={() => setSymbol(s)} style={{
                padding: '5px 12px', fontFamily: T.mono, fontSize: 11, fontWeight: 600,
                background: on ? T.signal : T.ink200, color: on ? T.ink000 : T.textMid,
                border: `1px solid ${on ? T.signal : T.edge}`, borderRadius: 6,
                cursor: on ? 'default' : 'pointer',
              }}>{s}</div>
            );
          })}
          <input
            value={symbol} onChange={e => setSymbol(e.target.value.toUpperCase())}
            style={{
              padding: '5px 10px', fontFamily: T.mono, fontSize: 11, width: 80,
              background: T.ink000, border: `1px solid ${T.edge}`, color: T.text,
              borderRadius: 6, outline: 'none',
            }} placeholder="TICKER"
          />
        </div>

        {/* Quote */}
        {quote && (
          <div style={{
            background: T.ink200, border: `1px solid ${T.edge}`, borderRadius: 10,
            padding: '12px 16px', marginBottom: 14,
            display: 'flex', alignItems: 'baseline', gap: 16, flexWrap: 'wrap',
          }}>
            <div style={{ fontFamily: T.mono, fontSize: 20, fontWeight: 500, color: T.text }}>
              {quote.symbol} ${(quote.last || quote.close || 0).toFixed(2)}
            </div>
            <div style={{
              fontFamily: T.mono, fontSize: 12,
              color: (quote.change || 0) >= 0 ? T.bull : T.bear,
            }}>
              {(quote.change || 0) >= 0 ? '+' : ''}{(quote.change || 0).toFixed(2)} · {(quote.change_percentage || 0).toFixed(2)}%
            </div>
            <div style={{ fontFamily: T.mono, fontSize: 10, color: T.textDim, marginLeft: 'auto' }}>
              BID {(quote.bid || 0).toFixed(2)} · ASK {(quote.ask || 0).toFixed(2)} · VOL {(quote.volume || 0).toLocaleString()}
            </div>
          </div>
        )}

        {/* Expirations */}
        {expirations.length > 0 && (
          <div style={{ display: 'flex', gap: 6, marginBottom: 14, flexWrap: 'wrap' }}>
            <div style={{ fontSize: 10, letterSpacing: 0.8, color: T.textDim, alignSelf: 'center', textTransform: 'uppercase', fontWeight: 600, marginRight: 6 }}>Exp</div>
            {expirations.slice(0, 8).map(exp => {
              const on = exp === selectedExp;
              return (
                <div key={exp} onClick={() => setSelectedExp(exp)} style={{
                  padding: '4px 9px', fontFamily: T.mono, fontSize: 10, fontWeight: 500,
                  background: on ? T.signal : T.ink200, color: on ? T.ink000 : T.textMid,
                  border: `1px solid ${on ? T.signal : T.edge}`, borderRadius: 5,
                  cursor: on ? 'default' : 'pointer',
                }}>{exp}</div>
              );
            })}
          </div>
        )}

        {loading && (
          <div style={{ padding: '30px 0', textAlign: 'center', fontFamily: T.mono, fontSize: 11, color: T.textDim }}>
            LOADING TRADIER CHAIN…
          </div>
        )}

        {!loading && !chain && !quote && (
          <div style={{ padding: '30px 0', textAlign: 'center', fontSize: 12, color: T.textDim }}>
            No chain available. Check that Tradier key is set in Settings ⚙ and mode matches (sandbox vs live).
          </div>
        )}

        {chain && calls.length > 0 && puts.length > 0 && (
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 80px 1fr', gap: 10 }}>
            {/* Calls */}
            <div>
              <div style={{
                fontSize: 10, letterSpacing: 1.2, color: T.bull, textTransform: 'uppercase', fontWeight: 600,
                marginBottom: 6, textAlign: 'right',
              }}>Calls</div>
              <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                <thead><tr style={{ borderBottom: `0.5px solid ${T.edgeHi}` }}>
                  <th style={{ padding: '4px 6px', fontSize: 9, color: T.textDim, textAlign: 'right', fontWeight: 500 }}>BID</th>
                  <th style={{ padding: '4px 6px', fontSize: 9, color: T.textDim, textAlign: 'right', fontWeight: 500 }}>ASK</th>
                  <th style={{ padding: '4px 6px', fontSize: 9, color: T.textDim, textAlign: 'right', fontWeight: 500 }}>VOL</th>
                  <th style={{ padding: '4px 6px', fontSize: 9, color: T.textDim, textAlign: 'right', fontWeight: 500 }}>OI</th>
                </tr></thead>
                <tbody>{calls.map((o, i) => <Row key={i} o={o} isCall={true} />)}</tbody>
              </table>
            </div>
            {/* Strike column */}
            <div>
              <div style={{
                fontSize: 10, letterSpacing: 1.2, color: T.signal, textTransform: 'uppercase', fontWeight: 600,
                marginBottom: 6, textAlign: 'center',
              }}>Strike</div>
              <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                <thead><tr style={{ borderBottom: `0.5px solid ${T.edgeHi}` }}>
                  <th style={{ padding: '4px', fontSize: 9, color: T.textDim, textAlign: 'center', fontWeight: 500 }}>$</th>
                </tr></thead>
                <tbody>{calls.map((o, i) => (
                  <tr key={i} style={{ borderBottom: `0.5px solid ${T.edge}` }}>
                    <td style={{
                      padding: '4px', fontFamily: T.mono, fontSize: 10.5, fontWeight: 600,
                      textAlign: 'center',
                      color: Math.abs(o.strike - (quote?.last || 0)) < 1 ? T.signal : T.text,
                    }}>{o.strike}</td>
                  </tr>
                ))}</tbody>
              </table>
            </div>
            {/* Puts */}
            <div>
              <div style={{
                fontSize: 10, letterSpacing: 1.2, color: T.bear, textTransform: 'uppercase', fontWeight: 600,
                marginBottom: 6, textAlign: 'left',
              }}>Puts</div>
              <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                <thead><tr style={{ borderBottom: `0.5px solid ${T.edgeHi}` }}>
                  <th style={{ padding: '4px 6px', fontSize: 9, color: T.textDim, textAlign: 'left', fontWeight: 500 }}>BID</th>
                  <th style={{ padding: '4px 6px', fontSize: 9, color: T.textDim, textAlign: 'left', fontWeight: 500 }}>ASK</th>
                  <th style={{ padding: '4px 6px', fontSize: 9, color: T.textDim, textAlign: 'left', fontWeight: 500 }}>VOL</th>
                  <th style={{ padding: '4px 6px', fontSize: 9, color: T.textDim, textAlign: 'left', fontWeight: 500 }}>OI</th>
                </tr></thead>
                <tbody>{puts.map((o, i) => <Row key={i} o={o} isCall={false} />)}</tbody>
              </table>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
window.TROptionsChain = TROptionsChain;

// Small button — "Options" — opens the chain. Usable in any screen header.
function TROptionsButton() {
  return (
    <div
      onClick={() => window.openTROptions && window.openTROptions()}
      title="Tradier options chain"
      style={{
        padding: '0 10px', height: 26, display: 'flex', alignItems: 'center', gap: 5,
        background: '#10141B', border: '1px solid rgba(255,255,255,0.08)',
        borderRadius: 6, cursor: 'pointer', color: 'rgba(180,188,200,0.75)',
        fontFamily: '"JetBrains Mono", ui-monospace, monospace', fontSize: 10, fontWeight: 600, letterSpacing: 0.6,
      }}>⚡ CHAIN</div>
  );
}
window.TROptionsButton = TROptionsButton;

window.TRLiveStripInline = TRLiveStripInline;
window.TRGearInline = TRGearInline;
window.TRLastFetchedBadge = TRLastFetchedBadge;
