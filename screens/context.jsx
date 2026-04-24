// ContextScreen — Merged "Context" tab (replaces Historical + Calendar).
// Internal pill-tab switcher: "Chart" (multi-series historical view) |
// "Calendar" (upcoming event grid). Nothing else changes about either view.

const ctxTokens = {
  ink000: '#07090C', ink100: '#0B0E13', ink200: '#10141B', ink300: '#171C24', ink400: '#1E2430',
  edge: 'rgba(255,255,255,0.06)', edgeHi: 'rgba(255,255,255,0.10)',
  text: '#ffffff', textMid: 'rgba(180,188,200,0.75)', textDim: 'rgba(130,138,150,0.55)',
  signal: '#c9a227',
  btc: '#F7931A', oil: '#0077B5', spx: '#9AA3B2', dow: '#C7A8FF',
  geo: '#D96B6B', fed: '#0077B5', btcEvt: '#F7931A',
  trump: '#B07BE6', inst: '#6FCF8E', reg: '#5FC9C2', earn: '#C7A8FF',
  bull: '#6FCF8E', bear: '#D96B6B',
  ui: 'InterTight, -apple-system, BlinkMacSystemFont, "SF Pro Text", system-ui, sans-serif',
  mono: '"JetBrains Mono", ui-monospace, "SF Mono", Menlo, Consolas, monospace',
};

// ============================================================================
// CHART (Historical) constants + helpers — from historical.jsx
// ============================================================================

const CTX_RANGES = {
  '1D':  { days: 1,     N: 96,  unit: '15min', granularity: 'INTRADAY',
           ticks: ['09:30', '11:00', '12:30', '14:00', '15:30'] },
  '1W':  { days: 7,     N: 84,  unit: '2h',    granularity: 'HOURLY',
           ticks: ['MON', 'TUE', 'WED', 'THU', 'FRI'] },
  '1M':  { days: 30,    N: 60,  unit: '12h',   granularity: 'DAILY',
           ticks: ['MAR 20', 'MAR 27', 'APR 03', 'APR 10', 'APR 19'] },
  '3M':  { days: 90,    N: 90,  unit: '1d',    granularity: 'DAILY',
           ticks: ['JAN 19', 'FEB 09', 'MAR 02', 'MAR 24', 'APR 19'] },
  '1Y':  { days: 365,   N: 104, unit: '3d',    granularity: 'DAILY',
           ticks: ['MAY 25', 'AUG 25', 'NOV 25', 'FEB 26', 'APR 26'] },
  '2Y':  { days: 730,   N: 104, unit: '1w',    granularity: 'WEEKLY',
           ticks: ['APR 24', 'OCT 24', 'APR 25', 'OCT 25', 'APR 26'] },
  '5Y':  { days: 1825,  N: 130, unit: '2w',    granularity: 'WEEKLY',
           ticks: ['APR 21', 'APR 22', 'APR 23', 'APR 24', 'APR 25', 'APR 26'] },
  'All': { days: 4750,  N: 160, unit: '1mo',   granularity: 'MONTHLY',
           ticks: ['2013', '2015', '2017', '2019', '2021', '2023', '2026'] },
};

const CTX_EVENTS_ALL = [
  { daysAgo: 0.15, cat: 'reg',    color: '#5FC9C2', label: 'CLARITY House vote passes 294-128', date: 'APR 19, 2026 · 11:20',
    body: 'Market-structure bill cleared the House by a wider-than-expected margin. Senate markup scheduled Monday. Thune: "vote in two weeks, not two months."',
    url: 'https://www.politico.com/newsletters/politico-crypto' },
  { daysAgo: 0.40, cat: 'btc',    color: '#F7931A', label: 'IBIT crosses $8.2B weekly inflow',    date: 'APR 19, 2026 · 06:44',
    body: 'Spot BTC ETFs logged day 14 of consecutive net inflows. IBIT alone added $1.8B yesterday. Morgan Stanley PWM green-light accelerating adoption.',
    url: 'https://www.bloomberg.com/news/articles/' },
  { daysAgo: 0.85, cat: 'geo',    color: '#D96B6B', label: 'IRGC warns over Gulf tanker incident', date: 'APR 18, 2026 · 20:15',
    body: 'Iranian Revolutionary Guard Corps signaled "proportional response" after second tanker incident near Hormuz this week. Hormuz insurance premiums spike 40% w/w.',
    url: 'https://www.reuters.com/world/middle-east/' },
  { daysAgo: 2.3,  cat: 'fed',    color: '#0077B5', label: 'Fed minutes turn dovish',            date: 'APR 17, 2026 · 14:00',
    body: '"Most participants" see a cut appropriate by Q3 if core PCE holds. Waller: "policy is more restrictive than we thought." DXY breaks 102.',
    url: 'https://www.bloomberg.com/news/articles/fed-minutes' },
  { daysAgo: 5,    cat: 'reg',    color: '#5FC9C2', label: 'Lummis reserve bill gains co-sponsors', date: 'APR 14, 2026',
    body: 'Strategic BTC reserve bill adds 13 co-sponsors post-CLARITY momentum. Treasury RFP hints at "budget-neutral pathways" to acquire 200K BTC.',
    url: 'https://www.reuters.com/legal/' },
  { daysAgo: 9,    cat: 'trump',  color: '#B07BE6', label: 'Crypto-friendly SEC chair confirmed', date: 'APR 10, 2026',
    body: 'Senate confirmed the nominee 54-44 along party lines. Enforcement posture expected to shift toward disclosure-based framework.',
    url: 'https://www.politico.com/news/2026/04/10/' },
  { daysAgo: 15,   cat: 'geo',    color: '#D96B6B', label: 'Ukraine drone strikes Ryazan refinery', date: 'APR 04, 2026',
    body: '200k bpd offline. Ripple effects on European diesel; WTI prints +$2.80 intraday. Russia signals retaliation vector on Ukrainian energy infrastructure.',
    url: 'https://www.reuters.com/world/europe/' },
  { daysAgo: 35,   cat: 'fed',    color: '#0077B5', label: 'March FOMC: held at 4.50–4.75%',      date: 'MAR 15, 2026',
    body: 'Statement tweak: "greater confidence" in disinflation path. Powell press conference signaled optionality; rates market repriced Q3 cut odds to 72%.',
    url: 'https://www.federalreserve.gov/monetarypolicy/fomcminutes.htm' },
  { daysAgo: 55,   cat: 'geo',    color: '#D96B6B', label: 'Bab el-Mandeb strike disrupts Red Sea', date: 'FEB 23, 2026',
    body: 'Houthi-linked strike against VLCC near Bab el-Mandeb. Maersk, Hapag-Lloyd both extend Cape of Good Hope routing. Shipping spot rates +22%.',
    url: 'https://www.ft.com/content/' },
  { daysAgo: 120,  cat: 'inst',   color: '#6FCF8E', label: 'Sovereign BTC allocation reported',    date: 'DEC 23, 2025',
    body: 'Mid-sized EM sovereign wealth fund disclosed a multi-billion BTC position via spot ETFs. First G20-affiliate sovereign entity to report allocation.',
    url: 'https://www.ft.com/content/sovereign-btc' },
  { daysAgo: 195,  cat: 'fed',    color: '#0077B5', label: 'Fed 25bp cut',                        date: 'OCT 07, 2025',
    body: 'First cut in 18 months. Statement noted "balanced" risks. Dot plot moved median Q4 rate projection to 4.0-4.25%.',
    url: 'https://www.federalreserve.gov/' },
  { daysAgo: 250,  cat: 'geo',    color: '#D96B6B', label: 'Hormuz tanker attack',               date: 'AUG 12, 2025',
    body: 'Tanker attacked approaching Strait of Hormuz. Reuters confirmed Iranian IRGC involvement. Brent spiked 6% on the session; WTI followed.',
    url: 'https://www.reuters.com/world/middle-east/tanker-attack-hormuz' },
  { daysAgo: 335,  cat: 'trump',  color: '#B07BE6', label: 'Tariff wave on CN imports',          date: 'MAY 20, 2025',
    body: 'Second tariff round hit 18% across consumer electronics + inputs. Supply-chain response muted this time; yuan held range.',
    url: 'https://www.wsj.com/articles/tariffs-china-' },
  { daysAgo: 425,  cat: 'btc',    color: '#F7931A', label: 'BTC spot ETF net +$2.1B',            date: 'FEB 19, 2025',
    body: 'Single-day inflow record. IBIT + FBTC captured 73% of the bid. Commentary centered on 60/40 reallocation flows.',
    url: 'https://www.bloomberg.com/news/articles/' },
  { daysAgo: 515,  cat: 'reg',    color: '#5FC9C2', label: 'CLARITY Act markup advances',        date: 'DEC 04, 2024',
    body: 'House Financial Services ordered the market-structure bill reported favorably. First major bipartisan milestone for digital-asset legislation.',
    url: 'https://www.congress.gov/bill/' },
  { daysAgo: 570,  cat: 'geo',    color: '#D96B6B', label: 'Iran strikes Iraq base',             date: 'OCT 14, 2024',
    body: 'Ballistic-missile strike against a U.S. contractor presence. Limited casualties. Oil complex bid into close; WTI +3.1% in after-hours.',
    url: 'https://www.reuters.com/world/middle-east/' },
  { daysAgo: 640,  cat: 'fed',    color: '#0077B5', label: 'Fed raises 75bp',                    date: 'JUL 27, 2024',
    body: 'Final hike of the cycle — second consecutive 75bp increment. Statement softened forward guidance; terminal implied rate shaved 15bp.',
    url: 'https://www.federalreserve.gov/' },
  { daysAgo: 1100, cat: 'btc',    color: '#F7931A', label: 'BTC spot ETF approved',              date: 'JAN 10, 2024',
    body: 'SEC approved the first wave of spot Bitcoin ETFs. 11 issuers including BlackRock, Fidelity, Ark.',
    url: 'https://www.sec.gov/news/press-release/' },
  { daysAgo: 1650, cat: 'fed',    color: '#0077B5', label: 'Rate-hiking cycle begins',           date: 'MAR 16, 2022',
    body: 'First hike of cycle — 25bp. Powell framed the pivot as a fight against "persistent" inflation.',
    url: 'https://www.federalreserve.gov/' },
  { daysAgo: 2400, cat: 'inst',   color: '#6FCF8E', label: 'MicroStrategy first BTC buy',        date: 'AUG 11, 2020',
    body: 'First public-company BTC treasury acquisition. 21,454 BTC for $250M. Catalyzed the corporate-treasury thesis.',
    url: 'https://www.microstrategy.com/press/' },
  { daysAgo: 4600, cat: 'btc',    color: '#F7931A', label: 'Bitcoin genesis block',              date: 'JAN 03, 2009',
    body: 'Block 0 mined by Satoshi Nakamoto. Coinbase transaction embedded the Times headline reference.',
    url: 'https://en.bitcoin.it/wiki/Genesis_block' },
];

