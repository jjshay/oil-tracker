// tr-panel-launcher.jsx — TradeRadar Panel Launcher.
//
// A full-screen, visually-refined picker that surfaces all 27 intelligence
// panels so users don't need to know Cmd+K to discover them.
//
// Exposes:
//   window.TRPanelLauncher         — React component ({ open, onClose })
//   window.openTRPanelLauncher()   — dispatches CustomEvent('tr:open-launcher')
//   window.TRPanelLauncherButton   — tiny ⬚ button that matches TRGearInline style
//
// Coordinator wires mounting + button placement separately. This file only
// attaches globals + UI logic; no side-effects at mount time.
//
// Keyboard:
//   /  or  Cmd+Shift+P     — listener wired by coordinator; we just handle the
//                            modal-level keys (Up/Down/Enter/Escape).
//   Escape                 — close
//   Up/Down                — navigate cards
//   Enter                  — open selected card

(function () {

  // ------------------------------------------------------------------
  // Design palette (matches tr-cmdk / tr-header-extras)
  // ------------------------------------------------------------------
  const T = {
    ink000: '#07090C', ink100: '#0B0E13', ink200: '#10141B', ink300: '#171C24',
    edge: 'rgba(255,255,255,0.06)', edgeHi: 'rgba(255,255,255,0.10)',
    text: '#ffffff', textMid: 'rgba(180,188,200,0.75)', textDim: 'rgba(130,138,150,0.55)',
    signal: '#c9a227', bull: '#6FCF8E', amber: '#E0A83A', bear: '#D96B6B',
    mono: '"JetBrains Mono", ui-monospace, "SF Mono", Menlo, Consolas, monospace',
    ui: '"Inter Tight", system-ui, -apple-system, Segoe UI, sans-serif',
  };

  // ------------------------------------------------------------------
  // Panel registry — all 27 panels.
  //
  // status computation:
  //   engineGlobal  — optional window global we expect to be defined when the
  //                   underlying engine is loaded. If missing → gray.
  //   requiredKey   — optional path under TR_SETTINGS.keys; if the key is
  //                   missing → amber ("needs key"). Otherwise → green (live).
  //                   If no requiredKey is declared and engine is present → green.
  // ------------------------------------------------------------------
  const PANELS = [
    // ────── Tools ──────
    { key: 'settings',   category: 'Tools',    icon: '⚙', name: 'Settings',
      desc: 'API keys · Telegram · refresh cadence',
      keywords: 'settings config keys preferences gear',
      opener: 'openTRSettings' },
    { key: 'options',    category: 'Tools',    icon: '⚡', name: 'Options Chain',
      desc: 'Tradier calls / puts by strike + expiry',
      keywords: 'options chain tradier calls puts strike iv',
      opener: 'openTROptions', engineGlobal: 'TradierAPI', requiredKey: 'tradier' },
    { key: 'trade',      category: 'Tools',    icon: '⚡', name: 'Trade Ticket',
      desc: 'Tradier order entry — buy / sell',
      keywords: 'trade order ticket buy sell tradier',
      opener: 'openTRTrade', engineGlobal: 'TradierAPI', requiredKey: 'tradier' },
    { key: 'alerts',     category: 'Tools',    icon: '🔔', name: 'Alerts',
      desc: 'Telegram signal rules + triggers',
      keywords: 'alerts telegram notifications signal triggers',
      opener: 'openTRAlerts', requiredKey: 'telegramBot' },
    { key: 'prediction_t', category: 'Tools',  icon: '🎯', name: 'Prediction Markets',
      desc: 'Kalshi + Polymarket live odds (politics)',
      keywords: 'prediction kalshi polymarket politics election bet fed odds',
      opener: 'openTRPrediction' },
    { key: 'sizing',     category: 'Tools',    icon: '🧮', name: 'Position Sizing',
      desc: 'Stock · options · crypto risk calc',
      keywords: 'sizing risk position calculator stop loss leverage shares contracts kelly',
      opener: 'openTRSizing' },
    { key: 'correlation',category: 'Tools',    icon: '🔗', name: 'Correlation Matrix',
      desc: 'BTC · SPY · QQQ · GLD · DXY · TLT (30d)',
      keywords: 'correlation matrix heatmap btc spy qqq gold dxy tlt pearson risk-on risk-off',
      opener: 'openTRCorrelation' },
    { key: 'scenarios',  category: 'Tools',    icon: '🎬', name: 'Scenario Playbook',
      desc: 'If/then pre-computed catalyst impacts',
      keywords: 'scenarios playbook if then hormuz fed cpi opec taiwan catalyst',
      opener: 'openTRScenarios' },

    // ────── Macro ──────
    { key: 'fred',       category: 'Macro',    icon: '📉', name: 'FRED Macro',
      desc: '10 Fed / macro series dashboard',
      keywords: 'fred macro fed funds dxy m2 yield treasury',
      opener: 'openTRFRED', requiredKey: 'fred' },
    { key: 'treasury',   category: 'Macro',    icon: '💵', name: 'Treasury Auctions',
      desc: 'Recent auctions + yield curve',
      keywords: 'treasury auction yield curve bid cover tail',
      opener: 'openTRTreasury' },
    { key: 'cot',        category: 'Macro',    icon: '📋', name: 'COT Report',
      desc: 'CFTC speculator positioning',
      keywords: 'cot cftc commitments positioning speculator',
      opener: 'openTRCOT' },
    { key: 'recession',  category: 'Macro',    icon: '⚠', name: 'Recession Model',
      desc: 'NY Fed prob + yield curve + LEI',
      keywords: 'recession ny fed yield curve lei probability',
      opener: 'openTRRecession', requiredKey: 'fred' },
    { key: 'cb',         category: 'Macro',    icon: '🏦', name: 'Central Bank Speeches',
      desc: 'Fed / ECB / BOJ / BOE / BIS',
      keywords: 'central bank speech fed ecb boj boe bis powell lagarde',
      opener: 'openTRCB' },

    // ────── Crypto ──────
    { key: 'etf',        category: 'Crypto',   icon: '💰', name: 'ETF Flows',
      desc: 'BTC + ETH daily net by issuer',
      keywords: 'etf flows ibit fbtc farside bitcoin ethereum',
      opener: 'openTRETF' },
    { key: 'funding',    category: 'Crypto',   icon: '📊', name: 'Funding Rates',
      desc: 'Cross-exchange BTC/ETH perp funding',
      keywords: 'funding perp binance bybit okx dydx rate',
      opener: 'openTRFunding' },
    { key: 'liq',        category: 'Crypto',   icon: '💥', name: 'Liquidations',
      desc: 'BTC/ETH liquidation heatmap',
      keywords: 'liquidations liq heatmap squeeze leverage',
      opener: 'openTRLiq' },
    { key: 'deribit',    category: 'Crypto',   icon: '📐', name: 'Deribit Options',
      desc: 'DVOL · skew · term structure',
      keywords: 'deribit options dvol skew term structure iv',
      opener: 'openTRDeribit' },
    { key: 'stables',    category: 'Crypto',   icon: '🪙', name: 'Stablecoin Supply',
      desc: 'USDT + USDC mint / burn',
      keywords: 'stablecoin usdt usdc dai mint burn supply',
      opener: 'openTRStables' },
    { key: 'reserves',   category: 'Crypto',   icon: '🏦', name: 'Exchange Reserves',
      desc: 'BTC / ETH held on exchanges',
      keywords: 'exchange reserves btc binance coinbase accumulation',
      opener: 'openTRReserves' },
    { key: 'defi',       category: 'Crypto',   icon: '🔗', name: 'DeFi TVL',
      desc: 'Protocol + chain TVL',
      keywords: 'defi tvl lido aave uniswap ethereum solana',
      opener: 'openTRDeFi' },
    { key: 'ethstaking', category: 'Crypto',   icon: '🔷', name: 'ETH Staking',
      desc: 'Validators + LSD breakdown',
      keywords: 'eth staking validator lido rocket pool lsd',
      opener: 'openTRETHStaking' },
    { key: 'alt',        category: 'Crypto',   icon: '🚀', name: 'Altcoin Flow',
      desc: 'Gainers / losers / trending',
      keywords: 'alt altcoin gainers losers trending dominance',
      opener: 'openTRAlt' },
    { key: 'prediction_c', category: 'Crypto', icon: '🎯', name: 'Prediction Markets (Crypto)',
      desc: 'Kalshi + Polymarket crypto contracts',
      keywords: 'prediction kalshi polymarket crypto btc eth odds',
      opener: 'openTRPrediction' },

    // ────── OSINT ──────
    { key: 'congress',   category: 'OSINT',    icon: '🏛', name: 'Congress Trading',
      desc: 'Pelosi · Vance · Crenshaw filings',
      keywords: 'congress pelosi capitol trades politicians stock disclosure',
      opener: 'openTRCongress' },
    { key: 'disasters',  category: 'OSINT',    icon: '🌋', name: 'Disasters',
      desc: 'Earthquakes · wildfires · GDACS',
      keywords: 'disaster earthquake wildfire fire usgs nasa firms gdacs',
      opener: 'openTRDisasters' },
    { key: 'gdelt',      category: 'OSINT',    icon: '🌐', name: 'GDELT Events',
      desc: 'Real-time geopolitical event feed',
      keywords: 'gdelt events geopolitical conflict tone goldstein',
      opener: 'openTRGDELT' },
    { key: 'weather',    category: 'OSINT',    icon: '🌀', name: 'Weather & Hurricanes',
      desc: 'NOAA alerts + NHC tracker',
      keywords: 'weather hurricane noaa nhc gulf natgas storm',
      opener: 'openTRWeather' },
    { key: 'shipping',   category: 'OSINT',    icon: '⚓', name: 'Shipping Chokepoints',
      desc: 'Panama / Suez / BDI',
      keywords: 'shipping panama suez bdi baltic dry chokepoint',
      opener: 'openTRShipping' },
    { key: 'tanker',     category: 'OSINT',    icon: '🚢', name: 'Tanker Tracker',
      desc: 'Strait of Hormuz shipping AIS',
      keywords: 'tanker ship hormuz oil vlcc ais marine',
      opener: 'openTRTanker', requiredKey: 'aishub' },
    { key: 'opec',       category: 'OSINT',    icon: '🛢', name: 'OPEC Production',
      desc: 'OPEC+ by country + SPR + rig count',
      keywords: 'opec production saudi russia iraq iran spr rig',
      opener: 'openTROPEC' },

    // ────── Equities ──────
    { key: 'insider',    category: 'Equities', icon: '👤', name: 'Insider Trading',
      desc: 'Form 4 filings (Finnhub)',
      keywords: 'insider form 4 ceo cfo buy sell finnhub',
      opener: 'openTRInsider', requiredKey: 'finnhub' },
    { key: '13f',        category: 'Equities', icon: '🐋', name: '13F Hedge Funds',
      desc: 'Berkshire · Bridgewater · Citadel',
      keywords: '13f hedge fund berkshire bridgewater citadel sec',
      opener: 'openTR13F' },
    { key: 'wsb',        category: 'Equities', icon: '🦍', name: 'r/wallstreetbets',
      desc: 'Top ticker leaderboard + sentiment',
      keywords: 'wsb wallstreetbets reddit sentiment meme',
      opener: 'openTRWSB' },
    { key: 'gtrends',    category: 'Equities', icon: '🔍', name: 'Public Interest',
      desc: 'Wikipedia pageviews + Google Trends',
      keywords: 'google trends wikipedia pageviews search interest',
      opener: 'openTRTrends' },
    { key: 'earnings',   category: 'Equities', icon: '📈', name: 'Earnings',
      desc: 'Upcoming + recent beats / misses',
      keywords: 'earnings eps whisper beats surprise finnhub',
      opener: 'openTREarnings', requiredKey: 'finnhub' },
  ];

  const CATEGORIES = ['All', 'Macro', 'Crypto', 'OSINT', 'Equities', 'Tools'];
  const HISTORY_KEY = 'tr_panel_history';
  const HISTORY_LIMIT = 8;
  const USAGE_KEY = 'tr_panel_usage_v1';
  const USAGE_TOP_N = 8;
  const USAGE_TTL_MS = 365 * 24 * 60 * 60 * 1000; // 1-year rolling
  const DEFAULT_TOP8 = ['options', 'settings', 'correlation', 'scenarios', 'sizing', 'journal', 'trade', 'alerts'];

  // ------------------------------------------------------------------
  // History helpers (localStorage)
  // ------------------------------------------------------------------
  function loadHistory() {
    try {
      const raw = localStorage.getItem(HISTORY_KEY);
      if (!raw) return [];
      const arr = JSON.parse(raw);
      if (!Array.isArray(arr)) return [];
      return arr.filter(k => typeof k === 'string').slice(0, HISTORY_LIMIT);
    } catch (_) { return []; }
  }
  function pushHistory(key) {
    try {
      const current = loadHistory().filter(k => k !== key);
      current.unshift(key);
      const next = current.slice(0, HISTORY_LIMIT);
      localStorage.setItem(HISTORY_KEY, JSON.stringify(next));
    } catch (_) {}
  }

  // ------------------------------------------------------------------
  // Usage tracking helpers (localStorage)
  //   Shape: { [panelKey]: { count: number, lastOpenedAt: epochMs } }
  // ------------------------------------------------------------------
  function loadUsage() {
    try {
      const raw = localStorage.getItem(USAGE_KEY);
      if (!raw) return {};
      const obj = JSON.parse(raw);
      if (!obj || typeof obj !== 'object') return {};
      // 1-year rolling: drop zero-count entries older than TTL. Keep live counts.
      const now = Date.now();
      const cleaned = {};
      Object.keys(obj).forEach(k => {
        const v = obj[k];
        if (!v || typeof v !== 'object') return;
        const count = Number(v.count) || 0;
        const last  = Number(v.lastOpenedAt) || 0;
        if (count <= 0 && last && (now - last) > USAGE_TTL_MS) return;
        cleaned[k] = { count, lastOpenedAt: last };
      });
      return cleaned;
    } catch (_) { return {}; }
  }
  function recordUsage(key) {
    if (!key || typeof key !== 'string') return;
    try {
      const usage = loadUsage();
      const prev = usage[key] || { count: 0, lastOpenedAt: 0 };
      usage[key] = {
        count: (Number(prev.count) || 0) + 1,
        lastOpenedAt: Date.now(),
      };
      localStorage.setItem(USAGE_KEY, JSON.stringify(usage));
    } catch (_) {}
  }
  function computeTop8(usage) {
    const entries = Object.keys(usage || {})
      .map(k => ({ key: k, count: Number((usage[k] || {}).count) || 0 }))
      .filter(e => e.count > 0)
      .sort((a, b) => b.count - a.count);
    if (entries.length >= USAGE_TOP_N) {
      return entries.slice(0, USAGE_TOP_N).map(e => ({ key: e.key, count: e.count }));
    }
    // Fallback: merge real usage with default list (real counts first, then defaults)
    const seen = new Set(entries.map(e => e.key));
    const out = entries.map(e => ({ key: e.key, count: e.count }));
    for (const dk of DEFAULT_TOP8) {
      if (out.length >= USAGE_TOP_N) break;
      if (seen.has(dk)) continue;
      out.push({ key: dk, count: (usage && usage[dk] && Number(usage[dk].count)) || 0 });
      seen.add(dk);
    }
    return out.slice(0, USAGE_TOP_N);
  }

  // Global subscriber: any part of the app can emit `tr:panel-opened`
  // and we'll bump the counter. Installs once per page.
  try {
    if (typeof window !== 'undefined' && !window.__TR_PANEL_USAGE_WIRED__) {
      window.addEventListener('tr:panel-opened', (ev) => {
        try {
          const k = ev && ev.detail && ev.detail.key;
          if (k) recordUsage(k);
        } catch (_) {}
      });
      window.__TR_PANEL_USAGE_WIRED__ = true;
    }
  } catch (_) {}

  // ------------------------------------------------------------------
  // Status resolver — returns { kind: 'live'|'needs_key'|'unknown', label }.
  // ------------------------------------------------------------------
  function resolveStatus(panel) {
    const engineOk = !panel.engineGlobal || (typeof window[panel.engineGlobal] !== 'undefined');
    if (panel.requiredKey) {
      const keys = (window.TR_SETTINGS && window.TR_SETTINGS.keys) || {};
      const has = !!keys[panel.requiredKey];
      if (!has) return { kind: 'needs_key', label: 'needs key' };
    }
    if (engineOk) return { kind: 'live', label: 'live' };
    return { kind: 'unknown', label: 'offline' };
  }

  // ------------------------------------------------------------------
  // Search scorer (borrowed pattern from tr-cmdk fuzzyScore)
  // ------------------------------------------------------------------
  function fuzzyScore(q, c) {
    if (!q) return 0;
    const query = q.toLowerCase().trim();
    const cand  = (c || '').toLowerCase();
    if (!cand) return -1;
    if (cand === query) return 1000;
    if (cand.startsWith(query)) return 500 - (cand.length - query.length);
    const idx = cand.indexOf(query);
    if (idx !== -1) return 200 - idx;
    let ci = 0;
    for (let qi = 0; qi < query.length; qi++) {
      const ch = query[qi];
      const found = cand.indexOf(ch, ci);
      if (found === -1) return -1;
      ci = found + 1;
    }
    return 50 - (cand.length - query.length);
  }
  function scorePanel(q, p) {
    if (!q) return 0;
    const fields = [p.name, p.desc, p.keywords, p.category];
    let best = -1;
    for (const f of fields) {
      const s = fuzzyScore(q, f);
      if (s > best) best = s;
    }
    return best;
  }

  // ==================================================================
  // StatusDot — colored dot + tiny mono label.
  // ==================================================================
  function StatusDot({ status }) {
    const color =
      status.kind === 'live'      ? T.bull  :
      status.kind === 'needs_key' ? T.amber :
                                    T.textDim;
    return (
      <div style={{
        display: 'inline-flex', alignItems: 'center', gap: 5,
        fontFamily: T.mono, fontSize: 9, letterSpacing: 0.5,
        color: status.kind === 'live' ? T.bull :
               status.kind === 'needs_key' ? T.amber : T.textDim,
        textTransform: 'uppercase',
      }}>
        <span style={{
          width: 6, height: 6, borderRadius: '50%',
          background: color,
          boxShadow: status.kind === 'live' ? `0 0 6px ${T.bull}` : 'none',
        }} />
        <span>{status.label}</span>
      </div>
    );
  }

  // ==================================================================
  // PanelCard
  // ==================================================================
  function PanelCard({ panel, active, onHover, onClick }) {
    const status = resolveStatus(panel);
    const borderColor = active ? T.signal : T.edgeHi;
    const lift = active ? 'translateY(-1px)' : 'translateY(0)';
    const glow = active
      ? `0 0 0 1px ${T.signal}, 0 8px 24px rgba(201,162,39,0.18)`
      : '0 2px 8px rgba(0,0,0,0.35)';
    return (
      <div
        role="button"
        tabIndex={0}
        onMouseEnter={onHover}
        onClick={onClick}
        style={{
          position: 'relative',
          display: 'flex', flexDirection: 'column', gap: 8,
          padding: '14px 14px 12px',
          background: active ? T.ink300 : T.ink200,
          border: `1px solid ${borderColor}`,
          borderRadius: 10,
          cursor: 'pointer',
          transform: lift,
          boxShadow: glow,
          transition: 'transform 160ms cubic-bezier(0.2,0.7,0.2,1), border-color 160ms cubic-bezier(0.2,0.7,0.2,1), box-shadow 160ms cubic-bezier(0.2,0.7,0.2,1), background 160ms cubic-bezier(0.2,0.7,0.2,1)',
          minHeight: 104,
          outline: 'none',
        }}
        onFocus={(e) => { e.currentTarget.style.borderColor = T.signal; }}
        onBlur={(e) => { e.currentTarget.style.borderColor = active ? T.signal : T.edgeHi; }}
      >
        <div style={{ display: 'flex', alignItems: 'flex-start', gap: 10 }}>
          <div style={{
            width: 30, height: 30, flexShrink: 0, borderRadius: 7,
            background: T.ink100, border: `1px solid ${T.edge}`,
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            fontSize: 16, lineHeight: 1,
          }}>{panel.icon}</div>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{
              fontFamily: T.ui, fontSize: 13.5, fontWeight: 600,
              color: T.text, letterSpacing: 0.1,
              whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
            }}>{panel.name}</div>
            <div style={{
              fontFamily: T.mono, fontSize: 9, color: T.textDim,
              letterSpacing: 0.6, textTransform: 'uppercase', marginTop: 2,
            }}>{panel.category}</div>
          </div>
        </div>
        <div style={{
          flex: 1,
          fontFamily: T.ui, fontSize: 11.5, lineHeight: 1.4,
          color: T.textMid,
        }}>{panel.desc}</div>
        <div style={{
          display: 'flex', alignItems: 'center', justifyContent: 'space-between',
          marginTop: 2,
        }}>
          <StatusDot status={status} />
          <span style={{
            fontFamily: T.mono, fontSize: 9, color: active ? T.signal : T.textDim,
            letterSpacing: 0.5, textTransform: 'uppercase',
          }}>{active ? '↵ open' : ''}</span>
        </div>
      </div>
    );
  }

  // ==================================================================
  // PillTabs
  // ==================================================================
  function PillTabs({ value, onChange }) {
    return (
      <div style={{
        display: 'flex', flexWrap: 'wrap', gap: 6,
        padding: '10px 18px', borderBottom: `1px solid ${T.edge}`,
      }}>
        {CATEGORIES.map(cat => {
          const sel = cat === value;
          return (
            <div key={cat} onClick={() => onChange(cat)}
              style={{
                padding: '6px 12px', borderRadius: 999,
                background: sel ? 'rgba(201,162,39,0.12)' : 'transparent',
                border: `1px solid ${sel ? T.signal : T.edge}`,
                color: sel ? T.signal : T.textMid,
                fontFamily: T.ui, fontSize: 11.5, fontWeight: 500,
                letterSpacing: 0.3, cursor: 'pointer', userSelect: 'none',
                transition: 'background 160ms cubic-bezier(0.2,0.7,0.2,1), border-color 160ms cubic-bezier(0.2,0.7,0.2,1), color 160ms cubic-bezier(0.2,0.7,0.2,1)',
              }}
              onMouseEnter={(e) => {
                if (sel) return;
                e.currentTarget.style.background = 'rgba(255,255,255,0.03)';
                e.currentTarget.style.color = T.text;
              }}
              onMouseLeave={(e) => {
                if (sel) return;
                e.currentTarget.style.background = 'transparent';
                e.currentTarget.style.color = T.textMid;
              }}>
              {cat}
            </div>
          );
        })}
      </div>
    );
  }

  // ==================================================================
  // Responsive column hook
  // ==================================================================
  function useColumns() {
    const [cols, setCols] = React.useState(
      (typeof window !== 'undefined' && window.innerWidth < 900) ? 2 : 3
    );
    React.useEffect(() => {
      const onResize = () => {
        const w = window.innerWidth || 1200;
        setCols(w < 900 ? 2 : 3);
      };
      window.addEventListener('resize', onResize);
      return () => window.removeEventListener('resize', onResize);
    }, []);
    return cols;
  }

  // ==================================================================
  // TRPanelLauncher
  // ==================================================================
  function TRPanelLauncher({ open, onClose }) {
    const [query, setQuery] = React.useState('');
    const [category, setCategory] = React.useState('All');
    const [activeIdx, setActiveIdx] = React.useState(0);
    const [history, setHistory] = React.useState(loadHistory());
    const [usage, setUsage] = React.useState(loadUsage());
    const inputRef = React.useRef(null);
    const gridRef = React.useRef(null);
    const cols = useColumns();

    // Reset on open.
    React.useEffect(() => {
      if (open) {
        setQuery('');
        setCategory('All');
        setActiveIdx(0);
        setHistory(loadHistory());
        setUsage(loadUsage());
        setTimeout(() => {
          if (inputRef.current) { try { inputRef.current.focus(); } catch (_) {} }
        }, 10);
      }
    }, [open]);

    // Live-refresh usage whenever any panel opens (from this launcher OR elsewhere).
    React.useEffect(() => {
      const onPanelOpened = () => setUsage(loadUsage());
      window.addEventListener('tr:panel-opened', onPanelOpened);
      return () => window.removeEventListener('tr:panel-opened', onPanelOpened);
    }, []);

    // Compute recents (history keys → panel objects, in order).
    const recents = React.useMemo(() => {
      const byKey = {};
      PANELS.forEach(p => { byKey[p.key] = p; });
      return history.map(k => byKey[k]).filter(Boolean);
    }, [history]);

    // Compute top-8 quick access (usage → panel objects, with count).
    const top8 = React.useMemo(() => {
      const byKey = {};
      PANELS.forEach(p => { byKey[p.key] = p; });
      return computeTop8(usage)
        .map(e => byKey[e.key] ? { panel: byKey[e.key], count: e.count } : null)
        .filter(Boolean);
    }, [usage]);

    // Filtered + sorted panels for the main grid.
    const filtered = React.useMemo(() => {
      let list = PANELS;
      if (category !== 'All') list = list.filter(p => p.category === category);
      if (query.trim()) {
        list = list
          .map(p => ({ p, score: scorePanel(query, p) }))
          .filter(x => x.score >= 0)
          .sort((a, b) => b.score - a.score)
          .map(x => x.p);
      }
      return list;
    }, [category, query]);

    // Clamp active index.
    React.useEffect(() => {
      if (activeIdx >= filtered.length) setActiveIdx(Math.max(0, filtered.length - 1));
    }, [filtered.length, activeIdx]);

    function openPanel(panel) {
      if (!panel) return;
      try {
        const fn = window[panel.opener];
        if (typeof fn === 'function') fn();
      } catch (_) {}
      pushHistory(panel.key);
      setHistory(loadHistory());
      // Notify the rest of the app + bump usage via the global subscriber.
      try {
        window.dispatchEvent(new CustomEvent('tr:panel-opened', { detail: { key: panel.key } }));
      } catch (_) {}
      // Also refresh locally (in case subscriber races with this component's unmount).
      setUsage(loadUsage());
      onClose && onClose();
    }

    function handleKeyDown(e) {
      if (e.key === 'Escape') {
        e.preventDefault();
        onClose && onClose();
        return;
      }
      if (!filtered.length) return;
      if (e.key === 'ArrowDown') {
        e.preventDefault();
        setActiveIdx(i => Math.min(filtered.length - 1, i + cols));
      } else if (e.key === 'ArrowUp') {
        e.preventDefault();
        setActiveIdx(i => Math.max(0, i - cols));
      } else if (e.key === 'ArrowRight') {
        e.preventDefault();
        setActiveIdx(i => Math.min(filtered.length - 1, i + 1));
      } else if (e.key === 'ArrowLeft') {
        e.preventDefault();
        setActiveIdx(i => Math.max(0, i - 1));
      } else if (e.key === 'Enter') {
        e.preventDefault();
        openPanel(filtered[activeIdx]);
      }
    }

    // Keep active card in view.
    React.useEffect(() => {
      const root = gridRef.current;
      if (!root) return;
      const el = root.querySelector(`[data-grid-idx="${activeIdx}"]`);
      if (el && typeof el.scrollIntoView === 'function') {
        try { el.scrollIntoView({ block: 'nearest' }); } catch (_) {}
      }
    }, [activeIdx, filtered.length]);

    if (!open) return null;

    const gridStyle = {
      display: 'grid',
      gridTemplateColumns: `repeat(${cols}, minmax(0, 1fr))`,
      gap: 12,
      padding: '14px 18px 18px',
    };

    return (
      <div onClick={onClose} onKeyDown={handleKeyDown} tabIndex={-1}
        style={{
          position: 'fixed', inset: 0,
          background: 'rgba(7,9,12,0.9)',
          backdropFilter: 'blur(14px) saturate(140%)',
          WebkitBackdropFilter: 'blur(14px) saturate(140%)',
          display: 'flex', alignItems: 'flex-start', justifyContent: 'center',
          zIndex: 210, padding: '8vh 24px 24px',
          fontFamily: T.ui, color: T.text,
        }}>
        <div onClick={e => e.stopPropagation()}
          style={{
            width: '100%', maxWidth: 920, maxHeight: '85vh',
            display: 'flex', flexDirection: 'column',
            background: T.ink100,
            border: `1px solid ${T.edgeHi}`, borderRadius: 16,
            boxShadow: '0 32px 96px rgba(0,0,0,0.7), 0 0 0 1px rgba(255,255,255,0.03)',
            overflow: 'hidden',
          }}>

          {/* Header: title + search */}
          <div style={{
            display: 'flex', alignItems: 'center', gap: 14,
            padding: '16px 18px', borderBottom: `1px solid ${T.edge}`,
          }}>
            <div style={{
              display: 'flex', alignItems: 'center', gap: 8,
              color: T.signal, fontFamily: T.mono, fontSize: 11, fontWeight: 600,
              letterSpacing: 0.8, textTransform: 'uppercase',
            }}>
              <span style={{
                display: 'inline-block', width: 12, height: 12,
                border: `1.5px solid ${T.signal}`, borderRadius: 2,
              }} />
              <span>Panels</span>
            </div>
            <input
              ref={inputRef}
              value={query}
              onChange={e => { setQuery(e.target.value); setActiveIdx(0); }}
              onKeyDown={handleKeyDown}
              placeholder="Search 27 intelligence panels…"
              onFocus={(e) => { e.currentTarget.style.borderColor = 'rgba(201,162,39,0.45)'; }}
              onBlur={(e) => { e.currentTarget.style.borderColor = T.edge; }}
              style={{
                flex: 1, height: 32, padding: '0 10px',
                background: T.ink200, border: `1px solid ${T.edge}`, borderRadius: 8,
                color: T.text, fontFamily: T.ui, fontSize: 14, outline: 'none',
                transition: 'border-color 160ms cubic-bezier(0.2,0.7,0.2,1)',
              }}
            />
            <span style={{
              fontFamily: T.mono, fontSize: 9.5, color: T.textDim, letterSpacing: 0.5,
            }}>↑↓←→ ENTER ESC</span>
          </div>

          {/* Category pill tabs */}
          <PillTabs value={category} onChange={(c) => { setCategory(c); setActiveIdx(0); }} />

          {/* Scroll body */}
          <div ref={gridRef} style={{
            flex: 1, overflow: 'auto',
          }}>
            {/* QUICK ACCESS · TOP 8 strip */}
            {top8.length > 0 && !query.trim() && category === 'All' && (
              <div style={{
                margin: '14px 18px 16px',
                padding: '10px 14px',
                background: 'rgba(201,162,39,0.05)',
                borderRadius: 10,
                border: `1px solid ${T.edge}`,
              }}>
                <div style={{
                  fontFamily: T.mono, fontSize: 9, color: T.signal,
                  letterSpacing: 0.8, textTransform: 'uppercase',
                  marginBottom: 8,
                }}>⚡ Quick Access · Top 8</div>
                <div style={{
                  display: 'flex', flexWrap: 'nowrap', gap: 8,
                  overflowX: 'auto',
                }}>
                  {top8.map(({ panel, count }) => (
                    <div
                      key={'top8-' + panel.key}
                      role="button"
                      tabIndex={0}
                      title={panel.name + (count > 0 ? ' · opened ' + count + 'x' : '')}
                      onClick={() => openPanel(panel)}
                      onMouseEnter={(e) => {
                        e.currentTarget.style.borderColor = T.edgeHi;
                        e.currentTarget.style.transform = 'scale(1.03)';
                      }}
                      onMouseLeave={(e) => {
                        e.currentTarget.style.borderColor = T.edge;
                        e.currentTarget.style.transform = 'scale(1)';
                      }}
                      style={{
                        flexShrink: 0,
                        width: 82, height: 40,
                        display: 'flex', alignItems: 'center', gap: 6,
                        padding: '0 8px',
                        background: T.ink200,
                        border: `1px solid ${T.edge}`,
                        borderRadius: 8,
                        cursor: 'pointer',
                        transition: 'border-color 140ms cubic-bezier(0.2,0.7,0.2,1), transform 140ms cubic-bezier(0.2,0.7,0.2,1)',
                        outline: 'none',
                      }}>
                      <span style={{ fontSize: 13, lineHeight: 1 }}>{panel.icon}</span>
                      <span style={{
                        flex: 1, minWidth: 0,
                        display: 'flex', flexDirection: 'column', justifyContent: 'center',
                      }}>
                        <span style={{
                          fontFamily: T.ui, fontSize: 10.5, fontWeight: 600,
                          color: T.text, lineHeight: 1.1,
                          whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
                        }}>{panel.name}</span>
                        {count > 0 && (
                          <span style={{
                            fontFamily: T.mono, fontSize: 9, color: T.textDim,
                            lineHeight: 1.1, letterSpacing: 0.3,
                          }}>{count}x</span>
                        )}
                      </span>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* Recently used */}
            {recents.length > 0 && !query.trim() && category === 'All' && (
              <div>
                <div style={{
                  padding: '14px 18px 6px',
                  fontFamily: T.mono, fontSize: 10, color: T.textDim,
                  letterSpacing: 0.8, textTransform: 'uppercase',
                }}>Recently used</div>
                <div style={gridStyle}>
                  {recents.map((p) => (
                    <PanelCard
                      key={'rec-' + p.key}
                      panel={p}
                      active={false}
                      onHover={() => {}}
                      onClick={() => openPanel(p)}
                    />
                  ))}
                </div>
                <div style={{
                  height: 1, background: T.edge, margin: '6px 18px 0',
                }} />
              </div>
            )}

            {/* Main grid */}
            <div style={{
              padding: '14px 18px 6px',
              fontFamily: T.mono, fontSize: 10, color: T.textDim,
              letterSpacing: 0.8, textTransform: 'uppercase',
            }}>
              {query.trim() ? `Results (${filtered.length})`
                : category === 'All' ? `All panels (${filtered.length})`
                : `${category} (${filtered.length})`}
            </div>
            {filtered.length === 0 && (
              <div style={{
                padding: '40px 18px', textAlign: 'center',
                fontFamily: T.mono, fontSize: 12, color: T.textDim,
              }}>No panels match.</div>
            )}
            {filtered.length > 0 && (
              <div style={gridStyle}>
                {filtered.map((p, idx) => (
                  <div key={p.key} data-grid-idx={idx}>
                    <PanelCard
                      panel={p}
                      active={idx === activeIdx}
                      onHover={() => setActiveIdx(idx)}
                      onClick={() => openPanel(p)}
                    />
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* Footer */}
          <div style={{
            padding: '10px 18px', borderTop: `1px solid ${T.edge}`,
            fontFamily: T.mono, fontSize: 10, color: T.textDim, letterSpacing: 0.4,
            display: 'flex', justifyContent: 'space-between', alignItems: 'center',
          }}>
            <span>{PANELS.length} panels · {recents.length} recent</span>
            <span>/ or ⌘⇧P · TradeRadar</span>
          </div>
        </div>
      </div>
    );
  }

  // ==================================================================
  // TRPanelLauncherButton — ⬚ icon matching TRGearInline btn style.
  // ==================================================================
  function TRPanelLauncherButton() {
    return (
      <div
        onClick={() => window.openTRPanelLauncher && window.openTRPanelLauncher()}
        title="Panel Launcher (/ or ⌘⇧P)"
        style={{
          width: 28, height: 28, borderRadius: 7,
          background: '#10141B', border: '1px solid rgba(255,255,255,0.08)',
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          cursor: 'pointer', color: 'rgba(180,188,200,0.75)',
          fontFamily: '"JetBrains Mono", ui-monospace, monospace',
          fontSize: 14, fontWeight: 600, lineHeight: 1,
        }}>
        <span style={{
          display: 'inline-block', width: 13, height: 13,
          border: '1.5px solid currentColor', borderRadius: 2,
        }} />
      </div>
    );
  }

  // ------------------------------------------------------------------
  // Globals
  // ------------------------------------------------------------------
  window.TRPanelLauncher = TRPanelLauncher;
  window.TRPanelLauncherButton = TRPanelLauncherButton;
  window.openTRPanelLauncher = function openTRPanelLauncher() {
    try { window.dispatchEvent(new CustomEvent('tr:open-launcher')); } catch (_) {}
  };
})();
