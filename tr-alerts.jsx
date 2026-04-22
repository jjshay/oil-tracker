// tr-alerts.jsx — TradeRadar background alert engine + rules UI.
//
// Exposes:
//   window.TRAlertsManager  — start/stop the 60s poll loop, evaluate rules
//   window.TRAlertsPanel    — React modal component ({open, onClose})
//   window.openTRAlerts()   — global trigger (fires 'tr:open-alerts' CustomEvent
//                             so the coordinator can mount + show the panel)
//
// Storage:
//   localStorage.tr_alert_rules  — JSON array of rule objects
//   localStorage.tr_alert_state  — JSON map { [ruleId]: lastTriggeredAtMs }
//   localStorage.tr_alert_seeded — '1' once defaults have been seeded
//
// Depends on (all attached to window by engine/*.js):
//   LiveData.getCryptoPrices, LiveData.getFearGreed
//   LiveData.getEquityMacro (optional — VIX/DXY)
//   LiveData.getFunding (optional — crypto perp funding)
//   MilitaryFlights.getMidEast
//   InsiderData.getRecent (optional)
//   CongressTrades.getRecent (optional)
//   TelegramAlert.send, TelegramAlert.isConfigured
//
// Consensus divergence check reads summary screen's LLM predictions if cached
// on window.TR_LAST_PREDS (best-effort — skipped silently if unavailable).

