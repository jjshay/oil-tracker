// engine/stables.js — Stablecoin supply (mint/burn) tracker for USDT, USDC, DAI.
//
// Mints / burns are the purest leading signal for crypto liquidity:
//   - supply up    → fresh USD entering the system  → bull tilt
//   - supply down  → redemptions/burns              → bear tilt
//
// Data sources (all public, no-key, CORS-friendly):
//   - DeFiLlama stablecoins API (primary)
//       https://stablecoins.llama.fi/stablecoin/{id}
//       id 1 = Tether (USDT), 2 = USD Coin (USDC), 5 = Dai (DAI)
//       returns daily `tokens` history [{ date: unixSec, circulating:{peggedUSD} }]
//   - CoinGecko coin endpoint (fallback / "right now" supply)
//       https://api.coingecko.com/api/v3/coins/{slug}?market_data=true
//       slug: tether | usd-coin | dai
//
// Exposes on window.StableData:
//   getSupplyHistory(ticker='USDT', days=30)  → [{ date, supply }] | null
//   getRecent24hChange(ticker='USDT')          → { current, delta24h, pct24h } | null
//   getLargeMovers(threshold=100_000_000, days=14)
//     → [{ date, ticker, delta, direction }]   — day-over-day jumps > threshold
//   getAllCurrent()                            → { USDT, USDC, DAI } snapshots
//   getTrend(ticker='USDT', days=7|30)        → { start, end, net, pctChange }
//
// Cache: 15-minute TTL, keyed per (source+ticker).

