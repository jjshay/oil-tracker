// engine/alt-flow.js — Altcoin price action + dominance aggregator.
//
// Free public data sources:
//   GET https://api.coingecko.com/api/v3/coins/markets?vs_currency=usd
//       &order=market_cap_desc&per_page=100&page=1&sparkline=true
//       &price_change_percentage=1h,24h,7d,30d
//   GET https://api.coingecko.com/api/v3/search/trending
//   GET https://api.coingecko.com/api/v3/global        (BTC/ETH/stable share)
//
// Exposes on window:
//   AltFlow.getTopGainers(days=1|7|30, limit=20)  → [{ id, symbol, name, price,
//       mcap, change24h, change7d, change30d, sparkline, image }, …]
//   AltFlow.getTopLosers(days=1|7|30, limit=20)   → same
//   AltFlow.getTrending()                         → [{ id, symbol, name, score,
//       mcap_rank, price_btc, thumb }, ...]
//   AltFlow.getDominance()                        → { btc, eth, stable, alt,
//       total_mcap_usd }
//
// Cache: 10-minute TTL per endpoint.
// We request ONE big /markets payload and reshape it locally so free-tier rate
// limits aren't stressed (gainers/losers/sparklines all come from the same
// request).

(function () {
  if (typeof window === 'undefined') return;

  var CACHE_TTL_MS = 10 * 60 * 1000;
  var CG_BASE = 'https://api.coingecko.com/api/v3';

  // Known stablecoins (for dominance bucket). Extendable; not every stable is
  // in the top 100 market cap so this is a best-effort list.
  var STABLE_SYMS = {
    usdt: 1, usdc: 1, dai: 1, tusd: 1, usdd: 1, fdusd: 1, pyusd: 1, busd: 1,
    gusd: 1, lusd: 1, frax: 1, usde: 1, usds: 1, crvusd: 1, usdp: 1, usdb: 1,
  };

  var cache = {};
  function cacheGet(k) {
    var e = cache[k];
    if (!e) return null;
    if (Date.now() - e.fetchedAt > CACHE_TTL_MS) return null;
    return e.data;
  }
  function cacheSet(k, d) { cache[k] = { data: d, fetchedAt: Date.now() }; }

  async function fetchJson(url) {
    var cached = cacheGet(url);
    if (cached != null) return cached;
    try {
      var r = await fetch(url);
      if (!r.ok) return null;
      var j = await r.json();
      if (j == null) return null;
      cacheSet(url, j);
      return j;
    } catch (_) { return null; }
  }

  // ---------- markets fetch + reshape ----------
  async function fetchMarkets() {
    var url = CG_BASE + '/coins/markets'
      + '?vs_currency=usd'
      + '&order=market_cap_desc'
      + '&per_page=100&page=1'
      + '&sparkline=true'
      + '&price_change_percentage=24h%2C7d%2C30d';
    var arr = await fetchJson(url);
    if (!Array.isArray(arr)) return null;
    return arr.map(function (c) {
      return {
        id:         c.id,
        symbol:     (c.symbol || '').toUpperCase(),
        name:       c.name,
        image:      c.image || null,
        price:      Number(c.current_price) || 0,
        mcap:       Number(c.market_cap) || 0,
        volume24h:  Number(c.total_volume) || 0,
        change24h:  Number(c.price_change_percentage_24h_in_currency) || 0,
        change7d:   Number(c.price_change_percentage_7d_in_currency)  || 0,
        change30d:  Number(c.price_change_percentage_30d_in_currency) || 0,
        sparkline:  (c.sparkline_in_7d && Array.isArray(c.sparkline_in_7d.price))
                    ? c.sparkline_in_7d.price.slice(-96) : [],
        mcap_rank:  Number(c.market_cap_rank) || 9999,
      };
    });
  }

  function pickChange(row, days) {
    if (days === 7)  return row.change7d;
    if (days === 30) return row.change30d;
    return row.change24h;
  }

  async function getTopGainers(days, limit) {
    var d = (days === 7 || days === 30) ? days : 1;
    var n = Math.max(1, Math.min(100, limit || 20));
    var arr = await fetchMarkets();
    if (!arr) return null;
    var sorted = arr.slice().sort(function (a, b) {
      return pickChange(b, d) - pickChange(a, d);
    });
    return sorted.slice(0, n);
  }

  async function getTopLosers(days, limit) {
    var d = (days === 7 || days === 30) ? days : 1;
    var n = Math.max(1, Math.min(100, limit || 20));
    var arr = await fetchMarkets();
    if (!arr) return null;
    var sorted = arr.slice().sort(function (a, b) {
      return pickChange(a, d) - pickChange(b, d);
    });
    return sorted.slice(0, n);
  }

  async function getTrending() {
    var j = await fetchJson(CG_BASE + '/search/trending');
    if (!j || !Array.isArray(j.coins)) return null;
    return j.coins.map(function (wrapper) {
      var c = wrapper && wrapper.item ? wrapper.item : wrapper;
      if (!c) return null;
      return {
        id:        c.id,
        symbol:    (c.symbol || '').toUpperCase(),
        name:      c.name,
        score:     Number(c.score) || 0,
        mcap_rank: Number(c.market_cap_rank) || 9999,
        price_btc: Number(c.price_btc) || 0,
        thumb:     c.thumb || c.small || null,
      };
    }).filter(Boolean);
  }

  async function getDominance() {
    // /global gives us mcap_percentage. Also derive stable/alt from markets.
    var g = await fetchJson(CG_BASE + '/global');
    var data = g && g.data ? g.data : null;
    var btcPct = null, ethPct = null, totalMcap = null;
    if (data && data.market_cap_percentage) {
      btcPct = Number(data.market_cap_percentage.btc) || 0;
      ethPct = Number(data.market_cap_percentage.eth) || 0;
    }
    if (data && data.total_market_cap && data.total_market_cap.usd) {
      totalMcap = Number(data.total_market_cap.usd) || 0;
    }

    var stablePct = null;
    if (totalMcap && totalMcap > 0) {
      var arr = await fetchMarkets();
      if (arr) {
        var stableMcap = 0;
        for (var i = 0; i < arr.length; i++) {
          var sym = (arr[i].symbol || '').toLowerCase();
          if (STABLE_SYMS[sym]) stableMcap += arr[i].mcap;
        }
        stablePct = (stableMcap / totalMcap) * 100;
      }
    }
    var altPct = null;
    if (btcPct != null && ethPct != null) {
      altPct = 100 - btcPct - ethPct - (stablePct || 0);
      if (altPct < 0) altPct = 0;
    }
    if (btcPct == null) return null;
    return {
      btc:             btcPct,
      eth:             ethPct,
      stable:          stablePct,
      alt:             altPct,
      total_mcap_usd:  totalMcap,
    };
  }

  window.AltFlow = {
    getTopGainers: getTopGainers,
    getTopLosers:  getTopLosers,
    getTrending:   getTrending,
    getDominance:  getDominance,
    clearCache:    function () { cache = {}; },
  };
})();