(function () {
  const RULES_KEY = 'tr_alert_rules';
  const STATE_KEY = 'tr_alert_state';
  const SEEDED_KEY = 'tr_alert_seeded';
  const DEFAULT_COOLDOWN_MIN = 60;

  // ---------- storage helpers ----------
  function loadRules() {
    try {
      const raw = localStorage.getItem(RULES_KEY);
      const seeded = localStorage.getItem(SEEDED_KEY) === '1';
      if (!raw) {
        if (!seeded) return seedDefaults();
        return [];
      }
      const parsed = JSON.parse(raw);
      if (!Array.isArray(parsed)) {
        if (!seeded) return seedDefaults();
        return [];
      }
      if (parsed.length === 0 && !seeded) return seedDefaults();
      return parsed;
    } catch (_) {
      const seeded = localStorage.getItem(SEEDED_KEY) === '1';
      if (!seeded) return seedDefaults();
      return [];
    }
  }
  function saveRules(rules) {
    try { localStorage.setItem(RULES_KEY, JSON.stringify(rules)); } catch (_) {}
  }
  function loadState() {
    try {
      const raw = localStorage.getItem(STATE_KEY);
      if (!raw) return {};
      const parsed = JSON.parse(raw);
      return (parsed && typeof parsed === 'object') ? parsed : {};
    } catch (_) { return {}; }
  }
  function saveState(state) {
    try { localStorage.setItem(STATE_KEY, JSON.stringify(state)); } catch (_) {}
  }

  function seedDefaults() {
    // Seeded on first open only. Three rules, ON by default, pre-configured
    // with notes so the user sees actionable triggers immediately.
    const seeds = [
      {
        id: 'default-btc-110k',
        type: 'BTC_ABOVE',
        threshold: 110000,
        cooldownMin: 60,
        enabled: true,
        note: 'BTC breaks 110k — signal top-third of range',
      },
      {
        id: 'default-mil-10',
        type: 'MIL_FLIGHTS_ABOVE',
        threshold: 10,
        cooldownMin: 45,
        enabled: true,
        note: 'USAF CENTCOM activity spike — oil geo premium',
      },
      {
        id: 'default-fg-extreme',
        type: 'FG_BELOW',
        threshold: 25,
        cooldownMin: 120,
        enabled: true,
        note: 'Fear & Greed extreme fear — contrarian long setup',
      },
    ];
    saveRules(seeds);
    try { localStorage.setItem(SEEDED_KEY, '1'); } catch (_) {}
    return seeds;
  }

  function mkId() {
    return 'r_' + Math.random().toString(36).slice(2, 10) + Date.now().toString(36).slice(-4);
  }

  // ---------- rule type metadata ----------
  // `group` clusters rule cards in the panel UI.
  const RULE_TYPES = [
    { key: 'BTC_ABOVE',           label: 'BTC above',              unit: 'USD',    hint: 'e.g. 110000', group: 'Crypto',     icon: '₿' },
    { key: 'BTC_BELOW',           label: 'BTC below',              unit: 'USD',    hint: 'e.g. 80000',  group: 'Crypto',     icon: '₿' },
    { key: 'ETH_ABOVE',           label: 'ETH above',              unit: 'USD',    hint: 'e.g. 4200',   group: 'Crypto',     icon: 'Ξ' },
    { key: 'ETH_BELOW',           label: 'ETH below',              unit: 'USD',    hint: 'e.g. 2800',   group: 'Crypto',     icon: 'Ξ' },
    { key: 'FUNDING_ABOVE',       label: 'Perp funding above',     unit: 'bps/8h', hint: 'e.g. 10',     group: 'Crypto',     icon: '⚡' },
    { key: 'FG_ABOVE',            label: 'Fear & Greed above',     unit: 'index',  hint: '0-100',       group: 'Sentiment',  icon: '◉' },
    { key: 'FG_BELOW',            label: 'Fear & Greed below',     unit: 'index',  hint: '0-100',       group: 'Sentiment',  icon: '◉' },
    { key: 'CONSENSUS_DIVERGENT', label: 'LLM consensus divergent', unit: '',      hint: 'no threshold', group: 'Sentiment', icon: '◈' },
    { key: 'VIX_ABOVE',           label: 'VIX above',              unit: 'index',  hint: 'e.g. 22',     group: 'Equities',   icon: '△' },
    { key: 'DXY_ABOVE',           label: 'DXY above',              unit: 'index',  hint: 'e.g. 108',    group: 'Equities',   icon: '$' },
    { key: 'MIL_FLIGHTS_ABOVE',   label: 'US mil flights above',   unit: 'count',  hint: 'CENTCOM ADS-B count', group: 'Geopolitics', icon: '✈' },
    { key: 'INSIDER_BUY',         label: 'Insider buy >$500k',     unit: 'USD',    hint: 'min $ size',  group: 'Flow',       icon: '◆' },
    { key: 'CONGRESS_BUY',        label: 'Congress buy',           unit: 'USD',    hint: 'min $ size',  group: 'Flow',       icon: '◆' },
  ];

  function typeMeta(key) {
    return RULE_TYPES.find(r => r.key === key) || { key, label: key, group: 'Other', icon: '•', hint: '' };
  }
  function labelForType(key) { return typeMeta(key).label; }
  function iconForType(key) { return typeMeta(key).icon; }
  function groupForType(key) { return typeMeta(key).group; }

  // ---------- evaluation ----------
  // state := {
  //   btc:{price}, eth:{price}, fng:{value}, mil:{count},
  //   vix:{value}, dxy:{value}, funding:{bps},
  //   insider:{largestUsd, ticker, role}, congress:{largestUsd, name, ticker},
  //   consensus:{aligned, sentiment, sentiments:[]}
  // }
  function evaluateRule(rule, state) {
    if (!rule || !rule.enabled) return null;
    switch (rule.type) {
      case 'BTC_ABOVE':
        if (state.btc && isFinite(state.btc.price) && state.btc.price > rule.threshold) {
          return `BTC above ${fmtUsd(rule.threshold)}: now ${fmtUsd(state.btc.price)}`;
        }
        return null;
      case 'BTC_BELOW':
        if (state.btc && isFinite(state.btc.price) && state.btc.price < rule.threshold) {
          return `BTC below ${fmtUsd(rule.threshold)}: now ${fmtUsd(state.btc.price)}`;
        }
        return null;
      case 'ETH_ABOVE':
        if (state.eth && isFinite(state.eth.price) && state.eth.price > rule.threshold) {
          return `ETH above ${fmtUsd(rule.threshold)}: now ${fmtUsd(state.eth.price)}`;
        }
        return null;
      case 'ETH_BELOW':
        if (state.eth && isFinite(state.eth.price) && state.eth.price < rule.threshold) {
          return `ETH below ${fmtUsd(rule.threshold)}: now ${fmtUsd(state.eth.price)}`;
        }
        return null;
      case 'FG_ABOVE':
        if (state.fng && isFinite(state.fng.value) && state.fng.value > rule.threshold) {
          return `Fear & Greed above ${rule.threshold}: now ${state.fng.value} (${state.fng.classification || '—'})`;
        }
        return null;
      case 'FG_BELOW':
        if (state.fng && isFinite(state.fng.value) && state.fng.value < rule.threshold) {
          return `Fear & Greed below ${rule.threshold}: now ${state.fng.value} (${state.fng.classification || '—'})`;
        }
        return null;
      case 'VIX_ABOVE':
        if (state.vix && isFinite(state.vix.value) && state.vix.value > rule.threshold) {
          return `VIX above ${rule.threshold}: now ${state.vix.value.toFixed(2)}`;
        }
        return null;
      case 'DXY_ABOVE':
        if (state.dxy && isFinite(state.dxy.value) && state.dxy.value > rule.threshold) {
          return `DXY above ${rule.threshold}: now ${state.dxy.value.toFixed(2)}`;
        }
        return null;
      case 'FUNDING_ABOVE':
        if (state.funding && isFinite(state.funding.bps) && state.funding.bps > rule.threshold) {
          return `Perp funding above ${rule.threshold} bps/8h: now ${state.funding.bps.toFixed(2)}`;
        }
        return null;
      case 'MIL_FLIGHTS_ABOVE':
        if (state.mil && isFinite(state.mil.count) && state.mil.count > rule.threshold) {
          return `US military flights above ${rule.threshold}: ${state.mil.count} tracked over CENTCOM`;
        }
        return null;
      case 'INSIDER_BUY': {
        const floor = isFinite(rule.threshold) && rule.threshold > 0 ? rule.threshold : 500000;
        if (state.insider && isFinite(state.insider.largestUsd) && state.insider.largestUsd >= floor) {
          const who = [state.insider.role, state.insider.ticker].filter(Boolean).join(' @ ');
          return `Insider buy ${fmtUsd(state.insider.largestUsd)}${who ? ' — ' + who : ''}`;
        }
        return null;
      }
      case 'CONGRESS_BUY': {
        const floor = isFinite(rule.threshold) && rule.threshold > 0 ? rule.threshold : 0;
        if (state.congress && isFinite(state.congress.largestUsd) && state.congress.largestUsd >= floor) {
          const who = [state.congress.name, state.congress.ticker].filter(Boolean).join(' · ');
          return `Congress trade ${fmtUsd(state.congress.largestUsd)}${who ? ' — ' + who : ''}`;
        }
        return null;
      }
      case 'CONSENSUS_DIVERGENT':
        if (state.consensus && state.consensus.sentiments && state.consensus.sentiments.length >= 2
            && state.consensus.aligned === false) {
          return `LLM consensus divergent: ${state.consensus.sentiments.join(' / ')}`;
        }
        return null;
      default:
        return null;
    }
  }

  function fmtUsd(n) {
    if (!isFinite(n)) return '—';
    return '$' + Math.round(n).toLocaleString('en-US');
  }

  // ---------- state collection ----------
  async function collectState() {
    const out = {
      btc: null, eth: null, fng: null, mil: null, consensus: null,
      vix: null, dxy: null, funding: null, insider: null, congress: null,
    };
    try {
      if (typeof LiveData !== 'undefined') {
        const prices = await LiveData.getCryptoPrices();
        if (prices && prices.bitcoin && isFinite(prices.bitcoin.usd)) {
          out.btc = { price: prices.bitcoin.usd, change24h: prices.bitcoin.usd_24h_change };
        }
        if (prices && prices.ethereum && isFinite(prices.ethereum.usd)) {
          out.eth = { price: prices.ethereum.usd, change24h: prices.ethereum.usd_24h_change };
        }
        const fg = await LiveData.getFearGreed();
        if (fg && fg.data && fg.data[0]) {
          out.fng = {
            value: parseInt(fg.data[0].value, 10),
            classification: fg.data[0].value_classification,
          };
        }
        if (typeof LiveData.getEquityMacro === 'function') {
          try {
            const eq = await LiveData.getEquityMacro();
            if (eq && isFinite(eq.vix)) out.vix = { value: eq.vix };
            if (eq && isFinite(eq.dxy)) out.dxy = { value: eq.dxy };
          } catch (_) { /* silent */ }
        }
        if (typeof LiveData.getFunding === 'function') {
          try {
            const fd = await LiveData.getFunding();
            if (fd && isFinite(fd.bps)) out.funding = { bps: fd.bps, symbol: fd.symbol };
          } catch (_) { /* silent */ }
        }
      }
    } catch (_) { /* silent */ }
    try {
      if (typeof MilitaryFlights !== 'undefined') {
        const m = await MilitaryFlights.getMidEast();
        if (m && isFinite(m.usMilCount)) {
          out.mil = { count: m.usMilCount, total: m.total };
        }
      }
    } catch (_) { /* silent */ }
    try {
      if (typeof InsiderData !== 'undefined' && typeof InsiderData.getRecent === 'function') {
        const recs = await InsiderData.getRecent();
        if (Array.isArray(recs) && recs.length) {
          const buys = recs.filter(r => r && (r.type === 'buy' || r.transactionCode === 'P') && isFinite(r.usdValue));
          if (buys.length) {
            const top = buys.reduce((a, b) => (b.usdValue > a.usdValue ? b : a), buys[0]);
            out.insider = { largestUsd: top.usdValue, ticker: top.ticker, role: top.role || top.title };
          }
        }
      }
    } catch (_) { /* silent */ }
    try {
      if (typeof CongressTrades !== 'undefined' && typeof CongressTrades.getRecent === 'function') {
        const trs = await CongressTrades.getRecent();
        if (Array.isArray(trs) && trs.length) {
          const buys = trs.filter(r => r && (r.type === 'buy' || r.transaction === 'purchase') && isFinite(r.usdValue));
          if (buys.length) {
            const top = buys.reduce((a, b) => (b.usdValue > a.usdValue ? b : a), buys[0]);
            out.congress = { largestUsd: top.usdValue, ticker: top.ticker, name: top.name || top.representative };
          }
        }
      }
    } catch (_) { /* silent */ }
    // Consensus — best-effort from summary screen's cached preds
    try {
      const cached = window.TR_LAST_PREDS;
      if (cached && typeof cached === 'object') {
        const valid = ['claude', 'gpt', 'gemini']
          .map(k => cached[k])
          .filter(p => p && p.sentiment);
        if (valid.length >= 2) {
          const sentiments = valid.map(p => p.sentiment);
          const aligned = new Set(sentiments).size === 1;
          out.consensus = { aligned, sentiments, sentiment: aligned ? sentiments[0] : 'mixed' };
        }
      }
    } catch (_) { /* silent */ }
    return out;
  }

  // ---------- Telegram formatter ----------
  function formatMessage(rule, reason, state) {
    const lines = [];
    lines.push(`<b>TR alert · ${escapeHtml(labelForType(rule.type))}</b>`);
    lines.push(escapeHtml(reason));
    if (rule.note) lines.push('<i>' + escapeHtml(rule.note) + '</i>');
    const ctx = [];
    if (state.btc) ctx.push(`BTC ${fmtUsd(state.btc.price)}`);
    if (state.eth) ctx.push(`ETH ${fmtUsd(state.eth.price)}`);
    if (state.fng) ctx.push(`F&amp;G ${state.fng.value}`);
    if (state.vix) ctx.push(`VIX ${state.vix.value.toFixed(1)}`);
    if (state.dxy) ctx.push(`DXY ${state.dxy.value.toFixed(1)}`);
    if (state.mil) ctx.push(`MIL ${state.mil.count}`);
    if (ctx.length) lines.push('<i>' + ctx.join(' · ') + '</i>');
    lines.push('<code>' + new Date().toISOString() + '</code>');
    return lines.join('\n');
  }
  function escapeHtml(s) {
    return String(s == null ? '' : s)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  }

  // ---------- Telegram config detection ----------
  function telegramConfigured() {
    try {
      if (typeof TelegramAlert === 'undefined') return false;
      if (typeof TelegramAlert.isConfigured === 'function') return !!TelegramAlert.isConfigured();
      // Fallback: check localStorage keys some integrations commonly use.
      const tok = localStorage.getItem('tg_bot_token') || localStorage.getItem('telegram_bot_token');
      const chat = localStorage.getItem('tg_chat_id') || localStorage.getItem('telegram_chat_id');
      return !!(tok && chat);
    } catch (_) { return false; }
  }

  // ---------- core manager ----------
  const Manager = {
    _timer: null,
    _running: false,
    _intervalMs: 60_000,
    _lastTickAt: null,
    _lastState: null,
    _listeners: new Set(),

    getRules() { return loadRules(); },
    setRules(rules) { saveRules(rules); this._emit(); },
    getState() { return loadState(); },
    getLastSnapshot() { return this._lastState; },
    getLastTickAt() { return this._lastTickAt; },
    telegramConfigured() { return telegramConfigured(); },

    onChange(cb) {
      this._listeners.add(cb);
      return () => this._listeners.delete(cb);
    },
    _emit() {
      this._listeners.forEach(cb => { try { cb(); } catch (_) {} });
    },

    addRule(partial) {
      const rules = loadRules();
      const rule = Object.assign({
        id: mkId(),
        type: 'BTC_ABOVE',
        threshold: 0,
        cooldownMin: DEFAULT_COOLDOWN_MIN,
        enabled: true,
        note: '',
      }, partial || {});
      rules.push(rule);
      saveRules(rules);
      this._emit();
      return rule;
    },
    updateRule(id, patch) {
      const rules = loadRules().map(r => r.id === id ? Object.assign({}, r, patch) : r);
      saveRules(rules);
      this._emit();
    },
    deleteRule(id) {
      const rules = loadRules().filter(r => r.id !== id);
      saveRules(rules);
      const st = loadState();
      delete st[id];
      saveState(st);
      this._emit();
    },
    toggleRule(id) {
      const rules = loadRules().map(r => r.id === id ? Object.assign({}, r, { enabled: !r.enabled }) : r);
      saveRules(rules);
      this._emit();
    },

    async testSend() {
      if (typeof TelegramAlert === 'undefined') return { ok: false, error: 'TelegramAlert missing' };
      const ts = new Date().toISOString();
      const msg = `<b>TR test alert</b>\nTelegram connection OK.\n<code>${ts}</code>`;
      return TelegramAlert.send(msg, { parseMode: 'HTML' });
    },

    async testSendRule(id) {
      const rule = loadRules().find(r => r.id === id);
      if (!rule) return { ok: false, error: 'rule not found' };
      if (typeof TelegramAlert === 'undefined') return { ok: false, error: 'TelegramAlert missing' };
      const state = this._lastState || await collectState();
      const reason = `[TEST] ${labelForType(rule.type)} — threshold ${rule.threshold}`;
      const msg = formatMessage(rule, reason, state);
      return TelegramAlert.send(msg, { parseMode: 'HTML' });
    },

    async tick() {
      const state = await collectState();
      this._lastState = state;
      this._lastTickAt = Date.now();
      const rules = loadRules();
      const runState = loadState();
      const now = Date.now();
      let fired = 0;
      for (const rule of rules) {
        if (!rule.enabled) continue;
        const reason = evaluateRule(rule, state);
        if (!reason) continue;
        const cooldownMs = Math.max(0, Number(rule.cooldownMin) || DEFAULT_COOLDOWN_MIN) * 60_000;
        const last = runState[rule.id] || 0;
        if (now - last < cooldownMs) continue;
        // Fire — only call Telegram if configured; otherwise mark state so we
        // don't hammer the check on every tick.
        if (typeof TelegramAlert !== 'undefined') {
          try {
            const msg = formatMessage(rule, reason, state);
            await TelegramAlert.send(msg, { parseMode: 'HTML' });
          } catch (_) { /* silent */ }
        }
        runState[rule.id] = now;
        fired++;
      }
      saveState(runState);
      this._emit();
      return { fired, state };
    },

    start(intervalMs) {
      if (this._running) return;
      if (intervalMs && intervalMs > 5_000) this._intervalMs = intervalMs;
      this._running = true;
      // First tick after a small delay so the engine has time to boot.
      setTimeout(() => { this.tick(); }, 2_000);
      this._timer = setInterval(() => { this.tick(); }, this._intervalMs);
    },
    stop() {
      this._running = false;
      if (this._timer) { clearInterval(this._timer); this._timer = null; }
    },
    isRunning() { return this._running; },
  };

  window.TRAlertsManager = Manager;

  // ---------- global open trigger ----------
  window.openTRAlerts = function openTRAlerts() {
    try { window.dispatchEvent(new CustomEvent('tr:open-alerts')); } catch (_) {}
  };

  // ---------- React panel ----------
  function TRAlertsPanel({ open, onClose }) {
    const T = {
      ink000: '#07090C', ink100: '#0B0E13', ink200: '#10141B', ink300: '#171C24',
      edge: 'rgba(255,255,255,0.06)', edgeHi: 'rgba(255,255,255,0.10)',
      text: '#ffffff', textMid: 'rgba(180,188,200,0.75)', textDim: 'rgba(130,138,150,0.55)',
      signal: '#c9a227', signalSoft: 'rgba(201,162,39,0.12)',
      bull: '#6FCF8E', bear: '#D96B6B', amber: '#E8A94B',
      mono: '"JetBrains Mono", ui-monospace, "SF Mono", Menlo, Consolas, monospace',
    };

    const [rules, setRules] = React.useState(Manager.getRules());
    const [runState, setRunState] = React.useState(Manager.getState());
    const [snapshot, setSnapshot] = React.useState(Manager.getLastSnapshot());
    const [testStatus, setTestStatus] = React.useState(null);
    const [perRuleTest, setPerRuleTest] = React.useState({}); // { [ruleId]: 'sending'|'ok'|'err' }
    const [newType, setNewType] = React.useState('BTC_ABOVE');
    const [newThreshold, setNewThreshold] = React.useState('');
    const [newCooldown, setNewCooldown] = React.useState(60);
    const [newNote, setNewNote] = React.useState('');
    const [tgConfigured, setTgConfigured] = React.useState(Manager.telegramConfigured());

    React.useEffect(() => {
      const off = Manager.onChange(() => {
        setRules(Manager.getRules());
        setRunState(Manager.getState());
        setSnapshot(Manager.getLastSnapshot());
        setTgConfigured(Manager.telegramConfigured());
      });
      const int = setInterval(() => setTgConfigured(Manager.telegramConfigured()), 4000);
      return () => { off(); clearInterval(int); };
    }, []);

    if (!open) return null;

    const inputStyle = {
      padding: '6px 10px', fontFamily: T.mono, fontSize: 11,
      background: T.ink000, border: `1px solid ${T.edge}`, color: T.text,
      borderRadius: 6, outline: 'none', width: '100%',
    };
    const labelStyle = {
      fontSize: 9, letterSpacing: 0.8, color: T.textDim,
      textTransform: 'uppercase', fontWeight: 600, marginBottom: 4,
    };

    function handleAdd() {
      const threshold = parseFloat(newThreshold);
      if (newType !== 'CONSENSUS_DIVERGENT' && !isFinite(threshold)) return;
      Manager.addRule({
        type: newType,
        threshold: isFinite(threshold) ? threshold : 0,
        cooldownMin: Math.max(1, Number(newCooldown) || 60),
        enabled: true,
        note: newNote || '',
      });
      setNewThreshold('');
      setNewNote('');
    }

    async function handleTest() {
      setTestStatus('sending');
      const res = await Manager.testSend();
      setTestStatus(res && res.ok ? 'ok' : 'err');
      setTimeout(() => setTestStatus(null), 3500);
    }

    async function handleTestRule(id) {
      setPerRuleTest(s => Object.assign({}, s, { [id]: 'sending' }));
      const res = await Manager.testSendRule(id);
      setPerRuleTest(s => Object.assign({}, s, { [id]: res && res.ok ? 'ok' : 'err' }));
      setTimeout(() => {
        setPerRuleTest(s => {
          const cp = Object.assign({}, s); delete cp[id]; return cp;
        });
      }, 3500);
    }

    function fmtLast(ts) {
      if (!ts) return '—';
      const d = Date.now() - ts;
      if (d < 60_000) return Math.round(d / 1000) + 's ago';
      if (d < 3_600_000) return Math.round(d / 60_000) + 'm ago';
      if (d < 86_400_000) return Math.round(d / 3_600_000) + 'h ago';
      return Math.round(d / 86_400_000) + 'd ago';
    }

    // Group rules by type.group
    const groupOrder = ['Crypto', 'Equities', 'Sentiment', 'Geopolitics', 'Flow', 'Other'];
    const grouped = {};
    for (const r of rules) {
      const g = groupForType(r.type);
      if (!grouped[g]) grouped[g] = [];
      grouped[g].push(r);
    }
    const groupKeys = groupOrder.filter(g => grouped[g] && grouped[g].length);

    // Hero banner — telegram status
    const tgBadge = tgConfigured
      ? { color: T.bull, bg: 'rgba(111,207,142,0.10)', border: 'rgba(111,207,142,0.4)', label: 'TELEGRAM CONNECTED' }
      : { color: T.amber, bg: 'rgba(232,169,75,0.10)', border: 'rgba(232,169,75,0.4)', label: 'TELEGRAM NOT CONFIGURED' };

    return (
      <div onClick={onClose} style={{
        position: 'fixed', inset: 0, background: 'rgba(7,9,12,0.8)',
        backdropFilter: 'blur(12px) saturate(150%)',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        zIndex: 120, padding: 40,
      }}>
        <div onClick={e => e.stopPropagation()} style={{
          width: 880, maxHeight: '94%', overflow: 'auto',
          background: T.ink100, border: `1px solid ${T.edgeHi}`, borderRadius: 14,
          padding: '22px 26px', color: T.text,
          fontFamily: '"Inter Tight", system-ui, sans-serif',
          boxShadow: '0 24px 80px rgba(0,0,0,0.6)',
        }}>
          {/* Header */}
          <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 14 }}>
            <div style={{ fontSize: 10, letterSpacing: 1.2, color: T.textDim, textTransform: 'uppercase', fontWeight: 600 }}>
              Alert Rules
            </div>
            <div style={{
              padding: '2px 8px', fontFamily: T.mono, fontSize: 9.5, fontWeight: 600, letterSpacing: 0.6,
              color: Manager.isRunning() ? T.bull : T.bear,
              background: Manager.isRunning() ? 'rgba(111,207,142,0.10)' : 'rgba(217,107,107,0.10)',
              borderRadius: 4,
              border: `0.5px solid ${Manager.isRunning() ? 'rgba(111,207,142,0.4)' : 'rgba(217,107,107,0.4)'}`,
            }}>
              {Manager.isRunning() ? 'RUNNING' : 'STOPPED'}
            </div>
            <div style={{ fontFamily: T.mono, fontSize: 9.5, color: T.textDim, letterSpacing: 0.4 }}>
              LAST TICK · {fmtLast(Manager.getLastTickAt())}
            </div>
            <div style={{ marginLeft: 'auto', display: 'flex', gap: 8 }}>
              <div onClick={handleTest} style={{
                padding: '5px 12px', fontFamily: T.mono, fontSize: 10.5, fontWeight: 600,
                background: testStatus === 'ok' ? T.bull : testStatus === 'err' ? T.bear : T.ink200,
                color: testStatus ? T.ink000 : T.textMid,
                border: `1px solid ${T.edge}`, borderRadius: 5,
                cursor: 'pointer', letterSpacing: 0.4,
              }}>
                {testStatus === 'sending' ? 'SENDING…' : testStatus === 'ok' ? 'SENT' : testStatus === 'err' ? 'FAILED' : 'TEST ALERT NOW'}
              </div>
              <div onClick={onClose} style={{
                width: 28, height: 28, borderRadius: 7,
                background: T.ink200, border: `1px solid ${T.edge}`,
                display: 'flex', alignItems: 'center', justifyContent: 'center',
                cursor: 'pointer', color: T.textMid, fontSize: 16,
              }}>×</div>
            </div>
          </div>

          {/* Hero card — what this does + telegram status */}
          <div style={{
            padding: '14px 18px', background: `linear-gradient(135deg, ${T.ink200}, ${T.ink300})`,
            border: `1px solid ${T.edgeHi}`, borderRadius: 10, marginBottom: 14,
            display: 'flex', alignItems: 'center', gap: 16,
          }}>
            <div style={{ flex: 1 }}>
              <div style={{ fontSize: 14, fontWeight: 600, color: T.text, marginBottom: 4 }}>
                Telegram push alerts — always watching
              </div>
              <div style={{ fontSize: 12, color: T.textMid, lineHeight: 1.5 }}>
                Rules fire in the background every 60s and send a Telegram message when your thresholds cross.
                Three defaults are pre-configured and ON. Add crypto, equity, macro, insider, and congress triggers below.
              </div>
            </div>
            <div style={{
              padding: '6px 12px', fontFamily: T.mono, fontSize: 10, fontWeight: 700, letterSpacing: 0.6,
              color: tgBadge.color, background: tgBadge.bg, border: `1px solid ${tgBadge.border}`,
              borderRadius: 5, whiteSpace: 'nowrap',
            }}>
              ● {tgBadge.label}
            </div>
          </div>

          {/* Empty state: Telegram not configured */}
          {!tgConfigured && (
            <div style={{
              padding: '16px 20px', background: T.ink200,
              border: `1px solid rgba(232,169,75,0.35)`, borderRadius: 10, marginBottom: 14,
            }}>
              <div style={{ fontSize: 13, fontWeight: 600, color: T.amber, marginBottom: 8 }}>
                Connect Telegram in 2 min
              </div>
              <ol style={{ margin: 0, paddingLeft: 18, fontSize: 12, color: T.textMid, lineHeight: 1.7 }}>
                <li>Open Telegram, chat <a href="https://t.me/BotFather" target="_blank" rel="noreferrer" style={{ color: T.signal, textDecoration: 'none' }}>@BotFather</a>, send <code style={{ color: T.text }}>/newbot</code>, copy the token.</li>
                <li>Chat <a href="https://t.me/userinfobot" target="_blank" rel="noreferrer" style={{ color: T.signal, textDecoration: 'none' }}>@userinfobot</a> to get your numeric chat ID.</li>
                <li>Paste both into TradeRadar Settings → Telegram and hit save.</li>
                <li>Come back here and click <b style={{ color: T.text }}>TEST ALERT NOW</b> to verify.</li>
              </ol>
            </div>
          )}

          {/* Live snapshot */}
          <div style={{
            padding: '10px 14px', background: T.ink200,
            border: `1px solid ${T.edge}`, borderRadius: 8, marginBottom: 16,
            fontFamily: T.mono, fontSize: 11, color: T.textMid, display: 'flex', gap: 18, flexWrap: 'wrap',
          }}>
            <div>BTC · <span style={{ color: T.text }}>{snapshot && snapshot.btc ? fmtUsd(snapshot.btc.price) : '—'}</span></div>
            <div>ETH · <span style={{ color: T.text }}>{snapshot && snapshot.eth ? fmtUsd(snapshot.eth.price) : '—'}</span></div>
            <div>F&amp;G · <span style={{ color: T.text }}>{snapshot && snapshot.fng ? snapshot.fng.value : '—'}</span></div>
            <div>VIX · <span style={{ color: T.text }}>{snapshot && snapshot.vix ? snapshot.vix.value.toFixed(1) : '—'}</span></div>
            <div>DXY · <span style={{ color: T.text }}>{snapshot && snapshot.dxy ? snapshot.dxy.value.toFixed(1) : '—'}</span></div>
            <div>MIL · <span style={{ color: T.text }}>{snapshot && snapshot.mil ? snapshot.mil.count : '—'}</span></div>
            <div>CONSENSUS · <span style={{ color: T.text }}>
              {snapshot && snapshot.consensus ? (snapshot.consensus.aligned ? 'aligned' : 'divergent') : '—'}
            </span></div>
          </div>

          {/* Grouped rule list */}
          <div style={{ marginBottom: 18 }}>
            <div style={{ ...labelStyle, marginBottom: 8 }}>Rules · {rules.length}</div>
            {rules.length === 0 && (
              <div style={{ color: T.textDim, fontSize: 12, padding: '12px 0' }}>No rules. Add one below.</div>
            )}
            {groupKeys.map(group => (
              <div key={group} style={{ marginBottom: 14 }}>
                <div style={{
                  fontFamily: T.mono, fontSize: 9.5, letterSpacing: 1, color: T.signal,
                  textTransform: 'uppercase', fontWeight: 700, marginBottom: 6, paddingLeft: 2,
                }}>
                  {group} · {grouped[group].length}
                </div>
                {grouped[group].map(rule => {
                  const last = runState[rule.id];
                  const recentlyTriggered = last && (Date.now() - last) < 6 * 3_600_000;
                  const prt = perRuleTest[rule.id];
                  const meta = typeMeta(rule.type);
                  const leftBorder = rule.enabled && recentlyTriggered ? T.signal : 'transparent';
                  return (
                    <div key={rule.id} style={{
                      padding: '10px 12px', marginBottom: 6,
                      background: T.ink200,
                      border: `1px solid ${rule.enabled ? T.edgeHi : T.edge}`,
                      borderLeft: `3px solid ${leftBorder}`,
                      borderRadius: 7,
                      fontFamily: T.mono, fontSize: 11,
                      display: 'grid',
                      gridTemplateColumns: '32px 28px 1fr 110px 110px 120px 80px 60px',
                      alignItems: 'center', gap: 10,
                    }}>
                      {/* Big ON/OFF toggle */}
                      <div onClick={() => Manager.toggleRule(rule.id)} style={{
                        width: 28, height: 16, borderRadius: 8,
                        background: rule.enabled ? T.signal : T.ink000,
                        border: `1px solid ${rule.enabled ? T.signal : T.edgeHi}`,
                        cursor: 'pointer', position: 'relative',
                        transition: 'all 0.15s ease',
                      }}>
                        <div style={{
                          position: 'absolute', top: 1, left: rule.enabled ? 13 : 1,
                          width: 12, height: 12, borderRadius: '50%',
                          background: rule.enabled ? T.ink000 : T.textMid,
                          transition: 'left 0.15s ease',
                        }} />
                      </div>
                      {/* Type icon */}
                      <div style={{
                        width: 24, height: 24, borderRadius: 5,
                        background: rule.enabled ? T.signalSoft : T.ink000,
                        border: `1px solid ${T.edge}`,
                        display: 'flex', alignItems: 'center', justifyContent: 'center',
                        color: rule.enabled ? T.signal : T.textDim,
                        fontSize: 13, fontWeight: 700,
                      }}>{meta.icon}</div>
                      {/* Label + note */}
                      <div>
                        <div style={{ color: rule.enabled ? T.text : T.textMid, fontWeight: 600 }}>
                          {labelForType(rule.type)}
                        </div>
                        {rule.note && (
                          <div style={{ color: T.textDim, fontSize: 10, marginTop: 2, fontFamily: '"Inter Tight", sans-serif' }}>
                            {rule.note}
                          </div>
                        )}
                      </div>
                      {/* Inline threshold */}
                      <div>
                        {rule.type !== 'CONSENSUS_DIVERGENT' ? (
                          <input
                            type="number"
                            value={rule.threshold}
                            onChange={e => Manager.updateRule(rule.id, { threshold: parseFloat(e.target.value) || 0 })}
                            style={{
                              ...inputStyle, padding: '4px 8px', fontSize: 10.5,
                              color: T.signal, fontWeight: 600, textAlign: 'right',
                            }}
                          />
                        ) : (
                          <div style={{ color: T.textDim, textAlign: 'right', fontSize: 10 }}>—</div>
                        )}
                      </div>
                      {/* Cooldown */}
                      <div>
                        <input
                          type="number"
                          value={rule.cooldownMin}
                          onChange={e => Manager.updateRule(rule.id, { cooldownMin: Math.max(1, parseInt(e.target.value, 10) || 60) })}
                          style={{
                            ...inputStyle, padding: '4px 8px', fontSize: 10.5,
                            color: T.textMid, textAlign: 'right',
                          }}
                        />
                      </div>
                      {/* Last triggered */}
                      <div style={{ color: recentlyTriggered ? T.signal : T.textDim, fontSize: 10 }}>
                        last · {fmtLast(last)}
                      </div>
                      {/* Test send per rule */}
                      <div onClick={() => handleTestRule(rule.id)} style={{
                        padding: '4px 6px', fontSize: 9.5, fontWeight: 600, letterSpacing: 0.4,
                        textAlign: 'center', cursor: 'pointer', borderRadius: 4,
                        background: prt === 'ok' ? T.bull : prt === 'err' ? T.bear : T.ink000,
                        color: prt ? T.ink000 : T.textMid,
                        border: `1px solid ${T.edge}`,
                      }}>
                        {prt === 'sending' ? '…' : prt === 'ok' ? 'SENT' : prt === 'err' ? 'ERR' : 'TEST'}
                      </div>
                      {/* Delete */}
                      <div onClick={() => Manager.deleteRule(rule.id)} style={{
                        color: T.bear, cursor: 'pointer', textAlign: 'right', fontSize: 10, fontWeight: 600,
                      }}>DELETE</div>
                    </div>
                  );
                })}
              </div>
            ))}
          </div>

          {/* Add rule */}
          <div style={{
            padding: '14px 16px', background: T.ink200,
            border: `1px solid ${T.edge}`, borderRadius: 8,
          }}>
            <div style={{ ...labelStyle, marginBottom: 10 }}>Add rule</div>
            <div style={{ display: 'grid', gridTemplateColumns: '2fr 1fr 1fr auto', gap: 10, alignItems: 'end', marginBottom: 10 }}>
              <div>
                <div style={labelStyle}>type</div>
                <select value={newType} onChange={e => setNewType(e.target.value)} style={{ ...inputStyle, height: 30 }}>
                  {groupOrder.map(g => {
                    const opts = RULE_TYPES.filter(t => t.group === g);
                    if (!opts.length) return null;
                    return (
                      <optgroup key={g} label={g}>
                        {opts.map(t => <option key={t.key} value={t.key}>{t.label}</option>)}
                      </optgroup>
                    );
                  })}
                </select>
              </div>
              <div>
                <div style={labelStyle}>threshold</div>
                <input
                  type="number"
                  value={newThreshold}
                  onChange={e => setNewThreshold(e.target.value)}
                  placeholder={(RULE_TYPES.find(r => r.key === newType) || {}).hint || ''}
                  disabled={newType === 'CONSENSUS_DIVERGENT'}
                  style={{ ...inputStyle, opacity: newType === 'CONSENSUS_DIVERGENT' ? 0.4 : 1 }}
                />
              </div>
              <div>
                <div style={labelStyle}>cooldown (min)</div>
                <input
                  type="number"
                  value={newCooldown}
                  onChange={e => setNewCooldown(e.target.value)}
                  style={inputStyle}
                />
              </div>
              <div onClick={handleAdd} style={{
                padding: '7px 16px', fontFamily: T.mono, fontSize: 11, fontWeight: 600,
                background: T.signal, color: T.ink000, borderRadius: 6,
                cursor: 'pointer', letterSpacing: 0.5, height: 30, display: 'flex', alignItems: 'center',
              }}>ADD</div>
            </div>
            <div>
              <div style={labelStyle}>note (optional)</div>
              <input
                type="text"
                value={newNote}
                onChange={e => setNewNote(e.target.value)}
                placeholder="why this matters — shows in Telegram + card"
                style={inputStyle}
              />
            </div>
          </div>

          <div style={{ marginTop: 14, fontFamily: T.mono, fontSize: 9.5, color: T.textDim, letterSpacing: 0.3 }}>
            Tick every {Math.round(Manager._intervalMs / 1000)}s · Telegram requires bot token + chat ID in Settings.
          </div>
        </div>
      </div>
    );
  }
  window.TRAlertsPanel = TRAlertsPanel;
})();
