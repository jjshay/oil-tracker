// engine/shipping.js — Chokepoint + Baltic Dry Index intelligence.
//
// Free public sources. All non-API-key:
//   - Panama Canal transit stats: https://pancanal.com/en/canal-transit-statistics/
//     (scraped via public CORS proxy; PanCanal site is Cloudflare-gated)
//   - Suez Canal Authority:       https://www.suezcanal.gov.eg
//     (transit stats page; scraped via proxy)
//   - Baltic Dry Index (BDI):     Stooq quote endpoint — CSV (no key)
//       https://stooq.com/q/l/?s=^bdi&f=sd2t2ohlcv&h&e=csv
//     Daily history:
//       https://stooq.com/q/d/l/?s=^bdi&i=d
//   - AIS density (chokepoints):  MarineTraffic / VesselFinder embed URLs
//     (we only expose hot-links; live density is shown in the iframe there)
//
// Exposes window.ShippingIntel:
//   getPanamaTransits()     → { daily, avg30d, delta, source, fetchedAt } | null
//   getSuezTransits()       → { daily, avg30d, delta, source, fetchedAt } | null
//   getBDI()                → { last, change, changePct, history:[{date,close}], fetchedAt } | null
//   getChokepointDensity(bbox) → { marineTrafficUrl, vesselFinderUrl } (lookup helper)
//   CHOKEPOINTS             → array of named bbox presets w/ external urls.
//
// Cache: 30-min TTL for scrape endpoints (traffic is low-frequency), 10-min
// for BDI.

