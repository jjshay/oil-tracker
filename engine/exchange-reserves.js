// engine/exchange-reserves.js — Exchange reserves intelligence.
//
// Rationale: coins sitting on exchanges are "fight-ready" supply for sell
// pressure. Outflows (reserves dropping) = accumulation / cold-storage
// move = typically bullish. Inflows = distribution = typically bearish.
//
// Data source strategy (free, no-key):
//   Primary:  DeFiLlama CEX Transparency API
//     GET https://api.llama.fi/cexs
//     returns { cexs: [{
//         name, slug, cgId, walletsLink,
//         currentTvl,       // USD, on-chain holdings snapshot
//         cleanAssetsTvl,   // USD, excluding own-issued tokens
//         inflows_24h, inflows_1w, inflows_1m,  // USD delta
//         spotVolume, oi, derivVolume, leverage,
//       ...}, …] }
//
//   Fallback: CryptoQuant public endpoint (behind auth) — if the user adds
//     a key in window.TR_SETTINGS.keys.cryptoquant we try /btc/exchange-flows.
//
//   Last resort: return cached snapshot (if any) or null. The panel handles
//   the null state with an "embed public Dune dashboard" escape hatch.
//
// NOTE: DeFiLlama reports USD-denominated reserves; converting to BTC
// requires a BTC price. We fetch BTC price once (CoinGecko simple/price)
// and expose both the USD and BTC-equivalent number so the caller can
// pick whichever fits the tile.
//
// Exposes on window.ExchangeReserves:
//   getBTCReserves()      → {
//       total, totalBtc,
//       byExchange: { binance:{tvl, tvlBtc, 24h, 1w, 1m, url}, …},
//       trend7d, trend30d, btcPrice, source, fetchedAt,
//   } | null
//   getHistory(days=30)   → [{ date, total }]  — synthesised from current
//                           + 1w/1m deltas when full series unavailable
//   clearCache()

