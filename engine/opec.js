// engine/opec.js — OPEC+ production + US strategic reserve tracker.
//
// Free public sources:
//   - EIA Open Data API (https://www.eia.gov/opendata/)
//       • International production by country (monthly, MBBL/D)
//         series: INTL.55-1-{COUNTRY}-TBPD.M  (dry barrels per day)
//         e.g. Saudi: INTL.55-1-SAU-TBPD.M, Russia: INTL.55-1-RUS-TBPD.M
//       • SPR: PET.WCSSTUS1.W  (weekly, kbbl) — "Weekly U.S. Ending Stocks of
//         Crude Oil in the Strategic Petroleum Reserve"
//       • Rig count (Baker Hughes via EIA): PET.E_ERTRR0_XR0_NUS_C.W
//   - Free-tier: requires an API key. Pulled from
//         window.TR_SETTINGS.keys.eia  OR  window.EIA_API_KEY
//     If missing → getters return null (UI prompts to add a key).
//
// Cache: 1 hour (monthly/weekly data).
//
// Exposes window.OPECData:
//   getProduction({ country, months=6 }) → { country, history:[{date,value}], latest, prior, delta } | null
//   getOPECPlusTotal(months=6)           → aggregate over canonical OPEC+ list
//   getSPRLevel()                        → { kbbl, asOf, history[] } | null
//   getRigCount()                        → { count, asOf } | null
//   COUNTRIES                            → label/code table

