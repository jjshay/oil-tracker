// tr-scenarios-panel.jsx — TradeRadar Scenario Playbook.
//
// Pre-computed "If X happens, then Y" scenarios for the top catalysts on the
// radar. When the catalyst fires in real time, the user has a reference point
// instead of panicking.
//
// Exposes:
//   window.TRScenariosPanel   — React modal ({ open, onClose })
//   window.openTRScenarios()  — dispatches CustomEvent('tr:open-scenarios')
//
// Optional dependency:
//   window.AIAnalysis.runMulti  — if present, "Refresh" can override seeds.

(function () {
  const T = {
    ink000: '#07090C', ink100: '#0B0E13', ink200: '#10141B', ink300: '#171C24',
    edge: 'rgba(255,255,255,0.06)', edgeHi: 'rgba(255,255,255,0.10)',
    text: '#ffffff', textMid: 'rgba(180,188,200,0.75)', textDim: 'rgba(130,138,150,0.55)',
    signal: '#c9a227', bull: '#6FCF8E', bear: '#D96B6B',
    mono: '"JetBrains Mono", ui-monospace, "SF Mono", Menlo, Consolas, monospace',
  };

  const STORAGE_KEY = 'tr_scenarios_v1';

  // Seed scenarios — hardcoded fallback if no LLM keys / no user override.
  // `impacts` use a `bias` ('bull' | 'bear' | 'neutral') that is interpreted
  // from the asset holder's perspective (e.g. oil +$15 is bearish for SPX
  // longs but green on the Oil row because it's the oil price going up).
  const SEED_SCENARIOS = [
    {
      title: 'Iran closes Strait of Hormuz',
      probability: 'Low',
      status: 'ARMED',
      expandedByDefault: true,
      impacts: [
        { asset: 'Oil (WTI)', move: '+$15/bbl',  confidence: 'High',   bias: 'bull' },
        { asset: 'SPX',       move: '-3%',       confidence: 'High',   bias: 'bear' },
        { asset: 'BTC',       move: '-8%',       confidence: 'Medium', bias: 'bear' },
        { asset: 'DXY',       move: '+1.5%',     confidence: 'High',   bias: 'bull' },
      ],
    },
    {
      title: 'Fed cuts 50bp at next meeting (surprise)',
      probability: 'Low',
      status: 'ARMED',
      expandedByDefault: false,
      impacts: [
        { asset: 'BTC',  move: '+6%',   confidence: 'High',   bias: 'bull' },
        { asset: 'SPX',  move: '+2%',   confidence: 'High',   bias: 'bull' },
        { asset: 'DXY',  move: '-1.2%', confidence: 'High',   bias: 'bear' },
        { asset: 'Gold', move: '+2%',   confidence: 'Medium', bias: 'bull' },
      ],
    },
    {
      title: 'CLARITY Act fails in Senate',
      probability: 'Medium',
      status: 'ARMED',
      expandedByDefault: false,
      impacts: [
        { asset: 'BTC',  move: '-6%',  confidence: 'Medium', bias: 'bear' },
        { asset: 'COIN', move: '-12%', confidence: 'High',   bias: 'bear' },
        { asset: 'MSTR', move: '-9%',  confidence: 'High',   bias: 'bear' },
      ],
    },
    {
      title: 'BLS print +0.5% hotter than expected on CPI',
      probability: 'Medium',
      status: 'ARMED',
      expandedByDefault: false,
      impacts: [
        { asset: 'US 10Y Yield', move: '+15bp', confidence: 'High',   bias: 'bull' },
        { asset: 'SPX',          move: '-1.5%', confidence: 'High',   bias: 'bear' },
        { asset: 'BTC',          move: '-4%',   confidence: 'Medium', bias: 'bear' },
      ],
    },
    {
      title: 'OPEC+ adds 1Mbpd of supply',
      probability: 'Medium',
      status: 'ARMED',
      expandedByDefault: false,
      impacts: [
        { asset: 'Oil (WTI)',   move: '-$6/bbl', confidence: 'High',   bias: 'bear' },
        { asset: 'XLE',         move: '-3%',     confidence: 'High',   bias: 'bear' },
        { asset: 'Russia/ME EM', move: '-2%',    confidence: 'Medium', bias: 'bear' },
      ],
    },
    {
      title: 'Taiwan Strait escalation (military exercise upgrade)',
      probability: 'Low',
      status: 'ARMED',
      expandedByDefault: false,
      impacts: [
        { asset: 'SPX',       move: '-2.5%',  confidence: 'High',   bias: 'bear' },
        { asset: 'Gold',      move: '+2%',    confidence: 'High',   bias: 'bull' },
        { asset: 'Oil (WTI)', move: '+$4/bbl', confidence: 'Medium', bias: 'bull' },
        { asset: 'Semis (SOXX)', move: '-5%', confidence: 'High',   bias: 'bear' },
      ],
    },
  ];

  const LLM_PROMPT = [
    'You are a market risk analyst. Produce exactly 6 "If X happens, then Y" scenarios',
    'relevant to the current macro/geopolitical news flow (oil, Fed policy, crypto',
    'regulation, inflation prints, OPEC+, Taiwan/China, Iran, US elections).',
    '',
    'Return STRICT JSON (no prose, no markdown fences) with this shape:',
    '{ "scenarios": [ {',
    '    "title": "short actionable catalyst sentence",',
    '    "probability": "Low" | "Medium" | "High",',
    '    "impacts": [',
    '      { "asset": "SPX" | "BTC" | "Oil (WTI)" | "DXY" | "Gold" | "US 10Y Yield" | ticker,',
    '        "move": "+2%" | "-$6/bbl" | "+15bp",',
    '        "confidence": "Low" | "Medium" | "High",',
    '        "bias": "bull" | "bear" | "neutral" }',
    '    ]',
    '} ] }',
    '',
    'Each scenario must have 3-4 impacts. Keep titles under 80 chars.',
    '"bias" is from the perspective of the asset itself moving up (bull) or down (bear).',
    'Return exactly 6 scenarios. No commentary.',
  ].join('\n');

  // ------------------------------------------------------------------
  // Storage helpers
  // ------------------------------------------------------------------
  function loadStored() {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (!raw) return null;
      const parsed = JSON.parse(raw);
      if (!parsed || !Array.isArray(parsed.scenarios)) return null;
      return parsed;
    } catch (_) { return null; }
  }

  function saveStored(scenarios) {
    try {
      const payload = {
        updated: new Date().toISOString(),
        scenarios: scenarios,
      };
      localStorage.setItem(STORAGE_KEY, JSON.stringify(payload));
    } catch (_) {}
  }

  function cloneSeeds() {
    return SEED_SCENARIOS.map(s => ({
      title: s.title,
      probability: s.probability,
      status: s.status,
      expandedByDefault: s.expandedByDefault,
      impacts: s.impacts.map(i => ({ ...i })),
    }));
  }

  window.openTRScenarios = function openTRScenarios() {
    try { window.dispatchEvent(new CustomEvent('tr:open-scenarios')); } catch (_) {}
  };

  // ------------------------------------------------------------------
  // Sub-components
  // ------------------------------------------------------------------
  function StatusDot({ status, onClick }) {
    const color = status === 'ARMED' ? T.bull
                : status === 'TRIGGERED' ? T.bear
                : T.signal;
    return (
      <span
        onClick={(e) => { e.stopPropagation(); onClick && onClick(); }}
        title={`Status: ${status} (click to cycle)`}
        style={{
          display: 'inline-block', width: 10, height: 10, borderRadius: '50%',
          background: color, boxShadow: `0 0 6px ${color}`,
          cursor: 'pointer', flexShrink: 0,
        }}
      />
    );
  }

  function ProbChip({ probability }) {
    const bg = probability === 'High' ? T.bear + '22'
             : probability === 'Medium' ? T.signal + '22'
             : T.ink300;
    const border = probability === 'High' ? T.bear
                 : probability === 'Medium' ? T.signal
                 : T.edgeHi;
    return (
      <span style={{
        fontSize: 10, letterSpacing: 0.5, padding: '2px 8px',
        border: `1px solid ${border}`, borderRadius: 999,
        background: bg, color: T.text, textTransform: 'uppercase',
        fontFamily: T.mono,
      }}>{probability}</span>
    );
  }

  function ImpactTable({ impacts }) {
    return (
      <table style={{
        width: '100%', borderCollapse: 'collapse', fontSize: 13,
        fontFamily: T.mono, marginTop: 8,
      }}>
        <thead>
          <tr style={{ color: T.textDim, fontSize: 10, letterSpacing: 0.5, textTransform: 'uppercase' }}>
            <th style={{ textAlign: 'left',  padding: '6px 10px', borderBottom: `1px solid ${T.edge}` }}>Asset</th>
            <th style={{ textAlign: 'right', padding: '6px 10px', borderBottom: `1px solid ${T.edge}` }}>Expected Move</th>
            <th style={{ textAlign: 'right', padding: '6px 10px', borderBottom: `1px solid ${T.edge}` }}>Confidence</th>
          </tr>
        </thead>
        <tbody>
          {impacts.map((imp, i) => {
            const color = imp.bias === 'bull' ? T.bull
                        : imp.bias === 'bear' ? T.bear
                        : T.textMid;
            return (
              <tr key={i}>
                <td style={{ padding: '6px 10px', borderBottom: `1px solid ${T.edge}`, color: T.text }}>
                  {imp.asset}
                </td>
                <td style={{
                  padding: '6px 10px', borderBottom: `1px solid ${T.edge}`,
                  color: color, textAlign: 'right', fontWeight: 600,
                }}>
                  {imp.move}
                </td>
                <td style={{
                  padding: '6px 10px', borderBottom: `1px solid ${T.edge}`,
                  color: T.textMid, textAlign: 'right',
                }}>
                  {imp.confidence}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    );
  }

  function ScenarioCard({ scenario, index, expanded, onToggleExpand, onCycleStatus }) {
    const open = !!expanded;
    return (
      <div style={{
        background: open ? T.ink200 : T.ink100,
        border: open ? `1px solid ${T.signal}55` : `1px solid ${T.edge}`,
        borderRadius: 10,
        marginBottom: 10,
        overflow: 'hidden',
        transition: 'background 120ms ease, border 120ms ease',
      }}>
        <div
          onClick={onToggleExpand}
          style={{
            display: 'flex', alignItems: 'center', gap: 12,
            padding: '12px 14px', cursor: 'pointer',
          }}
        >
          <StatusDot status={scenario.status} onClick={onCycleStatus} />
          <span style={{
            fontSize: 11, color: T.textDim, fontFamily: T.mono,
            width: 22, flexShrink: 0,
          }}>
            {String(index + 1).padStart(2, '0')}
          </span>
          <span style={{ flex: 1, fontSize: 14, color: T.text, fontWeight: 500 }}>
            {scenario.title}
          </span>
          <ProbChip probability={scenario.probability} />
          <span style={{ color: T.textDim, fontSize: 14, marginLeft: 4 }}>
            {open ? '▾' : '▸'}
          </span>
        </div>
        {open && (
          <div style={{ padding: '0 14px 14px 14px' }}>
            <ImpactTable impacts={scenario.impacts} />
            <div style={{
              marginTop: 10, fontSize: 11, color: T.textDim, fontFamily: T.mono,
              display: 'flex', gap: 16, flexWrap: 'wrap',
            }}>
              <span>Status: <span style={{ color: T.text }}>{scenario.status}</span></span>
              <span>Probability: <span style={{ color: T.text }}>{scenario.probability}</span></span>
              <span style={{ color: T.textDim }}>Click the status dot to cycle ARMED → PAUSED → TRIGGERED.</span>
            </div>
          </div>
        )}
      </div>
    );
  }

  // ------------------------------------------------------------------
  // Main panel
  // ------------------------------------------------------------------
  function TRScenariosPanel({ open, onClose }) {
    const [scenarios, setScenarios] = React.useState(() => {
      const stored = loadStored();
      if (stored && stored.scenarios && stored.scenarios.length) {
        return stored.scenarios;
      }
      return cloneSeeds();
    });

    const [expandedIdx, setExpandedIdx] = React.useState(() => {
      const s = (loadStored() && loadStored().scenarios) || SEED_SCENARIOS;
      const i = s.findIndex(x => x.expandedByDefault);
      return i >= 0 ? i : 0;
    });

    const [refreshing, setRefreshing] = React.useState(false);
    const [llmModel, setLlmModel] = React.useState(null);
    const [refreshError, setRefreshError] = React.useState(null);
    const [updatedAt, setUpdatedAt] = React.useState(() => {
      const s = loadStored();
      return s ? s.updated : null;
    });

    // Persist on every change.
    React.useEffect(() => {
      saveStored(scenarios);
      setUpdatedAt(new Date().toISOString());
    }, [scenarios]);

    function cycleStatus(i) {
      setScenarios(prev => prev.map((s, idx) => {
        if (idx !== i) return s;
        const next = s.status === 'ARMED' ? 'PAUSED'
                   : s.status === 'PAUSED' ? 'TRIGGERED'
                   : 'ARMED';
        return { ...s, status: next };
      }));
    }

    function toggleExpand(i) {
      setExpandedIdx(cur => (cur === i ? -1 : i));
    }

    async function refreshWithLLM() {
      setRefreshError(null);
      const AI = window.AIAnalysis;
      if (!AI || typeof AI.runMulti !== 'function') {
        setRefreshError('No LLM configured — using seeds.');
        return;
      }
      setRefreshing(true);
      try {
        const result = await AI.runMulti({
          prompt: LLM_PROMPT,
          maxTokens: 1400,
          temperature: 0.3,
        });
        const text = (result && (result.text || result.output || result.content)) || '';
        const modelName = (result && (result.model || result.provider)) || 'LLM';
        // Try to parse JSON — tolerant to leading/trailing prose.
        let parsed = null;
        try {
          parsed = JSON.parse(text);
        } catch (_) {
          const m = text.match(/\{[\s\S]*\}/);
          if (m) {
            try { parsed = JSON.parse(m[0]); } catch (_) {}
          }
        }
        if (!parsed || !Array.isArray(parsed.scenarios) || parsed.scenarios.length === 0) {
          throw new Error('Malformed LLM response');
        }
        const cleaned = parsed.scenarios.slice(0, 6).map((s, i) => ({
          title: String(s.title || 'Untitled scenario').slice(0, 140),
          probability: ['Low', 'Medium', 'High'].includes(s.probability) ? s.probability : 'Medium',
          status: 'ARMED',
          expandedByDefault: i === 0,
          impacts: Array.isArray(s.impacts) ? s.impacts.slice(0, 5).map(imp => ({
            asset: String(imp.asset || '—').slice(0, 32),
            move: String(imp.move || '—').slice(0, 24),
            confidence: ['Low', 'Medium', 'High'].includes(imp.confidence) ? imp.confidence : 'Medium',
            bias: ['bull', 'bear', 'neutral'].includes(imp.bias) ? imp.bias : 'neutral',
          })) : [],
        }));
        setScenarios(cleaned);
        setExpandedIdx(0);
        setLlmModel(modelName);
      } catch (err) {
        setRefreshError((err && err.message) || 'LLM refresh failed');
      } finally {
        setRefreshing(false);
      }
    }

    if (!open) return null;

    return (
      <div onClick={onClose} style={{
        position: 'fixed', inset: 0, background: 'rgba(7,9,12,0.8)',
        backdropFilter: 'blur(12px) saturate(150%)',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        zIndex: 120, padding: 40,
      }}>
        <div onClick={e => e.stopPropagation()} style={{
          width: 680, maxHeight: '92%', overflow: 'hidden',
          display: 'flex', flexDirection: 'column',
          background: T.ink100, border: `1px solid ${T.edgeHi}`, borderRadius: 14,
          color: T.text,
          fontFamily: '"Inter Tight", system-ui, sans-serif',
          boxShadow: '0 24px 80px rgba(0,0,0,0.6)',
        }}>

          {/* Header */}
          <div style={{
            padding: '18px 22px 14px 22px',
            borderBottom: `1px solid ${T.edge}`,
            display: 'flex', alignItems: 'center', gap: 12,
          }}>
            <div style={{ flex: 1 }}>
              <div style={{
                fontSize: 10, letterSpacing: 1.5, color: T.signal,
                textTransform: 'uppercase', fontFamily: T.mono,
              }}>
                TradeRadar · Scenario Playbook
              </div>
              <div style={{ fontSize: 18, fontWeight: 600, marginTop: 2 }}>
                If X happens, then Y
              </div>
              <div style={{ fontSize: 11, color: T.textDim, marginTop: 2, fontFamily: T.mono }}>
                {updatedAt ? `Updated ${new Date(updatedAt).toISOString().replace('T', ' ').slice(0, 16)} UTC` : 'Seed scenarios'}
                {llmModel ? ` · ${llmModel}` : ''}
              </div>
            </div>
            <button
              onClick={refreshWithLLM}
              disabled={refreshing}
              style={{
                fontSize: 11, fontFamily: T.mono,
                padding: '8px 12px', borderRadius: 8,
                background: refreshing ? T.ink300 : T.ink200,
                color: refreshing ? T.textDim : T.signal,
                border: `1px solid ${T.signal}55`,
                cursor: refreshing ? 'wait' : 'pointer',
                letterSpacing: 0.5, textTransform: 'uppercase',
              }}
            >
              {refreshing ? '↻ Refreshing…' : '↻ Refresh scenarios with LLM'}
            </button>
            <button
              onClick={onClose}
              style={{
                background: 'transparent', border: 'none', color: T.textMid,
                fontSize: 22, cursor: 'pointer', padding: '0 4px',
              }}
              aria-label="Close"
            >×</button>
          </div>

          {refreshError && (
            <div style={{
              padding: '8px 22px', fontSize: 11, fontFamily: T.mono,
              color: T.bear, background: T.bear + '11',
              borderBottom: `1px solid ${T.edge}`,
            }}>
              {refreshError}
            </div>
          )}

          {/* Body */}
          <div style={{
            padding: '16px 22px 22px 22px',
            overflowY: 'auto', flex: 1,
          }}>
            <div style={{
              fontSize: 11, color: T.textDim, marginBottom: 12, lineHeight: 1.5,
            }}>
              Pre-compute your reaction. When a catalyst fires, you already know the expected
              move, not the panic move. Click any card to expand. Click the status dot to cycle
              <span style={{ color: T.bull }}> ARMED </span>→
              <span style={{ color: T.signal }}> PAUSED </span>→
              <span style={{ color: T.bear }}> TRIGGERED</span>.
            </div>
            {scenarios.map((s, i) => (
              <ScenarioCard
                key={i}
                index={i}
                scenario={s}
                expanded={expandedIdx === i}
                onToggleExpand={() => toggleExpand(i)}
                onCycleStatus={() => cycleStatus(i)}
              />
            ))}
          </div>
        </div>
      </div>
    );
  }

  window.TRScenariosPanel = TRScenariosPanel;
})();
