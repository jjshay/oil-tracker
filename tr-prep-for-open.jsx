// tr-prep-for-open.jsx — TradeRadar "Prep Me For Open" morning ritual.
//
// One-click routine that warms the dashboard before market open:
//   1. Refresh crypto prices (LiveData.getCryptoPrices)
//   2. Refresh Fear & Greed (LiveData.getFearGreed)
//   3. Pull latest news (NewsFeed.fetchAll — top 8 catalysts)
//   4. Run multi-LLM consensus (AIAnalysis.runMulti with today's news)
//   5. Check watchlist tickers against tr_alert_rules (Finnhub quotes)
//   6. Scan overnight scenarios in tr_scenarios_v1 — flag any ARMED
//   7. Echo the TRADE OF THE DAY if cached (tr_trade_of_day_v1, display-only)
//
// Exposes:
//   window.TRPrepForOpen.Button({ T })    — gold pill "⚡ PREP ME FOR OPEN"
//   window.TRPrepForOpen.Modal({ open, onClose, T }) — live checklist modal
//   window.openTRPrepForOpen()            — dispatches 'tr:prep-for-open'
//
// Depends on (all attached to window by engine/*.js or earlier panels):
//   LiveData.getCryptoPrices, LiveData.getFearGreed
//   NewsFeed.fetchAll
//   AIAnalysis.runMulti
//   TR_SETTINGS.keys.finnhub  (for watchlist quote checks)
//   tr-hooks.jsx trLoadWatchlist (indirectly via localStorage 'tr_watchlist')

