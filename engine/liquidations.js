// engine/liquidations.js — cross-exchange crypto perp liquidation stream
//
// Exposes window.Liquidations with:
//   getRecent(symbol='BTC', count=60)
//       -> [{ time, exchange, symbol, side, price, qty, notional, sourceUrl }]
//          Newest-first. Merges BitMEX + Binance futures (Binance silently
//          skipped when geo-restricted, BitMEX is always available).
//   getTotals24h(symbol='BTC')
//       -> { longs_liquidated_usd, shorts_liquidated_usd, count, samples }
//          `count` = # of liq events observed in the rolling window.
//   getClusterLevels(symbol='BTC')
//       -> { price, levels:[{price, side, notional_usd, distancePct}], window: [lo,hi] }
//          Heuristic: we don't have open-interest-by-leverage data without a
//          paid feed, so we synthesise plausible liquidation clusters from
//          recent liquidation-price distribution (kernel-binned into 20 bins
//          across price ±20%). Works as a "where did pain cluster" heatmap.
//
// Public API only. No keys. CORS-friendly:
//   - BitMEX       : https://www.bitmex.com/api/v1/liquidation  (CORS-ok)
//   - Binance FAPI : https://fapi.binance.com/fapi/v1/allForceOrders
//                    (may 451 from US/EU — we swallow and continue)
//
// Cache: 20s TTL for feed, 60s for 24h totals, 60s for clusters.

