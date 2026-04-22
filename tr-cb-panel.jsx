// tr-cb-panel.jsx — Central-bank speech aggregator modal.
//
// Surfaces recent Fed / ECB / BOJ / BOE / BIS speeches. Filter pills let you
// isolate Powell / Lagarde / Ueda / Bailey / Other. Each row has a "Score with
// AI" button that runs the existing AIAnalysis.runMulti pipeline with a
// dovish/hawkish read + actionable impact on oil / BTC / rates.
//
// Exposes:
//   window.TRCBPanel({ open, onClose })   — full modal
//   window.openTRCB()                     — dispatches open event
//
// Depends on:
//   window.CentralBanks   (engine/central-banks.js)
//   window.AIAnalysis     (engine/ai.js, for runMulti)

(function () {
  const T = {
    ink000: '#07090C', ink100: '#0B0E13', ink200: '#10141B', ink300: '#171C24',
    edge: 'rgba(255,255,255,0.06)', edgeHi: 'rgba(255,255,255,0.10)',
    text: '#ffffff', textMid: 'rgba(180,188,200,0.75)', textDim: 'rgba(130,138,150,0.55)',
    signal: '#c9a227', bull: '#6FCF8E', bear: '#D96B6B', accent: '#60a5fa',
    mono: '"JetBrains Mono", ui-monospace, "SF Mono", Menlo, Consolas, monospace',
    ui: '"Inter Tight", system-ui, -apple-system, sans-serif',
  };

  window.openTRCB = function openTRCB() {
    try { window.dispatchEvent(new CustomEvent('tr:open-cb')); } catch (_) {}
  };

  const FILTERS = [
    { id: 'all',     label: 'ALL',     match: () => true },
    { id: 'powell',  label: 'POWELL',  match: s => /powell/i.test(s.speaker) },
    { id: 'lagarde', label: 'LAGARDE', match: s => /lagarde/i.test(s.speaker) },
    { id: 'ueda',    label: 'UEDA',    match: s => /ueda/i.test(s.speaker) },
    { id: 'bailey',  label: 'BAILEY',  match: s => /bailey/i.test(s.speaker) },
    {
      id: 'other', label: 'OTHER',
      match: s => !/powell|lagarde|ueda|bailey/i.test(s.speaker || ''),
    },
  ];

  function fmtDate(d) {
    if (!d) return '—';
    const dt = new Date(d);
    if (!isFinite(dt.getTime())) return '—';
    const now = new Date();
    const diff = (now - dt) / 1000;
    if (diff < 60)      return Math.floor(diff) + 's ago';
    if (diff < 3600)    return Math.floor(diff / 60) + 'm ago';
    if (diff < 86400)   return Math.floor(diff / 3600) + 'h ago';
    if (diff < 86400 * 7) return Math.floor(diff / 86400) + 'd ago';
    return dt.toISOString().slice(0, 10);
  }

  function Pill({ active, label, onClick, color }) {
    return (
      <div onClick={onClick} style={{
        padding: '5px 12px',
        fontFamily: T.mono, fontSize: 10.5, fontWeight: 600, letterSpacing: 0.5,
        background: active ? (color || T.signal) : T.ink200,
        color: active ? T.ink000 : T.textMid,
        border: `1px solid ${active ? (color || T.signal) : T.edge}`,
        borderRadius: 5, cursor: 'pointer',
      }}>{label}</div>
    );
  }

  function SpeechRow({ speech, onScore, scoring, score }) {
    return (
      <div style={{
        padding: '14px 18px', borderBottom: `1px solid ${T.edge}`,
        display: 'flex', gap: 14, alignItems: 'flex-start',
      }}>
        <div style={{
          flex: '0 0 56px', textAlign: 'center',
          padding: '4px 0',
        }}>
          <div style={{
            fontFamily: T.mono, fontSize: 10.5, fontWeight: 700,
            color: speech.bankColor, letterSpacing: 0.8,
          }}>{speech.bankShort}</div>
          <div style={{ fontFamily: T.mono, fontSize: 9, color: T.textDim, marginTop: 2 }}>
            {fmtDate(speech.date)}
          </div>
        </div>

        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontSize: 11, color: T.signal, fontWeight: 600, marginBottom: 3 }}>
            {speech.speaker || '—'}
          </div>
          <a href={speech.link} target="_blank" rel="noopener noreferrer" style={{
            display: 'block', color: T.text, fontSize: 13, fontWeight: 500,
            textDecoration: 'none', lineHeight: 1.35, marginBottom: 5,
          }}>{speech.title}</a>
          {speech.excerpt && (
            <div style={{ fontSize: 11, color: T.textMid, lineHeight: 1.45 }}>
              {speech.excerpt}
            </div>
          )}
          {score && score.consensus && (
            <div style={{
              marginTop: 8, padding: '8px 10px', background: T.ink200,
              border: `1px solid ${T.edge}`, borderRadius: 6,
              fontSize: 11.5, color: T.text, lineHeight: 1.5,
            }}>
              <div style={{
                display: 'inline-block', padding: '2px 8px', borderRadius: 4,
                background: score.consensus.agree ? 'rgba(111,207,142,0.15)' : 'rgba(217,107,107,0.15)',
                color: score.consensus.agree ? T.bull : T.bear,
                fontFamily: T.mono, fontSize: 9.5, letterSpacing: 0.6, marginBottom: 5,
              }}>{score.consensus.label || 'AI READ'}</div>
              <div>{score.consensus.summary}</div>
            </div>
          )}
        </div>

        <div style={{ flex: '0 0 120px', display: 'flex', flexDirection: 'column', gap: 6 }}>
          <button onClick={onScore} disabled={scoring} style={{
            padding: '6px 10px', fontFamily: T.mono, fontSize: 10, fontWeight: 600,
            letterSpacing: 0.5, background: scoring ? T.ink300 : T.ink200,
            color: scoring ? T.textDim : T.signal,
            border: `1px solid ${T.edgeHi}`, borderRadius: 5,
            cursor: scoring ? 'default' : 'pointer',
          }}>{scoring ? 'SCORING…' : 'SCORE WITH AI'}</button>
          <a href={speech.link} target="_blank" rel="noopener noreferrer" style={{
            padding: '6px 10px', fontFamily: T.mono, fontSize: 10, fontWeight: 500,
            letterSpacing: 0.5, background: 'transparent',
            color: T.textMid, textAlign: 'center',
            border: `1px solid ${T.edge}`, borderRadius: 5, textDecoration: 'none',
          }}>READ ↗</a>
        </div>
      </div>
    );
  }

  function TRCBPanel({ open, onClose }) {
    const [speeches, setSpeeches] = React.useState([]);
    const [loading, setLoading]   = React.useState(false);
    const [filter, setFilter]     = React.useState('all');
    const [scores, setScores]     = React.useState({}); // { link: {consensus,…} }
    const [scoring, setScoring]   = React.useState({}); // { link: true }
    const [refreshTick, setRefreshTick] = React.useState(0);

    React.useEffect(() => {
      if (!open) return;
      let active = true;
      setLoading(true);
      (async () => {
        try {
          if (!window.CentralBanks) return;
          const rows = await window.CentralBanks.fetchSpeeches({
            banks: ['fed', 'ecb', 'boj', 'boe', 'bis'],
            limit: 60,
          });
          if (active) setSpeeches(rows || []);
        } catch (e) {
          console.warn('[TRCBPanel] load failed', e && e.message);
        } finally {
          if (active) setLoading(false);
        }
      })();
      return () => { active = false; };
    }, [open, refreshTick]);

    async function scoreSpeech(speech) {
      const key = speech.link || speech.title;
      if (!window.AIAnalysis || !window.AIAnalysis.runMulti) {
        alert('Add a Claude or OpenAI key in Settings to enable scoring.');
        return;
      }
      setScoring(s => ({ ...s, [key]: true }));
      try {
        const headlines = [{
          title: `[${speech.bankShort} · ${speech.speaker}] ${speech.title}`,
          source: speech.bankShort,
          description: speech.excerpt || '',
        }];
        const res = await window.AIAnalysis.runMulti(headlines, {});
        setScores(s => ({ ...s, [key]: res }));
      } catch (e) {
        console.warn('[TRCBPanel] score failed', e && e.message);
      } finally {
        setScoring(s => ({ ...s, [key]: false }));
      }
    }

    if (!open) return null;

    const active = FILTERS.find(f => f.id === filter) || FILTERS[0];
    const filtered = speeches.filter(active.match);

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
              }}>CENTRAL BANKS · Speech aggregator</div>
              <div style={{ fontSize: 13, color: T.text, fontWeight: 500 }}>
                Fed · ECB · BOJ · BOE · BIS
              </div>
            </div>
            <div style={{ flex: 1 }} />
            <div style={{ fontFamily: T.mono, fontSize: 10, color: T.textDim }}>
              {loading ? 'LOADING…' : `${filtered.length} / ${speeches.length} speeches`}
            </div>
            <div onClick={() => setRefreshTick(t => t + 1)} style={{
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

          {/* Filter pills */}
          <div style={{
            padding: '12px 22px', borderBottom: `1px solid ${T.edge}`,
            display: 'flex', gap: 8, flexWrap: 'wrap', background: T.ink100,
          }}>
            {FILTERS.map(f => (
              <Pill key={f.id} label={f.label} active={f.id === filter}
                onClick={() => setFilter(f.id)} />
            ))}
          </div>

          {/* Speech list */}
          <div style={{ flex: 1, overflowY: 'auto' }}>
            {!loading && !filtered.length && (
              <div style={{ padding: '30px 22px', fontSize: 12, color: T.textDim }}>
                No speeches in the current filter. Try REFRESH or a different speaker.
              </div>
            )}
            {filtered.map((s, i) => {
              const k = s.link || s.title + i;
              return (
                <SpeechRow
                  key={k}
                  speech={s}
                  scoring={!!scoring[k]}
                  score={scores[k]}
                  onScore={() => scoreSpeech(s)}
                />
              );
            })}
          </div>

          {/* Footer */}
          <div style={{
            padding: '10px 22px', borderTop: `1px solid ${T.edge}`,
            background: T.ink200,
            fontFamily: T.mono, fontSize: 9.5, color: T.textDim, letterSpacing: 0.4,
          }}>
            Sources: federalreserve.gov · ecb.europa.eu · boj.or.jp · bankofengland.co.uk · bis.org
            &nbsp;·&nbsp;15-min cache · AI score uses configured Claude / OpenAI keys
          </div>
        </div>
      </div>
    );
  }

  window.TRCBPanel = TRCBPanel;
})();