function ctxHash01(i, seed) {
  const x = Math.sin((i * 9973 + seed * 77) * 0.013) * 43758.5453;
  return x - Math.floor(x);
}
function ctxSynthSeries(range) {
  const cfg = CTX_RANGES[range];
  const N = cfg.N;
  const endTargets = {
    '1D':  { btc: +0.9,  oil: -0.4, spx: +0.3,  dow: +0.2 },
    '1W':  { btc: +3.8,  oil: +1.5, spx: +0.9,  dow: +0.6 },
    '1M':  { btc: +8.4,  oil: -2.1, spx: +2.2,  dow: +1.9 },
    '3M':  { btc: +22.1, oil: +4.3, spx: +3.8,  dow: +3.1 },
    '1Y':  { btc: +61,   oil: +8,   spx: +12,   dow: +9 },
    '2Y':  { btc: +142.8, oil: +9.6, spx: +22.1, dow: +17.4 },
    '5Y':  { btc: +480,   oil: +28,  spx: +65,   dow: +48 },
    'All': { btc: +24500, oil: +120, spx: +260,  dow: +195 },
  }[range];
  const btc = [], oil = [], spx = [], dow = [];
  const volAmp = {
    '1D': { btc: 0.35, oil: 0.18, spx: 0.12, dow: 0.10 },
    '1W': { btc: 1.4,  oil: 0.7,  spx: 0.35, dow: 0.30 },
    '1M': { btc: 3.2,  oil: 1.6,  spx: 0.8,  dow: 0.7 },
    '3M': { btc: 6.5,  oil: 2.8,  spx: 1.4,  dow: 1.2 },
    '1Y': { btc: 11,   oil: 5,    spx: 2.5,  dow: 2.0 },
    '2Y': { btc: 18,   oil: 8,    spx: 4,    dow: 3.5 },
    '5Y': { btc: 38,   oil: 14,   spx: 7,    dow: 6 },
    'All':{ btc: 220,  oil: 22,   spx: 14,   dow: 12 },
  }[range];
  for (let i = 0; i < N; i++) {
    const t = i / (N - 1);
    const drift = (v) => v * t;
    const noise = (seed, amp) => (Math.sin(t * (7 + seed) + seed) + Math.sin(t * (3 + seed) * 1.7 + seed * 0.5)) * amp * 0.4
                                + (ctxHash01(i, seed) - 0.5) * amp * 0.3;
    btc.push(drift(endTargets.btc) + noise(1, volAmp.btc));
    oil.push(drift(endTargets.oil) + noise(3, volAmp.oil));
    spx.push(drift(endTargets.spx) + noise(5, volAmp.spx));
    dow.push(drift(endTargets.dow) + noise(7, volAmp.dow));
  }
  btc[N-1] = endTargets.btc; oil[N-1] = endTargets.oil;
  spx[N-1] = endTargets.spx; dow[N-1] = endTargets.dow;
  btc[0] = 0; oil[0] = 0; spx[0] = 0; dow[0] = 0;
  return { btc, oil, spx, dow, end: endTargets };
}

// ============================================================================
// CHART subview (historical)
// ============================================================================