(function () {
  if (typeof window === 'undefined') return;

  var CACHE_TTL_MS = 10 * 60 * 1000;

  // Exchanges to surface as first-class tiles (match canonical crypto UI).
  // Keys are lowercased DeFiLlama `name` matches.
  var TARGET_EXCHANGES = [
    'Binance', 'Coinbase', 'Kraken', 'OKX', 'Bybit', 'Bitfinex',
    'Gemini', 'Robinhood', 'Crypto.com', 'KuCoin',
  ];

  var cache = {
    cexs:     null,  // { data, fetchedAt }
    btcPrice: null,  // { data, fetchedAt }
    history:  null,  // { data, fetchedAt }
  };

  function cacheGet(key) {
    var e = cache[key];
    if (!e) return null;
    if (Date.now() - e.fetchedAt > CACHE_TTL_MS) return null;
    return e.data;
  }
  function cacheSet(key, data) {
    cache[key] = { data: data, fetchedAt: Date.now() };
  }

  async function tryFetch(url, opts) {
    try {
      var r = await fetch(url, Object.assign({ method: 'GET' }, opts || {}));
      if (!r.ok) return null;
      return await r.json();
    } catch (e) {
      return null;
    }
  }

  // BTC price (USD), from CoinGecko simple endpoint. Cached 10 min.
  async function getBtcPriceUsd() {
    var cached = cacheGet('btcPrice');
    if (cached != null) return cached;
    var j = await tryFetch(
      'https://api.coingecko.com/api/v3/simple/price?ids=bitcoin&vs_currencies=usd'
    );
    var p = j && j.bitcoin && j.bitcoin.usd;
    if (typeof p !== 'number' || !isFinite(p)) {
      // Try alt source — Binance public
      var b = await tryFetch('https://api.binance.com/api/v3/ticker/price?symbol=BTCUSDT');
      if (b && b.price) p = parseFloat(b.price);
    }
    if (typeof p !== 'number' || !isFinite(p)) return null;
    cacheSet('btcPrice', p);
    return p;
  }

  async function loadCEXs() {
    var cached = cacheGet('cexs');
    if (cached) return cached;
    var j = await tryFetch('https://api.llama.fi/cexs');
    if (!j || !Array.isArray(j.cexs)) return null;
    cacheSet('cexs', j.cexs);
    return j.cexs;
  }

  // Optional CryptoQuant fallback — only if user provided a key.
  async function tryCryptoQuant() {
    var key = (window.TR_SETTINGS
             && window.TR_SETTINGS.keys
             && window.TR_SETTINGS.keys.cryptoquant) || '';
    if (!key) return null;
    try {
      var r = await fetch(
        'https://api.cryptoquant.com/v1/btc/exchange-flows/reserve?exchange=all_exchange&window=day',
        { headers: { Authorization: 'Bearer ' + key } }
      );
      if (!r.ok) return null;
      var j = await r.json();
      // shape: { status, result: { window, data: [{ datetime, reserve_usd, reserve }] } }
      var arr = j && j.result && j.result.data;
      if (!Array.isArray(arr) || !arr.length) return null;
      return arr;
    } catch (e) {
      return null;
    }
  }

  function normExchangeName(n) {
    if (!n) return '';
    return String(n).replace(/\s+/g, ' ').trim();
  }

  // Pull a row by (case-insensitive) substring of name so we catch
  // "Coinbase", "Coinbase Pro", "Coinbase Institutional" etc.
  function findCEX(list, needle) {
    if (!list) return null;
    var low = needle.toLowerCase();
    // Exact first
    for (var i = 0; i < list.length; i++) {
      if (normExchangeName(list[i].name).toLowerCase() === low) return list[i];
    }
    // Then prefix
    for (var j = 0; j < list.length; j++) {
      var n = normExchangeName(list[j].name).toLowerCase();
      if (n.indexOf(low) === 0) return list[j];
    }
    return null;
  }

  // Primary: DeFiLlama roll-up keyed by USD (converted to BTC via CG price).
  async function getBTCReserves() {
    var cexs = await loadCEXs();
    var btcPrice = await getBtcPriceUsd();
    if (!cexs) {
      // Last-ditch: cryptoquant if keyed
      var cq = await tryCryptoQuant();
      if (cq && cq.length) {
        var latest = cq[0];
        return {
          total:      num(latest.reserve_usd),
          totalBtc:   num(latest.reserve),
          byExchange: {},
          trend7d:    null,
          trend30d:   null,
          btcPrice:   btcPrice,
          source:     'CryptoQuant',
          fetchedAt:  Date.now(),
        };
      }
      return null;
    }

    var byExchange = {};
    var totalUsd = 0;
    var total24h = 0;
    var total1w  = 0;
    var total1m  = 0;

    for (var i = 0; i < TARGET_EXCHANGES.length; i++) {
      var name = TARGET_EXCHANGES[i];
      var row = findCEX(cexs, name);
      if (!row) {
        byExchange[name] = null;
        continue;
      }
      var tvl = num(row.cleanAssetsTvl != null ? row.cleanAssetsTvl : row.currentTvl);
      var in24 = num(row.inflows_24h);
      var in1w = num(row.inflows_1w);
      var in1m = num(row.inflows_1m);
      byExchange[name] = {
        name:        row.name,
        slug:        row.slug || null,
        tvlUsd:      tvl,
        tvlBtc:      (tvl != null && btcPrice) ? (tvl / btcPrice) : null,
        in24hUsd:    in24,
        in1wUsd:     in1w,
        in1mUsd:     in1m,
        pct24h:      (tvl && in24 != null) ? (in24 / tvl) * 100 : null,
        pct7d:       (tvl && in1w != null) ? (in1w / tvl) * 100 : null,
        pct30d:      (tvl && in1m != null) ? (in1m / tvl) * 100 : null,
        walletsLink: row.walletsLink || null,
        spotVolume:  num(row.spotVolume),
      };
      if (tvl  != null) totalUsd += tvl;
      if (in24 != null) total24h += in24;
      if (in1w != null) total1w  += in1w;
      if (in1m != null) total1m  += in1m;
    }

    var res = {
      total:     totalUsd || null,
      totalBtc:  btcPrice ? totalUsd / btcPrice : null,
      byExchange: byExchange,
      trend24h:  {
        usd: total24h,
        pct: totalUsd ? (total24h / totalUsd) * 100 : null,
      },
      trend7d:   {
        usd: total1w,
        pct: totalUsd ? (total1w / totalUsd) * 100 : null,
      },
      trend30d:  {
        usd: total1m,
        pct: totalUsd ? (total1m / totalUsd) * 100 : null,
      },
      btcPrice:  btcPrice,
      source:    'DeFiLlama',
      fetchedAt: Date.now(),
    };
    return res;
  }

  // Synth history: DeFiLlama gives us `now`, `-24h`, `-1w`, `-1m` inflow
  // deltas. We back out four anchor points and linearly interpolate daily
  // to fill a ~30-day series. This is an approximation but good enough
  // for the sparkline / line chart until CryptoQuant is wired.
  async function getHistory(days) {
    var cached = cacheGet('history');
    if (cached && cached._days === (days || 30)) return cached.rows;

    var now = await getBTCReserves();
    if (!now || now.total == null) return null;

    var n = Math.max(7, Math.min(90, days || 30));
    var end     = now.total;
    var minus24 = end - (now.trend24h ? now.trend24h.usd || 0 : 0);
    var minus7  = end - (now.trend7d  ? now.trend7d.usd  || 0 : 0);
    var minus30 = end - (now.trend30d ? now.trend30d.usd || 0 : 0);

    // Anchor offsets in days (newest=0).
    var anchors = [
      { d: 0,  v: end },
      { d: 1,  v: minus24 },
      { d: 7,  v: minus7 },
      { d: 30, v: minus30 },
    ];

    function valueAtOffset(off) {
      // Find two anchors bracketing `off`.
      var a = null, b = null;
      for (var i = 0; i < anchors.length; i++) {
        if (anchors[i].d <= off) a = anchors[i];
        if (anchors[i].d >= off && b == null) b = anchors[i];
      }
      if (a && b && a !== b && a.d !== b.d) {
        var t = (off - a.d) / (b.d - a.d);
        return a.v + (b.v - a.v) * t;
      }
      return (a || b || anchors[anchors.length - 1]).v;
    }

    var rows = [];
    var today = new Date();
    for (var k = n - 1; k >= 0; k--) {
      var d = new Date(today.getTime() - k * 86400 * 1000);
      var iso = d.getUTCFullYear()
              + '-' + pad2(d.getUTCMonth() + 1)
              + '-' + pad2(d.getUTCDate());
      var v = valueAtOffset(k);
      rows.push({
        date:    iso,
        total:   v,
        totalBtc: now.btcPrice ? v / now.btcPrice : null,
        synth:   true, // flag so the UI can reveal this is interpolated
      });
    }
    var out = { _days: n, rows: rows };
    cache.history = { data: out, fetchedAt: Date.now() };
    return rows;
  }

  function num(x) {
    if (x == null) return null;
    var n = Number(x);
    return isFinite(n) ? n : null;
  }
  function pad2(n) { return n < 10 ? '0' + n : '' + n; }

  function clearCache() {
    cache.cexs = null;
    cache.btcPrice = null;
    cache.history = null;
  }

  window.ExchangeReserves = {
    getBTCReserves:  getBTCReserves,
    getHistory:      getHistory,
    clearCache:      clearCache,
    TARGET_EXCHANGES: TARGET_EXCHANGES.slice(),
  };
})();
