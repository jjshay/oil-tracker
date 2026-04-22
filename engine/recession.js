// engine/recession.js — NY Fed recession probability + leading indicators.
//
// Blends multiple macro signals into a 0-100 composite recession-risk score:
//   - RECPROUSM156N : NY Fed probability of US recession 12 months ahead (yield-curve based)
//   - T10Y3M        : 10Y − 3M Treasury spread (the NY Fed's preferred inversion signal)
//   - T10Y2Y        : 10Y − 2Y Treasury spread (classic 2s10s)
//   - USSLIND       : Philly Fed leading index for the US
//   - UMCSENT       : U Mich consumer sentiment (proxy for Conference Board LEI flavor)
//
// Free FRED API; user provides key via window.TR_SETTINGS.keys.fred.
//
// Exposes window.RecessionData:
//   getNYFedProbability()   → { latest, prior, delta, history:[{date,value}], series:'RECPROUSM156N' } | null
//   getYieldCurveSpread()   → { t10y3m:{…}, t10y2y:{…} }
//   getConsumerSentiment()  → { latest, …, series:'UMCSENT' } | null
//   getLEI()                → { latest, …, series:'USSLIND' } | null
//   getCompositeModel()     → {
//     score:           0-100  (higher = more recession risk)
//     label:           'LOW'|'ELEVATED'|'HIGH'|'CRITICAL'
//     components:      [{ id, label, weight, contribution, raw }],
//     asOf:            ISO date,
//   }
//   HISTORICAL_RECESSIONS   → [{ start:'YYYY-MM', end:'YYYY-MM', label }]
//
// Depends on window.FREDData (engine/fred.js) for the raw series fetch.

