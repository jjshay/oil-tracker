// engine/cot.js — CFTC Commitment of Traders (Disaggregated) positioning.
//
// Source: Socrata Open Data (CORS-ok, no key required).
//   https://publicreporting.cftc.gov/resource/gpe5-46if.json
//   (Disaggregated Futures-Only — legacy "non-commercial" mapped to Asset
//   Manager + Leveraged Money + Other Reportable in this dataset.)
//
// Speculator-net is defined as:
//   speculator_long  = lev_money_long  + asset_mgr_long  + other_rept_long
//   speculator_short = lev_money_short + asset_mgr_short + other_rept_short
//   net              = long − short
//
// Exposes on window:
//   COTData.getRecent(commodityKey, weeks)   → [{ date, long, short, net, open_interest }, …] newest-first
//   COTData.getDelta(commodityKey)           → { latest, prior, deltaNet, deltaLong, deltaShort }
//   COTData.getBundle()                       → { [key]: { recent:[…], delta:{…} } } for all tracked commodities
//   COTData.COMMODITIES                       → canonical list
//   COTData.CATEGORIES                        → canonical category order
//   COTData.clearCache()                      → void
//
// Cache: in-memory, 6-hour TTL (COT data is weekly).

(function () {
  if (typeof window === 'undefined') return;

  var CACHE_TTL_MS = 6 * 60 * 60 * 1000;
  var BASE = 'https://publicreporting.cftc.gov/resource/gpe5-46if.json';

  // Filter commodities down to the ones that actually trade + matter.
  // `match` runs against Socrata's `market_and_exchange_names` (exchange-qualified)
  // as a case-insensitive substring. `commodity` matches the broader `commodity_name`.
  var COMMODITIES = [
    // Energy
    { key: 'crude_wti',    label: 'WTI Crude',    category: 'Energy',     commodity: 'CRUDE OIL, LIGHT SWEET', match: 'LIGHT SWEET CRUDE OIL - NEW YORK MERCANTILE' },
    { key: 'crude_brent',  label: 'Brent Crude',  category: 'Energy',     commodity: null,                     match: 'BRENT CRUDE OIL' },
    { key: 'natgas',       label: 'Natural Gas',  category: 'Energy',     commodity: 'NATURAL GAS',            match: 'NATURAL GAS - NEW YORK MERCANTILE' },
    // Metals
    { key: 'gold',         label: 'Gold',         category: 'Metals',     commodity: 'GOLD',                   match: 'GOLD - COMMODITY EXCHANGE' },
    { key: 'silver',       label: 'Silver',       category: 'Metals',     commodity: 'SILVER',                 match: 'SILVER - COMMODITY EXCHANGE' },
    { key: 'copper',       label: 'Copper',       category: 'Metals',     commodity: 'COPPER',                 match: 'COPPER-' },
    // Equities
    { key: 'sp500_emini',  label: 'S&P 500 E-Mini',  category: 'Equities',  commodity: null,                  match: 'E-MINI S&P 500' },
    { key: 'nasdaq_emini', label: 'Nasdaq E-Mini',   category: 'Equities',  commodity: null,                  match: 'NASDAQ-100 E-MINI' },
    { key: 'russell_emini',label: 'Russell E-Mini',  category: 'Equities',  commodity: null,                  match: 'RUSSELL 2000 E-MINI' },
    // Currencies
    { key: 'dxy',          label: 'USD Index',     category: 'Currencies', commodity: 'U.S. DOLLAR INDEX',    match: 'U.S. DOLLAR INDEX' },
    { key: 'eur',          label: 'Euro FX',       category: 'Currencies', commodity: 'EURO FX',              match: 'EURO FX' },
    { key: 'jpy',          label: 'Japanese Yen',  category: 'Currencies', commodity: 'JAPANESE YEN',         match: 'JAPANESE YEN' },
    // Crypto
    { key: 'btc',          label: 'Bitcoin',       category: 'Crypto',     commodity: 'BITCOIN',              match: 'BITCOIN -' },
    { key: 'btc_micro',    label: 'BTC Micro',     category: 'Crypto',     commodity: 'BITCOIN',              match: 'MICRO BITCOIN' },
    { key: 'eth',          label: 'Ether',         category: 'Crypto',     commodity: 'ETHER',                match: 'ETHER -' },
  ];

  var CATEGORIES = ['Energy','Metals','Equities','Currencies','Crypto'];

  var byKey = {};
  for (var i = 0; i < COMMODITIES.length; i++) byKey[COMMODITIES[i].key] = COMMODITIES[i];

  // ---------- cache ----------
  var cache = {};  // { [key]: { rows, fetchedAt } }

  function cacheGet(key) {
    var e = cache[key];
    if (!e) return null;
    if (Date.now() - e.fetchedAt > CACHE_TTL_MS) return null;
    return e.rows;
  }
  function cacheSet(key, rows) {
    cache[key] = { rows: rows, fetchedAt: Date.now() };
  }

  function intOr(v, fb) {
    if (v == null) return fb;
    var n = parseInt(String(v).replace(/,/g, ''), 10);
    return isFinite(n) ? n : fb;
  }

  // Build a Socrata WHERE clause to match a commodity using the definition.
  function whereClauseFor(def) {
    // Socrata SQL-style $where. Use upper(...) like '%FOO%'.
    var parts = [];
    if (def.match) {
      var safe = String(def.match).replace(/'/g, "''").toUpperCase();
      parts.push("upper(market_and_exchange_names) like '%" + safe + "%'");
    }
    if (def.commodity) {
      var c = String(def.commodity).replace(/'/g, "''").toUpperCase();
      parts.push("upper(commodity_name) = '" + c + "'");
    }
    // Ensure we get at least one condition.
    if (!parts.length) return null;
    return parts.join(' AND ');
  }

  async function fetchRecentForCommodity(def, weeks) {
    var lim = Math.max(4, Math.min(104, weeks || 26));
    var where = whereClauseFor(def);
    if (!where) return null;
    var url = BASE
      + '?$where=' + encodeURIComponent(where)
      + '&$order=' + encodeURIComponent('report_date_as_yyyy_mm_dd DESC')
      + '&$limit=' + lim;
    try {
      var resp = await fetch(url, { method: 'GET' });
      if (!resp.ok) return null;
      var arr = await resp.json();
      if (!Array.isArray(arr) || arr.length === 0) return null;
      // If multiple contracts match (happens w/ "EURO FX", etc.), pick the
      // single highest-open-interest contract name as the canonical series,
      // then filter to only that one across all returned weeks.
      var contractCounts = {};
      var latestDate = arr[0].report_date_as_yyyy_mm_dd;
      for (var i = 0; i < arr.length; i++) {
        if (arr[i].report_date_as_yyyy_mm_dd !== latestDate) continue;
        var mkt = arr[i].market_and_exchange_names || '';
        var oi = intOr(arr[i].open_interest_all, 0);
        contractCounts[mkt] = Math.max(contractCounts[mkt] || 0, oi);
      }
      var bestMkt = null; var bestOI = -1;
      for (var m in contractCounts) {
        if (!Object.prototype.hasOwnProperty.call(contractCounts, m)) continue;
        if (contractCounts[m] > bestOI) { bestOI = contractCounts[m]; bestMkt = m; }
      }
      var filtered = arr.filter(function (r) {
        return (r.market_and_exchange_names || '') === bestMkt;
      });
      if (filtered.length === 0) filtered = arr;

      var rows = filtered.map(function (r) {
        var lm_l = intOr(r.lev_money_positions_long, 0);
        var lm_s = intOr(r.lev_money_positions_short, 0);
        var am_l = intOr(r.asset_mgr_positions_long, 0);
        var am_s = intOr(r.asset_mgr_positions_short, 0);
        var or_l = intOr(r.other_rept_positions_long, 0);
        var or_s = intOr(r.other_rept_positions_short, 0);
        var spec_long  = lm_l + am_l + or_l;
        var spec_short = lm_s + am_s + or_s;
        var date = (r.report_date_as_yyyy_mm_dd || '').slice(0, 10);
        return {
          date: date,
          long: spec_long,
          short: spec_short,
          net: spec_long - spec_short,
          open_interest: intOr(r.open_interest_all, 0),
          contract: r.market_and_exchange_names || '',
          components: {
            leveraged: { long: lm_l, short: lm_s, net: lm_l - lm_s },
            assetMgr:  { long: am_l, short: am_s, net: am_l - am_s },
            otherRept: { long: or_l, short: or_s, net: or_l - or_s },
          },
        };
      });
      // Newest-first, dedupe by date.
      rows.sort(function (a, b) { return a.date < b.date ? 1 : a.date > b.date ? -1 : 0; });
      var seen = {};
      var out = [];
      for (var k = 0; k < rows.length; k++) {
        if (seen[rows[k].date]) continue;
        seen[rows[k].date] = true;
        out.push(rows[k]);
      }
      return out;
    } catch (_) { return null; }
  }

  async function getRecent(commodityKey, weeks) {
    var def = byKey[commodityKey];
    if (!def) return null;
    var cached = cacheGet(commodityKey);
    if (cached) return cached.slice(0, weeks || 26);
    var rows = await fetchRecentForCommodity(def, weeks || 26);
    if (!rows) return null;
    cacheSet(commodityKey, rows);
    return rows.slice(0, weeks || 26);
  }

  async function getDelta(commodityKey) {
    var rows = await getRecent(commodityKey, 8);
    if (!rows || rows.length === 0) return null;
    var latest = rows[0];
    var prior = rows[1] || null;
    var out = {
      latest: latest,
      prior: prior,
      deltaNet:   prior ? latest.net - prior.net     : null,
      deltaLong:  prior ? latest.long - prior.long   : null,
      deltaShort: prior ? latest.short - prior.short : null,
    };
    return out;
  }

  async function getBundle() {
    var out = {};
    var results = await Promise.all(COMMODITIES.map(function (def) {
      return getRecent(def.key, 26).then(function (rows) { return { key: def.key, rows: rows }; });
    }));
    for (var i = 0; i < results.length; i++) {
      var r = results[i];
      var rows = r.rows;
      if (!rows || !rows.length) { out[r.key] = { recent: [], delta: null }; continue; }
      var latest = rows[0];
      var prior = rows[1] || null;
      out[r.key] = {
        recent: rows,
        delta: {
          latest: latest,
          prior: prior,
          deltaNet:   prior ? latest.net - prior.net     : null,
          deltaLong:  prior ? latest.long - prior.long   : null,
          deltaShort: prior ? latest.short - prior.short : null,
        },
      };
    }
    return out;
  }

  function clearCache() { cache = {}; }

  window.COTData = {
    getRecent:  getRecent,
    getDelta:   getDelta,
    getBundle:  getBundle,
    COMMODITIES: COMMODITIES.slice(),
    CATEGORIES:  CATEGORIES.slice(),
    clearCache: clearCache,
  };
})();