(function () {
  if (typeof window === 'undefined') return;

  const FEED_TTL_MS    = 20 * 1000;
  const TOTALS_TTL_MS  = 60 * 1000;
  const CLUSTER_TTL_MS = 60 * 1000;
  const _cache = {};

  function cacheGet(key, ttl) {
    const e = _cache[key];
    if (!e) return null;
    if (Date.now() - e.time > ttl) return null;
    return e.data;
  }
  function cacheSet(key, data) {
    _cache[key] = { data, time: Date.now() };
  }

  async function jget(url, opts) {
    opts = opts || {};
    const ctl = new AbortController();
    const to = setTimeout(() => ctl.abort(), opts.timeout || 7000);
    try {
      const r = await fetch(url, { signal: ctl.signal, cache: 'no-store' });
      if (!r.ok) throw new Error('HTTP ' + r.status);
      return await r.json();
    } finally {
      clearTimeout(to);
    }
  }

  // ----- symbol helpers -----
  function bitmexPair(symbol) {
    // BitMEX uses XBT for BTC; main perp is XBTUSD (inverse) + XBTUSDT (linear)
    const s = (symbol || 'BTC').toUpperCase();
    if (s === 'BTC') return 'XBTUSD';
    if (s === 'ETH') return 'ETHUSD';
    return s + 'USD';
  }
  function binancePair(symbol) {
    const s = (symbol || 'BTC').toUpperCase();
    return s + 'USDT';
  }

  // ----- BitMEX: /api/v1/liquidation?reverse=true&count=N -----
  // BitMEX inverts the "side" convention: a Buy order = SHORT being liquidated
  // (buy-to-close), Sell = LONG being liquidated. We normalise to
  // {side: 'long' | 'short'} = side that was wiped out.
  async function bitmexRecent(symbol, count) {
    const pair = bitmexPair(symbol);
    const url = 'https://www.bitmex.com/api/v1/liquidation?symbol=' + pair +
                '&reverse=true&count=' + Math.max(1, Math.min(500, count || 100));
    const d = await jget(url);
    if (!Array.isArray(d)) return [];
    return d.map(function (x) {
      const price = Number(x.price);
      const qty   = Number(x.leavesQty);
      // XBTUSD is inverse: "qty" = USD contracts, so notional ~= qty (1 contract = $1).
      // XBTUSDT is linear (qty = coins). We treat inverse as USD directly.
      const isInverse = /USD$/.test(pair) && !/USDT$/.test(pair);
      const notional = isInverse ? qty : (qty * price);
      const side = x.side === 'Buy' ? 'short' : 'long';
      return {
        time: x.timestamp ? Date.parse(x.timestamp) : Date.now(),
        exchange: 'bitmex',
        symbol: pair,
        side,
        price,
        qty,
        notional,
        sourceUrl: 'https://www.bitmex.com/app/trade/' + pair,
      };
    });
  }

  // ----- Binance FAPI: /fapi/v1/allForceOrders?symbol=...&limit=N -----
  // May return HTTP 451 / code:0 with "restricted location" error from US/EU.
  // Geo-blocked -> we throw and the safe() wrapper returns [].
  async function binanceRecent(symbol, count) {
    const pair = binancePair(symbol);
    const url = 'https://fapi.binance.com/fapi/v1/allForceOrders?symbol=' + pair +
                '&limit=' + Math.max(1, Math.min(500, count || 100));
    const d = await jget(url);
    if (!Array.isArray(d)) {
      // Geo-block payload shape: {code:0,msg:"Service unavailable..."}
      throw new Error('binance: non-array response (likely geo-restricted)');
    }
    return d.map(function (x) {
      const price = Number(x.averagePrice || x.price);
      const qty   = Number(x.executedQty || x.origQty);
      const notional = price * qty;
      // Binance "side" = the liquidation order's side. BUY liq order = short wiped;
      // SELL liq order = long wiped. Same inversion as BitMEX.
      const side = (String(x.side).toUpperCase() === 'BUY') ? 'short' : 'long';
      return {
        time: Number(x.time) || Date.now(),
        exchange: 'binance',
        symbol: pair,
        side,
        price,
        qty,
        notional,
        sourceUrl: 'https://www.binance.com/en/futures/' + pair,
      };
    });
  }

  async function safe(fn, label) {
    try {
      return await fn();
    } catch (e) {
      try { console.warn('[liquidations]', label, 'failed:', e && e.message); } catch (_) {}
      return [];
    }
  }

  // ----- public API -----
  async function getRecent(symbol, count) {
    const sym = (symbol || 'BTC').toUpperCase();
    const n = Math.max(1, Math.min(500, Number(count) || 60));
    const key = 'recent:' + sym + ':' + n;
    const cached = cacheGet(key, FEED_TTL_MS);
    if (cached) return cached;

    const [bmx, bnb] = await Promise.all([
      safe(() => bitmexRecent(sym, n), 'bitmex ' + sym),
      safe(() => binanceRecent(sym, n), 'binance ' + sym),
    ]);

    const merged = bmx.concat(bnb)
      .filter(function (x) { return isFinite(x.price) && isFinite(x.notional) && x.notional > 0; })
      .sort(function (a, b) { return b.time - a.time; })
      .slice(0, n);

    cacheSet(key, merged);
    return merged;
  }

  async function getTotals24h(symbol) {
    const sym = (symbol || 'BTC').toUpperCase();
    const key = 'totals:' + sym;
    const cached = cacheGet(key, TOTALS_TTL_MS);
    if (cached) return cached;

    // Pull the largest window BitMEX gives us for free (500) + Binance (500).
    const [bmx, bnb] = await Promise.all([
      safe(() => bitmexRecent(sym, 500), 'bitmex totals ' + sym),
      safe(() => binanceRecent(sym, 500), 'binance totals ' + sym),
    ]);

    const cutoff = Date.now() - 24 * 3600 * 1000;
    const all = bmx.concat(bnb).filter(function (x) { return x.time >= cutoff; });

    let longs = 0, shorts = 0;
    all.forEach(function (x) {
      if (x.side === 'long')  longs  += x.notional || 0;
      else if (x.side === 'short') shorts += x.notional || 0;
    });
    const out = {
      longs_liquidated_usd:  longs,
      shorts_liquidated_usd: shorts,
      count: all.length,
      samples: all.length,
      exchanges: {
        bitmex:  bmx.length,
        binance: bnb.length,
      },
      windowHours: 24,
    };
    cacheSet(key, out);
    return out;
  }

  // Synthetic cluster heatmap.
  // Real cluster-OI data is gated behind paid APIs. We approximate by binning
  // the last ~500 observed liquidation PRICES around the current mark, which
  // tends to concentrate near leverage cliffs anyway. Output is sorted by
  // notional desc and trimmed to the top 20 bins.
  async function getClusterLevels(symbol) {
    const sym = (symbol || 'BTC').toUpperCase();
    const key = 'clusters:' + sym;
    const cached = cacheGet(key, CLUSTER_TTL_MS);
    if (cached) return cached;

    const rows = await getRecent(sym, 500);
    if (!rows.length) {
      const empty = { price: null, levels: [], window: [null, null] };
      cacheSet(key, empty);
      return empty;
    }
    // Current price = median of most recent 10 liq prices (robust proxy).
    const recent = rows.slice(0, 10).map(function (r) { return r.price; }).sort(function (a, b) { return a - b; });
    const price = recent[Math.floor(recent.length / 2)] || rows[0].price;
    const lo = price * 0.80, hi = price * 1.20;
    const BINS = 40;
    const step = (hi - lo) / BINS;
    const bins = new Array(BINS).fill(0).map(function (_, i) {
      return { lo: lo + i * step, hi: lo + (i + 1) * step, long: 0, short: 0 };
    });
    rows.forEach(function (r) {
      if (r.price < lo || r.price >= hi) return;
      const ix = Math.min(BINS - 1, Math.floor((r.price - lo) / step));
      if (r.side === 'long') bins[ix].long += r.notional || 0;
      else if (r.side === 'short') bins[ix].short += r.notional || 0;
    });
    const levels = [];
    bins.forEach(function (b) {
      const mid = (b.lo + b.hi) / 2;
      if (b.long > 0) {
        levels.push({
          price: mid, side: 'long', notional_usd: b.long,
          distancePct: ((mid - price) / price) * 100,
        });
      }
      if (b.short > 0) {
        levels.push({
          price: mid, side: 'short', notional_usd: b.short,
          distancePct: ((mid - price) / price) * 100,
        });
      }
    });
    levels.sort(function (a, b) { return b.notional_usd - a.notional_usd; });
    const out = {
      price,
      levels: levels.slice(0, 20),
      window: [lo, hi],
    };
    cacheSet(key, out);
    return out;
  }

  window.Liquidations = {
    getRecent,
    getTotals24h,
    getClusterLevels,
  };
})();
