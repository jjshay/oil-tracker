// tr-cmdk.jsx — TradeRadar Cmd+K command palette.
//
// Exposes:
//   window.TRCmdK           — React component ({ open, onClose, onNav })
//   window.openTRCmdK()     — dispatches CustomEvent('tr:open-cmdk')
//
// The coordinator in index.html mounts <TRCmdK open={...} onClose={...} onNav={setTab} />
// and wires a keydown listener for ⌘K / Ctrl+K plus a listener for the
// custom event. This file is pure UI + fuzzy search — no side effects at
// mount time beyond attaching the globals.
//
// Search corpus:
//   - window.TR_TABS_META      → every tab (jump)
//   - POPULAR_TICKERS          → SPY/QQQ/NVDA/TSLA/MSTR/COIN/IBIT/BTC/ETH/SOL
//   - STATIC_ACTIONS           → settings / options / trade / flights / alerts / refresh

(function () {
  const POPULAR_TICKERS = [
    { sym: 'SPY',  name: 'S&P 500 ETF'            },
    { sym: 'QQQ',  name: 'Nasdaq 100 ETF'         },
    { sym: 'NVDA', name: 'NVIDIA'                 },
    { sym: 'TSLA', name: 'Tesla'                  },
    { sym: 'MSTR', name: 'MicroStrategy'          },
    { sym: 'COIN', name: 'Coinbase'               },
    { sym: 'IBIT', name: 'iShares Bitcoin Trust'  },
    { sym: 'BTC',  name: 'Bitcoin'                },
    { sym: 'ETH',  name: 'Ethereum'               },
    { sym: 'SOL',  name: 'Solana'                 },
  ];

  const STATIC_ACTIONS = [
    {
      key: 'act:settings',
      icon: '⚙',
      label: 'Open Settings',
      hint: 'API keys · Telegram · refresh',
      keywords: 'settings config keys gear preferences',
      run: ({ onClose }) => { if (window.openTRSettings) window.openTRSettings(); onClose && onClose(); },
    },
    {
      key: 'act:options',
      icon: '⚡',
      label: 'Open Options Chain',
      hint: 'Tradier chain modal',
      keywords: 'options chain tradier calls puts strike',
      run: ({ onClose }) => { if (window.openTROptions) window.openTROptions(); onClose && onClose(); },
    },
    {
      key: 'act:trade',
      icon: '⚡',
      label: 'Open Trade Ticket',
      hint: 'Tradier order entry',
      keywords: 'trade order ticket buy sell tradier',
      run: ({ onClose }) => { if (window.openTRTrade) window.openTRTrade(); onClose && onClose(); },
    },
    {
      key: 'act:flights',
      icon: '✈',
      label: 'Open Flight Tracker',
      hint: 'CENTCOM ADS-B radar',
      keywords: 'flights military centcom adsb opensky radar',
      run: ({ onNav, onClose }) => { onNav && onNav('flights'); onClose && onClose(); },
    },
    {
      key: 'act:alerts',
      icon: '🔔',
      label: 'Open Alerts',
      hint: 'Telegram signal rules',
      keywords: 'alerts telegram notifications rules signal',
      run: ({ onClose }) => { if (window.openTRAlerts) window.openTRAlerts(); onClose && onClose(); },
    },
    {
      key: 'act:congress', icon: '🏛', label: 'Congress Trading', hint: 'Pelosi / Vance / Crenshaw filings',
      keywords: 'congress pelosi capitol trades politicians stock disclosure',
      run: ({ onClose }) => { if (window.openTRCongress) window.openTRCongress(); onClose && onClose(); },
    },
    {
      key: 'act:prediction', icon: '🎯', label: 'Prediction Markets', hint: 'Kalshi + Polymarket live odds',
      keywords: 'prediction kalshi polymarket fed odds election bet',
      run: ({ onClose }) => { if (window.openTRPrediction) window.openTRPrediction(); onClose && onClose(); },
    },
    {
      key: 'act:tanker', icon: '🚢', label: 'Tanker Tracker', hint: 'Strait of Hormuz shipping',
      keywords: 'tanker ship hormuz oil vlcc ais marine',
      run: ({ onClose }) => { if (window.openTRTanker) window.openTRTanker(); onClose && onClose(); },
    },
    {
      key: 'act:etf', icon: '💰', label: 'ETF Flows', hint: 'BTC + ETH daily net by issuer',
      keywords: 'etf flows ibit fbtc farside bitcoin ethereum',
      run: ({ onClose }) => { if (window.openTRETF) window.openTRETF(); onClose && onClose(); },
    },
    {
      key: 'act:funding', icon: '📊', label: 'Funding Rates', hint: 'Cross-exchange BTC/ETH perp funding',
      keywords: 'funding perp binance bybit okx dydx rate',
      run: ({ onClose }) => { if (window.openTRFunding) window.openTRFunding(); onClose && onClose(); },
    },
    // ────── Macro / Fed ──────
    { key: 'act:fred',      icon: '📉', label: 'FRED Macro',        hint: '10 Fed / macro series dashboard',
      keywords: 'fred macro fed funds dxy m2 yield treasury',
      run: ({ onClose }) => { if (window.openTRFRED) window.openTRFRED(); onClose && onClose(); } },
    { key: 'act:treasury',  icon: '💵', label: 'Treasury Auctions', hint: 'Recent auctions + yield curve',
      keywords: 'treasury auction yield curve bid cover tail',
      run: ({ onClose }) => { if (window.openTRTreasury) window.openTRTreasury(); onClose && onClose(); } },
    { key: 'act:cot',       icon: '📋', label: 'COT Report',        hint: 'CFTC speculator positioning',
      keywords: 'cot cftc commitments positioning speculator',
      run: ({ onClose }) => { if (window.openTRCOT) window.openTRCOT(); onClose && onClose(); } },
    { key: 'act:recession', icon: '⚠',  label: 'Recession Model',   hint: 'NY Fed prob + yield curve + LEI',
      keywords: 'recession ny fed yield curve lei probability',
      run: ({ onClose }) => { if (window.openTRRecession) window.openTRRecession(); onClose && onClose(); } },
    { key: 'act:cb',        icon: '🏦', label: 'Central Bank Speeches', hint: 'Fed / ECB / BOJ / BOE / BIS',
      keywords: 'central bank speech fed ecb boj boe bis powell lagarde',
      run: ({ onClose }) => { if (window.openTRCB) window.openTRCB(); onClose && onClose(); } },
    // ────── Crypto derivatives / on-chain ──────
    { key: 'act:liq',       icon: '💥', label: 'Liquidations',      hint: 'BTC/ETH liq heatmap',
      keywords: 'liquidations liq heatmap squeeze leverage',
      run: ({ onClose }) => { if (window.openTRLiq) window.openTRLiq(); onClose && onClose(); } },
    { key: 'act:deribit',   icon: '📐', label: 'Deribit Options',   hint: 'DVOL, skew, term structure',
      keywords: 'deribit options dvol skew term structure iv',
      run: ({ onClose }) => { if (window.openTRDeribit) window.openTRDeribit(); onClose && onClose(); } },
    { key: 'act:stables',   icon: '🪙', label: 'Stablecoin Supply', hint: 'USDT + USDC mint/burn',
      keywords: 'stablecoin usdt usdc dai mint burn supply',
      run: ({ onClose }) => { if (window.openTRStables) window.openTRStables(); onClose && onClose(); } },
    { key: 'act:reserves',  icon: '🏦', label: 'Exchange Reserves', hint: 'BTC held on exchanges',
      keywords: 'exchange reserves btc binance coinbase accumulation',
      run: ({ onClose }) => { if (window.openTRReserves) window.openTRReserves(); onClose && onClose(); } },
    { key: 'act:defi',      icon: '🔗', label: 'DeFi TVL',          hint: 'Protocol + chain TVL',
      keywords: 'defi tvl lido aave uniswap ethereum solana',
      run: ({ onClose }) => { if (window.openTRDeFi) window.openTRDeFi(); onClose && onClose(); } },
    { key: 'act:ethstaking',icon: '🔷', label: 'ETH Staking',       hint: 'Validators + LSD breakdown',
      keywords: 'eth staking validator lido rocket pool lsd',
      run: ({ onClose }) => { if (window.openTRETHStaking) window.openTRETHStaking(); onClose && onClose(); } },
    { key: 'act:alt',       icon: '🚀', label: 'Altcoin Flow',      hint: 'Gainers / losers / trending',
      keywords: 'alt altcoin gainers losers trending dominance',
      run: ({ onClose }) => { if (window.openTRAlt) window.openTRAlt(); onClose && onClose(); } },
    // ────── OSINT / geo ──────
    { key: 'act:disasters', icon: '🌋', label: 'Disasters',         hint: 'Earthquakes + wildfires + GDACS',
      keywords: 'disaster earthquake wildfire fire usgs nasa firms',
      run: ({ onClose }) => { if (window.openTRDisasters) window.openTRDisasters(); onClose && onClose(); } },
    { key: 'act:gdelt',     icon: '🌐', label: 'GDELT Events',      hint: 'Real-time geopolitical event feed',
      keywords: 'gdelt events geopolitical conflict tone goldstein',
      run: ({ onClose }) => { if (window.openTRGDELT) window.openTRGDELT(); onClose && onClose(); } },
    { key: 'act:weather',   icon: '🌀', label: 'Weather & Hurricanes', hint: 'NOAA alerts + NHC tracker',
      keywords: 'weather hurricane noaa nhc gulf natgas storm',
      run: ({ onClose }) => { if (window.openTRWeather) window.openTRWeather(); onClose && onClose(); } },
    { key: 'act:shipping',  icon: '⚓', label: 'Shipping Chokepoints', hint: 'Panama / Suez / BDI',
      keywords: 'shipping panama suez bdi baltic dry chokepoint',
      run: ({ onClose }) => { if (window.openTRShipping) window.openTRShipping(); onClose && onClose(); } },
    { key: 'act:opec',      icon: '🛢', label: 'OPEC Production',   hint: 'OPEC+ by country + SPR + rig count',
      keywords: 'opec production saudi russia iraq iran spr rig',
      run: ({ onClose }) => { if (window.openTROPEC) window.openTROPEC(); onClose && onClose(); } },
    // ────── Equities / filings ──────
    { key: 'act:insider',   icon: '👤', label: 'Insider Trading',   hint: 'Form 4 filings (Finnhub)',
      keywords: 'insider form 4 ceo cfo buy sell finnhub',
      run: ({ onClose }) => { if (window.openTRInsider) window.openTRInsider(); onClose && onClose(); } },
    { key: 'act:13f',       icon: '🐋', label: '13F Hedge Funds',   hint: 'Berkshire, Bridgewater, Citadel…',
      keywords: '13f hedge fund berkshire bridgewater citadel sec',
      run: ({ onClose }) => { if (window.openTR13F) window.openTR13F(); onClose && onClose(); } },
    { key: 'act:wsb',       icon: '🦍', label: 'r/wallstreetbets',  hint: 'Top ticker leaderboard',
      keywords: 'wsb wallstreetbets reddit sentiment meme',
      run: ({ onClose }) => { if (window.openTRWSB) window.openTRWSB(); onClose && onClose(); } },
    { key: 'act:gtrends',   icon: '🔍', label: 'Public Interest',   hint: 'Wikipedia pageviews + Google Trends',
      keywords: 'google trends wikipedia pageviews search interest',
      run: ({ onClose }) => { if (window.openTRTrends) window.openTRTrends(); onClose && onClose(); } },
    { key: 'act:earnings',  icon: '📈', label: 'Earnings',          hint: 'Upcoming + recent beats/misses',
      keywords: 'earnings eps whisper beats surprise finnhub',
      run: ({ onClose }) => { if (window.openTREarnings) window.openTREarnings(); onClose && onClose(); } },
    {
      key: 'act:refresh',
      icon: '↻',
      label: 'Refresh',
      hint: 'Reload page',
      keywords: 'refresh reload reset',
      run: ({ onClose }) => { onClose && onClose(); try { window.location.reload(); } catch (_) {} },
    },
  ];

  // Fuzzy scorer — simple token-contains + character-sequence bonus. Returns
  // a numeric score; higher is better. Returns -1 for non-matches.
  function fuzzyScore(query, candidate) {
    if (!query) return 0; // neutral — ranked by original order
    const q = query.toLowerCase().trim();
    const c = (candidate || '').toLowerCase();
    if (!c) return -1;
    if (c === q) return 1000;
    if (c.startsWith(q)) return 500 - (c.length - q.length);
    const idx = c.indexOf(q);
    if (idx !== -1) return 200 - idx;
    // Character subsequence check
    let ci = 0;
    for (let qi = 0; qi < q.length; qi++) {
      const ch = q[qi];
      const found = c.indexOf(ch, ci);
      if (found === -1) return -1;
      ci = found + 1;
    }
    return 50 - (c.length - q.length);
  }

  function buildItems() {
    const items = [];
    const tabs = (window.TR_TABS_META && Array.isArray(window.TR_TABS_META)) ? window.TR_TABS_META : [];
    tabs.forEach(t => {
      items.push({
        key: 'tab:' + t.key,
        icon: '▸',
        label: 'Jump to ' + t.label,
        hint: 'tab · ' + t.key,
        keywords: ('tab navigate jump ' + t.label + ' ' + t.key).toLowerCase(),
        run: ({ onNav, onClose }) => { onNav && onNav(t.key); onClose && onClose(); },
      });
    });
    POPULAR_TICKERS.forEach(tk => {
      items.push({
        key: 'tk:' + tk.sym,
        icon: '$',
        label: tk.sym,
        hint: tk.name,
        keywords: (tk.sym + ' ' + tk.name).toLowerCase(),
        run: ({ onClose }) => {
          // Try options chain for equities; for crypto jump to Prices tab.
          const isCrypto = ['BTC', 'ETH', 'SOL'].includes(tk.sym);
          if (isCrypto) {
            // fall back to prices tab
            const onNav = window.__TR_CMDK_ON_NAV;
            if (onNav) onNav('prices');
          } else if (window.openTROptions) {
            window.openTROptions(tk.sym);
          }
          onClose && onClose();
        },
      });
    });
    STATIC_ACTIONS.forEach(a => items.push(a));
    return items;
  }

  function scoreItem(query, item) {
    if (!query) return 0;
    const fields = [item.label, item.hint, item.keywords];
    let best = -1;
    for (const f of fields) {
      const s = fuzzyScore(query, f);
      if (s > best) best = s;
    }
    return best;
  }

  function TRCmdK({ open, onClose, onNav }) {
    const T = {
      ink000: '#07090C', ink100: '#0B0E13', ink200: '#10141B', ink300: '#171C24',
      edge: 'rgba(255,255,255,0.06)', edgeHi: 'rgba(255,255,255,0.10)',
      text: '#ffffff', textMid: 'rgba(180,188,200,0.75)', textDim: 'rgba(130,138,150,0.55)',
      signal: '#c9a227',
      mono: '"JetBrains Mono", ui-monospace, "SF Mono", Menlo, Consolas, monospace',
    };

    const [query, setQuery] = React.useState('');
    const [activeIdx, setActiveIdx] = React.useState(0);
    const inputRef = React.useRef(null);
    const listRef = React.useRef(null);

    // Stash onNav globally so cross-action handlers (crypto ticker) can route.
    React.useEffect(() => {
      if (onNav) window.__TR_CMDK_ON_NAV = onNav;
    }, [onNav]);

    // Reset state + focus when opened.
    React.useEffect(() => {
      if (open) {
        setQuery('');
        setActiveIdx(0);
        // Defer focus to after the modal renders.
        setTimeout(() => {
          if (inputRef.current) {
            try { inputRef.current.focus(); } catch (_) {}
          }
        }, 10);
      }
    }, [open]);

    const items = React.useMemo(() => buildItems(), []);
    const results = React.useMemo(() => {
      if (!query.trim()) return items.slice(0, 40);
      const scored = items
        .map(it => ({ item: it, score: scoreItem(query, it) }))
        .filter(x => x.score >= 0)
        .sort((a, b) => b.score - a.score)
        .slice(0, 40)
        .map(x => x.item);
      return scored;
    }, [query, items]);

    // Clamp active index whenever results shrink.
    React.useEffect(() => {
      if (activeIdx >= results.length) setActiveIdx(Math.max(0, results.length - 1));
    }, [results.length, activeIdx]);

    function runItem(item) {
      if (!item || typeof item.run !== 'function') return;
      try { item.run({ onNav, onClose }); } catch (_) { onClose && onClose(); }
    }

    function handleKeyDown(e) {
      if (e.key === 'Escape') {
        e.preventDefault();
        onClose && onClose();
      } else if (e.key === 'ArrowDown') {
        e.preventDefault();
        setActiveIdx(i => Math.min(results.length - 1, i + 1));
      } else if (e.key === 'ArrowUp') {
        e.preventDefault();
        setActiveIdx(i => Math.max(0, i - 1));
      } else if (e.key === 'Enter') {
        e.preventDefault();
        const item = results[activeIdx];
        if (item) runItem(item);
      }
    }

    // Keep the active row scrolled into view.
    React.useEffect(() => {
      const root = listRef.current;
      if (!root) return;
      const el = root.querySelector(`[data-idx="${activeIdx}"]`);
      if (el && typeof el.scrollIntoView === 'function') {
        try { el.scrollIntoView({ block: 'nearest' }); } catch (_) {}
      }
    }, [activeIdx, results.length]);

    if (!open) return null;

    return (
      <div onClick={onClose} style={{
        position: 'fixed', inset: 0, background: 'rgba(7,9,12,0.82)',
        backdropFilter: 'blur(14px) saturate(150%)',
        display: 'flex', alignItems: 'flex-start', justifyContent: 'center',
        zIndex: 200, padding: '14vh 40px 40px',
      }}>
        <div onClick={e => e.stopPropagation()} style={{
          width: 640, maxHeight: '72vh', display: 'flex', flexDirection: 'column',
          background: T.ink100, border: `1px solid ${T.edgeHi}`, borderRadius: 14,
          color: T.text, fontFamily: '"Inter Tight", system-ui, sans-serif',
          boxShadow: '0 24px 80px rgba(0,0,0,0.65)', overflow: 'hidden',
        }}>
          {/* Search */}
          <div style={{
            display: 'flex', alignItems: 'center', gap: 10,
            padding: '14px 18px', borderBottom: `1px solid ${T.edge}`,
          }}>
            <span style={{ color: T.signal, fontFamily: T.mono, fontSize: 13, fontWeight: 600 }}>⌘K</span>
            <input
              ref={inputRef}
              value={query}
              onChange={e => { setQuery(e.target.value); setActiveIdx(0); }}
              onKeyDown={handleKeyDown}
              placeholder="Jump to a tab, ticker, or action…"
              style={{
                flex: 1, height: 28, padding: '0 4px',
                background: 'transparent', border: 'none', outline: 'none',
                color: T.text, fontFamily: '"Inter Tight", system-ui, sans-serif',
                fontSize: 15, letterSpacing: 0.2,
              }}
            />
            <span style={{ fontFamily: T.mono, fontSize: 10, color: T.textDim, letterSpacing: 0.5 }}>
              ↑↓ ENTER ESC
            </span>
          </div>

          {/* Results */}
          <div ref={listRef} style={{ flex: 1, overflow: 'auto', padding: '6px 0' }}>
            {results.length === 0 && (
              <div style={{
                padding: '26px 18px', color: T.textDim, fontFamily: T.mono,
                fontSize: 12, textAlign: 'center', letterSpacing: 0.4,
              }}>
                No matches
              </div>
            )}
            {results.map((item, idx) => {
              const active = idx === activeIdx;
              return (
                <div
                  key={item.key}
                  data-idx={idx}
                  onMouseEnter={() => setActiveIdx(idx)}
                  onClick={() => runItem(item)}
                  style={{
                    display: 'flex', alignItems: 'center', gap: 12,
                    padding: '9px 18px', cursor: 'pointer',
                    background: active ? T.ink300 : 'transparent',
                    borderLeft: `2px solid ${active ? T.signal : 'transparent'}`,
                  }}
                >
                  <span style={{
                    width: 22, display: 'inline-flex', justifyContent: 'center',
                    color: active ? T.signal : T.textMid, fontFamily: T.mono, fontSize: 13,
                  }}>{item.icon}</span>
                  <span style={{
                    flex: 1, fontSize: 13.5, color: active ? T.text : T.textMid, fontWeight: active ? 500 : 400,
                  }}>{item.label}</span>
                  {item.hint && (
                    <span style={{
                      fontFamily: T.mono, fontSize: 10.5, color: T.textDim, letterSpacing: 0.3,
                    }}>{item.hint}</span>
                  )}
                </div>
              );
            })}
          </div>

          {/* Footer */}
          <div style={{
            padding: '8px 16px', borderTop: `1px solid ${T.edge}`,
            fontFamily: T.mono, fontSize: 10, color: T.textDim, letterSpacing: 0.4,
            display: 'flex', justifyContent: 'space-between',
          }}>
            <span>{results.length} result{results.length === 1 ? '' : 's'}</span>
            <span>Cmd+K TradeRadar</span>
          </div>
        </div>
      </div>
    );
  }

  window.TRCmdK = TRCmdK;
  window.openTRCmdK = function openTRCmdK() {
    try { window.dispatchEvent(new CustomEvent('tr:open-cmdk')); } catch (_) {}
  };
})();