(function () {
  if (typeof window === 'undefined') return;

  var CACHE_TTL_MS = 10 * 60 * 1000;
  var cache = {}; // { key: { data, fetchedAt } }

  // NBER-dated US recessions over the last ~35 years — used for chart overlays.
  var HISTORICAL_RECESSIONS = [
    { start: '1990-07', end: '1991-03', label: 'Gulf War recession' },
    { start: '2001-03', end: '2001-11', label: 'Dot-com recession' },
    { start: '2007-12', end: '2009-06', label: 'Great Financial Crisis' },
    { start: '2020-02', end: '2020-04', label: 'COVID recession' },
  ];

  function cget(key) {
    var e = cache[key];
    if (!e) return null;
    if (Date.now() - e.fetchedAt > CACHE_TTL_MS) return null;
    return e.data;
  }
  function cset(key, data) {
    cache[key] = { data: data, fetchedAt: Date.now() };
  }

  // Pull a series from FRED and return a summarized { latest, prior, delta, history, series }.
  async function fetchSummary(seriesId, points) {
    var key = 'sum:' + seriesId + ':' + (points || 60);
    var hit = cget(key);
    if (hit) return hit;

    if (!window.FREDData || typeof window.FREDData.getSeries !== 'function') return null;
    var rows = await window.FREDData.getSeries(seriesId, points || 60);
    if (!rows || !rows.length) return null;

    var latest = null, prior = null;
    for (var i = 0; i < rows.length; i++) {
      if (rows[i].value != null) {
        if (latest == null) { latest = rows[i].value; continue; }
        prior = rows[i].value;
        break;
      }
    }
    var delta = (latest != null && prior != null) ? latest - prior : null;
    var summary = {
      series:  seriesId,
      latest:  latest,
      prior:   prior,
      delta:   delta,
      history: rows.slice().reverse(), // oldest → newest for sparklines
      asOf:    rows[0] && rows[0].date,
    };
    cset(key, summary);
    return summary;
  }

  async function getNYFedProbability() {
    return fetchSummary('RECPROUSM156N', 120);
  }

  async function getYieldCurveSpread() {
    var results = await Promise.all([
      fetchSummary('T10Y3M', 120),
      fetchSummary('T10Y2Y', 120),
    ]);
    return { t10y3m: results[0], t10y2y: results[1] };
  }

  async function getConsumerSentiment() {
    // DRTSCILM (Senior Loan Officer) is sparse; UMCSENT is the de-facto retail sentiment gauge.
    return fetchSummary('UMCSENT', 120);
  }

  async function getLEI() {
    // Philly Fed USSLIND leading index — monthly, national.
    return fetchSummary('USSLIND', 120);
  }

  // Compose a 0-100 recession risk score from the signals. Weights sum to 1.0.
  // Each component maps its own value to a 0-100 sub-score, then we take the
  // weighted mean. Missing components are dropped and weights renormalized.
  async function getCompositeModel() {
    var parts = await Promise.all([
      getNYFedProbability(),
      getYieldCurveSpread(),
      getConsumerSentiment(),
      getLEI(),
    ]);
    var nyfed  = parts[0];
    var spread = parts[1] || {};
    var sent   = parts[2];
    var lei    = parts[3];

    var components = [];

    // 1) NY Fed probability — already 0-100ish, pass through.
    if (nyfed && nyfed.latest != null) {
      var nyScore = Math.max(0, Math.min(100, nyfed.latest));
      components.push({
        id: 'nyfed',
        label: 'NY Fed model',
        weight: 0.40,
        raw: nyfed.latest,
        contribution: nyScore,
      });
    }

    // 2) 10Y-3M spread — more inverted = higher score. Map [-2, +3] → [100, 0].
    if (spread.t10y3m && spread.t10y3m.latest != null) {
      var s = spread.t10y3m.latest;
      var ycScore = Math.max(0, Math.min(100, ((3 - s) / 5) * 100));
      components.push({
        id: 't10y3m',
        label: '10Y-3M spread',
        weight: 0.25,
        raw: s,
        contribution: ycScore,
      });
    }

    // 3) 2s10s spread — same inversion dynamic. Map [-1, +3] → [100, 0].
    if (spread.t10y2y && spread.t10y2y.latest != null) {
      var s2 = spread.t10y2y.latest;
      var yc2Score = Math.max(0, Math.min(100, ((3 - s2) / 4) * 100));
      components.push({
        id: 't10y2y',
        label: '2s10s spread',
        weight: 0.15,
        raw: s2,
        contribution: yc2Score,
      });
    }

    // 4) Consumer sentiment — lower sentiment = higher recession risk.
    // UMCSENT historical range ~50 (bad) → 110 (great). Map 50→100, 110→0.
    if (sent && sent.latest != null) {
      var sScore = Math.max(0, Math.min(100, ((110 - sent.latest) / 60) * 100));
      components.push({
        id: 'sentiment',
        label: 'Consumer sentiment',
        weight: 0.10,
        raw: sent.latest,
        contribution: sScore,
      });
    }

    // 5) LEI — negative YoY = higher risk. latest value is a monthly change.
    // USSLIND historical range ~-3 (bad) → +3 (good). Map 3→0, -3→100.
    if (lei && lei.latest != null) {
      var lScore = Math.max(0, Math.min(100, ((3 - lei.latest) / 6) * 100));
      components.push({
        id: 'lei',
        label: 'Leading Index',
        weight: 0.10,
        raw: lei.latest,
        contribution: lScore,
      });
    }

    if (!components.length) {
      return { score: null, label: 'NO DATA', components: [], asOf: null };
    }

    var totalW = components.reduce(function (acc, c) { return acc + c.weight; }, 0);
    var score = components.reduce(function (acc, c) {
      return acc + (c.contribution * (c.weight / totalW));
    }, 0);
    score = Math.round(score * 10) / 10;

    var label = 'LOW';
    if (score >= 70) label = 'CRITICAL';
    else if (score >= 45) label = 'HIGH';
    else if (score >= 25) label = 'ELEVATED';

    return {
      score: score,
      label: label,
      components: components,
      asOf: new Date().toISOString(),
    };
  }

  function clearCache() { cache = {}; }

  window.RecessionData = {
    getNYFedProbability:  getNYFedProbability,
    getYieldCurveSpread:  getYieldCurveSpread,
    getConsumerSentiment: getConsumerSentiment,
    getLEI:               getLEI,
    getCompositeModel:    getCompositeModel,
    HISTORICAL_RECESSIONS: HISTORICAL_RECESSIONS.slice(),
    clearCache:           clearCache,
  };
})();