(function () {
  if (typeof window === 'undefined') return;

  var CACHE_SCRAPE_MS = 30 * 60 * 1000;
  var CACHE_QUOTE_MS  = 10 * 60 * 1000;

  var cache = {
    panama: { data: null, time: 0 },
    suez:   { data: null, time: 0 },
    bdi:    { data: null, time: 0 },
  };

  // Public CORS proxies (best-effort order). Copied intentionally small to
  // avoid dragging in engine/etf-flows.js helper surface.
  var PROXIES = [
    function (u) { return 'https://api.allorigins.win/raw?url=' + encodeURIComponent(u); },
    function (u) { return 'https://corsproxy.io/?' + encodeURIComponent(u); },
    function (u) { return 'https://api.codetabs.com/v1/proxy/?quest=' + encodeURIComponent(u); },
    function (u) { return u; }, // direct (mostly fails for scraped sources)
  ];

  async function fetchText(url) {
    for (var i = 0; i < PROXIES.length; i++) {
      try {
        var wrapped = PROXIES[i](url);
        var r = await fetch(wrapped);
        if (!r.ok) continue;
        var txt = await r.text();
        if (txt && txt.length > 20) return txt;
      } catch (e) { /* try next */ }
    }
    return null;
  }

  // Pull a number near a labeled phrase — robust to extra whitespace and
  // common PanCanal formatting ("32 transits", "Daily avg 34.5").
  function extractNumberNear(haystack, labelRegex) {
    if (!haystack) return null;
    try {
      var re = new RegExp(labelRegex.source + '[^0-9]{0,40}([0-9]+(?:[.,][0-9]+)?)', 'i');
      var m = haystack.match(re);
      if (!m) return null;
      var raw = m[1].replace(/,/g, '');
      var n = parseFloat(raw);
      return isFinite(n) ? n : null;
    } catch (e) { return null; }
  }

  // Panama Canal — pancanal.com/en/canal-transit-statistics/
  async function getPanamaTransits() {
    if (cache.panama.data && Date.now() - cache.panama.time < CACHE_SCRAPE_MS) {
      return cache.panama.data;
    }
    var url = 'https://pancanal.com/en/canal-transit-statistics/';
    var out = null;
    try {
      var html = await fetchText(url);
      if (html) {
        // Strip scripts/styles + collapse to text-ish.
        var clean = html.replace(/<script[\s\S]*?<\/script>/gi, ' ')
                        .replace(/<style[\s\S]*?<\/style>/gi, ' ')
                        .replace(/<[^>]+>/g, ' ')
                        .replace(/\s+/g, ' ');

        var daily = extractNumberNear(clean, /daily transits?/i)
                 || extractNumberNear(clean, /transits? \(daily\)/i)
                 || extractNumberNear(clean, /vessels? per day/i);
        var avg   = extractNumberNear(clean, /average|avg\.?/i);

        if (daily != null) {
          var delta = (avg != null) ? daily - avg : null;
          out = {
            daily: daily,
            avg30d: avg,
            delta: delta,
            source: 'pancanal.com',
            fetchedAt: Date.now(),
          };
        }
      }
    } catch (e) {
      console.warn('[ShippingIntel] getPanamaTransits failed:', e && e.message);
    }
    cache.panama = { data: out, time: Date.now() };
    return out;
  }

  // Suez Canal — suezcanal.gov.eg (various sub-pages; we try the home page
  // since the SCA occasionally publishes "x transits yesterday" headlines).
  async function getSuezTransits() {
    if (cache.suez.data && Date.now() - cache.suez.time < CACHE_SCRAPE_MS) {
      return cache.suez.data;
    }
    var url = 'https://www.suezcanal.gov.eg/English/Pages/default.aspx';
    var out = null;
    try {
      var html = await fetchText(url);
      if (html) {
        var clean = html.replace(/<script[\s\S]*?<\/script>/gi, ' ')
                        .replace(/<style[\s\S]*?<\/style>/gi, ' ')
                        .replace(/<[^>]+>/g, ' ')
                        .replace(/\s+/g, ' ');
        var daily = extractNumberNear(clean, /daily transits?|transits? per day|vessels? per day|transiting vessels/i);
        var avg   = extractNumberNear(clean, /average transits?|average daily/i);
        if (daily != null) {
          out = {
            daily: daily,
            avg30d: avg,
            delta: (avg != null) ? daily - avg : null,
            source: 'suezcanal.gov.eg',
            fetchedAt: Date.now(),
          };
        }
      }
    } catch (e) {
      console.warn('[ShippingIntel] getSuezTransits failed:', e && e.message);
    }
    cache.suez = { data: out, time: Date.now() };
    return out;
  }

  // Baltic Dry Index via Stooq. Free, no key, open CSV.
  //   Quote:   https://stooq.com/q/l/?s=^bdi&f=sd2t2ohlcv&h&e=csv
  //   History: https://stooq.com/q/d/l/?s=^bdi&i=d
  async function getBDI() {
    if (cache.bdi.data && Date.now() - cache.bdi.time < CACHE_QUOTE_MS) {
      return cache.bdi.data;
    }
    var out = null;
    try {
      var quoteCsv = await fetchText('https://stooq.com/q/l/?s=^bdi&f=sd2t2ohlcv&h&e=csv');
      var histCsv  = await fetchText('https://stooq.com/q/d/l/?s=^bdi&i=d');

      var last = null, open = null;
      if (quoteCsv) {
        // Header: Symbol,Date,Time,Open,High,Low,Close,Volume
        var lines = quoteCsv.trim().split(/\r?\n/);
        if (lines.length >= 2) {
          var row = lines[1].split(',');
          open  = parseFloat(row[3]);
          last  = parseFloat(row[6]);
        }
      }

      var history = [];
      if (histCsv) {
        // Header: Date,Open,High,Low,Close,Volume
        var hl = histCsv.trim().split(/\r?\n/);
        for (var i = 1; i < hl.length; i++) {
          var parts = hl[i].split(',');
          if (parts.length < 5) continue;
          var c = parseFloat(parts[4]);
          if (!isFinite(c)) continue;
          history.push({ date: parts[0], close: c });
        }
        // Keep last 30 entries.
        history = history.slice(-30);
      }

      if (isFinite(last)) {
        var prev = history.length >= 2 ? history[history.length - 2].close : open;
        var change = (isFinite(prev)) ? last - prev : null;
        var changePct = (isFinite(prev) && prev !== 0) ? (change / prev) * 100 : null;
        out = {
          last: last,
          change: change,
          changePct: changePct,
          history: history,
          fetchedAt: Date.now(),
        };
      }
    } catch (e) {
      console.warn('[ShippingIntel] getBDI failed:', e && e.message);
    }
    cache.bdi = { data: out, time: Date.now() };
    return out;
  }

  // Chokepoint presets. Each has a bbox + a ready MarineTraffic + VesselFinder
  // link centered on the chokepoint. The UI uses these directly as external
  // launch targets.
  var CHOKEPOINTS = [
    { id: 'panama',    name: 'Panama Canal',    lat: 9.08,   lon: -79.68,
      marineTrafficUrl: 'https://www.marinetraffic.com/en/ais/home/centerx:-79.68/centery:9.08/zoom:10',
      vesselFinderUrl:  'https://www.vesselfinder.com/?zoom=10&lat=9.08&lon=-79.68' },
    { id: 'suez',      name: 'Suez Canal',      lat: 30.42,  lon: 32.35,
      marineTrafficUrl: 'https://www.marinetraffic.com/en/ais/home/centerx:32.35/centery:30.42/zoom:9',
      vesselFinderUrl:  'https://www.vesselfinder.com/?zoom=9&lat=30.42&lon=32.35' },
    { id: 'hormuz',    name: 'Strait of Hormuz',lat: 26.5,   lon: 56.5,
      marineTrafficUrl: 'https://www.marinetraffic.com/en/ais/home/centerx:56.5/centery:26.5/zoom:7',
      vesselFinderUrl:  'https://www.vesselfinder.com/?zoom=7&lat=26.5&lon=56.5' },
    { id: 'babelmandeb', name: 'Bab el-Mandeb', lat: 12.58,  lon: 43.34,
      marineTrafficUrl: 'https://www.marinetraffic.com/en/ais/home/centerx:43.34/centery:12.58/zoom:8',
      vesselFinderUrl:  'https://www.vesselfinder.com/?zoom=8&lat=12.58&lon=43.34' },
    { id: 'bosphorus', name: 'Bosphorus',       lat: 41.11,  lon: 29.07,
      marineTrafficUrl: 'https://www.marinetraffic.com/en/ais/home/centerx:29.07/centery:41.11/zoom:10',
      vesselFinderUrl:  'https://www.vesselfinder.com/?zoom=10&lat=41.11&lon=29.07' },
    { id: 'malacca',   name: 'Strait of Malacca', lat: 2.5, lon: 101.5,
      marineTrafficUrl: 'https://www.marinetraffic.com/en/ais/home/centerx:101.5/centery:2.5/zoom:7',
      vesselFinderUrl:  'https://www.vesselfinder.com/?zoom=7&lat=2.5&lon=101.5' },
  ];

  function getChokepointDensity(bbox) {
    // Browser-side AIS queries require a key + paid bbox access. This helper
    // instead returns quick-launch URLs so the UI can route a user to live
    // visual density without needing to proxy AIS feeds.
    if (!bbox) return CHOKEPOINTS;
    return {
      marineTrafficUrl: 'https://www.marinetraffic.com/en/ais/home/centerx:'
        + ((bbox.lonMin + bbox.lonMax) / 2) + '/centery:'
        + ((bbox.latMin + bbox.latMax) / 2) + '/zoom:7',
      vesselFinderUrl:  'https://www.vesselfinder.com/?zoom=7&lat='
        + ((bbox.latMin + bbox.latMax) / 2) + '&lon='
        + ((bbox.lonMin + bbox.lonMax) / 2),
    };
  }

  function clearCache() {
    cache.panama = { data: null, time: 0 };
    cache.suez   = { data: null, time: 0 };
    cache.bdi    = { data: null, time: 0 };
  }

  window.ShippingIntel = {
    CHOKEPOINTS: CHOKEPOINTS,
    getPanamaTransits: getPanamaTransits,
    getSuezTransits: getSuezTransits,
    getBDI: getBDI,
    getChokepointDensity: getChokepointDensity,
    clearCache: clearCache,
  };
})();
