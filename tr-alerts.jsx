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
//
// Depends on (all attached to window by engine/*.js):
//   LiveData.getCryptoPrices, LiveData.getFearGreed
//   MilitaryFlights.getMidEast
//   TelegramAlert.send
//
// Consensus divergence check reads summary screen's LLM predictions if cached
// on window.TR_LAST_PREDS (best-effort — skipped silently if unavailable).

(function () {
  const RULES_KEY = 'tr_alert_rules';
  const STATE_KEY = 'tr_alert_state';
  const DEFAULT_COOLDOWN_MIN = 60;

  // ---------- storage helpers ----------
  function loadRules() {
    try {
      const raw = localStorage.getItem(RULES_KEY);
      if (!raw) return seedDefaults();
      const parsed = JSON.parse(raw);
      if (!Array.isArray(parsed)) return seedDefaults();
      return parsed;
    } catch (_) { return seedDefaults(); }
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
    // Non-destructive: seeded only when localStorage is empty. Every rule starts
    // disabled so the user opts in from the panel.
    const seeds = [
      { id: mkId(), type: 'BTC_ABOVE',           threshold: 110000, cooldownMin: 60,  enabled: false },
      { id: mkId(), type: 'BTC_BELOW',           threshold: 80000,  cooldownMin: 60,  enabled: false },
      { id: mkId(), type: 'FG_ABOVE',            threshold: 80,     cooldownMin: 120, enabled: false },
      { id: mkId(), type: 'FG_BELOW',            threshold: 25,     cooldownMin: 120, enabled: false },
      { id: mkId(), type: 'MIL_FLIGHTS_ABOVE',   threshold: 10,     cooldownMin: 45,  enabled: false },
      { id: mkId(), type: 'CONSENSUS_DIVERGENT', threshold: 0,      cooldownMin: 180, enabled: false },
    ];
    saveRules(seeds);
    return seeds;
  }

  function mkId() {
    return 'r_' + Math.random().toString(36).slice(2, 10) + Date.now().toString(36).slice(-4);
  }

  // ---------- rule type metadata ----------
  const RULE_TYPES = [
    { key: 'BTC_ABOVE',           label: 'BTC above',              unit: 'USD',    hint: 'e.g. 110000' },
    { key: 'BTC_BELOW',           label: 'BTC below',              unit: 'USD',    hint: 'e.g. 80000' },
    { key: 'FG_ABOVE',            label: 'Fear & Greed above',     unit: 'index',  hint: '0-100' },
    { key: 'FG_BELOW',            label: 'Fear & Greed below',     unit: 'index',  hint: '0-100' },
    { key: 'MIL_FLIGHTS_ABOVE',   label: 'US mil flights above',   unit: 'count',  hint: 'CENTCOM ADS-B count' },
    { key: 'CONSENSUS_DIVERGENT', label: 'LLM consensus divergent', unit: '',      hint: 'no threshold' },
  ];

  function labelForType(key) {
    const t = RULE_TYPES.find(r => r.key === key);
    return t ? t.label : key;
  }

  // ---------- evaluation ----------
  // state := { btc:{price}, fng:{value}, mil:{count}, consensus:{aligned, sentiment, sentiments:[]} }
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
      case 'MIL_FLIGHTS_ABOVE':
        if (state.mil && isFinite(state.mil.count) && state.mil.count > rule.threshold) {
          return `US military flights above ${rule.threshold}: ${state.mil.count} tracked over CENTCOM`;
        }
        return null;
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
    const out = { btc: null, fng: null, mil: null, consensus: null };
    try {
      if (typeof LiveData !== 'undefined') {
        const prices = await LiveData.getCryptoPrices();
        if (prices && prices.bitcoin && isFinite(prices.bitcoin.usd)) {
          out.btc = { price: prices.bitcoin.usd, change24h: prices.bitcoin.usd_24h_change };
        }
        const fg = await LiveData.getFearGreed();
        if (fg && fg.data && fg.data[0]) {
          out.fng = {
            value: parseInt(fg.data[0].value, 10),
            classification: fg.data[0].value_classification,
          };
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
    const ctx = [];
    if (state.btc) ctx.push(`BTC ${fmtUsd(state.btc.price)}`);
    if (state.fng) ctx.push(`F&amp;G ${state.fng.value}`);
    if (state.mil) ctx.push(`MIL ${state.mil.count}`);
    if (ctx.length) lines.push('<i>' + ctx.join(' · ') + '</i>');
    lines.push('<code>' + new Date().toISOString() + '</code>');
    return lines.join('\n');
  }
  function escapeHtml(s) {
    return String(s == null ? '' : s)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
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
      signal: '#c9a227', bull: '#6FCF8E', bear: '#D96B6B',
      mono: '"JetBrains Mono", ui-monospace, "SF Mono", Menlo, Consolas, monospace',
    };

    const [rules, setRules] = React.useState(Manager.getRules());
    const [runState, setRunState] = React.useState(Manager.getState());
    const [snapshot, setSnapshot] = React.useState(Manager.getLastSnapshot());
    const [testStatus, setTestStatus] = React.useState(null);
    const [newType, setNewType] = React.useState('BTC_ABOVE');
    const [newThreshold, setNewThreshold] = React.useState('');
    const [newCooldown, setNewCooldown] = React.useState(60);

    React.useEffect(() => {
      const off = Manager.onChange(() => {
        setRules(Manager.getRules());
        setRunState(Manager.getState());
        setSnapshot(Manager.getLastSnapshot());
      });
      return off;
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
      });
      setNewThreshold('');
    }

    async function handleTest() {
      setTestStatus('sending');
      const res = await Manager.testSend();
      setTestStatus(res && res.ok ? 'ok' : 'err');
      setTimeout(() => setTestStatus(null), 3500);
    }

    function fmtLast(ts) {
      if (!ts) return '—';
      const d = Date.now() - ts;
      if (d < 60_000) return Math.round(d / 1000) + 's ago';
      if (d < 3_600_000) return Math.round(d / 60_000) + 'm ago';
      if (d < 86_400_000) return Math.round(d / 3_600_000) + 'h ago';
      return Math.round(d / 86_400_000) + 'd ago';
    }

    return (
      <div onClick={onClose} style={{
        position: 'fixed', inset: 0, background: 'rgba(7,9,12,0.8)',
        backdropFilter: 'blur(12px) saturate(150%)',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        zIndex: 120, padding: 40,
      }}>
        <div onClick={e => e.stopPropagation()} style={{
          width: 820, maxHeight: '92%', overflow: 'auto',
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
                {testStatus === 'sending' ? 'SENDING…' : testStatus === 'ok' ? 'SENT' : testStatus === 'err' ? 'FAILED' : 'TEST SEND'}
              </div>
              <div onClick={onClose} style={{
                width: 28, height: 28, borderRadius: 7,
                background: T.ink200, border: `1px solid ${T.edge}`,
                display: 'flex', alignItems: 'center', justifyContent: 'center',
                cursor: 'pointer', color: T.textMid, fontSize: 16,
              }}>×</div>
            </div>
          </div>

          {/* Live snapshot */}
          <div style={{
            padding: '10px 14px', background: T.ink200,
            border: `1px solid ${T.edge}`, borderRadius: 8, marginBottom: 16,
            fontFamily: T.mono, fontSize: 11, color: T.textMid, display: 'flex', gap: 18, flexWrap: 'wrap',
          }}>
            <div>BTC · <span style={{ color: T.text }}>{snapshot && snapshot.btc ? fmtUsd(snapshot.btc.price) : '—'}</span></div>
            <div>F&amp;G · <span style={{ color: T.text }}>{snapshot && snapshot.fng ? snapshot.fng.value : '—'}</span></div>
            <div>MIL · <span style={{ color: T.text }}>{snapshot && snapshot.mil ? snapshot.mil.count : '—'}</span></div>
            <div>CONSENSUS · <span style={{ color: T.text }}>
              {snapshot && snapshot.consensus ? (snapshot.consensus.aligned ? 'aligned' : 'divergent') : '—'}
            </span></div>
          </div>

          {/* Rule list */}
          <div style={{ marginBottom: 18 }}>
            <div style={{ ...labelStyle, marginBottom: 8 }}>Rules · {rules.length}</div>
            {rules.length === 0 && (
              <div style={{ color: T.textDim, fontSize: 12, padding: '12px 0' }}>No rules. Add one below.</div>
            )}
            {rules.map(rule => {
              const last = runState[rule.id];
              return (
                <div key={rule.id} style={{
                  display: 'grid',
                  gridTemplateColumns: '24px 1fr 100px 100px 100px 60px',
                  alignItems: 'center', gap: 10,
                  padding: '9px 10px', marginBottom: 6,
                  background: T.ink200, border: `1px solid ${T.edge}`, borderRadius: 7,
                  fontFamily: T.mono, fontSize: 11,
                }}>
                  <div onClick={() => Manager.toggleRule(rule.id)} style={{
                    width: 18, height: 18, borderRadius: 4,
                    background: rule.enabled ? T.signal : 'transparent',
                    border: `1px solid ${rule.enabled ? T.signal : T.edgeHi}`,
                    cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center',
                    color: T.ink000, fontSize: 12, fontWeight: 700,
                  }}>{rule.enabled ? '✓' : ''}</div>
                  <div style={{ color: rule.enabled ? T.text : T.textMid }}>
                    {labelForType(rule.type)}
                    {rule.type !== 'CONSENSUS_DIVERGENT' && (
                      <span style={{ color: T.signal, marginLeft: 6 }}>
                        {rule.type.startsWith('BTC') ? fmtUsd(rule.threshold) : rule.threshold}
                      </span>
                    )}
                  </div>
                  <div style={{ color: T.textDim }}>{rule.cooldownMin}m cool</div>
                  <div style={{ color: T.textDim }}>last · {fmtLast(last)}</div>
                  <div style={{ color: T.textDim, fontSize: 9.5 }}>{rule.id.slice(-6)}</div>
                  <div onClick={() => Manager.deleteRule(rule.id)} style={{
                    color: T.bear, cursor: 'pointer', textAlign: 'right', fontSize: 10, fontWeight: 600,
                  }}>DELETE</div>
                </div>
              );
            })}
          </div>

          {/* Add rule */}
          <div style={{
            padding: '14px 16px', background: T.ink200,
            border: `1px solid ${T.edge}`, borderRadius: 8,
          }}>
            <div style={{ ...labelStyle, marginBottom: 10 }}>Add rule</div>
            <div style={{ display: 'grid', gridTemplateColumns: '2fr 1fr 1fr auto', gap: 10, alignItems: 'end' }}>
              <div>
                <div style={labelStyle}>type</div>
                <select value={newType} onChange={e => setNewType(e.target.value)} style={{ ...inputStyle, height: 30 }}>
                  {RULE_TYPES.map(t => <option key={t.key} value={t.key}>{t.label}</option>)}
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
