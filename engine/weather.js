// engine/weather.js — NOAA weather alerts + NHC hurricane tracker.
//
// Free public endpoints (no key required):
//   - https://api.weather.gov/alerts/active       → GeoJSON feed of active
//     watches/warnings/advisories across the US. Supports ?severity, ?area.
//   - https://www.nhc.noaa.gov/CurrentStorms.json → JSON feed of currently
//     tracked Atlantic + E/C Pacific tropical systems, with forecast cone.
//
// Focus regions (correlated with energy / shipping markets):
//   Gulf of Mexico  → oil production (30% of US crude), natgas
//   Texas           → 48% of US refining capacity
//   Caribbean       → shipping lanes, Panama access
//   Northeast       → natgas heating demand
//
// Exposes window.WeatherIntel with:
//   getActiveAlerts({ severity })   → [{ id, event, severity, headline, ... }]
//   getHurricanes()                 → [{ id, name, classification, wind, ... }]
//   getGulfAlerts()                 → subset inside Gulf-oil bbox
//   getCorrelation()                → { oilRisk, natgasRisk, notes }
//
// Cache: 10-min TTL per endpoint.
//
(function () {
  if (typeof window === 'undefined') return;

  var CACHE_TTL_MS = 10 * 60 * 1000;
  var cache = {
    alerts:     { data: null, time: 0, key: '' },
    hurricanes: { data: null, time: 0 },
  };

  // NOAA requires a User-Agent header with a contact. Browser fetch lets
  // them set it but we can still pass Accept to hint GeoJSON.
  var NWS_HEADERS = {
    'Accept': 'application/geo+json',
  };

  // Gulf-of-Mexico oil bbox (south TX/LA shelf + deepwater):
  //   roughly 24N-30N, -98W to -85W
  var GULF_BBOX = { latMin: 24.0, latMax: 30.5, lonMin: -98.0, lonMax: -85.0 };

  // Texas refinery corridor — Houston Ship Channel + Port Arthur + Corpus.
  var TEXAS_REFINERY_BBOX = { latMin: 27.5, latMax: 30.0, lonMin: -97.5, lonMax: -93.5 };

  // Northeast natgas-demand region (NY/NJ/PA/NE).
  var NORTHEAST_BBOX = { latMin: 39.0, latMax: 45.5, lonMin: -80.0, lonMax: -67.0 };

  // Caribbean shipping lanes (Panama approach + Mona Passage).
  var CARIBBEAN_BBOX = { latMin: 9.0, latMax: 22.0, lonMin: -88.0, lonMax: -60.0 };

  function centroid(geom) {
    try {
      if (!geom) return null;
      if (geom.type === 'Point') {
        return { lon: geom.coordinates[0], lat: geom.coordinates[1] };
      }
      // For Polygon/MultiPolygon → average outer-ring coords (rough).
      var flat = [];
      function walk(c) {
        if (!Array.isArray(c)) return;
        if (typeof c[0] === 'number' && typeof c[1] === 'number') {
          flat.push(c);
        } else {
          for (var i = 0; i < c.length; i++) walk(c[i]);
        }
      }
      walk(geom.coordinates);
      if (!flat.length) return null;
      var sx = 0, sy = 0;
      for (var i = 0; i < flat.length; i++) {
        sx += flat[i][0];
        sy += flat[i][1];
      }
      return { lon: sx / flat.length, lat: sy / flat.length };
    } catch (e) { return null; }
  }

  function inBbox(pt, bbox) {
    if (!pt || !bbox) return false;
    return pt.lat >= bbox.latMin && pt.lat <= bbox.latMax
        && pt.lon >= bbox.lonMin && pt.lon <= bbox.lonMax;
  }

  function severityRank(s) {
    var m = { 'Extreme': 4, 'Severe': 3, 'Moderate': 2, 'Minor': 1, 'Unknown': 0 };
    return m[s] != null ? m[s] : 0;
  }

  // Normalize an NWS alert feature to a light, stable shape.
  function normalizeAlert(feat) {
    var p = (feat && feat.properties) || {};
    var c = centroid(feat && feat.geometry);
    return {
      id:          p.id || feat.id || '',
      event:       p.event || 'Alert',
      severity:    p.severity || 'Unknown',
      urgency:     p.urgency || 'Unknown',
      certainty:   p.certainty || 'Unknown',
      headline:    p.headline || p.event || '',
      description: (p.description || '').slice(0, 400),
      areaDesc:    p.areaDesc || '',
      sent:        p.sent || null,
      effective:   p.effective || null,
      expires:     p.expires || null,
      senderName:  p.senderName || '',
      lat:         c ? c.lat : null,
      lon:         c ? c.lon : null,
    };
  }

  async function getActiveAlerts(opts) {
    opts = opts || {};
    var severity = opts.severity || 'Severe';
    var key = 'sev:' + severity;
    if (cache.alerts.data && cache.alerts.key === key
        && Date.now() - cache.alerts.time < CACHE_TTL_MS) {
      return cache.alerts.data;
    }

    var url = 'https://api.weather.gov/alerts/active?severity=' + encodeURIComponent(severity);
    var out = [];
    try {
      var r = await fetch(url, { headers: NWS_HEADERS });
      if (r.ok) {
        var j = await r.json();
        var feats = (j && j.features) || [];
        for (var i = 0; i < feats.length; i++) {
          out.push(normalizeAlert(feats[i]));
        }
        out.sort(function (a, b) {
          var sa = severityRank(a.severity);
          var sb = severityRank(b.severity);
          if (sa !== sb) return sb - sa;
          return (b.sent || '').localeCompare(a.sent || '');
        });
      }
    } catch (e) {
      console.warn('[WeatherIntel] getActiveAlerts failed:', e && e.message);
    }
    cache.alerts = { data: out, time: Date.now(), key: key };
    return out;
  }

  // NHC CurrentStorms.json — list of active tropical cyclones.
  // Shape (simplified): { activeStorms: [{ id, name, classification, intensity,
  //   pressure, latitudeNumeric, longitudeNumeric, movementDir, movementSpeed,
  //   forecastAdvisory:{ issuance }, trackCone:{ geometry } }] }
  async function getHurricanes() {
    if (cache.hurricanes.data && Date.now() - cache.hurricanes.time < CACHE_TTL_MS) {
      return cache.hurricanes.data;
    }
    var out = [];
    try {
      var r = await fetch('https://www.nhc.noaa.gov/CurrentStorms.json');
      if (r.ok) {
        var j = await r.json();
        var storms = (j && j.activeStorms) || [];
        for (var i = 0; i < storms.length; i++) {
          var s = storms[i] || {};
          out.push({
            id:             s.id || s.binNumber || '',
            name:           s.name || 'Unnamed',
            classification: s.classification || s.intensityClass || '',
            intensity:      Number(s.intensity || 0),          // kt
            pressure:       Number(s.pressure || 0),           // mb
            lat:            Number(s.latitudeNumeric || 0),
            lon:            Number(s.longitudeNumeric || 0),
            movementDir:    s.movementDir || '',
            movementSpeed:  Number(s.movementSpeed || 0),
            basinId:        s.binNumber || s.basin || '',
            issuance:       (s.forecastAdvisory && s.forecastAdvisory.issuance) || '',
            publicAdvisory: s.publicAdvisory && s.publicAdvisory.url || '',
            trackUrl:       s.trackCone && (s.trackCone.kmzFile || s.trackCone.zipFile) || '',
            graphicUrl:     (s.fiveDayForecastGraphic && s.fiveDayForecastGraphic.url)
                         || (s.forecastGraphics5 && s.forecastGraphics5.url) || '',
          });
        }
        // Sort by intensity descending.
        out.sort(function (a, b) { return b.intensity - a.intensity; });
      }
    } catch (e) {
      console.warn('[WeatherIntel] getHurricanes failed:', e && e.message);
    }
    cache.hurricanes = { data: out, time: Date.now() };
    return out;
  }

  async function getGulfAlerts() {
    var all = await getActiveAlerts({ severity: 'Severe' });
    var extreme = await getActiveAlerts({ severity: 'Extreme' });
    var merged = (extreme || []).concat(all || []);
    // dedupe by id
    var seen = {};
    var out = [];
    for (var i = 0; i < merged.length; i++) {
      var a = merged[i];
      if (seen[a.id]) continue;
      seen[a.id] = true;
      var pt = (a.lat != null && a.lon != null) ? { lat: a.lat, lon: a.lon } : null;
      if (inBbox(pt, GULF_BBOX) || /gulf|louisiana|texas coast|mississippi/i.test(a.areaDesc || '')) {
        out.push(a);
      }
    }
    return out;
  }

  // Heuristic correlation. If a hurricane sits in the Gulf bbox → oil risk.
  // If severe winter alerts in the Northeast bbox → natgas demand spike.
  async function getCorrelation() {
    var [alerts, storms] = await Promise.all([
      getActiveAlerts({ severity: 'Severe' }),
      getHurricanes(),
    ]);

    var oilRisk = 'low', natgasRisk = 'low';
    var notes = [];

    var gulfStorms = (storms || []).filter(function (s) {
      return inBbox({ lat: s.lat, lon: s.lon }, GULF_BBOX)
          || inBbox({ lat: s.lat, lon: s.lon }, CARIBBEAN_BBOX);
    });
    if (gulfStorms.length) {
      oilRisk = gulfStorms.some(function (s) { return s.intensity >= 74; }) ? 'high' : 'elevated';
      notes.push(gulfStorms.length + ' tropical system(s) in Gulf/Caribbean → shut-in risk for offshore rigs.');
    }

    var txAlerts = (alerts || []).filter(function (a) {
      return inBbox({ lat: a.lat, lon: a.lon }, TEXAS_REFINERY_BBOX)
          || /texas|houston|galveston|port arthur|beaumont/i.test(a.areaDesc || '');
    });
    if (txAlerts.length) {
      notes.push(txAlerts.length + ' severe alert(s) over TX refinery corridor → refinery utilization risk.');
      if (oilRisk === 'low') oilRisk = 'elevated';
    }

    var neAlerts = (alerts || []).filter(function (a) {
      return inBbox({ lat: a.lat, lon: a.lon }, NORTHEAST_BBOX)
          || /winter storm|blizzard|arctic|ice storm|cold/i.test(a.event || '');
    });
    if (neAlerts.length) {
      natgasRisk = neAlerts.length >= 5 ? 'high' : 'elevated';
      notes.push(neAlerts.length + ' winter/cold alerts → Northeast natgas heating demand spike.');
    }

    if (!notes.length) notes.push('No acute energy-weather correlations right now.');

    return { oilRisk: oilRisk, natgasRisk: natgasRisk, notes: notes,
             gulfStormCount: gulfStorms.length, txAlertCount: txAlerts.length,
             neAlertCount: neAlerts.length };
  }

  function clearCache() {
    cache.alerts     = { data: null, time: 0, key: '' };
    cache.hurricanes = { data: null, time: 0 };
  }

  window.WeatherIntel = {
    GULF_BBOX: GULF_BBOX,
    TEXAS_REFINERY_BBOX: TEXAS_REFINERY_BBOX,
    NORTHEAST_BBOX: NORTHEAST_BBOX,
    CARIBBEAN_BBOX: CARIBBEAN_BBOX,
    getActiveAlerts: getActiveAlerts,
    getHurricanes: getHurricanes,
    getGulfAlerts: getGulfAlerts,
    getCorrelation: getCorrelation,
    clearCache: clearCache,
  };
})();
