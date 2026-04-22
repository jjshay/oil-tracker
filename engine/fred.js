// engine/fred.js — FRED (St. Louis Fed) macro series fetcher.
//
// Free public API. Users need a 32-char API key from
// https://fred.stlouisfed.org/docs/api/api_key.html. The engine resolves the
// key in this order:
//   1. window.TR_SETTINGS.keys.fred
//   2. window.FRED_API_KEY
//   3. fallback placeholder (will 400 — caller must show "paste key" UI)
//
// Exposes on window:
//   FREDData.getSeries(seriesId, limit)   → [{ date:'YYYY-MM-DD', value:Number|null }, …]
//                                             newest-first, or null on failure.
//   FREDData.getBundle()                   → {
//     DFF:       { latest, prior, delta, deltaPct, history:[{date,value},…] },
//     DGS10:     { … },
//     …one entry per SERIES id…
//   }
//   FREDData.SERIES                         → canonical series map (for UI labels/units)
//   FREDData.hasKey()                       → boolean
//   FREDData.clearCache()                   → void
//
// Cache: in-memory, 10-minute TTL, keyed by series id.

(function () {
  if (typeof window === 'undefined') return;

  var CACHE_TTL_MS = 10 * 60 * 1000;
  var BASE = 'https://api.stlouisfed.org/fred/series/observations';

  // Canonical series set the FRED panel renders as tiles.
  // unit:  'pct' | 'bps' | 'usd-bn' | 'usd-tn' | 'num' | 'ratio'
  // scale: optional multiplier (e.g. WALCL is in millions of $, we convert to $B)
  var SERIES = {
    DFF:         { label: 'Fed Funds',    desc: 'Effective Fed Funds Rate',    unit: 'pct' },
    DGS10:       { label: '10Y Treasury', desc: '10-Year Treasury Yield',      unit: 'pct' },
    DTWEXBGS:    { label: 'USD Index',    desc: 'Trade-Weighted USD (Broad)',  unit: 'num' },
    BAMLH0A0HYM2:{ label: 'HY OAS',       desc: 'High-Yield Option-Adj Spread',unit: 'pct' },
    WM2NS:       { label: 'M2 Supply',    desc: 'M2 Money Stock (NSA)',        unit: 'usd-bn', scale: 1 },
    WALCL:       { label: 'Fed Balance',  desc: 'Fed Balance Sheet',           unit: 'usd-bn', scale: 0.001 }, // millions → billions
    T10Y2Y:      { label: '2s10s Spread', desc: '10Y − 2Y Treasury Spread',    unit: 'pct' },
    T10YIE:      { label: '10Y Breakeven',desc: '10Y Breakeven Inflation',     unit: 'pct' },
    DEXUSEU:     { label: 'EUR/USD',      desc: 'EUR/USD Spot',                unit: 'num' },
    UNRATE:      { label: 'Unemployment', desc: 'U.S. Unemployment Rate',      unit: 'pct' },
  };

  // Canonical rendering order for the grid.
  var SERIES_ORDER = [
    'DFF','DGS10','T10Y2Y','T10YIE',
    'DTWEXBGS','DEXUSEU','BAMLH0A0HYM2','UNRATE',
    'WM2NS','WALCL',
  ];

  // ---------- key resolution ----------
  function resolveKey() {
    try {
      var s = window.TR_SETTINGS;
      if (s && s.keys && typeof s.keys.fred === 'string' && s.keys.fred.trim()) return s.keys.fred.trim();
    } catch (_) {}
    if (typeof window.FRED_API_KEY === 'string' && window.FRED_API_KEY.trim()) return window.FRED_API_KEY.trim();
    // Placeholder. Will fail validation (32-char alpha-num lowercase).
    return 'PASTE_FRED_KEY_HERE_________________';
  }
  function hasKey() {
    var k = resolveKey();
    return /^[a-z0-9]{32}$/.test(k);
  }

  // ---------- cache ----------
  var cache = {};  // { [seriesId]: { data, fetchedAt } }

  function cacheGet(key) {
    var e = cache[key];
    if (!e) return null;
    if (Date.now() - e.fetchedAt > CACHE_TTL_MS) return null;
    return e.data;
  }
  function cacheSet(key, data) {
    cache[key] = { data: data, fetchedAt: Date.now() };
  }

  // ---------- fetch ----------
  async function getSeries(seriesId, limit) {
    if (!seriesId) return null;
    var lim = Math.max(1, Math.min(500, limit || 30));
    var cacheKey = seriesId + ':' + lim;
    var cached = cacheGet(cacheKey);
    if (cached) return cached;

    var key = resolveKey();
    var url = BASE
      + '?series_id=' + encodeURIComponent(seriesId)
      + '&api_key=' + encodeURIComponent(key)
      + '&file_type=json&sort_order=desc&limit=' + lim;

    try {
      var resp = await fetch(url, { method: 'GET' });
      if (!resp.ok) return null;
      var json = await resp.json();
      if (!json || !Array.isArray(json.observations)) return null;
      var scale = (SERIES[seriesId] && SERIES[seriesId].scale) || 1;
      var rows = json.observations.map(function (o) {
        var v = o.value;
        if (v == null || v === '' || v === '.') return { date: o.date, value: null };
        var n = parseFloat(v);
        if (!isFinite(n)) return { date: o.date, value: null };
        return { date: o.date, value: n * scale };
      });
      cacheSet(cacheKey, rows);
      return rows;
    } catch (_) {
      return null;
    }
  }

  // ---------- bundle ----------
  function summarizeRows(rows) {
    if (!rows || !rows.length) return null;
    // rows is newest-first.
    var latest = null;
    var prior = null;
    for (var i = 0; i < rows.length; i++) {
      if (rows[i].value != null) {
        if (latest == null) { latest = rows[i].value; continue; }
        prior = rows[i].value;
        break;
      }
    }
    var delta = null;
    var deltaPct = null;
    if (latest != null && prior != null) {
      delta = latest - prior;
      if (prior !== 0) deltaPct = (delta / Math.abs(prior)) * 100;
    }
    return {
      latest: latest,
      prior: prior,
      delta: delta,
      deltaPct: deltaPct,
      history: rows.slice().reverse(), // oldest → newest for sparklines
    };
  }

  async function getBundle() {
    var ids = SERIES_ORDER;
    var out = {};
    // Fire all fetches in parallel.
    var results = await Promise.all(ids.map(function (id) {
      return getSeries(id, 30).then(function (rows) { return { id: id, rows: rows }; });
    }));
    for (var i = 0; i < results.length; i++) {
      var r = results[i];
      out[r.id] = summarizeRows(r.rows);
    }
    return out;
  }

  function clearCache() { cache = {}; }

  window.FREDData = {
    getSeries: getSeries,
    getBundle: getBundle,
    hasKey:    hasKey,
    clearCache: clearCache,
    SERIES:    SERIES,
    SERIES_ORDER: SERIES_ORDER.slice(),
  };
})();