(function () {
  // ─────── Theme fallback (matches tr-selftest.jsx) ───────
  const DEFAULT_T = {
    ink000: '#07090C', ink100: '#0B0E13', ink200: '#10141B', ink300: '#171C24',
    edge: 'rgba(255,255,255,0.06)', edgeHi: 'rgba(255,255,255,0.10)',
    text: '#ffffff', textMid: 'rgba(180,188,200,0.75)', textDim: 'rgba(130,138,150,0.55)',
    signal: '#c9a227', bull: '#6FCF8E', bear: '#D96B6B', warn: '#E8B84A',
    mono: '"JetBrains Mono", ui-monospace, "SF Mono", Menlo, Consolas, monospace',
    ui: '"Inter Tight", InterTight, -apple-system, BlinkMacSystemFont, system-ui, sans-serif',
  };
  function mergeT(T) { return Object.assign({}, DEFAULT_T, T || {}); }

  const LAST_RUN_KEY = 'tr_prep_last_run_v1';
  const TRADE_KEY = 'tr_trade_of_day_v1';
  const SCENARIO_KEY = 'tr_scenarios_v1';
  const ALERT_RULES_KEY = 'tr_alert_rules';
  const WATCHLIST_KEY = 'tr_watchlist';

  // ─────── Inject keyframes once (matching self-test) ───────
  (function injectStyles() {
    if (typeof document === 'undefined') return;
    if (document.getElementById('tr-prep-for-open-styles')) return;
    const s = document.createElement('style');
    s.id = 'tr-prep-for-open-styles';
    s.textContent =
      '@keyframes trPrepRowIn { from { opacity: 0; transform: translateY(3px); } to { opacity: 1; transform: translateY(0); } }' +
      '@keyframes trPrepFadeIn { from { opacity: 0; transform: translateY(4px); } to { opacity: 1; transform: translateY(0); } }' +
      '@keyframes trPrepSpin { from { transform: rotate(0deg); } to { transform: rotate(360deg); } }';
    document.head.appendChild(s);
  })();

  // ─────── Helpers ───────
  function fmtAgo(ts) {
    if (!ts) return null;
    const diff = Math.max(0, Date.now() - Number(ts));
    const m = Math.floor(diff / 60000);
    if (m < 1) return 'just now';
    if (m < 60) return m + 'm ago';
    const h = Math.floor(m / 60);
    if (h < 24) return h + 'h ago';
    const d = Math.floor(h / 24);
    return d + 'd ago';
  }
  function readLastRun() {
    try {
      const raw = localStorage.getItem(LAST_RUN_KEY);
      if (!raw) return null;
      const n = Number(raw);
      return isFinite(n) ? n : null;
    } catch (_) { return null; }
  }
  function writeLastRun(ts) {
    try { localStorage.setItem(LAST_RUN_KEY, String(ts)); } catch (_) {}
  }
  function loadJSON(key, fallback) {
    try {
      const raw = localStorage.getItem(key);
      if (!raw) return fallback;
      const p = JSON.parse(raw);
      return (p == null) ? fallback : p;
    } catch (_) { return fallback; }
  }

  // Evaluate an alert rule against a live quote. Returns a human string
  // describing what is ARMED/CLOSE, or null if nowhere near the threshold.
  // Rules come from tr_alert_rules. We support the ticker-sensitive subset:
  // BTC_ABOVE/BELOW and ETH_ABOVE/BELOW get handled via crypto snapshot.
  function ruleHitForQuote(rule, sym, quote) {
    if (!rule || !rule.enabled) return null;
    if (!quote || !isFinite(quote.price)) return null;
    const thr = Number(rule.threshold);
    if (!isFinite(thr)) return null;
    // Rules don't carry a symbol field — only fire if the rule type
    // matches the symbol being tested AND the threshold is a stock price.
    // Generic "watchlist at target" check: ticker's price is within 1% of
    // any crypto-style threshold that matches its price range.
    const delta = Math.abs(quote.price - thr) / thr;
    if (delta <= 0.01) return `${sym} at target ${thr.toLocaleString()} (now ${quote.price.toFixed(2)})`;
    return null;
  }

  // Watchlist quote pull via Finnhub (free tier handles ~60/min).
  async function fetchFinnhubQuote(sym, key) {
    try {
      const url = 'https://finnhub.io/api/v1/quote?symbol=' + encodeURIComponent(sym) + '&token=' + key;
      const r = await fetch(url);
      if (!r.ok) return null;
      const j = await r.json();
      if (!j || typeof j.c !== 'number' || j.c === 0) return null;
      return { price: j.c, changePct: j.dp, change: j.d, prevClose: j.pc };
    } catch (_) { return null; }
  }

  // ─────── 7-step ritual ───────
  // Each step returns { detail, data } on success, throws on fatal error.
  // onProgress({ idx, status, detail }) is called as each step flips state.
  async function runPrepRoutine(onProgress) {
    const steps = [
      { key: 'prices',    icon: '◉', name: 'Refresh crypto prices' },
      { key: 'feargreed', icon: '◈', name: 'Refresh Fear & Greed' },
      { key: 'news',      icon: '✦', name: 'Pull latest news (top 8)' },
      { key: 'consensus', icon: '◆', name: 'Run multi-LLM consensus' },
      { key: 'alerts',    icon: '△', name: 'Check watchlist vs alert rules' },
      { key: 'scenarios', icon: '▲', name: 'Scan overnight scenarios' },
      { key: 'trade',     icon: '⚡', name: 'Echo Trade of the Day' },
    ];
    const state = steps.map(s => ({
      key: s.key, icon: s.icon, name: s.name, status: 'pending', detail: '',
    }));
    const emit = () => { if (onProgress) onProgress(state.map(x => Object.assign({}, x))); };
    emit();

    const setRunning = (idx) => { state[idx].status = 'running'; emit(); };
    const setDone    = (idx, detail, data) => { state[idx].status = 'done'; state[idx].detail = detail || ''; state[idx].data = data; emit(); };
    const setWarn    = (idx, detail) => { state[idx].status = 'warn'; state[idx].detail = detail || ''; emit(); };
    const setFail    = (idx, detail) => { state[idx].status = 'fail'; state[idx].detail = detail || ''; emit(); };

    // Kick off parallel-safe steps immediately. Consensus waits on news.
    const results = {};

    // Step 1: prices
    setRunning(0);
    const pricesP = (async () => {
      try {
        if (typeof LiveData === 'undefined' || !LiveData.getCryptoPrices) { setFail(0, 'LiveData missing'); return null; }
        const p = await LiveData.getCryptoPrices();
        const btc = p && p.bitcoin && p.bitcoin.usd;
        const eth = p && p.ethereum && p.ethereum.usd;
        const detail = btc ? ('BTC $' + Math.round(btc).toLocaleString() + (eth ? ' · ETH $' + Math.round(eth).toLocaleString() : '')) : 'no price';
        setDone(0, detail, p);
        return p;
      } catch (e) { setFail(0, e.message || String(e)); return null; }
    })();

    // Step 2: fear & greed
    setRunning(1);
    const fgP = (async () => {
      try {
        if (typeof LiveData === 'undefined' || !LiveData.getFearGreed) { setFail(1, 'LiveData missing'); return null; }
        const fg = await LiveData.getFearGreed();
        const d0 = fg && fg.data && fg.data[0];
        if (!d0) { setWarn(1, 'no F&G data'); return null; }
        setDone(1, d0.value + ' · ' + (d0.value_classification || '—'), d0);
        return d0;
      } catch (e) { setFail(1, e.message || String(e)); return null; }
    })();

    // Step 3: news
    setRunning(2);
    const newsP = (async () => {
      try {
        if (typeof NewsFeed === 'undefined' || !NewsFeed.fetchAll) { setFail(2, 'NewsFeed missing'); return []; }
        const arr = await NewsFeed.fetchAll();
        if (!Array.isArray(arr) || !arr.length) { setWarn(2, 'no articles'); return []; }
        const top = arr.slice(0, 8);
        setDone(2, top.length + ' catalysts', top);
        return top;
      } catch (e) { setFail(2, e.message || String(e)); return []; }
    })();

    // Step 4: consensus — depends on news
    setRunning(3);
    const consensusP = (async () => {
      const top = await newsP;
      try {
        if (typeof AIAnalysis === 'undefined' || !AIAnalysis.runMulti) { setFail(3, 'AIAnalysis missing'); return null; }
        if (!top || !top.length) { setWarn(3, 'no news to analyze'); return null; }
        const headlines = top.map(n => ({
          source: n.source || n.provider || 'news',
          title: n.title || n.headline || '',
        })).filter(h => h.title);
        if (!headlines.length) { setWarn(3, 'no usable headlines'); return null; }
        const r = await AIAnalysis.runMulti(headlines);
        const c = r && r.consensus;
        if (!c) { setWarn(3, 'need 2+ LLM keys'); return null; }
        const senti = String(c.sentiment || '').toUpperCase();
        const conf = c.avgConfidence ? Math.round(Number(c.avgConfidence) * 10) : null;
        const lbl = c.label || (c.agree ? 'ALIGNED' : 'DIVERGENT');
        const detail = `${lbl} · ${senti}${conf != null ? ' · ' + conf : ''}`;
        setDone(3, detail, c);
        return c;
      } catch (e) { setFail(3, e.message || String(e)); return null; }
    })();

    // Step 5: watchlist vs alert rules — depends on prices for BTC/ETH
    setRunning(4);
    const alertsP = (async () => {
      try {
        const prices = await pricesP;
        const rules = loadJSON(ALERT_RULES_KEY, []);
        const watchlist = loadJSON(WATCHLIST_KEY, { tickers: [], options: [] });
        const finnKey = (window.TR_SETTINGS && window.TR_SETTINGS.keys && window.TR_SETTINGS.keys.finnhub) || '';

        let armed = 0;
        let atTarget = 0;
        const hits = [];

        // Count ARMED rules that are already firing on BTC/ETH from the
        // snapshot we just fetched in step 1.
        const btcPx = prices && prices.bitcoin && prices.bitcoin.usd;
        const ethPx = prices && prices.ethereum && prices.ethereum.usd;
        for (const rule of (rules || [])) {
          if (!rule || !rule.enabled) continue;
          const thr = Number(rule.threshold);
          if (!isFinite(thr)) continue;
          if (rule.type === 'BTC_ABOVE' && isFinite(btcPx) && btcPx > thr) { armed++; hits.push('BTC>' + thr); }
          else if (rule.type === 'BTC_BELOW' && isFinite(btcPx) && btcPx < thr) { armed++; hits.push('BTC<' + thr); }
          else if (rule.type === 'ETH_ABOVE' && isFinite(ethPx) && ethPx > thr) { armed++; hits.push('ETH>' + thr); }
          else if (rule.type === 'ETH_BELOW' && isFinite(ethPx) && ethPx < thr) { armed++; hits.push('ETH<' + thr); }
        }

        // Check each watchlist ticker against any price-shaped rule.
        const tickers = (watchlist && Array.isArray(watchlist.tickers)) ? watchlist.tickers.slice(0, 10) : [];
        if (finnKey && tickers.length) {
          const quotes = await Promise.all(tickers.map(t => fetchFinnhubQuote(t.sym, finnKey)));
          tickers.forEach((t, i) => {
            const q = quotes[i];
            if (!q) return;
            for (const rule of (rules || [])) {
              const hit = ruleHitForQuote(rule, t.sym, q);
              if (hit) { atTarget++; hits.push(hit); break; }
            }
          });
        }

        const parts = [];
        parts.push(armed + ' ARMED');
        parts.push(atTarget + ' at target');
        setDone(4, parts.join(' · '), { armed, atTarget, hits, rulesCount: (rules || []).length, tickersChecked: tickers.length });
        return { armed, atTarget, hits };
      } catch (e) { setFail(4, e.message || String(e)); return { armed: 0, atTarget: 0, hits: [] }; }
    })();

    // Step 6: overnight scenarios
    setRunning(5);
    const scenariosP = (async () => {
      try {
        const blob = loadJSON(SCENARIO_KEY, null);
        const arr = (blob && Array.isArray(blob.scenarios)) ? blob.scenarios
                  : (Array.isArray(blob) ? blob : []);
        if (!arr.length) { setWarn(5, 'no scenarios cached'); return { armed: 0, total: 0 }; }
        const armed = arr.filter(s => s && s.status === 'ARMED').length;
        setDone(5, armed + ' ARMED of ' + arr.length, { armed, total: arr.length, scenarios: arr });
        return { armed, total: arr.length };
      } catch (e) { setFail(5, e.message || String(e)); return { armed: 0, total: 0 }; }
    })();

    // Step 7: trade of the day — display only, no regeneration
    setRunning(6);
    const tradeP = (async () => {
      try {
        const trade = loadJSON(TRADE_KEY, null);
        if (!trade) { setWarn(6, 'no cached trade'); return null; }
        const summary = trade.title || trade.thesis || trade.ticker || trade.symbol || 'cached trade';
        const detail = String(summary).slice(0, 60);
        setDone(6, detail, trade);
        return trade;
      } catch (e) { setFail(6, e.message || String(e)); return null; }
    })();

    // Await everything.
    const [prices, fg, news, consensus, alerts, scenarios, trade] = await Promise.all([
      pricesP, fgP, newsP, consensusP, alertsP, scenariosP, tradeP,
    ]);

    Object.assign(results, { prices, fg, news, consensus, alerts, scenarios, trade });

    writeLastRun(Date.now());
    return { state: state.map(x => Object.assign({}, x)), results };
  }

  // ─────── React: Button ───────
  function Button(props) {
    const T = mergeT(props && props.T);
    const [lastRun, setLastRun] = React.useState(readLastRun());
    const [tick, setTick] = React.useState(0);

    React.useEffect(() => {
      const sync = () => setLastRun(readLastRun());
      const interval = setInterval(() => setTick(t => t + 1), 60_000);
      window.addEventListener('tr:prep-for-open-done', sync);
      window.addEventListener('storage', sync);
      return () => {
        clearInterval(interval);
        window.removeEventListener('tr:prep-for-open-done', sync);
        window.removeEventListener('storage', sync);
      };
    }, []);

    const onClick = () => {
      try { window.openTRPrepForOpen && window.openTRPrepForOpen(); } catch (_) {}
    };

    const ago = fmtAgo(lastRun);
    // tick is used to force re-compute of ago every minute.
    void tick;

    return React.createElement(
      'div',
      { style: { display: 'inline-flex', flexDirection: 'column', alignItems: 'flex-start', gap: 3 } },
      React.createElement(
        'div',
        {
          onClick: onClick,
          style: {
            padding: '6px 14px',
            background: T.signal,
            color: T.ink000,
            borderRadius: 6,
            fontFamily: T.mono,
            fontWeight: 700,
            letterSpacing: 0.4,
            fontSize: 11,
            cursor: 'pointer',
            userSelect: 'none',
            transition: 'opacity 160ms cubic-bezier(0.2,0.7,0.2,1)',
          },
          onMouseEnter: (e) => { e.currentTarget.style.opacity = '0.88'; },
          onMouseLeave: (e) => { e.currentTarget.style.opacity = '1'; },
        },
        '\u26A1 PREP ME FOR OPEN'
      ),
      ago
        ? React.createElement(
            'div',
            { style: { fontFamily: T.mono, fontSize: 9, color: T.textDim, letterSpacing: 0.4 } },
            'last run ' + ago
          )
        : null
    );
  }

  // ─────── React: Modal ───────
  function Modal(props) {
    const T = mergeT(props && props.T);
    const open = !!(props && props.open);
    const onClose = (props && props.onClose) || function () {};

    const [steps, setSteps] = React.useState([]);
    const [running, setRunning] = React.useState(false);
    const [startAt, setStartAt] = React.useState(null);
    const [endAt, setEndAt] = React.useState(null);
    const [results, setResults] = React.useState(null);
    const [autoCloseAt, setAutoCloseAt] = React.useState(null);
    const [now, setNow] = React.useState(Date.now());

    const run = React.useCallback(async () => {
      if (running) return;
      setRunning(true);
      setResults(null);
      setEndAt(null);
      setAutoCloseAt(null);
      setStartAt(Date.now());
      try {
        const out = await runPrepRoutine((s) => setSteps(s));
        setResults(out.results);
        setSteps(out.state);
        const finished = Date.now();
        setEndAt(finished);
        setAutoCloseAt(finished + 5000);
        try { window.dispatchEvent(new CustomEvent('tr:prep-for-open-done', { detail: out })); } catch (_) {}
      } catch (e) {
        // Still emit whatever we have.
      }
      setRunning(false);
    }, [running]);

    React.useEffect(() => {
      if (open && steps.length === 0 && !running) run();
      // eslint-disable-next-line
    }, [open]);

    // Ticker for elapsed + auto-close countdown.
    React.useEffect(() => {
      if (!open) return undefined;
      const id = setInterval(() => setNow(Date.now()), 250);
      return () => clearInterval(id);
    }, [open]);

    // Auto-close 5s after completion unless user is still interacting.
    React.useEffect(() => {
      if (!autoCloseAt) return undefined;
      const remain = autoCloseAt - Date.now();
      if (remain <= 0) { onClose(); return undefined; }
      const id = setTimeout(() => { onClose(); }, remain);
      return () => clearTimeout(id);
    }, [autoCloseAt, onClose]);

    if (!open) return null;

    const elapsedMs = startAt ? ((endAt || now) - startAt) : 0;
    const elapsedS = (elapsedMs / 1000).toFixed(1);

    const colorFor = (s) =>
      s === 'done' ? T.bull :
      s === 'warn' ? T.warn :
      s === 'fail' ? T.bear :
      s === 'running' ? T.signal :
      T.textDim;

    // Summary line (bottom).
    function buildSummary() {
      if (!results) return null;
      const bits = [];
      const news = results.news;
      if (Array.isArray(news)) bits.push(news.length + ' new catalysts');
      const c = results.consensus;
      if (c) {
        const senti = String(c.sentiment || '').toUpperCase();
        const conf = c.avgConfidence ? Math.round(Number(c.avgConfidence) * 10) : null;
        bits.push('Consensus: ' + senti + (conf != null ? ' ' + conf : ''));
      }
      const a = results.alerts;
      if (a) bits.push((a.armed || 0) + ' alerts ARMED');
      const sc = results.scenarios;
      if (sc && sc.armed) bits.push(sc.armed + ' scenarios ARMED');
      if (a && a.atTarget) bits.push(a.atTarget + ' watchlist at target');
      return bits.join(' \u00B7 ');
    }

    const jumpToDrivers = () => {
      try {
        window.dispatchEvent(new CustomEvent('tr:tab-changed', { detail: { tab: 'drivers' } }));
        if (typeof window.trSetTab === 'function') window.trSetTab('drivers');
      } catch (_) {}
      onClose();
    };

    const autoCloseRemain = autoCloseAt ? Math.max(0, Math.ceil((autoCloseAt - now) / 1000)) : null;

    return React.createElement(
      'div',
      {
        onClick: onClose,
        style: {
          position: 'fixed', inset: 0, background: 'rgba(7,9,12,0.78)',
          backdropFilter: 'blur(14px) saturate(150%)', WebkitBackdropFilter: 'blur(14px) saturate(150%)',
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          zIndex: 9600, padding: 40, fontFamily: T.ui,
        },
      },
      React.createElement(
        'div',
        {
          onClick: (e) => e.stopPropagation(),
          style: {
            width: 640, maxHeight: '86%', display: 'flex', flexDirection: 'column',
            background: T.ink100, border: '1px solid ' + T.edgeHi, borderRadius: 14,
            boxShadow: '0 24px 80px rgba(0,0,0,0.6)', overflow: 'hidden',
            animation: 'trPrepFadeIn 180ms cubic-bezier(0.2,0.7,0.2,1)',
          },
        },
        // Header
        React.createElement(
          'div',
          {
            style: {
              padding: '18px 24px', borderBottom: '1px solid ' + T.edge,
              display: 'flex', alignItems: 'center', gap: 12,
            },
          },
          React.createElement(
            'div',
            {
              style: {
                fontSize: 10, letterSpacing: 1.2, color: T.signal,
                textTransform: 'uppercase', fontWeight: 700, fontFamily: T.mono,
              },
            },
            '\u26A1 Prep Me For Open'
          ),
          React.createElement(
            'div',
            { style: { marginLeft: 'auto', display: 'flex', gap: 8, alignItems: 'center' } },
            React.createElement(
              'div',
              {
                onClick: running ? undefined : run,
                style: {
                  padding: '5px 12px', background: T.signal, color: T.ink000,
                  borderRadius: 6, fontSize: 11, fontWeight: 600, letterSpacing: 0.3,
                  cursor: running ? 'default' : 'pointer', opacity: running ? 0.5 : 1,
                  fontFamily: T.mono,
                },
              },
              running ? 'RUNNING\u2026' : '\u21BB RE-RUN'
            ),
            React.createElement(
              'div',
              {
                onClick: onClose,
                style: {
                  width: 28, height: 28, borderRadius: 7, background: T.ink300,
                  border: '1px solid ' + T.edge, display: 'flex', alignItems: 'center',
                  justifyContent: 'center', cursor: 'pointer', color: T.textMid, fontSize: 13,
                },
              },
              '\u2715'
            )
          )
        ),
        // Body
        React.createElement(
          'div',
          { style: { flex: 1, overflowY: 'auto', padding: '16px 24px' } },
          // Step rows
          React.createElement(
            'div',
            {
              style: {
                background: T.ink200, border: '1px solid ' + T.edge, borderRadius: 10,
                overflow: 'hidden',
              },
            },
            steps.map((s, i) =>
              React.createElement(
                'div',
                {
                  key: s.key + i,
                  style: {
                    display: 'grid', gridTemplateColumns: '30px 1fr auto',
                    gap: 10, padding: '9px 14px', fontFamily: T.mono, fontSize: 11,
                    borderBottom: i < steps.length - 1 ? '0.5px solid ' + T.edge : 'none',
                    alignItems: 'center',
                    animation: 'trPrepRowIn 180ms cubic-bezier(0.2,0.7,0.2,1) both',
                  },
                },
                React.createElement(
                  'div',
                  { style: { color: colorFor(s.status), fontSize: 13, textAlign: 'center' } },
                  s.status === 'running'
                    ? React.createElement('span', {
                        style: {
                          display: 'inline-block', width: 10, height: 10,
                          border: '1.5px solid ' + T.signal,
                          borderTopColor: 'transparent',
                          borderRadius: '50%',
                          animation: 'trPrepSpin 700ms linear infinite',
                        },
                      })
                    : s.status === 'done' ? '\u2713'
                    : s.status === 'warn' ? '\u26A0'
                    : s.status === 'fail' ? '\u2715'
                    : s.icon
                ),
                React.createElement(
                  'div',
                  { style: { color: T.text, fontSize: 11 } },
                  s.name
                ),
                React.createElement(
                  'div',
                  { style: { color: colorFor(s.status), fontSize: 10, textAlign: 'right', letterSpacing: 0.3 } },
                  s.detail || (s.status === 'running' ? '\u2026' : '')
                )
              )
            )
          ),
          // Summary banner (appears when done)
          results
            ? React.createElement(
                'div',
                {
                  style: {
                    marginTop: 14, padding: '12px 16px', background: T.ink200,
                    border: '1px solid ' + T.edge, borderRadius: 10,
                    fontFamily: T.mono, fontSize: 11, color: T.text, lineHeight: 1.55,
                  },
                },
                React.createElement(
                  'div',
                  {
                    style: {
                      fontSize: 9, letterSpacing: 1.2, color: T.signal,
                      textTransform: 'uppercase', fontWeight: 700, marginBottom: 6,
                    },
                  },
                  'Ready'
                ),
                buildSummary() || 'Prep complete.'
              )
            : null
        ),
        // Footer
        React.createElement(
          'div',
          {
            style: {
              padding: '12px 24px', borderTop: '1px solid ' + T.edge,
              display: 'flex', alignItems: 'center', gap: 12,
              fontFamily: T.mono, fontSize: 10, color: T.textDim, letterSpacing: 0.4,
            },
          },
          React.createElement(
            'div',
            null,
            endAt ? ('Ready in ' + elapsedS + 's') : (running ? ('Running\u2026 ' + elapsedS + 's') : 'Idle')
          ),
          autoCloseRemain != null
            ? React.createElement(
                'div',
                { style: { color: T.textMid } },
                'auto-close in ' + autoCloseRemain + 's'
              )
            : null,
          React.createElement(
            'div',
            {
              onClick: jumpToDrivers,
              style: {
                marginLeft: 'auto',
                padding: '5px 12px', background: T.ink300, color: T.text,
                border: '1px solid ' + T.edgeHi, borderRadius: 6,
                fontSize: 11, fontWeight: 600, letterSpacing: 0.3,
                cursor: 'pointer', fontFamily: T.mono,
              },
            },
            'Jump to Drivers \u2192'
          )
        )
      )
    );
  }

  // ─────── Global opener + auto-mount ───────
  window.openTRPrepForOpen = function openTRPrepForOpen() {
    try { window.dispatchEvent(new CustomEvent('tr:prep-for-open')); } catch (_) {}
  };

  window.TRPrepForOpen = { Button: Button, Modal: Modal, runRoutine: runPrepRoutine };

  (function mountRoot() {
    if (typeof document === 'undefined') return;

    function Mount() {
      const [open, setOpen] = React.useState(false);
      React.useEffect(() => {
        const onOpen = () => setOpen(true);
        window.addEventListener('tr:prep-for-open', onOpen);
        return () => window.removeEventListener('tr:prep-for-open', onOpen);
      }, []);
      return React.createElement(Modal, { open: open, onClose: () => setOpen(false) });
    }

    function doMount() {
      if (document.getElementById('tr-prep-for-open-root')) return;
      if (typeof React === 'undefined' || typeof ReactDOM === 'undefined') return;
      const div = document.createElement('div');
      div.id = 'tr-prep-for-open-root';
      document.body.appendChild(div);
      if (ReactDOM.createRoot) ReactDOM.createRoot(div).render(React.createElement(Mount));
      else ReactDOM.render(React.createElement(Mount), div);
    }

    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', doMount);
    else doMount();
  })();
})();