(function () {
  if (typeof window === 'undefined') return;

  var CACHE_TTL_MS = 60 * 60 * 1000; // 1 hour
  var cache = {};

  function getKey() {
    try {
      if (window.TR_SETTINGS && window.TR_SETTINGS.keys && window.TR_SETTINGS.keys.eia) {
        return window.TR_SETTINGS.keys.eia;
      }
    } catch (e) {}
    if (window.EIA_API_KEY) return window.EIA_API_KEY;
    return '';
  }

  // Canonical OPEC+ members we care about (ISO-3 country codes used by EIA).
  var COUNTRIES = [
    { code: 'SAU', name: 'Saudi Arabia' },
    { code: 'RUS', name: 'Russia'       },
    { code: 'IRQ', name: 'Iraq'         },
    { code: 'ARE', name: 'UAE'          },
    { code: 'IRN', name: 'Iran'         },
    { code: 'KWT', name: 'Kuwait'       },
    { code: 'NGA', name: 'Nigeria'      },
    { code: 'VEN', name: 'Venezuela'    },
    { code: 'DZA', name: 'Algeria'      },
    { code: 'LBY', name: 'Libya'        },
  ];

  function cacheGet(key) {
    var c = cache[key];
    if (c && Date.now() - c.time < CACHE_TTL_MS) return c.data;
    return undefined;
  }
  function cacheSet(key, data) {
    cache[key] = { data: data, time: Date.now() };
  }

  // EIA v2 API. Format:
  //   https://api.eia.gov/v2/international/data/?api_key=...
  //     &frequency=monthly&data[0]=value
  //     &facets[productId][]=55 (crude oil)
  //     &facets[activityId][]=1 (production)
  //     &facets[countryRegionId][]=SAU
  //     &facets[unit][]=TBPD
  //     &sort[0][column]=period&sort[0][direction]=desc&length=24
  async function getProduction(opts) {
    opts = opts || {};
    var country = opts.country;
    var months = opts.months || 6;
    if (!country) return null;
    var ck = 'prod:' + country + ':' + months;
    var hit = cacheGet(ck);
    if (hit !== undefined) return hit;

    var key = getKey();
    if (!key) return null;

    var url = 'https://api.eia.gov/v2/international/data/?api_key=' + encodeURIComponent(key)
      + '&frequency=monthly'
      + '&data[0]=value'
      + '&facets[productId][]=55'
      + '&facets[activityId][]=1'
      + '&facets[countryRegionId][]=' + encodeURIComponent(country)
      + '&facets[unit][]=TBPD'
      + '&sort[0][column]=period&sort[0][direction]=desc'
      + '&length=' + Math.max(months + 2, 12);

    var out = null;
    try {
      var r = await fetch(url);
      if (r.ok) {
        var j = await r.json();
        var rows = (j && j.response && j.response.data) || [];
        // Sort ascending by period for UI-friendly history.
        rows.sort(function (a, b) { return (a.period || '').localeCompare(b.period || ''); });
        var hist = rows.map(function (r) {
          return { date: r.period, value: Number(r.value) };
        }).filter(function (x) { return isFinite(x.value); }).slice(-months);
        if (hist.length) {
          var latest = hist[hist.length - 1].value;
          var prior  = hist.length >= 2 ? hist[hist.length - 2].value : null;
          out = {
            country: country,
            unit: 'TBPD',
            history: hist,
            latest: latest,
            prior: prior,
            delta: (prior != null) ? latest - prior : null,
            deltaPct: (prior != null && prior !== 0) ? ((latest - prior) / prior) * 100 : null,
            asOf: hist[hist.length - 1].date,
          };
        }
      }
    } catch (e) {
      console.warn('[OPECData] getProduction failed:', e && e.message);
    }
    cacheSet(ck, out);
    return out;
  }

  async function getOPECPlusTotal(months) {
    months = months || 6;
    var ck = 'total:' + months;
    var hit = cacheGet(ck);
    if (hit !== undefined) return hit;

    var key = getKey();
    if (!key) return null;

    var all = await Promise.all(COUNTRIES.map(function (c) {
      return getProduction({ country: c.code, months: months });
    }));

    // Build date-indexed aggregate.
    var byDate = {};
    for (var i = 0; i < all.length; i++) {
      var p = all[i];
      if (!p || !p.history) continue;
      for (var j = 0; j < p.history.length; j++) {
        var row = p.history[j];
        if (!byDate[row.date]) byDate[row.date] = 0;
        byDate[row.date] += row.value;
      }
    }
    var dates = Object.keys(byDate).sort();
    if (!dates.length) { cacheSet(ck, null); return null; }
    var hist = dates.map(function (d) { return { date: d, value: byDate[d] }; });
    var latest = hist[hist.length - 1].value;
    var prior  = hist.length >= 2 ? hist[hist.length - 2].value : null;
    var out = {
      scope: 'OPEC+ (' + COUNTRIES.length + ' members)',
      unit: 'TBPD',
      history: hist,
      latest: latest,
      prior: prior,
      delta: (prior != null) ? latest - prior : null,
      deltaPct: (prior != null && prior !== 0) ? ((latest - prior) / prior) * 100 : null,
      asOf: hist[hist.length - 1].date,
    };
    cacheSet(ck, out);
    return out;
  }

  // SPR weekly ending stocks.
  // v2 path: petroleum/stoc/wstk — but simplest is the series endpoint:
  //   https://api.eia.gov/v2/seriesid/PET.WCSSTUS1.W?api_key=...
  async function getSPRLevel() {
    var ck = 'spr';
    var hit = cacheGet(ck);
    if (hit !== undefined) return hit;

    var key = getKey();
    if (!key) return null;

    var out = null;
    try {
      var url = 'https://api.eia.gov/v2/seriesid/PET.WCSSTUS1.W?api_key=' + encodeURIComponent(key);
      var r = await fetch(url);
      if (r.ok) {
        var j = await r.json();
        var rows = (j && j.response && j.response.data) || [];
        rows.sort(function (a, b) { return (a.period || '').localeCompare(b.period || ''); });
        var history = rows.slice(-26).map(function (x) {
          return { date: x.period, value: Number(x.value) };
        }).filter(function (x) { return isFinite(x.value); });
        if (history.length) {
          out = {
            kbbl: history[history.length - 1].value,
            asOf: history[history.length - 1].date,
            history: history,
          };
        }
      }
    } catch (e) {
      console.warn('[OPECData] getSPRLevel failed:', e && e.message);
    }
    cacheSet(ck, out);
    return out;
  }

  // Baker Hughes rig count (U.S. total). EIA publishes weekly.
  // v2 series: PET.E_ERTRR0_XR0_NUS_C.W   (crude + natgas combined total)
  // We fall back to PET.W_EPC0_SAX_R48-Z00_MBBL.W for a sanity series if
  // rig count is unavailable — not ideal, but we keep the surface simple.
  async function getRigCount() {
    var ck = 'rigs';
    var hit = cacheGet(ck);
    if (hit !== undefined) return hit;
    var key = getKey();
    if (!key) return null;

    var out = null;
    try {
      var url = 'https://api.eia.gov/v2/seriesid/PET.E_ERTRR0_XR0_NUS_C.W?api_key=' + encodeURIComponent(key);
      var r = await fetch(url);
      if (r.ok) {
        var j = await r.json();
        var rows = (j && j.response && j.response.data) || [];
        rows.sort(function (a, b) { return (a.period || '').localeCompare(b.period || ''); });
        if (rows.length) {
          var last = rows[rows.length - 1];
          out = {
            count: Number(last.value),
            asOf: last.period,
          };
        }
      }
    } catch (e) {
      console.warn('[OPECData] getRigCount failed:', e && e.message);
    }
    cacheSet(ck, out);
    return out;
  }

  function clearCache() { cache = {}; }

  window.OPECData = {
    COUNTRIES: COUNTRIES,
    getProduction: getProduction,
    getOPECPlusTotal: getOPECPlusTotal,
    getSPRLevel: getSPRLevel,
    getRigCount: getRigCount,
    clearCache: clearCache,
  };
})();
