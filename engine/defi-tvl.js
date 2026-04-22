// engine/defi-tvl.js — DeFi total value locked aggregator.
//
// Data source: DeFiLlama free public API (https://api.llama.fi). CORS-open,
// no key. We hit four endpoints:
//   GET /tvl                         → scalar total USD TVL
//   GET /protocols                   → full protocol list w/ chain breakdowns
//   GET /chains                      → per-chain TVL snapshot
//   GET /v2/historicalChainTvl       → daily time series (aggregate, all chains)
//
// Exposes on window:
//   DeFiTVL.getTotalTVL()                → number | null  (USD)
//   DeFiTVL.getByChain(chainKey?)        → { ethereum, solana, base, bsc,
//                                             arbitrum, tron, ... } | number
//   DeFiTVL.getTopProtocols(limit=20)    → [{ name, slug, tvl, chain, chains,
//                                             change1d, change7d, change30d,
//                                             category, logo, url }, …]
//   DeFiTVL.getHistory(days=30)          → [{ date, tvl }, …] (oldest→newest)
//
// Cache: 10-minute in-memory TTL keyed by endpoint.
// All values are USD. Missing fields default to 0.

(function () {
  if (typeof window === 'undefined') return;

  var CACHE_TTL_MS = 10 * 60 * 1000;
  var BASE = 'https://api.llama.fi';

  // ---------- cache ----------
  var cache = {}; // key → { data, fetchedAt }

  function cacheGet(key) {
    var e = cache[key];
    if (!e) return null;
    if (Date.now() - e.fetchedAt > CACHE_TTL_MS) return null;
    return e.data;
  }
  function cacheSet(key, data) {
    cache[key] = { data: data, fetchedAt: Date.now() };
  }

  // ---------- fetch helper ----------
  async function fetchJson(path) {
    var key = path;
    var cached = cacheGet(key);
    if (cached != null) return cached;
    try {
      var resp = await fetch(BASE + path, { method: 'GET' });
      if (!resp.ok) return null;
      var json = await resp.json();
      if (json == null) return null;
      cacheSet(key, json);
      return json;
    } catch (_) {
      return null;
    }
  }

  // ---------- public getters ----------
  async function getTotalTVL() {
    var j = await fetchJson('/tvl');
    if (j == null) return null;
    // /tvl returns a bare number; be defensive.
    if (typeof j === 'number' && isFinite(j)) return j;
    if (j && typeof j.tvl === 'number') return j.tvl;
    return null;
  }

  async function getByChain(chainKey) {
    var arr = await fetchJson('/chains');
    if (!Array.isArray(arr)) return null;
    var map = {};
    for (var i = 0; i < arr.length; i++) {
      var row = arr[i];
      if (!row || !row.name) continue;
      var k = String(row.name).toLowerCase();
      map[k] = {
        name: row.name,
        tvl: Number(row.tvl) || 0,
        tokenSymbol: row.tokenSymbol || null,
        gecko_id: row.gecko_id || null,
      };
    }
    if (chainKey) {
      var ck = String(chainKey).toLowerCase();
      return map[ck] || null;
    }
    return map;
  }

  async function getTopProtocols(limit) {
    var n = Math.max(1, Math.min(500, limit || 20));
    var arr = await fetchJson('/protocols');
    if (!Array.isArray(arr)) return null;
    // Sort by current TVL desc.
    var sorted = arr.slice().sort(function (a, b) {
      return (Number(b.tvl) || 0) - (Number(a.tvl) || 0);
    });
    var out = [];
    for (var i = 0; i < sorted.length && out.length < n; i++) {
      var p = sorted[i];
      if (!p || !p.name) continue;
      // Skip CEX/chains that sometimes bleed in with null tvl.
      if (!isFinite(p.tvl)) continue;
      out.push({
        name:      p.name,
        slug:      p.slug || null,
        tvl:       Number(p.tvl) || 0,
        chain:     p.chain || null,
        chains:    Array.isArray(p.chains) ? p.chains.slice(0, 8) : [],
        change1d:  Number(p.change_1d)  || 0,
        change7d:  Number(p.change_7d)  || 0,
        change30d: Number(p.change_1m)  || 0,
        category:  p.category || null,
        logo:      p.logo || null,
        url:       p.url || null,
      });
    }
    return out;
  }

  async function getHistory(days) {
    var n = Math.max(1, Math.min(365 * 5, days || 30));
    var arr = await fetchJson('/v2/historicalChainTvl');
    if (!Array.isArray(arr)) return null;
    // Each row: { date (unix seconds), tvl }. Keep oldest→newest.
    var rows = [];
    for (var i = 0; i < arr.length; i++) {
      var r = arr[i];
      if (!r || r.date == null) continue;
      var ts = Number(r.date);
      if (!isFinite(ts)) continue;
      rows.push({ date: isoFromUnix(ts), tvl: Number(r.tvl) || 0 });
    }
    rows.sort(function (a, b) { return a.date < b.date ? -1 : a.date > b.date ? 1 : 0; });
    return rows.slice(-n);
  }

  function isoFromUnix(sec) {
    var d = new Date(sec * 1000);
    var y = d.getUTCFullYear();
    var m = d.getUTCMonth() + 1;
    var day = d.getUTCDate();
    return y + '-' + pad2(m) + '-' + pad2(day);
  }
  function pad2(n) { return n < 10 ? '0' + n : '' + n; }

  // ---------- expose ----------
  window.DeFiTVL = {
    getTotalTVL:     getTotalTVL,
    getByChain:      getByChain,
    getTopProtocols: getTopProtocols,
    getHistory:      getHistory,
    clearCache:      function () { cache = {}; },
  };
})();
