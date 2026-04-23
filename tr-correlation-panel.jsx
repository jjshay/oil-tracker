// tr-correlation-panel.jsx — TradeRadar 30-day rolling correlation matrix.
//
// Shows a 6x6 Pearson correlation heatmap across:
//   BTC, SPY, QQQ, GLD, UUP (DXY proxy), TLT
//
// Data sources:
//   BTC        → CoinGecko /coins/bitcoin/market_chart
//   SPY/QQQ/GLD/UUP/TLT → Stooq daily CSV
//
// Exposes:
//   window.TRCorrelationPanel — React modal ({ open, onClose })
//   window.openTRCorrelation() — dispatches CustomEvent('tr:open-correlation')
//
// Depends on:
//   window.trFetch (tr-cache.js, optional — falls back to plain fetch)
//   React globals

(function () {
  const T = {
    ink000: '#07090C', ink100: '#0B0E13', ink200: '#10141B', ink300: '#171C24',
    edge: 'rgba(255,255,255,0.06)', edgeHi: 'rgba(255,255,255,0.10)',
    text: '#ffffff', textMid: 'rgba(180,188,200,0.75)', textDim: 'rgba(130,138,150,0.55)',
    signal: '#c9a227', bull: '#6FCF8E', bear: '#D96B6B',
    mono: '"JetBrains Mono", ui-monospace, "SF Mono", Menlo, Consolas, monospace',
  };

  // ----------------------------------------------------------------
  // Asset config — each has a ticker, display color dot, and fetcher.
  // ----------------------------------------------------------------
  const ASSETS = [
    { key: 'BTC', label: 'BTC', dot: '#f7931a', kind: 'cg', id: 'bitcoin' },
    { key: 'SPY', label: 'SPY', dot: '#6FCF8E', kind: 'stooq', sym: 'spy' },
    { key: 'QQQ', label: 'QQQ', dot: '#7FB4FF', kind: 'stooq', sym: 'qqq' },
    { key: 'GLD', label: 'GLD', dot: '#c9a227', kind: 'stooq', sym: 'gld' },
    { key: 'UUP', label: 'UUP', dot: '#B58AFF', kind: 'stooq', sym: 'uup' },
    { key: 'TLT', label: 'TLT', dot: '#D96B6B', kind: 'stooq', sym: 'tlt' },
  ];

  const CACHE_MS = 5 * 60 * 1000;  // 5-minute in-memory matrix cache
  let _matrixCache = null;         // { ts, matrix, closes, regime }

  // ----------------------------------------------------------------
  // fetch helper — prefer shared cache when present.
  // ----------------------------------------------------------------
  async function fetchText(url) {
    const f = (typeof window !== 'undefined' && window.trFetch) || fetch;
    const res = await f(url);
    if (!res || !res.ok) throw new Error('fetch failed: ' + url);
    return await res.text();
  }
  async function fetchJson(url) {
    const txt = await fetchText(url);
    return JSON.parse(txt);
  }

  // ----------------------------------------------------------------
  // Data fetchers — each returns an array of daily closes (oldest → newest).
  // ----------------------------------------------------------------
  async function fetchBTC() {
    // CoinGecko returns [[ts, price], ...] for the last N days (hourly on small ranges).
    const url = 'https://api.coingecko.com/api/v3/coins/bitcoin/market_chart?vs_currency=usd&days=30&interval=daily';
    const j = await fetchJson(url);
    const prices = Array.isArray(j && j.prices) ? j.prices : [];
    // Keep only daily closes — one per UTC day.
    const byDay = new Map();
    for (const row of prices) {
      if (!Array.isArray(row) || row.length < 2) continue;
      const d = new Date(row[0]);
      const key = d.toISOString().slice(0, 10);
      byDay.set(key, Number(row[1]));  // later values overwrite — last close wins
    }
    const closes = Array.from(byDay.values()).filter(Number.isFinite);
    return closes.slice(-30);
  }

  async function fetchStooq(sym) {
    // Stooq CSV is reverse-chronological? Actually it comes oldest-first.
    // Columns: Date,Open,High,Low,Close,Volume
    const url = `https://stooq.com/q/d/l/?s=${encodeURIComponent(sym)}.us&i=d`;
    const txt = await fetchText(url);
    const lines = txt.split(/\r?\n/).filter(Boolean);
    if (lines.length < 2) throw new Error('stooq empty: ' + sym);
    const header = lines[0].toLowerCase();
    const closeIdx = header.split(',').indexOf('close');
    if (closeIdx < 0) throw new Error('stooq no close col: ' + sym);
    const closes = [];
    for (let i = 1; i < lines.length; i++) {
      const parts = lines[i].split(',');
      const c = Number(parts[closeIdx]);
      if (Number.isFinite(c)) closes.push(c);
    }
    return closes.slice(-30);
  }

  async function fetchAsset(asset) {
    try {
      if (asset.kind === 'cg') return await fetchBTC();
      if (asset.kind === 'stooq') return await fetchStooq(asset.sym);
    } catch (e) {
      return [];
    }
    return [];
  }

  // ----------------------------------------------------------------
  // Math — log returns + Pearson correlation.
  // ----------------------------------------------------------------
  function logReturns(closes) {
    const out = [];
    for (let i = 1; i < closes.length; i++) {
      const a = closes[i - 1], b = closes[i];
      if (a > 0 && b > 0) out.push(Math.log(b / a));
      else out.push(0);
    }
    return out;
  }

  // Pearson r = Σ((x−x̄)(y−ȳ)) / sqrt( Σ(x−x̄)² · Σ(y−ȳ)² )
  function pearson(x, y) {
    const n = Math.min(x.length, y.length);
    if (n < 3) return 0;
    let sx = 0, sy = 0;
    for (let i = 0; i < n; i++) { sx += x[i]; sy += y[i]; }
    const mx = sx / n, my = sy / n;
    let num = 0, dx2 = 0, dy2 = 0;
    for (let i = 0; i < n; i++) {
      const dx = x[i] - mx, dy = y[i] - my;
      num += dx * dy;
      dx2 += dx * dx;
      dy2 += dy * dy;
    }
    const denom = Math.sqrt(dx2 * dy2);
    if (!isFinite(denom) || denom === 0) return 0;
    return num / denom;
  }

  // ----------------------------------------------------------------
  // Color scale — RGB lerp between bear (neg) / ink (neutral) / bull (pos).
  // Thresholds: |r| > 0.6 saturates; |r| < 0.2 neutral ink; linear in between.
  // ----------------------------------------------------------------
  function hexToRgb(hex) {
    const m = /^#?([0-9a-f]{6})$/i.exec(hex);
    if (!m) return { r: 0, g: 0, b: 0 };
    const n = parseInt(m[1], 16);
    return { r: (n >> 16) & 0xff, g: (n >> 8) & 0xff, b: n & 0xff };
  }
  function lerp(a, b, t) { return Math.round(a + (b - a) * t); }
  function mixRgb(c1, c2, t) {
    return `rgb(${lerp(c1.r, c2.r, t)}, ${lerp(c1.g, c2.g, t)}, ${lerp(c1.b, c2.b, t)})`;
  }
  function colorForR(r) {
    const bull = hexToRgb(T.bull);
    const bear = hexToRgb(T.bear);
    const neutral = hexToRgb('#1b2230');
    if (!isFinite(r)) return T.ink300;
    if (r > 0) {
      // 0 → neutral; 0.6+ → saturated bull
      const t = Math.min(1, r / 0.6);
      return mixRgb(neutral, bull, t);
    }
    if (r < 0) {
      const t = Math.min(1, Math.abs(r) / 0.6);
      return mixRgb(neutral, bear, t);
    }
    return `rgb(${neutral.r}, ${neutral.g}, ${neutral.b})`;
  }

  // ----------------------------------------------------------------
  // Regime read — rule-based one-liner (fallback since we have no LLM key).
  // ----------------------------------------------------------------
  function regimeLine(matrix) {
    // matrix indexed by ASSETS order: 0=BTC, 1=SPY, 2=QQQ, 3=GLD, 4=UUP, 5=TLT
    const btcQqq = matrix[0][2];
    const btcGld = matrix[0][3];
    const btcSpy = matrix[0][1];
    const fmt = (v) => (v >= 0 ? '+' : '') + v.toFixed(2);
    if (btcQqq > 0.5) {
      return `BTC trading as risk-on tech proxy: ${fmt(btcQqq)} vs QQQ, ${fmt(btcGld)} vs GLD. Moves with Nasdaq.`;
    }
    if (btcGld > 0.5) {
      return `BTC trading as safe-haven / inflation hedge: ${fmt(btcGld)} vs GLD, ${fmt(btcQqq)} vs QQQ. Digital-gold regime.`;
    }
    return `BTC decorrelated from macro — regime transition. QQQ ${fmt(btcQqq)}, GLD ${fmt(btcGld)}, SPY ${fmt(btcSpy)}.`;
  }

  // ----------------------------------------------------------------
  // Build matrix — single Promise.all pass.
  // ----------------------------------------------------------------
  async function buildMatrix() {
    const closesArr = await Promise.all(ASSETS.map(fetchAsset));
    const returnsArr = closesArr.map(logReturns);
    const n = ASSETS.length;
    const matrix = Array.from({ length: n }, () => new Array(n).fill(0));
    for (let i = 0; i < n; i++) {
      for (let j = 0; j < n; j++) {
        if (i === j) { matrix[i][j] = 1; continue; }
        if (i > j) { matrix[i][j] = matrix[j][i]; continue; }
        matrix[i][j] = pearson(returnsArr[i], returnsArr[j]);
      }
    }
    const regime = regimeLine(matrix);
    return { matrix, closes: closesArr, regime };
  }

  async function getMatrix(force) {
    const t = Date.now();
    if (!force && _matrixCache && (t - _matrixCache.ts) < CACHE_MS) {
      return _matrixCache;
    }
    const built = await buildMatrix();
    _matrixCache = { ts: t, ...built };
    return _matrixCache;
  }

  // ----------------------------------------------------------------
  // Public open hook.
  // ----------------------------------------------------------------
  window.openTRCorrelation = function openTRCorrelation() {
    try { window.dispatchEvent(new CustomEvent('tr:open-correlation')); } catch (_) {}
  };

  // ====================================================================
  // TRCorrelationPanel
  // ====================================================================
  function TRCorrelationPanel({ open, onClose }) {
    const [data, setData] = React.useState(_matrixCache);
    const [loading, setLoading] = React.useState(false);
    const [err, setErr] = React.useState(null);
    const [tick, setTick] = React.useState(0);

    React.useEffect(() => {
      if (!open) return;
      let cancel = false;
      const force = tick > 0;
      setLoading(true); setErr(null);
      getMatrix(force).then((d) => {
        if (cancel) return;
        setData(d);
        setLoading(false);
      }).catch((e) => {
        if (cancel) return;
        setErr(String(e && e.message || e));
        setLoading(false);
      });
      return () => { cancel = true; };
    }, [open, tick]);

    if (!open) return null;

    const matrix = data && data.matrix;
    const regime = data && data.regime;

    return (
      <div onClick={onClose} style={{
        position: 'fixed', inset: 0, background: 'rgba(7,9,12,0.8)',
        backdropFilter: 'blur(12px) saturate(150%)',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        zIndex: 120, padding: 40,
      }}>
        <div onClick={e => e.stopPropagation()} style={{
          width: 640, maxHeight: '92%', overflow: 'hidden',
          display: 'flex', flexDirection: 'column',
          background: T.ink100, border: `1px solid ${T.edgeHi}`, borderRadius: 14,
          color: T.text,
          fontFamily: '"Inter Tight", system-ui, sans-serif',
          boxShadow: '0 24px 80px rgba(0,0,0,0.6)',
        }}>

          {/* Header */}
          <div style={{
            padding: '18px 22px 12px 22px',
            borderBottom: `1px solid ${T.edge}`,
            display: 'flex', alignItems: 'center', gap: 12,
          }}>
            <div style={{
              fontSize: 15, fontWeight: 600, letterSpacing: 0.3, flex: 1,
            }}>
              30-Day Rolling Correlation
              <span style={{
                marginLeft: 8, fontSize: 11, color: T.textMid, fontWeight: 400,
                fontFamily: T.mono,
              }}>
                log-returns · Pearson r
              </span>
            </div>
            <button
              onClick={() => setTick(t => t + 1)}
              style={{
                background: T.ink200, color: T.text, border: `1px solid ${T.edge}`,
                padding: '6px 10px', borderRadius: 6, cursor: 'pointer',
                fontSize: 11, fontFamily: T.mono,
              }}
              title="Refresh"
            >↻ refresh</button>
            <button
              onClick={onClose}
              style={{
                background: 'transparent', color: T.textMid, border: 'none',
                padding: '6px 10px', cursor: 'pointer',
                fontSize: 16, fontFamily: T.mono,
              }}
            >✕</button>
          </div>

          {/* Body */}
          <div style={{ padding: '18px 22px 22px 22px', overflow: 'auto' }}>
            {loading && !matrix && (
              <div style={{
                padding: '40px 0', textAlign: 'center',
                fontFamily: T.mono, fontSize: 13, color: T.textMid,
              }}>
                Computing correlations<span style={{ color: T.signal }}>…</span>
              </div>
            )}

            {err && !matrix && (
              <div style={{
                padding: '20px 0', fontFamily: T.mono,
                fontSize: 12, color: T.bear,
              }}>
                error: {err}
              </div>
            )}

            {matrix && (
              <>
                {/* Grid */}
                <div style={{ display: 'inline-block' }}>
                  <table style={{
                    borderCollapse: 'separate', borderSpacing: 2,
                    fontFamily: T.mono, fontSize: 11,
                  }}>
                    <thead>
                      <tr>
                        <th style={{ width: 56 }}></th>
                        {ASSETS.map(a => (
                          <th key={a.key} style={{
                            padding: '4px 0', color: T.textMid, fontWeight: 500,
                            minWidth: 72,
                          }}>
                            <span style={{
                              display: 'inline-block', width: 7, height: 7,
                              borderRadius: '50%', background: a.dot,
                              marginRight: 5, verticalAlign: 'middle',
                            }} />
                            {a.label}
                          </th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {ASSETS.map((rowA, i) => (
                        <tr key={rowA.key}>
                          <td style={{
                            padding: '0 8px', textAlign: 'right', color: T.textMid,
                          }}>
                            <span style={{
                              display: 'inline-block', width: 7, height: 7,
                              borderRadius: '50%', background: rowA.dot,
                              marginRight: 5, verticalAlign: 'middle',
                            }} />
                            {rowA.label}
                          </td>
                          {ASSETS.map((colA, j) => {
                            const r = matrix[i][j];
                            const bg = colorForR(r);
                            const diag = i === j;
                            return (
                              <td key={colA.key} style={{
                                background: diag ? T.ink300 : bg,
                                color: T.text,
                                textAlign: 'center',
                                padding: '10px 4px',
                                borderRadius: 4,
                                fontWeight: 500,
                                minWidth: 68,
                                border: diag ? `1px solid ${T.edge}` : '1px solid rgba(0,0,0,0.25)',
                              }}>
                                {diag ? '—' : r.toFixed(2)}
                              </td>
                            );
                          })}
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>

                {/* Legend */}
                <div style={{
                  marginTop: 16, fontFamily: T.mono, fontSize: 10, color: T.textMid,
                }}>
                  <div style={{
                    height: 10, borderRadius: 4,
                    background: `linear-gradient(to right, ${T.bear} 0%, #1b2230 50%, ${T.bull} 100%)`,
                  }} />
                  <div style={{
                    display: 'flex', justifyContent: 'space-between', marginTop: 4,
                  }}>
                    <span>-1.00 (inverse)</span>
                    <span>0 (uncorrelated)</span>
                    <span>+1.00 (moves together)</span>
                  </div>
                </div>

                {/* Regime read */}
                <div style={{
                  marginTop: 18, padding: '12px 14px',
                  background: T.ink200, border: `1px solid ${T.edge}`, borderRadius: 8,
                  fontSize: 12, lineHeight: 1.5, color: T.text,
                }}>
                  <div style={{
                    fontSize: 10, color: T.signal, fontFamily: T.mono,
                    letterSpacing: 0.6, marginBottom: 4,
                  }}>CURRENT REGIME READ</div>
                  {regime}
                </div>

                {/* Footer note */}
                <div style={{
                  marginTop: 10, fontSize: 10, color: T.textDim, fontFamily: T.mono,
                }}>
                  sources: CoinGecko (BTC), Stooq (SPY/QQQ/GLD/UUP/TLT) · cached 5 min
                </div>
              </>
            )}
          </div>
        </div>
      </div>
    );
  }

  window.TRCorrelationPanel = TRCorrelationPanel;
})();