function ContextChartView() {
  const T = ctxTokens;
  const W = 1280;

  const [range, setRange] = React.useState('2Y');
  const [focus, setFocus] = React.useState(null);
  const [hoverIdx, setHoverIdx] = React.useState(null);

  const cfg = CTX_RANGES[range];
  const N = cfg.N;

  const { data: liveBtc } = (window.useAutoUpdate || (() => ({})))(
    `btc-series-${cfg.days}`,
    async () => {
      if (cfg.days > 365 || typeof LiveData === 'undefined') return null;
      const resp = await LiveData.getCryptoHistory('bitcoin', cfg.days);
      if (!resp || !resp.prices || !resp.prices.length) return null;
      return resp.prices.map(p => p[1]);
    },
    { refreshKey: 'historical' }
  );

  const finnhubKey = (window.TR_SETTINGS && window.TR_SETTINGS.keys && window.TR_SETTINGS.keys.finnhub) || '';
  const { data: liveEquities } = (window.useAutoUpdate || (() => ({})))(
    `hist-equities-${cfg.days}-${finnhubKey ? 'on' : 'off'}`,
    async () => {
      if (!finnhubKey || cfg.days > 365) return null;
      const now = Math.floor(Date.now() / 1000);
      const from = now - cfg.days * 86400;
      const res = cfg.days <= 7 ? '60' : 'D';
      const symbols = { oil: 'USO', spx: 'SPY', dow: 'DIA' };
      const out = {};
      for (const [k, sym] of Object.entries(symbols)) {
        try {
          const r = await fetch(`https://finnhub.io/api/v1/stock/candle?symbol=${sym}&resolution=${res}&from=${from}&to=${now}&token=${finnhubKey}`);
          const j = await r.json();
          if (j && j.s === 'ok' && j.c && j.c.length) out[k] = j.c;
        } catch (_) {}
      }
      return Object.keys(out).length ? out : null;
    },
    { refreshKey: 'historical' }
  );

  const data = React.useMemo(() => {
    const base = ctxSynthSeries(range);
    const resample = (arr, len) => {
      if (!arr || arr.length < 2) return null;
      const out = [];
      for (let i = 0; i < len; i++) {
        const idx = Math.round((i / (len - 1)) * (arr.length - 1));
        out.push(arr[idx]);
      }
      const first = out[0] || 1;
      return out.map(v => ((v / first) - 1) * 100);
    };
    const result = { ...base };
    if (liveBtc && liveBtc.length >= 2) {
      const pct = resample(liveBtc, N);
      if (pct) result.btc = pct;
    }
    if (liveEquities) {
      ['oil', 'spx', 'dow'].forEach(k => {
        if (liveEquities[k]) {
          const pct = resample(liveEquities[k], N);
          if (pct) result[k] = pct;
        }
      });
    }
    return result;
  }, [range, liveBtc, liveEquities]);

  const eventsInRange = React.useMemo(() => {
    return CTX_EVENTS_ALL
      .map(e => {
        const rel = 1 - (e.daysAgo / cfg.days);
        return { ...e, rel, i: Math.round(rel * (N - 1)) };
      })
      .filter(e => e.rel >= 0.02 && e.rel <= 1);
  }, [range]);

  React.useEffect(() => { setHoverIdx(null); }, [range]);

  const chartX = 40, chartY = 70;
  const chartW = 1200, chartH = 480;

  const allVals = [...data.btc, ...data.oil, ...data.spx, ...data.dow];
  const rawMin = Math.min(...allVals, 0);
  const rawMax = Math.max(...allVals, 0);
  const yPad = (rawMax - rawMin) * 0.08;
  const yMin = rawMin - yPad, yMax = rawMax + yPad;
  const yToPx = (v) => chartY + chartH - ((v - yMin) / (yMax - yMin)) * chartH;
  const iToPx = (i) => chartX + (i / (N - 1)) * chartW;

  const pathFor = (arr) => {
    let d = `M ${iToPx(0).toFixed(1)} ${yToPx(arr[0]).toFixed(1)}`;
    for (let i = 1; i < arr.length; i++) d += ` L ${iToPx(i).toFixed(1)} ${yToPx(arr[i]).toFixed(1)}`;
    return d;
  };

  const yTicks = (() => {
    const span = yMax - yMin;
    const rough = span / 5;
    const pow = Math.pow(10, Math.floor(Math.log10(Math.abs(rough))));
    const mult = [1, 2, 2.5, 5, 10].find(m => m * pow >= rough) || 1;
    const step = mult * pow;
    const arr = [];
    const start = Math.ceil(yMin / step) * step;
    for (let v = start; v <= yMax; v += step) arr.push(Number(v.toFixed(2)));
    if (!arr.includes(0) && yMin < 0 && yMax > 0) arr.push(0);
    return arr.sort((a, b) => a - b);
  })();

  const xTicks = cfg.ticks.map((label, ix, arr) => ({
    i: Math.round((ix / (arr.length - 1)) * (N - 1)),
    label,
  }));

  const fmtPct = (v) => (v >= 0 ? '+' : '') + v.toFixed(Math.abs(v) < 10 ? 2 : 1) + '%';

  const hover = hoverIdx !== null ? eventsInRange[hoverIdx] : null;
  const hoverX = hover ? iToPx(hover.i) : 0;
  const hoverBtcY = hover ? yToPx((focus && data[focus] ? data[focus] : data.btc)[hover.i]) : 0;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
      {/* Chrome row */}
      <div style={{
        height: 50, padding: '0 24px', display: 'flex', alignItems: 'center',
        justifyContent: 'space-between',
        borderBottom: `1px solid ${T.edge}`, background: T.ink000,
      }}>
        <div style={{ display: 'flex', gap: 22 }}>
          {[
            { key: 'btc', c: T.btc, label: 'BITCOIN', value: fmtPct(data.end.btc) },
            { key: 'oil', c: T.oil, label: 'WTI OIL',  value: fmtPct(data.end.oil) },
            { key: 'spx', c: T.spx, label: 'S&P 500',  value: fmtPct(data.end.spx) },
            { key: 'dow', c: T.dow, label: 'DOW 30',   value: fmtPct(data.end.dow) },
          ].map(s => {
            const isFocus = focus === s.key;
            const dim     = focus && !isFocus;
            return (
              <div key={s.label}
                onClick={() => setFocus(isFocus ? null : s.key)}
                title={isFocus ? 'Click to show all' : `Click to focus ${s.label}`}
                style={{
                  display: 'flex', alignItems: 'center', gap: 8,
                  cursor: 'pointer', opacity: dim ? 0.4 : 1,
                  padding: '4px 8px', borderRadius: 6,
                  background: isFocus ? `${s.c}1a` : 'transparent',
                  border: `1px solid ${isFocus ? `${s.c}55` : 'transparent'}`,
                  transition: 'opacity 140ms cubic-bezier(0.2,0.7,0.2,1), background 140ms cubic-bezier(0.2,0.7,0.2,1)',
                }}>
                <div style={{ width: 10, height: 10, borderRadius: 3, background: s.c }} />
                <div style={{
                  fontSize: 10.5, fontWeight: 500, letterSpacing: 0.6,
                  color: isFocus ? s.c : T.textMid, textTransform: 'uppercase',
                }}>{s.label}</div>
                <div style={{
                  fontFamily: T.mono, fontSize: 12, color: isFocus ? s.c : T.text, fontWeight: 500, marginLeft: 2,
                }}>{s.value}</div>
              </div>
            );
          })}
        </div>

        <div style={{
          display: 'flex', padding: 3, background: T.ink200,
          border: `1px solid ${T.edge}`, borderRadius: 10, height: 30,
        }}>
          {Object.keys(CTX_RANGES).map((r) => {
            const active = r === range;
            return (
              <div key={r}
                onClick={() => setRange(r)}
                style={{
                  padding: '0 12px', minWidth: 38, height: 24,
                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                  fontFamily: T.mono, fontSize: 11, fontWeight: 500,
                  color: active ? T.ink000 : T.textMid,
                  background: active ? T.signal : 'transparent',
                  borderRadius: 7, cursor: 'pointer',
                  boxShadow: active ? `inset 0 0.5px 0 rgba(255,255,255,0.25)` : 'none',
                  letterSpacing: 0.5,
                }}>{r}</div>
            );
          })}
        </div>
      </div>

      {/* Chart */}
      <div style={{ position: 'relative', flex: 1, background: T.ink000 }}>
        <svg width={W} height={chartY + chartH + 30} style={{ display: 'block' }}
             onMouseLeave={() => setHoverIdx(null)}>
          {yTicks.map(v => {
            const y = yToPx(v);
            const isZero = v === 0;
            return (
              <g key={v}>
                <line x1={chartX} y1={y} x2={chartX + chartW} y2={y}
                      stroke={isZero ? 'rgba(255,255,255,0.15)' : 'rgba(255,255,255,0.04)'}
                      strokeWidth={isZero ? 1 : 0.5}
                      strokeDasharray={isZero ? '0' : '2,3'} />
                <text x={chartX - 10} y={y + 3} fill={isZero ? T.textMid : T.textDim}
                      fontFamily={T.mono} fontSize={10} textAnchor="end">
                  {fmtPct(v)}
                </text>
              </g>
            );
          })}

          {xTicks.map((t, idx) => (
            <g key={idx}>
              <line x1={iToPx(t.i)} y1={chartY + chartH} x2={iToPx(t.i)} y2={chartY + chartH + 4}
                    stroke="rgba(255,255,255,0.12)" strokeWidth={0.5} />
              <text x={iToPx(t.i)} y={chartY + chartH + 18} fill={T.textDim}
                    fontFamily={T.mono} fontSize={10} textAnchor="middle" letterSpacing={0.5}>
                {t.label.toUpperCase()}
              </text>
            </g>
          ))}

          {hover && (
            <line x1={hoverX} y1={chartY} x2={hoverX} y2={chartY + chartH}
                  stroke={T.signal} strokeWidth={1} strokeOpacity={0.55} />
          )}

          <path d={pathFor(data.dow)} fill="none" stroke={T.dow} strokeWidth={focus === 'dow' ? 2 : 1.25} strokeOpacity={focus && focus !== 'dow' ? 0.12 : 0.8}
                strokeLinecap="round" strokeLinejoin="round" />
          <path d={pathFor(data.spx)} fill="none" stroke={T.spx} strokeWidth={focus === 'spx' ? 2 : 1.25} strokeOpacity={focus && focus !== 'spx' ? 0.12 : 0.85}
                strokeLinecap="round" strokeLinejoin="round" />
          <path d={pathFor(data.oil)} fill="none" stroke={T.oil}
                strokeWidth={focus === 'oil' ? 2.25 : 1.5}
                strokeOpacity={focus && focus !== 'oil' ? 0.12 : 1}
                strokeLinecap="round" strokeLinejoin="round" />
          <path d={pathFor(data.btc)} fill="none" stroke={T.btc}
                strokeWidth={focus === 'btc' ? 2.5 : 1.75}
                strokeOpacity={focus && focus !== 'btc' ? 0.12 : 1}
                strokeLinecap="round" strokeLinejoin="round" />

          {(() => {
            const relevantCats = !focus ? null
              : focus === 'oil' ? new Set(['geo', 'trump'])
              : focus === 'btc' ? new Set(['btc', 'inst', 'reg', 'trump'])
              : focus === 'spx' ? new Set(['fed', 'trump'])
              : focus === 'dow' ? new Set(['fed', 'trump'])
              : null;
            return eventsInRange.filter(e => !relevantCats || relevantCats.has(e.cat));
          })().map((e, idx) => {
            const cx = iToPx(e.i);
            const focusArr = focus && data[focus] ? data[focus] : data.btc;
            const cy = yToPx(focusArr[e.i]);
            const isHover = idx === hoverIdx;
            return (
              <g key={`evt-${idx}`}
                 style={{ cursor: 'pointer' }}
                 onMouseEnter={() => setHoverIdx(idx)}
                 onClick={() => window.open(e.url, '_blank', 'noopener,noreferrer')}>
                <circle cx={cx} cy={cy} r={14} fill="transparent" />
                {isHover && (
                  <>
                    <circle cx={cx} cy={cy} r={10} fill={e.color} fillOpacity={0.18} />
                    <circle cx={cx} cy={cy} r={5} fill={e.color} stroke={T.ink000} strokeWidth={1.5} />
                  </>
                )}
                {!isHover && (
                  <circle cx={cx} cy={cy} r={3.25} fill={T.ink000} stroke={e.color} strokeWidth={1.25} />
                )}
              </g>
            );
          })}

          {hover && [
            { v: data.btc[hover.i], c: T.btc, label: 'BTC' },
            { v: data.oil[hover.i], c: T.oil, label: 'OIL' },
            { v: data.spx[hover.i], c: T.spx, label: 'SPX' },
            { v: data.dow[hover.i], c: T.dow, label: 'DOW' },
          ].map((r) => (
            <g key={r.label}>
              <rect x={hoverX + 8} y={yToPx(r.v) - 8} width={58} height={16} rx={3}
                    fill={T.ink300} stroke={r.c} strokeWidth={0.5} strokeOpacity={0.8} />
              <text x={hoverX + 37} y={yToPx(r.v) + 3} fill={r.c}
                    fontFamily={T.mono} fontSize={10} fontWeight={500} textAnchor="middle">
                {fmtPct(r.v)}
              </text>
            </g>
          ))}
        </svg>

        {hover && (() => {
          const panelW = 300;
          const leftOf = hoverX > chartX + chartW * 0.62;
          const left = leftOf ? Math.max(10, hoverX - panelW - 14) : hoverX + 18;
          const top = Math.min(Math.max(hoverBtcY - 80, 90), chartY + chartH - 220);
          return (
            <div style={{
              position: 'absolute',
              left, top,
              width: panelW,
              background: 'rgba(16, 20, 27, 0.82)',
              backdropFilter: 'blur(24px) saturate(160%)',
              WebkitBackdropFilter: 'blur(24px) saturate(160%)',
              border: `1px solid ${T.edgeHi}`,
              borderRadius: 10,
              padding: '14px 16px 14px',
              boxShadow: '0 12px 32px rgba(0,0,0,0.5), inset 0 0.5px 0 rgba(255,255,255,0.08)',
              pointerEvents: 'none',
            }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 10 }}>
                <div style={{ width: 6, height: 6, borderRadius: 3, background: hover.color }} />
                <div style={{
                  fontSize: 9.5, letterSpacing: 0.8, color: T.textMid,
                  textTransform: 'uppercase', fontWeight: 500,
                }}>{({
                  geo:'Geopolitical', fed:'Federal Reserve', btc:'BTC Flow',
                  trump:'Policy', inst:'Institutional', reg:'Regulatory',
                }[hover.cat])} · Event</div>
                <div style={{ marginLeft: 'auto', fontFamily: T.mono, fontSize: 10, color: T.textDim }}>
                  {hover.date.toUpperCase()}
                </div>
              </div>
              <div style={{
                fontSize: 14, fontWeight: 500, color: T.text,
                letterSpacing: -0.1, marginBottom: 8, lineHeight: 1.3,
              }}>{hover.label}</div>
              <div style={{
                fontSize: 11.5, color: T.textMid, lineHeight: 1.5, marginBottom: 10,
              }}>{hover.body}</div>
              <div style={{
                display: 'flex', alignItems: 'center', gap: 6,
                paddingTop: 8, borderTop: `1px solid ${T.edge}`,
                fontFamily: T.mono, fontSize: 10, color: T.signal, letterSpacing: 0.4,
              }}>
                <span>→</span>
                <span style={{
                  textDecoration: 'underline', textDecorationColor: 'rgba(232,184,74,0.5)',
                  textUnderlineOffset: 2,
                }}>Click dot to open article</span>
              </div>
            </div>
          );
        })()}
      </div>

      {/* Correlation bar */}
      <div style={{
        height: 90,
        background: T.ink100, borderTop: `1px solid ${T.edge}`,
        display: 'flex', alignItems: 'center', padding: '0 36px',
      }}>
        {[
          { label: 'BTC / OIL',  sub: 'CORRELATION',   v: '+0.312' },
          { label: 'BTC / OIL',  sub: 'ROLLING 90D',    v: '+0.187' },
          { label: 'BTC / SPX',  sub: 'CORRELATION',   v: '+0.641' },
          { label: 'OIL / SPX',  sub: 'CORRELATION',   v: '-0.223' },
          { label: 'REGIME',     sub: 'DETECTED',       v: 'RISK-ON' },
        ].map((c, idx) => (
          <div key={idx} style={{
            flex: 1, display: 'flex', flexDirection: 'column',
            gap: 6, paddingLeft: idx === 0 ? 0 : 36,
            borderLeft: idx === 0 ? 'none' : `1px solid ${T.edge}`,
          }}>
            <div style={{
              fontSize: 9, letterSpacing: 1, color: T.textDim,
              textTransform: 'uppercase', fontWeight: 500,
            }}>
              {c.label} <span style={{ color: T.textDim, opacity: 0.6 }}>·</span>&nbsp;{c.sub}
            </div>
            <div style={{
              fontFamily: T.mono, fontSize: 20, fontWeight: 500,
              color: T.text, letterSpacing: -0.3, lineHeight: 1,
            }}>{c.v}</div>
            <div style={{ width: 18, height: 1.5, background: T.signal, marginTop: 2 }} />
          </div>
        ))}
      </div>
    </div>
  );
}