(function () {
  if (typeof window === 'undefined') return;

  var CACHE_TTL_MS = 15 * 60 * 1000;

  // DeFiLlama stablecoin ids (verified via /stablecoins listing, Apr 2026).
  var LLAMA_IDS = { USDT: 1, USDC: 2, DAI: 5 };
  var CG_SLUGS  = { USDT: 'tether', USDC: 'usd-coin', DAI: 'dai' };

  var cache = Object.create(null);
  function cacheGet(k) {
    var e = cache[k];
    if (!e) return null;
    if (Date.now() - e.fetchedAt > CACHE_TTL_MS) return null;
    return e.data;
  }
  function cacheSet(k, data) {
    cache[k] = { data: data, fetchedAt: Date.now() };
  }

  // ---------- low-level fetch ----------
  async function tryFetch(url) {
    try {
      var r = await fetch(url, { method: 'GET' });
      if (!r.ok) return null;
      return await r.json();
    } catch (e) {
      return null;
    }
  }

  // ---------- DeFiLlama ----------
  // Returns full daily history sorted newest-first:
  //   [{ date: 'YYYY-MM-DD', supply: number (USD), unix: sec }, …]
  async function loadLlamaHistory(ticker) {
    var key = 'llama:' + ticker;
    var cached = cacheGet(key);
    if (cached) return cached;

    var id = LLAMA_IDS[ticker];
    if (!id) return null;
    var j = await tryFetch('https://stablecoins.llama.fi/stablecoin/' + id);
    if (!j || !Array.isArray(j.tokens)) return null;

    var rows = [];
    for (var i = 0; i < j.tokens.length; i++) {
      var t = j.tokens[i];
      if (!t || !t.date) continue;
      var circ = t.circulating && t.circulating.peggedUSD;
      if (typeof circ !== 'number' || !isFinite(circ)) continue;
      var d = new Date(t.date * 1000);
      var iso = d.getUTCFullYear()
              + '-' + pad2(d.getUTCMonth() + 1)
              + '-' + pad2(d.getUTCDate());
      rows.push({ date: iso, unix: t.date, supply: circ });
    }
    if (!rows.length) return null;
    rows.sort(function (a, b) { return b.unix - a.unix; });
    cacheSet(key, rows);
    return rows;
  }

  // ---------- CoinGecko (fallback for current supply) ----------
  async function loadGeckoCurrent(ticker) {
    var key = 'gecko:' + ticker;
    var cached = cacheGet(key);
    if (cached) return cached;

    var slug = CG_SLUGS[ticker];
    if (!slug) return null;
    var url = 'https://api.coingecko.com/api/v3/coins/' + slug
            + '?localization=false&tickers=false&market_data=true'
            + '&community_data=false&developer_data=false&sparkline=false';
    var j = await tryFetch(url);
    if (!j || !j.market_data) return null;

    var md = j.market_data;
    var out = {
      source:           'CoinGecko',
      ticker:           ticker,
      circulating:      num(md.circulating_supply),
      total:            num(md.total_supply),
      marketCap:        num(md.market_cap && md.market_cap.usd),
      mcapChange24hPct: num(md.market_cap_change_percentage_24h),
      mcapChange24hUsd: num(md.market_cap_change_24h_in_currency && md.market_cap_change_24h_in_currency.usd),
      fetchedAt:        Date.now(),
    };
    cacheSet(key, out);
    return out;
  }

  function num(x) {
    if (x == null) return null;
    var n = Number(x);
    return isFinite(n) ? n : null;
  }
  function pad2(n) { return n < 10 ? '0' + n : '' + n; }

  // ---------- public API ----------
  async function getSupplyHistory(ticker, days) {
    ticker = (ticker || 'USDT').toUpperCase();
    var n = Math.max(1, Math.min(365 * 3, days || 30));
    var rows = await loadLlamaHistory(ticker);
    if (!rows) return null;
    return rows.slice(0, n);
  }

  // 24h change: uses CG if available (direct mcap delta), else day-over-day
  // from the Llama history.
  async function getRecent24hChange(ticker) {
    ticker = (ticker || 'USDT').toUpperCase();
    var cg = await loadGeckoCurrent(ticker);
    var history = await loadLlamaHistory(ticker);
    var out = {
      ticker:     ticker,
      current:    null,
      delta24h:   null,
      pct24h:     null,
      source:     null,
      fetchedAt:  Date.now(),
    };

    if (history && history.length >= 2) {
      out.current  = history[0].supply;
      out.delta24h = history[0].supply - history[1].supply;
      out.pct24h   = history[1].supply ? (out.delta24h / history[1].supply) * 100 : null;
      out.source   = 'DeFiLlama';
    }
    // Prefer CoinGecko mcapChange24hUsd if we got nothing from Llama.
    if (out.current == null && cg && cg.marketCap != null) {
      out.current  = cg.marketCap;
      out.delta24h = cg.mcapChange24hUsd;
      out.pct24h   = cg.mcapChange24hPct;
      out.source   = 'CoinGecko';
    }
    if (out.current == null) return null;
    return out;
  }

  // Net trend over N days (7 or 30 typically).
  async function getTrend(ticker, days) {
    ticker = (ticker || 'USDT').toUpperCase();
    var n = Math.max(2, Math.min(365, days || 7));
    var history = await loadLlamaHistory(ticker);
    if (!history || history.length < 2) return null;

    // Find the row closest to N days ago.
    var newest = history[0];
    var cutoff = newest.unix - (n * 86400);
    var oldRow = null;
    for (var i = 1; i < history.length; i++) {
      if (history[i].unix <= cutoff) { oldRow = history[i]; break; }
    }
    if (!oldRow) oldRow = history[Math.min(history.length - 1, n)];
    var net = newest.supply - oldRow.supply;
    var pct = oldRow.supply ? (net / oldRow.supply) * 100 : null;
    return {
      ticker:    ticker,
      days:      n,
      start:     oldRow.supply,
      end:       newest.supply,
      net:       net,
      pctChange: pct,
    };
  }

  // Large day-over-day movers across the basket, over the last N days.
  // A "large" event is any |delta| above the USD threshold (default $100M).
  async function getLargeMovers(threshold, days) {
    var th = threshold != null ? threshold : 100_000_000;
    var n  = Math.max(2, Math.min(365, days || 14));
    var tickers = ['USDT', 'USDC', 'DAI'];
    var out = [];

    for (var i = 0; i < tickers.length; i++) {
      var t = tickers[i];
      var hist = await loadLlamaHistory(t);
      if (!hist || hist.length < 2) continue;
      var lookup = hist.slice(0, n + 1); // newest n deltas
      for (var k = 0; k < lookup.length - 1; k++) {
        var cur = lookup[k];
        var prev = lookup[k + 1];
        var d = cur.supply - prev.supply;
        if (Math.abs(d) < th) continue;
        out.push({
          date:      cur.date,
          unix:      cur.unix,
          ticker:    t,
          supply:    cur.supply,
          delta:     d,
          direction: d > 0 ? 'mint' : 'burn',
        });
      }
    }
    // Newest first, then by |delta|
    out.sort(function (a, b) {
      if (b.unix !== a.unix) return b.unix - a.unix;
      return Math.abs(b.delta) - Math.abs(a.delta);
    });
    return out;
  }

  async function getAllCurrent() {
    var tickers = ['USDT', 'USDC', 'DAI'];
    var out = {};
    for (var i = 0; i < tickers.length; i++) {
      var t = tickers[i];
      var change = null;
      try { change = await getRecent24hChange(t); } catch (_) {}
      var trend7  = null;
      var trend30 = null;
      try { trend7  = await getTrend(t, 7); }  catch (_) {}
      try { trend30 = await getTrend(t, 30); } catch (_) {}
      out[t] = {
        ticker:   t,
        current:  change ? change.current  : null,
        delta24h: change ? change.delta24h : null,
        pct24h:   change ? change.pct24h   : null,
        net7d:    trend7  ? trend7.net     : null,
        pct7d:    trend7  ? trend7.pctChange : null,
        net30d:   trend30 ? trend30.net    : null,
        pct30d:   trend30 ? trend30.pctChange : null,
        source:   change ? change.source   : null,
      };
    }
    // Aggregate across the 3
    var agg = { current: 0, delta24h: 0, net7d: 0, net30d: 0, any: false };
    Object.keys(out).forEach(function (k) {
      var r = out[k];
      if (r.current != null) { agg.current  += r.current;  agg.any = true; }
      if (r.delta24h != null) agg.delta24h += r.delta24h;
      if (r.net7d    != null) agg.net7d    += r.net7d;
      if (r.net30d   != null) agg.net30d   += r.net30d;
    });
    out.TOTAL = agg.any ? agg : null;
    return out;
  }

  function clearCache() { cache = Object.create(null); }

  window.StableData = {
    getSupplyHistory:    getSupplyHistory,
    getRecent24hChange:  getRecent24hChange,
    getLargeMovers:      getLargeMovers,
    getAllCurrent:       getAllCurrent,
    getTrend:            getTrend,
    clearCache:          clearCache,
    TICKERS:             ['USDT', 'USDC', 'DAI'],
    LLAMA_IDS:           Object.assign({}, LLAMA_IDS),
  };
})();
