// tr-sizing-panel.jsx — TradeRadar Position-Sizing + Risk Calculator.
//
// Three tabs:
//   Stock / ETF   — shares, total capital, $ at risk, risk/reward
//   Options       — contracts, total cost, $ at risk, % of account
//   Crypto        — notional, margin, $ at risk, liquidation price
//
// Inputs persist in localStorage under key `tr_sizing_v1` so the user
// does not need to retype between sessions. All calcs are live (no Submit).
//
// Exposes:
//   window.TRSizingPanel    — React modal ({ open, onClose })
//   window.openTRSizing()   — dispatches CustomEvent('tr:open-sizing')

(function () {
  const T = {
    ink000: '#07090C', ink100: '#0B0E13', ink200: '#10141B', ink300: '#171C24',
    edge: 'rgba(255,255,255,0.06)', edgeHi: 'rgba(255,255,255,0.10)',
    text: '#ffffff', textMid: 'rgba(180,188,200,0.75)', textDim: 'rgba(130,138,150,0.55)',
    signal: '#c9a227', bull: '#6FCF8E', bear: '#D96B6B',
    mono: '"JetBrains Mono", ui-monospace, "SF Mono", Menlo, Consolas, monospace',
    ui: '"Inter Tight", system-ui, sans-serif',
  };

  const LS_KEY = 'tr_sizing_v1';

  // --------------------------------------------------------------------
  // Formatting helpers
  // --------------------------------------------------------------------
  function fmtMoney(n) {
    if (!isFinite(n)) return '—';
    const sign = n < 0 ? '-' : '';
    const abs = Math.abs(n);
    return sign + '$' + abs.toLocaleString('en-US', { maximumFractionDigits: 2, minimumFractionDigits: 2 });
  }
  function fmtInt(n) {
    if (!isFinite(n) || n < 0) return '—';
    return Math.floor(n).toLocaleString('en-US');
  }
  function fmtPct(n) {
    if (!isFinite(n)) return '—';
    return n.toFixed(2) + '%';
  }
  function num(v) {
    const x = parseFloat(v);
    return isFinite(x) ? x : NaN;
  }
  function posNum(v) {
    const x = num(v);
    return isFinite(x) && x > 0 ? x : NaN;
  }

  // --------------------------------------------------------------------
  // Persistence
  // --------------------------------------------------------------------
  function loadState() {
    try {
      const raw = localStorage.getItem(LS_KEY);
      if (!raw) return null;
      return JSON.parse(raw);
    } catch (_) { return null; }
  }
  function saveState(s) {
    try { localStorage.setItem(LS_KEY, JSON.stringify(s)); } catch (_) {}
  }

  const DEFAULT_STATE = {
    activeTab: 'stock',
    stock:   { account: '25000', risk: '1',   entry: '', stop: '', target: '' },
    options: { account: '25000', risk: '1',   premium: '', maxLoss: '', mode: 'long' },
    crypto:  { account: '25000', risk: '1',   entry: '', stop: '', leverage: '2' },
  };

  // --------------------------------------------------------------------
  // openTRSizing — global
  // --------------------------------------------------------------------
  window.openTRSizing = function openTRSizing() {
    try { window.dispatchEvent(new CustomEvent('tr:open-sizing')); } catch (_) {}
  };

  // --------------------------------------------------------------------
  // Small UI primitives
  // --------------------------------------------------------------------
  function Tab({ label, active, onClick }) {
    return (
      <div onClick={onClick} style={{
        padding: '7px 16px', fontSize: 11, fontWeight: 600,
        letterSpacing: 0.3, cursor: 'pointer',
        borderRadius: 6,
        background: active ? T.signal : T.ink200,
        color: active ? T.ink000 : T.textMid,
        border: `1px solid ${active ? T.signal : T.edge}`,
        transition: 'background 0.15s, color 0.15s',
        userSelect: 'none',
      }}>
        {label}
      </div>
    );
  }

  function Field({ label, value, onChange, placeholder, warn, hint, suffix }) {
    return (
      <div style={{ marginBottom: 10 }}>
        <div style={{
          fontSize: 10, color: T.textDim, letterSpacing: 0.6,
          textTransform: 'uppercase', marginBottom: 4, fontWeight: 600,
        }}>
          {label}
        </div>
        <div style={{ position: 'relative' }}>
          <input
            type="text"
            value={value}
            placeholder={placeholder || ''}
            onChange={e => onChange(e.target.value)}
            style={{
              width: '100%', padding: '8px 10px',
              background: T.ink200,
              border: `1px solid ${warn ? T.bear : T.edge}`,
              borderRadius: 6,
              color: T.text, fontFamily: T.mono, fontSize: 12.5,
              outline: 'none',
              boxShadow: warn ? `0 0 0 1px ${T.bear} inset` : 'none',
              boxSizing: 'border-box',
            }}
          />
          {suffix ? (
            <div style={{
              position: 'absolute', right: 10, top: '50%', transform: 'translateY(-50%)',
              fontFamily: T.mono, fontSize: 11, color: T.textDim, pointerEvents: 'none',
            }}>{suffix}</div>
          ) : null}
        </div>
        {hint ? (
          <div style={{ fontSize: 10.5, color: T.bear, marginTop: 4, fontFamily: T.mono }}>
            {hint}
          </div>
        ) : null}
      </div>
    );
  }

  function OutRow({ label, value, accent }) {
    return (
      <div style={{
        display: 'flex', justifyContent: 'space-between', alignItems: 'baseline',
        padding: '7px 10px',
        borderBottom: `1px solid ${T.edge}`,
      }}>
        <div style={{ fontSize: 10.5, color: T.textMid, letterSpacing: 0.4, textTransform: 'uppercase', fontWeight: 600 }}>
          {label}
        </div>
        <div style={{
          fontFamily: T.mono, fontSize: 13, fontWeight: 600,
          color: accent || T.text,
        }}>
          {value}
        </div>
      </div>
    );
  }

  function ModePill({ label, active, onClick }) {
    return (
      <div onClick={onClick} style={{
        padding: '5px 10px', fontSize: 10.5, fontWeight: 600,
        borderRadius: 5, cursor: 'pointer',
        background: active ? T.ink300 : T.ink200,
        color: active ? T.signal : T.textMid,
        border: `1px solid ${active ? T.signal : T.edge}`,
        userSelect: 'none',
      }}>{label}</div>
    );
  }

  // --------------------------------------------------------------------
  // Risk guide strip
  // --------------------------------------------------------------------
  function RiskGuide({ risk }) {
    const r = num(risk);
    const aggressive = isFinite(r) && r > 3;
    return (
      <div style={{
        padding: '8px 12px', margin: '0 0 12px 0',
        background: aggressive ? 'rgba(217,107,107,0.12)' : T.ink200,
        border: `1px solid ${aggressive ? T.bear : T.edge}`,
        borderRadius: 6,
        display: 'flex', alignItems: 'center', gap: 10,
        fontSize: 10.5, fontFamily: T.mono, letterSpacing: 0.3,
      }}>
        <div style={{ color: T.textDim, textTransform: 'uppercase', fontWeight: 600, letterSpacing: 0.8 }}>
          Risk Guide
        </div>
        <div style={{ color: T.bull }}>1% conservative</div>
        <div style={{ color: T.textDim }}>·</div>
        <div style={{ color: T.signal }}>2% standard</div>
        <div style={{ color: T.textDim }}>·</div>
        <div style={{ color: T.bear }}>3%+ aggressive</div>
        {aggressive ? (
          <div style={{ marginLeft: 'auto', color: T.bear, fontWeight: 600 }}>
            ⚠ {r.toFixed(1)}% is above standard risk
          </div>
        ) : null}
      </div>
    );
  }

  // --------------------------------------------------------------------
  // Stock / ETF calc
  // --------------------------------------------------------------------
  function StockPane({ s, update }) {
    const account = posNum(s.account);
    const risk    = num(s.risk);
    const entry   = posNum(s.entry);
    const stop    = posNum(s.stop);
    const target  = posNum(s.target);

    const dollarRisk = isFinite(account) && isFinite(risk) && risk > 0 ? account * (risk / 100) : NaN;
    const perShareRisk = isFinite(entry) && isFinite(stop) ? entry - stop : NaN;

    let stopWarn = '';
    if (isFinite(entry) && isFinite(stop) && stop >= entry) stopWarn = 'Stop must be below entry for long setups';

    const shares  = (isFinite(dollarRisk) && isFinite(perShareRisk) && perShareRisk > 0)
                      ? Math.floor(dollarRisk / perShareRisk) : NaN;
    const capital = (isFinite(shares) && isFinite(entry)) ? shares * entry : NaN;
    const atRisk  = (isFinite(shares) && isFinite(perShareRisk)) ? shares * perShareRisk : NaN;
    const rr      = (isFinite(target) && isFinite(entry) && isFinite(perShareRisk) && perShareRisk > 0)
                      ? (target - entry) / perShareRisk : NaN;

    return (
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16 }}>
        <div>
          <Field label="Account Size" suffix="$"
                 value={s.account} onChange={v => update({ account: v })}
                 placeholder="25000" />
          <Field label="Risk per Trade" suffix="%"
                 value={s.risk} onChange={v => update({ risk: v })}
                 placeholder="1" warn={num(s.risk) > 3} />
          <Field label="Entry Price" suffix="$"
                 value={s.entry} onChange={v => update({ entry: v })}
                 placeholder="100.00" />
          <Field label="Stop-Loss Price" suffix="$"
                 value={s.stop} onChange={v => update({ stop: v })}
                 placeholder="95.00"
                 warn={!!stopWarn} hint={stopWarn} />
          <Field label="Target (optional)" suffix="$"
                 value={s.target} onChange={v => update({ target: v })}
                 placeholder="110.00" />
        </div>
        <div style={{
          background: T.ink200, border: `1px solid ${T.edge}`, borderRadius: 8,
          alignSelf: 'start',
        }}>
          <OutRow label="Shares" value={fmtInt(shares)} accent={T.signal} />
          <OutRow label="Total Capital" value={fmtMoney(capital)} />
          <OutRow label="$ at Risk" value={fmtMoney(atRisk)} accent={T.bear} />
          <OutRow label="Risk/Reward"
                  value={isFinite(rr) ? rr.toFixed(2) + ' : 1' : '—'}
                  accent={isFinite(rr) && rr >= 2 ? T.bull : (isFinite(rr) && rr < 1 ? T.bear : T.text)} />
        </div>
      </div>
    );
  }

  // --------------------------------------------------------------------
  // Options calc
  // --------------------------------------------------------------------
  function OptionsPane({ s, update }) {
    const account = posNum(s.account);
    const risk    = num(s.risk);
    const premium = posNum(s.premium);
    const mode    = s.mode || 'long';

    // For long options, max loss == premium paid. For spreads, user supplies it.
    const effectiveMaxLoss = (mode === 'long')
      ? premium
      : posNum(s.maxLoss);

    const dollarRisk = isFinite(account) && isFinite(risk) && risk > 0 ? account * (risk / 100) : NaN;
    // Each contract controls 100 shares. Cost per contract = premium * 100.
    const contractCost   = isFinite(premium) ? premium * 100 : NaN;
    const contractMaxLos = isFinite(effectiveMaxLoss) ? effectiveMaxLoss * 100 : NaN;

    const contracts = (isFinite(dollarRisk) && isFinite(contractMaxLos) && contractMaxLos > 0)
                        ? Math.floor(dollarRisk / contractMaxLos) : NaN;
    const totalCost = (isFinite(contracts) && isFinite(contractCost)) ? contracts * contractCost : NaN;
    const atRisk    = (isFinite(contracts) && isFinite(contractMaxLos)) ? contracts * contractMaxLos : NaN;
    const pctAcct   = (isFinite(totalCost) && isFinite(account) && account > 0) ? (totalCost / account) * 100 : NaN;

    return (
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16 }}>
        <div>
          <Field label="Account Size" suffix="$"
                 value={s.account} onChange={v => update({ account: v })}
                 placeholder="25000" />
          <Field label="Risk per Trade" suffix="%"
                 value={s.risk} onChange={v => update({ risk: v })}
                 placeholder="1" warn={num(s.risk) > 3} />
          <div style={{ marginBottom: 10 }}>
            <div style={{
              fontSize: 10, color: T.textDim, letterSpacing: 0.6,
              textTransform: 'uppercase', marginBottom: 4, fontWeight: 600,
            }}>Strategy Mode</div>
            <div style={{ display: 'flex', gap: 6 }}>
              <ModePill label="Long call/put" active={mode === 'long'}   onClick={() => update({ mode: 'long' })} />
              <ModePill label="Credit spread" active={mode === 'credit'} onClick={() => update({ mode: 'credit' })} />
              <ModePill label="Debit spread"  active={mode === 'debit'}  onClick={() => update({ mode: 'debit' })} />
            </div>
          </div>
          <Field label="Premium per Contract" suffix="$"
                 value={s.premium} onChange={v => update({ premium: v })}
                 placeholder="2.50" />
          {mode !== 'long' ? (
            <Field label="Max Loss per Contract" suffix="$"
                   value={s.maxLoss} onChange={v => update({ maxLoss: v })}
                   placeholder={mode === 'credit' ? '(width − credit)' : '(debit paid)'}
                   hint={mode === 'credit' ? 'Credit spread: strike width minus credit received' : 'Debit spread: net debit paid'} />
          ) : null}
        </div>
        <div style={{
          background: T.ink200, border: `1px solid ${T.edge}`, borderRadius: 8,
          alignSelf: 'start',
        }}>
          <OutRow label="Contracts" value={fmtInt(contracts)} accent={T.signal} />
          <OutRow label="Total Cost" value={fmtMoney(totalCost)} />
          <OutRow label="$ at Risk" value={fmtMoney(atRisk)} accent={T.bear} />
          <OutRow label="% of Account"
                  value={fmtPct(pctAcct)}
                  accent={isFinite(pctAcct) && pctAcct > 10 ? T.bear : T.text} />
        </div>
      </div>
    );
  }

  // --------------------------------------------------------------------
  // Crypto calc
  // --------------------------------------------------------------------
  function CryptoPane({ s, update }) {
    const account  = posNum(s.account);
    const risk     = num(s.risk);
    const entry    = posNum(s.entry);
    const stop     = posNum(s.stop);
    const leverage = Math.max(1, Math.min(10, num(s.leverage) || 1));

    let stopWarn = '';
    if (isFinite(entry) && isFinite(stop) && stop >= entry) stopWarn = 'Stop must be below entry for long setups';

    const dollarRisk   = isFinite(account) && isFinite(risk) && risk > 0 ? account * (risk / 100) : NaN;
    const perUnitRisk  = isFinite(entry) && isFinite(stop) ? entry - stop : NaN;
    const units        = (isFinite(dollarRisk) && isFinite(perUnitRisk) && perUnitRisk > 0)
                           ? dollarRisk / perUnitRisk : NaN;
    const notional     = (isFinite(units) && isFinite(entry)) ? units * entry : NaN;
    const margin       = (isFinite(notional) && leverage > 0) ? notional / leverage : NaN;
    const atRisk       = (isFinite(units) && isFinite(perUnitRisk)) ? units * perUnitRisk : NaN;
    // Simplified isolated-margin liquidation for longs: price at which equity → 0
    // liq = entry * (1 − 1/leverage)
    const liqPrice     = (isFinite(entry) && leverage > 1) ? entry * (1 - 1 / leverage) : NaN;

    return (
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16 }}>
        <div>
          <Field label="Account Size" suffix="$"
                 value={s.account} onChange={v => update({ account: v })}
                 placeholder="25000" />
          <Field label="Risk per Trade" suffix="%"
                 value={s.risk} onChange={v => update({ risk: v })}
                 placeholder="1" warn={num(s.risk) > 3} />
          <Field label="Entry Price" suffix="$"
                 value={s.entry} onChange={v => update({ entry: v })}
                 placeholder="60000" />
          <Field label="Stop-Loss Price" suffix="$"
                 value={s.stop} onChange={v => update({ stop: v })}
                 placeholder="58000"
                 warn={!!stopWarn} hint={stopWarn} />
          <div style={{ marginBottom: 10 }}>
            <div style={{
              fontSize: 10, color: T.textDim, letterSpacing: 0.6,
              textTransform: 'uppercase', marginBottom: 4, fontWeight: 600,
              display: 'flex', justifyContent: 'space-between',
            }}>
              <span>Leverage</span>
              <span style={{ fontFamily: T.mono, color: T.signal }}>{leverage.toFixed(0)}×</span>
            </div>
            <input
              type="range" min={1} max={10} step={1}
              value={leverage}
              onChange={e => update({ leverage: e.target.value })}
              style={{ width: '100%', accentColor: T.signal }}
            />
          </div>
        </div>
        <div style={{
          background: T.ink200, border: `1px solid ${T.edge}`, borderRadius: 8,
          alignSelf: 'start',
        }}>
          <OutRow label="Notional"  value={fmtMoney(notional)} accent={T.signal} />
          <OutRow label="Margin"    value={fmtMoney(margin)} />
          <OutRow label="$ at Risk" value={fmtMoney(atRisk)} accent={T.bear} />
          <OutRow label="Liquidation Price"
                  value={isFinite(liqPrice) ? fmtMoney(liqPrice) : (leverage <= 1 ? 'n/a (1×)' : '—')}
                  accent={T.bear} />
        </div>
      </div>
    );
  }

  // --------------------------------------------------------------------
  // Main modal
  // --------------------------------------------------------------------
  function TRSizingPanel({ open, onClose }) {
    const [state, setState] = React.useState(() => {
      const loaded = loadState();
      if (!loaded) return DEFAULT_STATE;
      return {
        ...DEFAULT_STATE,
        ...loaded,
        stock:   { ...DEFAULT_STATE.stock,   ...(loaded.stock   || {}) },
        options: { ...DEFAULT_STATE.options, ...(loaded.options || {}) },
        crypto:  { ...DEFAULT_STATE.crypto,  ...(loaded.crypto  || {}) },
      };
    });

    React.useEffect(() => { saveState(state); }, [state]);

    if (!open) return null;

    const setTab = (k) => setState(s => ({ ...s, activeTab: k }));
    const updateStock   = (patch) => setState(s => ({ ...s, stock:   { ...s.stock,   ...patch } }));
    const updateOptions = (patch) => setState(s => ({ ...s, options: { ...s.options, ...patch } }));
    const updateCrypto  = (patch) => setState(s => ({ ...s, crypto:  { ...s.crypto,  ...patch } }));

    const activeRisk = (state[state.activeTab] || {}).risk;

    return (
      <div onClick={onClose} style={{
        position: 'fixed', inset: 0, background: 'rgba(7,9,12,0.8)',
        backdropFilter: 'blur(12px) saturate(150%)',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        zIndex: 120, padding: 40,
      }}>
        <div onClick={e => e.stopPropagation()} style={{
          width: 540, maxHeight: '92%', overflow: 'auto',
          display: 'flex', flexDirection: 'column',
          background: T.ink100, border: `1px solid ${T.edgeHi}`, borderRadius: 14,
          color: T.text,
          fontFamily: T.ui,
          boxShadow: '0 24px 80px rgba(0,0,0,0.6)',
        }}>
          {/* Header */}
          <div style={{
            padding: '16px 20px 12px 20px',
            borderBottom: `1px solid ${T.edge}`,
            display: 'flex', alignItems: 'center', gap: 12,
          }}>
            <div style={{
              fontSize: 10, letterSpacing: 1.2, color: T.textDim,
              textTransform: 'uppercase', fontWeight: 600,
            }}>
              Position Sizing
            </div>
            <div style={{
              padding: '2px 8px', fontFamily: T.mono, fontSize: 9.5, fontWeight: 600,
              letterSpacing: 0.6, color: T.signal,
              background: 'rgba(201,162,39,0.10)',
              borderRadius: 4, border: '0.5px solid rgba(201,162,39,0.4)',
            }}>
              RISK CALCULATOR
            </div>
            <div onClick={onClose} style={{
              marginLeft: 'auto',
              padding: '4px 10px', fontSize: 11, fontWeight: 600,
              color: T.textMid, cursor: 'pointer',
              border: `1px solid ${T.edge}`, borderRadius: 5,
              background: T.ink200,
            }}>Close</div>
          </div>

          {/* Tabs */}
          <div style={{
            padding: '12px 20px 0 20px',
            display: 'flex', gap: 8,
          }}>
            <Tab label="Stock / ETF"       active={state.activeTab === 'stock'}   onClick={() => setTab('stock')} />
            <Tab label="Options Contract"  active={state.activeTab === 'options'} onClick={() => setTab('options')} />
            <Tab label="Crypto Position"   active={state.activeTab === 'crypto'}  onClick={() => setTab('crypto')} />
          </div>

          {/* Body */}
          <div style={{ padding: '14px 20px 20px 20px' }}>
            <RiskGuide risk={activeRisk} />
            {state.activeTab === 'stock'   ? <StockPane   s={state.stock}   update={updateStock}   /> : null}
            {state.activeTab === 'options' ? <OptionsPane s={state.options} update={updateOptions} /> : null}
            {state.activeTab === 'crypto'  ? <CryptoPane  s={state.crypto}  update={updateCrypto}  /> : null}
          </div>

          {/* Footer */}
          <div style={{
            padding: '10px 20px',
            borderTop: `1px solid ${T.edge}`,
            fontSize: 10, fontFamily: T.mono, color: T.textDim,
            letterSpacing: 0.4,
          }}>
            Inputs auto-saved · key {LS_KEY}
          </div>
        </div>
      </div>
    );
  }

  window.TRSizingPanel = TRSizingPanel;
})();
