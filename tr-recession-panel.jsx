// tr-recession-panel.jsx — Recession probability modal.
//
// Surfaces the NY Fed 12-month recession probability, key yield-curve spreads,
// consumer sentiment, and the Philly Fed leading index, blended into a single
// composite risk gauge (0-100). Historical NBER recessions overlaid on charts.
//
// Exposes:
//   window.TRRecessionPanel({ open, onClose })  — full modal
//   window.openTRRecession()                    — dispatch open event
//
// Depends on:
//   window.RecessionData (engine/recession.js)
//   window.FREDData      (engine/fred.js — for the API key check)

(function () {
  const T = {
    ink000: '#07090C', ink100: '#0B0E13', ink200: '#10141B', ink300: '#171C24',
    edge: 'rgba(255,255,255,0.06)', edgeHi: 'rgba(255,255,255,0.10)',
    text: '#ffffff', textMid: 'rgba(180,188,200,0.75)', textDim: 'rgba(130,138,150,0.55)',
    signal: '#c9a227', bull: '#6FCF8E', bear: '#D96B6B',
    mono: '"JetBrains Mono", ui-monospace, "SF Mono", Menlo, Consolas, monospace',
    ui: '"Inter Tight", system-ui, -apple-system, sans-serif',
  };

  window.openTRRecession = function openTRRecession() {
    try { window.dispatchEvent(new CustomEvent('tr:open-recession')); } catch (_) {}
  };

  // ---------- helpers ----------
  function fmtPct(n, digits) {
    if (n == null || !isFinite(n)) return '—';
    return n.toFixed(digits == null ? 2 : digits) + '%';
  }
  function fmtNum(n, digits) {
    if (n == null || !isFinite(n)) return '—';
    return n.toFixed(digits == null ? 2 : digits);
  }
  function scoreColor(score) {
    if (score == null) return T.textDim;
    if (score >= 70) return T.bear;
    if (score >= 45) return '#ff9f43';
    if (score >= 25) return T.signal;
    return T.bull;
  }

  // Tiny inline SVG sparkline with optional NBER recession bands.
  function Sparkline({ history, width, height, stroke, recessions }) {
    if (!history || history.length < 2) {
      return (
        <div style={{
          width: width, height: height, display: 'flex', alignItems: 'center',
          justifyContent: 'center', fontFamily: T.mono, fontSize: 10, color: T.textDim,
        }}>no history</div>
      );
    }
    const valid = history.filter(p => p && p.value != null);
    if (valid.length < 2) {
      return (
        <div style={{ width, height, fontFamily: T.mono, fontSize: 10, color: T.textDim }}>
          no history
        </div>
      );
    }
    const vals = valid.map(p => p.value);
    const min = Math.min.apply(null, vals);
    const max = Math.max.apply(null, vals);
    const range = (max - min) || 1;
    const pad = 4;
    const innerH = height - pad * 2;
    const stepX = (width - pad * 2) / (valid.length - 1);
    const points = valid.map((p, i) => {
      const x = pad + stepX * i;
      const y = pad + innerH * (1 - (p.value - min) / range);
      return x.toFixed(1) + ',' + y.toFixed(1);
    }).join(' ');

    // Recession bands — match date string YYYY-MM.
    const bands = [];
    if (recessions && recessions.length) {
      const firstDate = valid[0].date;
      const lastDate  = valid[valid.length - 1].date;
      recessions.forEach((r, idx) => {
        // Clip to history window.
        const s = r.start > firstDate.slice(0,7) ? r.start : firstDate.slice(0,7);
        const e = r.end   < lastDate.slice(0,7)  ? r.end   : lastDate.slice(0,7);
        if (s >= e) return;
        const sIdx = valid.findIndex(p => p.date.slice(0,7) >= s);
        const eIdx = valid.findIndex(p => p.date.slice(0,7) >= e);
        if (sIdx < 0 || eIdx < 0 || eIdx <= sIdx) return;
        const x1 = pad + stepX * sIdx;
        const x2 = pad + stepX * eIdx;
        bands.push(
          <rect key={'b'+idx} x={x1} y={pad} width={x2 - x1} height={innerH}
            fill="rgba(217,107,107,0.12)" />
        );
      });
    }

    return (
      <svg width={width} height={height} style={{ display: 'block' }}>
        {bands}
        <polyline points={points} fill="none" stroke={stroke || T.signal} strokeWidth="1.5" />
      </svg>
    );
  }

  // ---------- Gauge ----------
  function Gauge({ score, label }) {
    const s = score == null ? 0 : score;
    const ang = Math.PI * (s / 100); // half circle
    const r = 110;
    const cx = 130, cy = 130;
    const x2 = cx - r * Math.cos(ang);
    const y2 = cy - r * Math.sin(ang);
    const color = scoreColor(score);
    const bigArc = ang > Math.PI / 2 ? 1 : 0;

    return (
      <div style={{ width: 260, position: 'relative' }}>
        <svg width={260} height={160}>
          <path d={`M ${cx - r} ${cy} A ${r} ${r} 0 0 1 ${cx + r} ${cy}`}
            fill="none" stroke="rgba(255,255,255,0.08)" strokeWidth="14" />
          {score != null && (
            <path d={`M ${cx - r} ${cy} A ${r} ${r} 0 ${bigArc} 1 ${x2} ${y2}`}
              fill="none" stroke={color} strokeWidth="14" strokeLinecap="round" />
          )}
          <text x={cx} y={cy - 20} textAnchor="middle" fill={color}
            style={{ fontFamily: T.mono, fontSize: 42, fontWeight: 700 }}>
            {score == null ? '—' : score.toFixed(0)}
          </text>
          <text x={cx} y={cy + 8} textAnchor="middle" fill={T.textMid}
            style={{ fontFamily: T.mono, fontSize: 11, letterSpacing: 1 }}>
            RECESSION RISK
          </text>
        </svg>
        <div style={{
          textAlign: 'center', fontFamily: T.mono, fontSize: 12,
          letterSpacing: 1.4, color: color, fontWeight: 700,
          padding: '4px 0',
        }}>{label || '—'}</div>
      </div>
    );
  }

  // ---------- Tile ----------
  function Tile({ title, subtitle, value, unit, delta, history, stroke, recessions }) {
    const up = delta != null && delta > 0;
    const down = delta != null && delta < 0;
    return (
      <div style={{
        background: T.ink200, border: `1px solid ${T.edge}`, borderRadius: 10,
        padding: '12px 14px', display: 'flex', flexDirection: 'column', gap: 8,
        minWidth: 0,
      }}>
        <div style={{
          fontSize: 9.5, letterSpacing: 1.1, color: T.signal, fontWeight: 700,
          textTransform: 'uppercase',
        }}>{title}</div>
        <div style={{ display: 'flex', alignItems: 'baseline', gap: 8 }}>
          <div style={{ fontFamily: T.mono, fontSize: 22, fontWeight: 600, color: T.text }}>
            {value}{unit || ''}
          </div>
          {delta != null && (
            <div style={{
              fontFamily: T.mono, fontSize: 10.5,
              color: up ? T.bear : down ? T.bull : T.textMid,
            }}>
              {up ? '▲' : down ? '▼' : '·'} {Math.abs(delta).toFixed(2)}
            </div>
          )}
        </div>
        <div style={{ fontSize: 10, color: T.textDim }}>{subtitle}</div>
        <Sparkline history={history} width={220} height={52}
          stroke={stroke} recessions={recessions} />
      </div>
    );
  }

  // ---------- Panel ----------
  function TRRecessionPanel({ open, onClose }) {
    const [nyfed,  setNyfed]  = React.useState(null);
    const [spread, setSpread] = React.useState(null);
    const [sent,   setSent]   = React.useState(null);
    const [lei,    setLei]    = React.useState(null);
    const [comp,   setComp]   = React.useState(null);
    const [loading, setLoading] = React.useState(false);
    const [tick, setTick] = React.useState(0);

    React.useEffect(() => {
      if (!open) return;
      let active = true;
      setLoading(true);
      (async () => {
        try {
          if (!window.RecessionData) return;
          const results = await Promise.all([
            window.RecessionData.getNYFedProbability(),
            window.RecessionData.getYieldCurveSpread(),
            window.RecessionData.getConsumerSentiment(),
            window.RecessionData.getLEI(),
            window.RecessionData.getCompositeModel(),
          ]);
          if (!active) return;
          setNyfed(results[0]);
          setSpread(results[1]);
          setSent(results[2]);
          setLei(results[3]);
          setComp(results[4]);
        } catch (e) {
          console.warn('[TRRecessionPanel] load failed', e && e.message);
        } finally {
          if (active) setLoading(false);
        }
      })();
      return () => { active = false; };
    }, [open, tick]);

    if (!open) return null;

    // FRED CSV endpoint works without a key — panel loads out-of-the-box.
    // If a key is present we still prefer the JSON endpoint inside FREDData.
    const recessions = (window.RecessionData && window.RecessionData.HISTORICAL_RECESSIONS) || [];

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
              }}>MACRO · Recession Probability</div>
              <div style={{ fontSize: 13, color: T.text, fontWeight: 500 }}>
                NY Fed model · Yield curve · Leading indicators
              </div>
            </div>
            <div style={{ flex: 1 }} />
            <div onClick={() => setTick(t => t + 1)} style={{
              padding: '5px 12px', fontFamily: T.mono, fontSize: 10.5, fontWeight: 600,
              background: T.ink300, color: T.textMid, border: `1px solid ${T.edgeHi}`,
              borderRadius: 5, cursor: 'pointer', letterSpacing: 0.4,
            }}>{loading ? 'LOADING…' : 'REFRESH'}</div>
            <button onClick={onClose} style={{
              background: 'transparent', color: T.textMid, border: `1px solid ${T.edge}`,
              padding: '5px 12px', borderRadius: 5, cursor: 'pointer',
              fontSize: 11, fontFamily: T.mono, letterSpacing: 0.4,
            }}>CLOSE ✕</button>
          </div>

          {/* Body */}
          <div style={{ flex: 1, overflowY: 'auto', padding: '20px 22px' }}>

            <div style={{ display: 'flex', gap: 24, alignItems: 'center', flexWrap: 'wrap' }}>
              <Gauge score={comp && comp.score} label={comp && comp.label} />
              <div style={{ flex: 1, minWidth: 280 }}>
                <div style={{
                  fontSize: 10, letterSpacing: 1.2, color: T.textDim,
                  textTransform: 'uppercase', fontWeight: 600, marginBottom: 8,
                }}>Composite blend</div>
                {comp && comp.components && comp.components.map(c => (
                  <div key={c.id} style={{
                    display: 'grid', gridTemplateColumns: '1fr 40px 70px 60px',
                    alignItems: 'center', gap: 8,
                    padding: '6px 0', borderBottom: `1px solid ${T.edge}`,
                    fontFamily: T.mono, fontSize: 11,
                  }}>
                    <div style={{ color: T.text }}>{c.label}</div>
                    <div style={{ color: T.textMid, textAlign: 'right' }}>
                      {(c.weight * 100).toFixed(0)}%
                    </div>
                    <div style={{ color: T.textMid, textAlign: 'right' }}>
                      raw {c.raw == null ? '—' : c.raw.toFixed(2)}
                    </div>
                    <div style={{
                      color: scoreColor(c.contribution), textAlign: 'right', fontWeight: 600,
                    }}>
                      {c.contribution.toFixed(0)}
                    </div>
                  </div>
                ))}
                {(!comp || !comp.components || !comp.components.length) && (
                  <div style={{ fontFamily: T.mono, fontSize: 11, color: T.textDim }}>
                    {loading ? 'Computing…' : 'No components available — FRED upstream offline.'}
                  </div>
                )}
              </div>
            </div>

            {/* Tiles */}
            <div style={{
              marginTop: 22, display: 'grid',
              gridTemplateColumns: 'repeat(auto-fit, minmax(240px, 1fr))', gap: 14,
            }}>
              <Tile
                title="NY Fed Model"
                subtitle="Prob of recession next 12mo (RECPROUSM156N)"
                value={nyfed ? fmtNum(nyfed.latest, 2) : '—'} unit="%"
                delta={nyfed && nyfed.delta}
                history={nyfed && nyfed.history}
                stroke={T.bear}
                recessions={recessions}
              />
              <Tile
                title="10Y-3M Spread"
                subtitle="NY Fed preferred inversion signal (T10Y3M)"
                value={spread && spread.t10y3m ? fmtPct(spread.t10y3m.latest, 2) : '—'}
                delta={spread && spread.t10y3m && spread.t10y3m.delta}
                history={spread && spread.t10y3m && spread.t10y3m.history}
                stroke={T.signal}
                recessions={recessions}
              />
              <Tile
                title="2s10s Spread"
                subtitle="Classic yield curve (T10Y2Y)"
                value={spread && spread.t10y2y ? fmtPct(spread.t10y2y.latest, 2) : '—'}
                delta={spread && spread.t10y2y && spread.t10y2y.delta}
                history={spread && spread.t10y2y && spread.t10y2y.history}
                stroke={T.bull}
                recessions={recessions}
              />
              <Tile
                title="Consumer Sentiment"
                subtitle="U Mich index (UMCSENT)"
                value={sent ? fmtNum(sent.latest, 1) : '—'}
                delta={sent && sent.delta}
                history={sent && sent.history}
                stroke="#a78bfa"
                recessions={recessions}
              />
              <Tile
                title="Leading Index"
                subtitle="Philly Fed USSLIND"
                value={lei ? fmtNum(lei.latest, 2) : '—'}
                delta={lei && lei.delta}
                history={lei && lei.history}
                stroke="#60a5fa"
                recessions={recessions}
              />
            </div>

            <div style={{
              marginTop: 22, fontSize: 10.5, color: T.textDim, fontFamily: T.mono,
              letterSpacing: 0.4,
            }}>
              Source: FRED · St. Louis Fed · NBER recession bands shown in red.
              Composite is a weighted blend, not a forecast — use as directional signal.
            </div>
          </div>
        </div>
      </div>
    );
  }

  window.TRRecessionPanel = TRRecessionPanel;
})();
