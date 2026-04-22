// engine/disasters.js — OSINT disaster feed: USGS earthquakes + NASA FIRMS
// wildfires + GDACS global disaster RSS. Focused on geopolitical / energy
// infrastructure zones (Middle East, Caspian, Russia-Ukraine corridor, US
// pipeline regions).
//
// All sources are CORS-ok public APIs. NASA FIRMS requires a free MAP_KEY
// stored in window.TR_SETTINGS.keys.nasa_firms — without a key we return
// null and the panel falls back to the public embed.
//
// Exposes window.DisasterData:
//   getEarthquakesGlobal(magMin=4.5)
//   getEarthquakesByRegion(bbox, magMin, sinceDays)
//   getWildfiresActive(region='middle_east'|'americas'|'europe'|'world')
//   getGDACSFeed()
//   REGIONS                        — named bboxes
//   OIL_GAS_INFRA                  — { name, lat, lon, type } for proximity
//   nearestInfra(lat, lon, maxKm)  — helper for panel enrichment
//
// 15-minute in-memory cache per keyed fetch.

(function () {
  const CACHE_MS = 15 * 60 * 1000;
  const cache = new Map();

  function cacheGet(key) {
    const c = cache.get(key);
    if (!c) return null;
    if (Date.now() - c.ts > CACHE_MS) { cache.delete(key); return null; }
    return c.data;
  }
  function cacheSet(key, data) {
    cache.set(key, { ts: Date.now(), data });
  }

  // Focus-zone bboxes: { latMin, latMax, lonMin, lonMax }.
  // Covers the chokepoints and pipeline corridors most likely to move
  // oil / gas / wheat / shipping tape on disruption.
  const REGIONS = {
    middle_east:    { latMin: 12,  latMax: 42,  lonMin: 32,  lonMax: 65,  label: 'Middle East' },
    caspian:        { latMin: 36,  latMax: 48,  lonMin: 44,  lonMax: 58,  label: 'Caspian' },
    russia_ukraine: { latMin: 44,  latMax: 60,  lonMin: 22,  lonMax: 50,  label: 'Russia-Ukraine' },
    us_gulf:        { latMin: 24,  latMax: 32,  lonMin: -98, lonMax: -80, label: 'US Gulf Coast' },
    us_alaska:      { latMin: 54,  latMax: 72,  lonMin: -170,lonMax: -140,label: 'Alaska (TAPS)' },
    americas:       { latMin: -55, latMax: 72,  lonMin: -170,lonMax: -30, label: 'Americas' },
    europe:         { latMin: 35,  latMax: 72,  lonMin: -12, lonMax: 42,  label: 'Europe' },
    world:          { latMin: -90, latMax: 90,  lonMin: -180,lonMax: 180, label: 'World' },
  };

  // Rough list of strategically-important oil/gas infrastructure points.
  // Used for "nearest infra" annotation on earthquake rows so the panel can
  // flag e.g. "M5.4 near Bandar Abbas — 38km from Kharg Island terminal".
  const OIL_GAS_INFRA = [
    { name: 'Kharg Island (export terminal)', lat: 29.23, lon: 50.32, type: 'terminal', country: 'Iran' },
    { name: 'Bandar Abbas (refinery / port)', lat: 27.19, lon: 56.27, type: 'port',     country: 'Iran' },
    { name: 'Ras Tanura (Saudi export)',      lat: 26.64, lon: 50.16, type: 'terminal', country: 'Saudi Arabia' },
    { name: 'Fujairah (bunker hub)',          lat: 25.12, lon: 56.34, type: 'port',     country: 'UAE' },
    { name: 'Ras Laffan (LNG)',               lat: 25.90, lon: 51.56, type: 'lng',      country: 'Qatar' },
    { name: 'Ceyhan (BTC terminus)',          lat: 36.85, lon: 35.93, type: 'terminal', country: 'Turkey' },
    { name: 'Baku (SOCAR)',                   lat: 40.40, lon: 49.85, type: 'hub',      country: 'Azerbaijan' },
    { name: 'Novorossiysk (CPC terminal)',    lat: 44.72, lon: 37.77, type: 'terminal', country: 'Russia' },
    { name: 'Ust-Luga (Baltic export)',       lat: 59.67, lon: 28.41, type: 'terminal', country: 'Russia' },
    { name: 'Druzhba pipeline (Mozyr)',       lat: 52.04, lon: 29.25, type: 'pipeline', country: 'Belarus' },
    { name: 'Yamal LNG (Sabetta)',            lat: 71.27, lon: 72.06, type: 'lng',      country: 'Russia' },
    { name: 'TAPS — Valdez terminus',         lat: 61.13, lon: -146.35,type: 'terminal', country: 'USA' },
    { name: 'TAPS — Prudhoe Bay',             lat: 70.33, lon: -148.72,type: 'field',    country: 'USA' },
    { name: 'Port Arthur (US refining)',      lat: 29.89, lon: -93.93, type: 'refinery', country: 'USA' },
    { name: 'Houston Ship Channel',           lat: 29.72, lon: -95.03, type: 'port',     country: 'USA' },
    { name: 'Corpus Christi (crude export)',  lat: 27.81, lon: -97.40, type: 'port',     country: 'USA' },
    { name: 'Cushing (WTI hub)',              lat: 35.98, lon: -96.77, type: 'hub',      country: 'USA' },
    { name: 'Suez Canal (Ain Sokhna)',        lat: 29.60, lon: 32.32,  type: 'choke',    country: 'Egypt' },
    { name: 'Bab el-Mandeb',                  lat: 12.58, lon: 43.33,  type: 'choke',    country: 'Yemen/Djibouti' },
    { name: 'Strait of Hormuz',               lat: 26.57, lon: 56.25,  type: 'choke',    country: 'Iran/Oman' },
  ];

  // Haversine in km.
  function haversineKm(lat1, lon1, lat2, lon2) {
    const R = 6371;
    const toRad = (d) => d * Math.PI / 180;
    const dLat = toRad(lat2 - lat1);
    const dLon = toRad(lon2 - lon1);
    const a = Math.sin(dLat / 2) ** 2 +
              Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) *
              Math.sin(dLon / 2) ** 2;
    return 2 * R * Math.asin(Math.sqrt(a));
  }

  function nearestInfra(lat, lon, maxKm = 500) {
    if (!isFinite(lat) || !isFinite(lon)) return null;
    let best = null;
    for (const p of OIL_GAS_INFRA) {
      const d = haversineKm(lat, lon, p.lat, p.lon);
      if (d <= maxKm && (!best || d < best.distanceKm)) {
        best = { ...p, distanceKm: Math.round(d) };
      }
    }
    return best;
  }

  function bboxContains(bbox, lat, lon) {
    if (!bbox) return true;
    // Handle antimeridian span (lonMin > lonMax) — not common here but safe.
    const inLat = lat >= bbox.latMin && lat <= bbox.latMax;
    const inLon = bbox.lonMin <= bbox.lonMax
      ? (lon >= bbox.lonMin && lon <= bbox.lonMax)
      : (lon >= bbox.lonMin || lon <= bbox.lonMax);
    return inLat && inLon;
  }

  function normalizeQuake(f) {
    if (!f || !f.properties || !f.geometry) return null;
    const [lon, lat, depth] = f.geometry.coordinates || [];
    const p = f.properties;
    return {
      id:       f.id,
      mag:      typeof p.mag === 'number' ? p.mag : null,
      place:    p.place || '',
      time:     p.time || null,
      tsunami:  !!p.tsunami,
      url:      p.url || '',
      type:     'earthquake',
      lat:      typeof lat === 'number' ? lat : null,
      lon:      typeof lon === 'number' ? lon : null,
      depthKm:  typeof depth === 'number' ? depth : null,
      felt:     p.felt || 0,
      alert:    p.alert || null,
      sig:      p.sig || 0,
    };
  }

  // ---------------------------- EARTHQUAKES ----------------------------
  // USGS feed endpoints — 200 OK, application/json, CORS-ok.
  async function getEarthquakesGlobal(magMin = 4.5) {
    const key = 'quakes:global:' + magMin;
    const cached = cacheGet(key);
    if (cached) return cached;

    // Pick the narrowest feed that covers the requested threshold.
    // Significant-week is light; all_day has more coverage for mag>=4.5.
    const url = magMin >= 4.5
      ? 'https://earthquake.usgs.gov/earthquakes/feed/v1.0/summary/4.5_day.geojson'
      : 'https://earthquake.usgs.gov/earthquakes/feed/v1.0/summary/all_day.geojson';

    let out = [];
    try {
      const r = await fetch(url);
      if (r.ok) {
        const j = await r.json();
        out = (j.features || [])
          .map(normalizeQuake)
          .filter(q => q && q.mag != null && q.mag >= magMin)
          .sort((a, b) => (b.time || 0) - (a.time || 0));
      }
    } catch (e) {
      console.warn('[DisasterData] quakes global fetch failed:', e.message);
    }
    cacheSet(key, out);
    return out;
  }

  // Query a bbox + time window. `sinceDays` defaults to 7.
  async function getEarthquakesByRegion(bboxOrName, magMin = 4.5, sinceDays = 7) {
    const bbox = typeof bboxOrName === 'string' ? REGIONS[bboxOrName] : bboxOrName;
    if (!bbox) return [];
    const keyStr = `quakes:region:${bbox.latMin},${bbox.latMax},${bbox.lonMin},${bbox.lonMax}:${magMin}:${sinceDays}`;
    const cached = cacheGet(keyStr);
    if (cached) return cached;

    const end   = new Date();
    const start = new Date(Date.now() - sinceDays * 86400 * 1000);
    const iso = (d) => d.toISOString().slice(0, 10);
    const url = 'https://earthquake.usgs.gov/fdsnws/event/1/query?' + [
      'format=geojson',
      `starttime=${iso(start)}`,
      `endtime=${iso(end)}`,
      `minmagnitude=${magMin}`,
      `minlatitude=${bbox.latMin}`,
      `maxlatitude=${bbox.latMax}`,
      `minlongitude=${bbox.lonMin}`,
      `maxlongitude=${bbox.lonMax}`,
    ].join('&');

    let out = [];
    try {
      const r = await fetch(url);
      if (r.ok) {
        const j = await r.json();
        out = (j.features || [])
          .map(normalizeQuake)
          .filter(Boolean)
          .sort((a, b) => (b.time || 0) - (a.time || 0));
      }
    } catch (e) {
      console.warn('[DisasterData] quakes region fetch failed:', e.message);
    }
    cacheSet(keyStr, out);
    return out;
  }

  // ----------------------------- WILDFIRES -----------------------------
  // NASA FIRMS VIIRS S-NPP NRT CSV. Needs MAP_KEY.
  // CSV columns (FIRMS v1):
  //   latitude,longitude,bright_ti4,scan,track,acq_date,acq_time,satellite,
  //   instrument,confidence,version,bright_ti5,frp,daynight
  async function getWildfiresActive(regionName = 'middle_east') {
    const region = REGIONS[regionName] || REGIONS.world;
    const cacheKey = 'fires:' + regionName;
    const cached = cacheGet(cacheKey);
    if (cached) return cached;

    const settings = window.TR_SETTINGS || {};
    const key = (settings.keys && (settings.keys.nasa_firms || settings.keys.firms)) || '';
    if (!key) {
      const result = {
        source: 'FIRMS',
        hasKey: false,
        fires: [],
        region: region,
        note: 'Add nasa_firms key to Settings to see live wildfire points.',
      };
      cacheSet(cacheKey, result);
      return result;
    }

    // FIRMS "area" endpoint: /api/area/csv/<key>/<sensor>/<area>/<day>
    // `area` = "world" OR "west,south,east,north".
    // Request the last 1 day to stay small.
    const areaParam = (regionName === 'world' || regionName === 'americas' || regionName === 'europe')
      ? (regionName === 'world'
          ? 'world'
          : [region.lonMin, region.latMin, region.lonMax, region.latMax].join(','))
      : [region.lonMin, region.latMin, region.lonMax, region.latMax].join(',');

    const url = `https://firms.modaps.eosdis.nasa.gov/api/area/csv/${encodeURIComponent(key)}/VIIRS_SNPP_NRT/${areaParam}/1`;
    let fires = [];
    try {
      const r = await fetch(url);
      if (r.ok) {
        const text = await r.text();
        fires = parseFIRMSCsv(text);
      } else if (r.status === 400 || r.status === 401) {
        console.warn('[DisasterData] FIRMS rejected key (status ' + r.status + ')');
      }
    } catch (e) {
      console.warn('[DisasterData] FIRMS fetch failed:', e.message);
    }
    const result = { source: 'FIRMS', hasKey: true, fires, region };
    cacheSet(cacheKey, result);
    return result;
  }

  function parseFIRMSCsv(text) {
    if (!text || typeof text !== 'string') return [];
    const lines = text.split(/\r?\n/).filter(Boolean);
    if (lines.length < 2) return [];
    const header = lines[0].split(',').map(s => s.trim().toLowerCase());
    const idx = (name) => header.indexOf(name);
    const iLat = idx('latitude'), iLon = idx('longitude');
    const iFrp = idx('frp'), iConf = idx('confidence');
    const iDate = idx('acq_date'), iTime = idx('acq_time');
    const iDN = idx('daynight'), iSat = idx('satellite');
    if (iLat < 0 || iLon < 0) return [];
    const out = [];
    for (let i = 1; i < lines.length; i++) {
      const parts = lines[i].split(',');
      const lat = parseFloat(parts[iLat]);
      const lon = parseFloat(parts[iLon]);
      if (!isFinite(lat) || !isFinite(lon)) continue;
      out.push({
        type: 'wildfire',
        lat, lon,
        frp:        iFrp >= 0 ? parseFloat(parts[iFrp]) || 0 : 0,
        confidence: iConf >= 0 ? (parts[iConf] || '').trim() : '',
        acqDate:    iDate >= 0 ? parts[iDate] : '',
        acqTime:    iTime >= 0 ? parts[iTime] : '',
        dayNight:   iDN >= 0 ? parts[iDN] : '',
        satellite:  iSat >= 0 ? parts[iSat] : 'VIIRS',
      });
    }
    // Sort by FRP (fire radiative power) desc — brightest fires first.
    out.sort((a, b) => (b.frp || 0) - (a.frp || 0));
    return out;
  }

  // ------------------------------ GDACS --------------------------------
  // GDACS global disaster RSS — hazards, alerts, storms, floods, droughts.
  // Parsed with DOMParser (client-side XML).
  async function getGDACSFeed() {
    const cacheKey = 'gdacs';
    const cached = cacheGet(cacheKey);
    if (cached) return cached;

    let out = [];
    try {
      const r = await fetch('https://www.gdacs.org/xml/rss.xml');
      if (r.ok) {
        const text = await r.text();
        out = parseGDACS(text);
      }
    } catch (e) {
      console.warn('[DisasterData] GDACS fetch failed:', e.message);
    }
    cacheSet(cacheKey, out);
    return out;
  }

  function parseGDACS(xmlText) {
    if (!xmlText || typeof xmlText !== 'string') return [];
    try {
      const parser = new DOMParser();
      const doc = parser.parseFromString(xmlText, 'text/xml');
      const items = Array.from(doc.getElementsByTagName('item'));
      return items.map(it => {
        const getTxt = (tag) => {
          const el = it.getElementsByTagName(tag)[0];
          return el ? (el.textContent || '').trim() : '';
        };
        const getNs = (prefix, tag) => {
          // getElementsByTagName works with prefixed names directly in XML docs.
          const el = it.getElementsByTagName(prefix + ':' + tag)[0];
          return el ? (el.textContent || '').trim() : '';
        };
        const lat = parseFloat(getNs('geo', 'lat')) || null;
        const lon = parseFloat(getNs('geo', 'long')) || null;
        const alertLevel = (getNs('gdacs', 'alertlevel') || '').toLowerCase();
        const eventType  = getNs('gdacs', 'eventtype');
        const country    = getNs('gdacs', 'country');
        const pubDate    = getTxt('pubDate');
        return {
          type:  'gdacs',
          title: getTxt('title'),
          link:  getTxt('link'),
          description: getTxt('description'),
          lat, lon,
          alertLevel,           // 'red' | 'orange' | 'green'
          eventType,            // EQ | TC | FL | DR | VO | WF
          country,
          time: pubDate ? (new Date(pubDate)).getTime() : null,
        };
      }).filter(x => x.title);
    } catch (e) {
      console.warn('[DisasterData] GDACS parse failed:', e.message);
      return [];
    }
  }

  function clearCache() { cache.clear(); }

  window.DisasterData = {
    REGIONS,
    OIL_GAS_INFRA,
    getEarthquakesGlobal,
    getEarthquakesByRegion,
    getWildfiresActive,
    getGDACSFeed,
    nearestInfra,
    bboxContains,
    clearCache,
  };
})();