// ============================================================================
// CALENDAR subview
// ============================================================================

function ContextCalendarView() {
  const T = ctxTokens;

  const weekStart = new Date(2026, 3, 13);
  const weeks = [];
  for (let w = 0; w < 5; w++) {
    const days = [];
    for (let d = 0; d < 7; d++) {
      const dt = new Date(weekStart);
      dt.setDate(dt.getDate() + w * 7 + d);
      days.push(dt);
    }
    weeks.push(days);
  }
  const todayStr = '2026-04-19';
  const iso = (d) => d.toISOString().slice(0, 10);

  const baseEvents = [
    { date: '2026-04-20', time: '08:30', cat: 'Macro Data',   c: T.fed,   imp: 3, title: 'US Retail Sales · Mar',       ex: { btc: +1, oil: 0, spx: +1 } },
    { date: '2026-04-21', time: '10:00', cat: 'Fed',          c: T.fed,   imp: 4, title: 'Powell · Economic Club NY',   ex: { btc: +1, oil: 0, spx: +1 } },
    { date: '2026-04-22', time: '14:00', cat: 'Fed',          c: T.fed,   imp: 5, title: 'FOMC Rate Decision',           ex: { btc: +1, oil: +1, spx: +1 }, pulse: true },
    { date: '2026-04-23', time: '16:00', cat: 'Earnings',     c: T.earn,  imp: 4, title: 'NVDA · Q1 Earnings',           ex: { btc: +1, oil: 0, spx: +1 } },
    { date: '2026-04-24', time: '09:00', cat: 'Regulatory',   c: T.reg,   imp: 5, title: 'CLARITY Act · Senate Vote',    ex: { btc: +1, oil: 0, spx: 0 }, pulse: true },
    { date: '2026-04-27', time: '00:00', cat: 'Geopolitical', c: T.geo,   imp: 4, title: 'Iran Nuclear Deadline',        ex: { btc: 0, oil: +1, spx: -1 } },
    { date: '2026-04-28', time: '10:30', cat: 'Oil',          c: T.oil,   imp: 3, title: 'EIA Crude Inventory',          ex: { btc: 0, oil: -1, spx: 0 } },
    { date: '2026-04-29', time: '08:30', cat: 'Macro Data',   c: T.fed,   imp: 5, title: 'US GDP · Q1 Advance',          ex: { btc: +1, oil: 0, spx: +1 } },
    { date: '2026-04-30', time: '16:00', cat: 'Earnings',     c: T.earn,  imp: 4, title: 'MSTR · Q1 Earnings',           ex: { btc: +1, oil: 0, spx: 0 } },
    { date: '2026-05-01', time: '08:30', cat: 'Macro Data',   c: T.fed,   imp: 4, title: 'Non-Farm Payrolls',            ex: { btc: +1, oil: 0, spx: +1 } },
    { date: '2026-05-01', time: '00:00', cat: 'Trump Policy', c: T.trump, imp: 4, title: 'China EV Battery Tariff · Eff.', ex: { btc: -1, oil: 0, spx: -1 } },
    { date: '2026-05-05', time: '14:00', cat: 'Geopolitical', c: T.geo,   imp: 3, title: 'G7 Foreign Ministers · Hormuz', ex: { btc: 0, oil: -1, spx: 0 } },
    { date: '2026-05-07', time: '10:00', cat: 'BTC Inst',     c: T.inst,  imp: 3, title: 'SEC · Spot ETH ETF Review',    ex: { btc: +1, oil: 0, spx: 0 } },
    { date: '2026-05-08', time: '09:00', cat: 'OPEC',         c: T.oil,   imp: 5, title: 'OPEC+ Ministerial Meeting',    ex: { btc: 0, oil: +1, spx: 0 }, pulse: true },
    { date: '2026-05-13', time: '08:30', cat: 'Macro Data',   c: T.fed,   imp: 4, title: 'CPI · April',                  ex: { btc: +1, oil: 0, spx: +1 } },
    { date: '2026-05-14', time: '00:00', cat: 'BTC Inst',     c: T.inst,  imp: 2, title: 'Bitcoin Conference · Miami',   ex: { btc: +1, oil: 0, spx: 0 } },
    { date: '2026-05-15', time: '16:00', cat: 'Earnings',     c: T.earn,  imp: 3, title: 'COIN · Q1 Earnings',           ex: { btc: +1, oil: 0, spx: +1 } },
  ];

  const [view, setView] = React.useState('Month');
  const [selectedDate, setSelectedDate] = React.useState('2026-04-22');
  const [activeCats, setActiveCats] = React.useState(null);
  const [monthShift, setMonthShift] = React.useState(0);
  const [customEvents, setCustomEvents] = React.useState([]);

  const liveHook = (window.useAutoUpdate || (() => ({ data: null })))(
    'calendar-live',
    async () => {
      const key = (window.TR_SETTINGS && window.TR_SETTINGS.keys && window.TR_SETTINGS.keys.finnhub) || '';
      if (!key) return null;
      const today = new Date();
      const from = today.toISOString().slice(0, 10);
      const toDt = new Date(today.getTime() + 30 * 86400000);
      const to = toDt.toISOString().slice(0, 10);
      const impactToImp = (v) => {
        if (typeof v === 'number') return v >= 3 ? 5 : v === 2 ? 3 : 2;
        const s = String(v || '').toLowerCase();
        if (s.indexOf('high') >= 0) return 5;
        if (s.indexOf('medium') >= 0) return 3;
        return 2;
      };
      const classifyEcon = (e) => {
        const raw = (e.event || e.title || '').trim();
        const up = raw.toUpperCase();
        const country = (e.country || '').toUpperCase();
        if (country && country !== 'US' && !/OPEC|CRUDE|OIL/.test(up)) return null;
        let cat = 'Macro Data', c = T.fed, imp = impactToImp(e.impact);
        let ex = { btc: 0, oil: 0, spx: 0 };
        if (/FOMC|FED FUNDS|FEDERAL FUNDS|RATE DECISION|POWELL|FED CHAIR/.test(up)) {
          cat = 'Fed'; c = T.fed; imp = Math.max(imp, 5);
          ex = { btc: +1, oil: +1, spx: +1 };
        } else if (/\bCPI\b|CORE PCE|\bPCE\b|NON-?FARM|NONFARM|PAYROLLS|\bPPI\b|\bGDP\b/.test(up)) {
          cat = 'Macro Data'; c = T.fed; imp = Math.max(imp, 4);
          ex = { btc: +1, oil: 0, spx: +1 };
        } else if (/OPEC|CRUDE|OIL INVENTOR|EIA/.test(up)) {
          cat = 'Oil'; c = T.oil;
          ex = { btc: 0, oil: -1, spx: 0 };
        }
        const timeRaw = e.time || '';
        const time = /^\d{2}:\d{2}/.test(timeRaw) ? timeRaw.slice(0, 5) : '08:30';
        const date = (e.time && /^\d{4}-\d{2}-\d{2}/.test(e.time)) ? e.time.slice(0, 10) : (e.date || '').slice(0, 10);
        if (!date) return null;
        return { date, time, cat, c, imp, title: raw || 'Economic Release', ex, _live: true };
      };
      const EARN_WATCH = ['NVDA', 'MSTR', 'COIN', 'IBIT', 'MARA'];
      const classifyEarn = (e) => {
        const sym = (e.symbol || '').toUpperCase();
        if (!sym || EARN_WATCH.indexOf(sym) === -1) return null;
        const date = (e.date || '').slice(0, 10);
        if (!date) return null;
        const hour = (e.hour || '').toLowerCase();
        const time = hour === 'bmo' ? '08:00' : hour === 'amc' ? '16:00' : '16:00';
        const ex = sym === 'NVDA' ? { btc: +1, oil: 0, spx: +1 }
                 : sym === 'MSTR' ? { btc: +1, oil: 0, spx: 0 }
                 : sym === 'COIN' ? { btc: +1, oil: 0, spx: +1 }
                 : { btc: +1, oil: 0, spx: 0 };
        return {
          date, time, cat: 'Earnings', c: T.earn, imp: 4,
          title: `${sym} · Q${e.quarter || ''} Earnings`.replace('Q · ', ' · '),
          ex, _live: true,
        };
      };
      const urls = {
        econ: `https://finnhub.io/api/v1/calendar/economic?from=${from}&to=${to}&token=${key}`,
        earn: `https://finnhub.io/api/v1/calendar/earnings?from=${from}&to=${to}&token=${key}`,
      };
      const [econRes, earnRes] = await Promise.all([
        fetch(urls.econ).then(r => r.ok ? r.json() : null).catch(() => null),
        fetch(urls.earn).then(r => r.ok ? r.json() : null).catch(() => null),
      ]);
      const econList = (econRes && econRes.economicCalendar) || [];
      const earnList = (earnRes && earnRes.earningsCalendar) || [];
      const transformed = [
        ...econList.map(classifyEcon).filter(Boolean),
        ...earnList.map(classifyEarn).filter(Boolean),
      ];
      return transformed.length ? transformed : null;
    },
    { refreshKey: 'calendar' }
  );
  const liveEvents = liveHook && liveHook.data;
  const liveOn = !!(liveEvents && liveEvents.length);

  const events = React.useMemo(() => {
    const norm = (s) => String(s || '').toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 24);
    const keyFor = (e) => `${e.date}|${norm(e.title)}`;
    const looseTag = (e) => {
      const up = (e.title || '').toUpperCase();
      if (/FOMC|FED FUNDS|RATE DECISION/.test(up)) return `${e.date}|FED_RATE`;
      if (/\bCPI\b/.test(up)) return `${e.date}|CPI`;
      if (/\bPPI\b/.test(up)) return `${e.date}|PPI`;
      if (/NON.?FARM|PAYROLLS/.test(up)) return `${e.date}|NFP`;
      if (/\bGDP\b/.test(up)) return `${e.date}|GDP`;
      if (/OPEC/.test(up)) return `${e.date}|OPEC`;
      if (/EIA|CRUDE INVENT/.test(up)) return `${e.date}|EIA`;
      const sym = (up.match(/^([A-Z]{2,5})\s*·/) || [])[1];
      if (sym) return `${e.date}|SYM_${sym}`;
      return null;
    };
    const seen = new Set();
    const looseSeen = new Set();
    const out = [];
    const pushIfNew = (e) => {
      const k = keyFor(e);
      const lt = looseTag(e);
      if (seen.has(k)) return;
      if (lt && looseSeen.has(lt)) return;
      seen.add(k);
      if (lt) looseSeen.add(lt);
      out.push(e);
    };
    (liveEvents || []).forEach(pushIfNew);
    baseEvents.forEach(pushIfNew);
    customEvents.forEach(pushIfNew);
    out.sort((a, b) => (a.date + a.time).localeCompare(b.date + b.time));
    return out;
  }, [liveEvents, customEvents]);

  const selected = React.useMemo(() => {
    const dayEvents = events.filter(e => e.date === selectedDate);
    if (!dayEvents.length) return null;
    return dayEvents.sort((a, b) => b.imp - a.imp)[0];
  }, [selectedDate, events]);

  const toggleCat = (label) => {
    setActiveCats(prev => {
      const cur = prev ? new Set(prev) : new Set();
      if (cur.has(label)) cur.delete(label); else cur.add(label);
      return cur.size === 0 ? null : cur;
    });
  };
  const catActive = (label) => !activeCats || activeCats.has(label);

  const eventsByDate = {};
  events.forEach(e => {
    if (!eventsByDate[e.date]) eventsByDate[e.date] = [];
    eventsByDate[e.date].push(e);
  });

  const daysUntil = (d) => Math.ceil((new Date(d) - new Date(todayStr)) / 86400000);

  const ImportanceDots = ({ n, size = 3 }) => (
    <div style={{ display: 'flex', gap: 2 }}>
      {[0, 1, 2, 3, 4].map(i => (
        <div key={i} style={{
          width: size, height: size, borderRadius: size / 2,
          background: i < n ? T.signal : 'rgba(255,255,255,0.10)',
        }} />
      ))}
    </div>
  );

  const DirArrow = ({ v, c }) => {
    if (v === 0) return <span style={{ color: T.textDim, fontFamily: T.mono, fontSize: 11 }}>—</span>;
    return (
      <span style={{ color: c, fontFamily: T.mono, fontSize: 12, fontWeight: 600 }}>
        {v > 0 ? '↑' : '↓'}
      </span>
    );
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
      {/* Toolbar */}
      <div style={{
        height: 50, display: 'flex', alignItems: 'center',
        padding: '0 28px', gap: 20,
        borderBottom: `1px solid ${T.edge}`, background: T.ink000,
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <div style={{
            fontSize: 18, fontWeight: 500, color: T.text, letterSpacing: -0.3,
          }}>April — May 2026</div>
          <div style={{ display: 'flex', gap: 4, marginLeft: 8 }}>
            {[{ s: '‹', d: -1 }, { s: '›', d: 1 }].map(btn => (
              <div key={btn.s}
                onClick={() => setMonthShift(prev => prev + btn.d)}
                style={{
                  width: 24, height: 24, borderRadius: 5,
                  background: T.ink200, border: `1px solid ${T.edge}`,
                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                  color: T.textMid, fontSize: 13, cursor: 'pointer',
                }}>{btn.s}</div>
            ))}
          </div>
          <div
            onClick={() => { setMonthShift(0); setSelectedDate(todayStr); }}
            style={{
              height: 24, padding: '0 10px', display: 'flex', alignItems: 'center',
              background: T.ink200, border: `1px solid ${T.edge}`, borderRadius: 5,
              fontSize: 10, color: T.textMid, letterSpacing: 0.5, marginLeft: 6,
              fontFamily: T.mono, cursor: 'pointer',
            }}>TODAY</div>
        </div>

        <div style={{ width: 1, height: 22, background: T.edge }} />

        <div style={{
          display: 'flex', padding: 3, background: T.ink200,
          border: `1px solid ${T.edge}`, borderRadius: 9, height: 28,
        }}>
          {['Month', 'Week', 'Agenda'].map(label => {
            const active = view === label;
            return (
              <div key={label}
                onClick={() => setView(label)}
                style={{
                  padding: '0 12px', height: 22, display: 'flex',
                  alignItems: 'center', fontSize: 11, fontWeight: 500,
                  color: active ? T.ink000 : T.textMid,
                  background: active ? T.signal : 'transparent',
                  borderRadius: 6, letterSpacing: 0.2,
                  cursor: active ? 'default' : 'pointer',
                }}>{label}</div>
            );
          })}
        </div>

        <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
          {[
            { label: 'Fed',     c: T.fed,   n: 4 },
            { label: 'Geo',     c: T.geo,   n: 2 },
            { label: 'Earn',    c: T.earn,  n: 3 },
            { label: 'Oil',     c: T.oil,   n: 2 },
            { label: 'Reg',     c: T.reg,   n: 1 },
            { label: 'Trump',   c: T.trump, n: 1 },
          ].map(c => {
            const on = catActive(c.label);
            return (
              <div key={c.label}
                onClick={() => toggleCat(c.label)}
                style={{
                  display: 'flex', alignItems: 'center', gap: 6,
                  padding: '4px 10px',
                  background: on ? T.ink200 : T.ink100,
                  border: `1px solid ${on ? T.edge : 'transparent'}`,
                  borderRadius: 6,
                  opacity: on ? 1 : 0.4, cursor: 'pointer',
                }}>
                <div style={{ width: 5, height: 5, borderRadius: 2.5, background: c.c }} />
                <div style={{ fontSize: 11, color: T.textMid, fontWeight: 500 }}>{c.label}</div>
                <div style={{ fontFamily: T.mono, fontSize: 10, color: T.textDim, marginLeft: 2 }}>{c.n}</div>
              </div>
            );
          })}
        </div>

        <div style={{ marginLeft: 'auto', display: 'flex', gap: 10, alignItems: 'center' }}>
          {liveOn && (
            <div style={{
              display: 'flex', alignItems: 'center', gap: 6,
              padding: '3px 9px', borderRadius: 6,
              background: 'rgba(111,207,142,0.10)',
              border: '1px solid rgba(111,207,142,0.35)',
              fontFamily: T.mono, fontSize: 9.5, fontWeight: 600,
              color: '#6FCF8E', letterSpacing: 0.7, textTransform: 'uppercase',
            }} title={`Live Finnhub calendar · ${liveEvents.length} upcoming events`}>
              <div style={{
                width: 5, height: 5, borderRadius: 3, background: '#6FCF8E',
                boxShadow: '0 0 6px rgba(111,207,142,0.8)',
              }} />
              LIVE · Finnhub
            </div>
          )}
          <div
            onClick={() => {
              const title = window.prompt('Event title');
              if (!title) return;
              const time = window.prompt('Time (HH:MM ET, 24h)', '14:00') || '14:00';
              setCustomEvents(prev => prev.concat([{
                date: selectedDate, time, cat: 'Custom', c: T.signal, imp: 3,
                title, ex: { btc: 0, oil: 0, spx: 0 },
              }]));
            }}
            style={{
              height: 28, padding: '0 12px', display: 'flex', alignItems: 'center', gap: 6,
              background: T.signal, color: T.ink000, borderRadius: 7,
              fontSize: 11, fontWeight: 600, letterSpacing: 0.2,
              boxShadow: 'inset 0 0.5px 0 rgba(255,255,255,0.3)',
              cursor: 'pointer',
            }}>
            + Add Event
          </div>
        </div>
      </div>

      {/* Body */}
      <div style={{ display: 'flex', flex: 1, minHeight: 0 }}>
        <div style={{
          flex: 1, background: T.ink000, padding: '16px 20px 16px 28px',
          display: 'flex', flexDirection: 'column',
        }}>
          <div style={{
            display: 'grid', gridTemplateColumns: 'repeat(7, 1fr)',
            gap: 6, marginBottom: 8,
          }}>
            {['MON', 'TUE', 'WED', 'THU', 'FRI', 'SAT', 'SUN'].map(d => (
              <div key={d} style={{
                fontSize: 9, letterSpacing: 1, color: T.textDim,
                fontWeight: 500, padding: '0 6px',
              }}>{d}</div>
            ))}
          </div>

          <div style={{
            flex: 1, display: 'grid',
            gridTemplateRows: `repeat(${weeks.length}, 1fr)`,
            gap: 6,
          }}>
            {weeks.map((days, wIdx) => (
              <div key={wIdx} style={{
                display: 'grid', gridTemplateColumns: 'repeat(7, 1fr)', gap: 6,
              }}>
                {days.map((dt) => {
                  const key = iso(dt);
                  const allDayEvents = eventsByDate[key] || [];
                  const catMap = { 'Fed': 'Fed', 'Macro Data': 'Fed', 'Geopolitical': 'Geo', 'Earnings': 'Earn',
                                    'Oil': 'Oil', 'OPEC': 'Oil', 'Regulatory': 'Reg', 'Trump Policy': 'Trump',
                                    'BTC Inst': 'Trump' };
                  const dayEvents = allDayEvents.filter(ev => catActive(catMap[ev.cat] || ev.cat));
                  const isToday = key === todayStr;
                  const isPast = key < todayStr;
                  const isSelected = key === selectedDate;
                  return (
                    <div key={key}
                      onClick={() => setSelectedDate(key)}
                      style={{
                      background: isSelected ? T.ink300 : (isToday ? 'rgba(232,184,74,0.05)' : T.ink100),
                      border: `1px solid ${isSelected ? T.edgeHi : (isToday ? 'rgba(232,184,74,0.3)' : T.edge)}`,
                      borderRadius: 8, padding: '8px 9px', minHeight: 0,
                      opacity: isPast ? 0.45 : 1,
                      boxShadow: isSelected ? 'inset 0 0.5px 0 rgba(255,255,255,0.08)' : 'none',
                      display: 'flex', flexDirection: 'column', gap: 4,
                      overflow: 'hidden', cursor: 'pointer',
                    }}>
                      <div style={{
                        display: 'flex', alignItems: 'center', marginBottom: 2,
                      }}>
                        <div style={{
                          fontFamily: T.mono, fontSize: 11, fontWeight: 500,
                          color: isToday ? T.signal : T.text,
                          letterSpacing: 0.2,
                        }}>{dt.getDate()}</div>
                        {isToday && (
                          <div style={{
                            marginLeft: 'auto', fontSize: 8.5, fontWeight: 600,
                            color: T.signal, letterSpacing: 0.6, fontFamily: T.mono,
                          }}>TODAY</div>
                        )}
                        {!isToday && dayEvents.length > 0 && (
                          <div style={{ marginLeft: 'auto' }}>
                            <ImportanceDots
                              n={Math.max(...dayEvents.map(e => e.imp))}
                              size={3}
                            />
                          </div>
                        )}
                      </div>

                      {dayEvents.slice(0, 3).map((e, idx) => {
                        const isSel = selected && e === selected;
                        return (
                          <div key={idx} style={{
                            display: 'flex', alignItems: 'center', gap: 4,
                            padding: '3px 5px',
                            background: isSel ? 'rgba(232,184,74,0.12)' : 'rgba(255,255,255,0.03)',
                            border: `0.5px solid ${isSel ? 'rgba(232,184,74,0.4)' : T.edge}`,
                            borderRadius: 4,
                            overflow: 'hidden',
                          }}>
                            <div style={{
                              width: 4, height: 4, borderRadius: 2, background: e.c, flexShrink: 0,
                            }} />
                            <div style={{
                              fontSize: 9.5, fontWeight: 500,
                              color: isSel ? T.signal : T.text,
                              whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
                              letterSpacing: 0.05,
                            }}>{e.title}</div>
                          </div>
                        );
                      })}
                      {dayEvents.length > 3 && (
                        <div style={{
                          fontFamily: T.mono, fontSize: 9, color: T.textDim,
                          padding: '0 5px', letterSpacing: 0.3,
                        }}>+{dayEvents.length - 3} more</div>
                      )}
                    </div>
                  );
                })}
              </div>
            ))}
          </div>
        </div>

        {/* Detail rail */}
        <div style={{
          width: 360, background: T.ink100, borderLeft: `1px solid ${T.edge}`,
          padding: '20px 22px', display: 'flex', flexDirection: 'column', gap: 16,
          overflow: 'auto',
        }}>
          <div>
            <div style={{
              fontSize: 10, letterSpacing: 1, color: T.textDim,
              textTransform: 'uppercase', fontWeight: 500, marginBottom: 10,
            }}>Selected · {new Date(selectedDate + 'T12:00').toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' })}</div>

            {!selected && (
              <div style={{
                background: T.ink200, border: `1px solid ${T.edge}`,
                borderRadius: 12, padding: '18px 18px',
                fontSize: 12, color: T.textMid, letterSpacing: 0.2, lineHeight: 1.5,
              }}>Nothing scheduled. Pick a day with a dot.</div>
            )}

            {selected && <div style={{
              background: T.ink200, border: `1px solid ${T.edgeHi}`,
              borderRadius: 12, padding: '16px 18px',
              boxShadow: 'inset 0 0.5px 0 rgba(255,255,255,0.06)',
            }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 10 }}>
                <div style={{ width: 6, height: 6, borderRadius: 3, background: selected.c }} />
                <div style={{
                  fontSize: 9.5, fontWeight: 500, letterSpacing: 0.8,
                  color: T.textMid, textTransform: 'uppercase',
                }}>{selected.cat}</div>
                <div style={{ marginLeft: 'auto' }}>
                  <ImportanceDots n={selected.imp} size={4} />
                </div>
              </div>

              <div style={{
                fontSize: 16, fontWeight: 500, color: T.text,
                letterSpacing: -0.2, marginBottom: 8, lineHeight: 1.25,
              }}>{selected.title}</div>

              <div style={{
                display: 'flex', gap: 16, marginBottom: 14,
                fontFamily: T.mono, fontSize: 11, color: T.textMid, letterSpacing: 0.3,
              }}>
                <span>{selected.time} ET</span>
                <span style={{ color: T.signal }}>IN {daysUntil(selected.date)}D</span>
              </div>

              <div style={{ borderTop: `1px solid ${T.edge}`, paddingTop: 12 }}>
                <div style={{
                  fontSize: 9, letterSpacing: 0.8, color: T.textDim,
                  textTransform: 'uppercase', fontWeight: 500, marginBottom: 8,
                }}>Expected Direction · On Hawkish Beat</div>
                <div style={{ display: 'flex', gap: 0 }}>
                  {[
                    { label: 'BTC', v: selected.ex.btc, c: T.btc },
                    { label: 'OIL', v: selected.ex.oil, c: T.oil },
                    { label: 'SPX', v: selected.ex.spx, c: T.spx },
                  ].map((r, idx) => (
                    <div key={r.label} style={{
                      flex: 1, paddingLeft: idx === 0 ? 0 : 12,
                      borderLeft: idx === 0 ? 'none' : `1px solid ${T.edge}`,
                    }}>
                      <div style={{
                        fontSize: 8.5, letterSpacing: 0.8, color: T.textDim,
                        textTransform: 'uppercase', marginBottom: 4,
                      }}>{r.label}</div>
                      <div style={{ display: 'flex', alignItems: 'baseline', gap: 4 }}>
                        <DirArrow v={r.v} c={r.c} />
                        <span style={{
                          fontFamily: T.mono, fontSize: 11, color: T.textMid,
                        }}>{r.v === 0 ? 'neutral' : r.v > 0 ? 'bullish' : 'bearish'}</span>
                      </div>
                    </div>
                  ))}
                </div>
              </div>

              <div style={{
                marginTop: 12, padding: '10px 12px',
                background: T.ink300, border: `0.5px solid ${T.edge}`,
                borderRadius: 7,
              }}>
                <div style={{
                  fontSize: 8.5, letterSpacing: 0.8, color: T.textDim,
                  textTransform: 'uppercase', fontWeight: 500, marginBottom: 4,
                }}>KALSHI · 25bp CUT</div>
                <div style={{ display: 'flex', alignItems: 'baseline', gap: 6 }}>
                  <div style={{
                    fontFamily: T.mono, fontSize: 18, fontWeight: 500, color: T.signal,
                    letterSpacing: -0.3,
                  }}>38%</div>
                  <div style={{
                    fontFamily: T.mono, fontSize: 10, color: T.textDim, letterSpacing: 0.3,
                  }}>+4 from last week</div>
                </div>
              </div>
            </div>}
          </div>

          <div style={{ flex: 1 }}>
            {(() => {
              const weekCount = events.filter(e => { const du = daysUntil(e.date); return du >= 0 && du <= 7; }).length;
              return (
                <div style={{
                  fontSize: 10, letterSpacing: 1, color: T.textDim,
                  textTransform: 'uppercase', fontWeight: 500, marginBottom: 10,
                }}>Next 7 Days · {weekCount} {weekCount === 1 ? 'Event' : 'Events'}</div>
              );
            })()}

            <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
              {events
                .filter(e => {
                  const du = daysUntil(e.date);
                  return du >= 0 && du <= 7;
                })
                .map((e, idx) => (
                  <div key={idx}
                    onClick={() => setSelectedDate(e.date)}
                    style={{
                      display: 'flex', alignItems: 'center', gap: 10,
                      padding: '9px 11px',
                      background: e.date === selectedDate ? T.ink300
                                : e.pulse ? 'rgba(232,184,74,0.05)' : T.ink200,
                      border: `0.5px solid ${e.date === selectedDate ? T.edgeHi
                                : e.pulse ? 'rgba(232,184,74,0.3)' : T.edge}`,
                      borderRadius: 7, cursor: 'pointer',
                    }}>
                    <div style={{ width: 5, height: 5, borderRadius: 2.5, background: e.c, flexShrink: 0 }} />
                    <div style={{ minWidth: 0, flex: 1 }}>
                      <div style={{
                        fontSize: 11.5, fontWeight: 500, color: T.text,
                        whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
                        marginBottom: 2,
                      }}>{e.title}</div>
                      <div style={{
                        fontFamily: T.mono, fontSize: 9.5, color: T.textDim, letterSpacing: 0.3,
                      }}>
                        {new Date(e.date).toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' }).toUpperCase()}
                        &nbsp;·&nbsp;{e.time}
                      </div>
                    </div>
                    <div style={{
                      fontFamily: T.mono, fontSize: 10, fontWeight: 600,
                      color: daysUntil(e.date) <= 1 ? T.signal : T.textMid,
                      padding: '2px 6px', borderRadius: 4,
                      background: daysUntil(e.date) <= 1 ? 'rgba(232,184,74,0.12)' : 'rgba(255,255,255,0.03)',
                      letterSpacing: 0.3,
                    }}>
                      {daysUntil(e.date) === 0 ? 'TODAY' : daysUntil(e.date) === 1 ? 'TMRW' : `${daysUntil(e.date)}D`}
                    </div>
                  </div>
                ))}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

// ============================================================================
// Shell — two-pill internal switcher
// ============================================================================

function ContextScreen({ onNav }) {
  const T = ctxTokens;
  const W = 1280, H = 820;
  const [sub, setSub] = React.useState('chart'); // 'chart' | 'calendar'

  return (
    <div style={{
      width: W, height: H, background: T.ink000, color: T.text,
      fontFamily: T.ui, position: 'relative', overflow: 'hidden',
      display: 'flex', flexDirection: 'column',
    }}>
      {/* Header */}
      <div style={{
        height: 52, display: 'flex', alignItems: 'center',
        padding: '0 20px', borderBottom: `1px solid ${T.edge}`,
        background: T.ink100,
      }}>
        <img src="assets/gg-logo.png" alt="Global Gauntlet"
          style={{ width: 44, height: 44, objectFit: 'contain', filter: 'drop-shadow(0 0 10px rgba(201,162,39,0.28))' }} />
        <div style={{ marginLeft: 12, fontSize: 15, fontWeight: 500, color: T.text, letterSpacing: 0.2 }}>TradeRadar</div>

        <TRTabBar current="context" onNav={onNav} />

        <div style={{ marginLeft: 'auto', display: 'flex', alignItems: 'center', gap: 16 }}>
          <TRLiveStripInline />
          <TRGearInline />
          <div style={{ fontFamily: T.mono, fontSize: 11, color: T.textMid, letterSpacing: 0.4 }}>
            <span style={{ color: T.signal }}>●</span>&nbsp; CONTEXT · CHART + CALENDAR
          </div>
        </div>
      </div>

      {/* Internal pill tab bar */}
      <div style={{
        height: 48, display: 'flex', alignItems: 'center',
        padding: '0 24px', gap: 8,
        borderBottom: `1px solid ${T.edge}`, background: T.ink100,
      }}>
        {[
          { key: 'chart',    label: 'Chart' },
          { key: 'calendar', label: 'Calendar' },
        ].map(t => {
          const active = sub === t.key;
          return (
            <div key={t.key}
              data-walk={`context-${t.key}`}
              onClick={() => setSub(t.key)}
              style={{
                padding: '7px 16px',
                fontSize: 11,
                fontWeight: 600,
                fontFamily: T.mono,
                letterSpacing: 0.6,
                borderRadius: 7,
                cursor: active ? 'default' : 'pointer',
                background: active ? T.signal : T.ink200,
                color: active ? T.ink000 : T.textMid,
                border: `1px solid ${active ? T.signal : T.edge}`,
                textTransform: 'uppercase',
                transition: 'background 140ms ease, color 140ms ease',
              }}>
              {t.label}
            </div>
          );
        })}
      </div>

      {/* Sub content */}
      <div style={{ flex: 1, minHeight: 0, display: 'flex', flexDirection: 'column' }}>
        {sub === 'chart' ? <ContextChartView /> : <ContextCalendarView />}
      </div>
    </div>
  );
}

window.ContextScreen = ContextScreen;
