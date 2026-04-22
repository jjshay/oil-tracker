// engine/gdelt.js — GDELT 2.1 global events + article feed.
// GDELT Project is fully free, CORS-ok, and public. Rate-limit ~= 1 req / 5s
// per IP — all fetches here are cached for 5 minutes.
//
// Exposes window.GDELTData:
//   search(query, opts)        — ArtList: articles matching a query
//   getTrendingEvents(opts)    — timelinesourcecountry mode aggregation
//   getByTheme(theme, limit)   — shorthand for a themed ArtList search
//   THEMES                     — curated map of theme -> GDELT theme code
//
// Article shape (normalized):
//   { url, title, domain, seendate, country, language,
//     tone, goldstein, image }
//
// Goldstein Scale: -10 (most conflictual) .. +10 (most cooperative).
// AvgTone: -100 .. +100. GDELT doesn't return goldstein inside artlist by
// default — we fall back to a heuristic based on tone + keyword detection
// (see scoreConflict()).
//
// Docs (2.1 Doc API):
//   https://blog.gdeltproject.org/gdelt-doc-2-0-api-debuts/
//   https://api.gdeltproject.org/api/v2/doc/doc?...

(function () {
  const BASE = 'https://api.gdeltproject.org/api/v2/doc/doc';
  const TTL_MS = 5 * 60 * 1000;
  const cache = new Map();

  function cacheGet(key) {
    const c = cache.get(key);
    if (!c) return null;
    if (Date.now() - c.ts > TTL_MS) { cache.delete(key); return null; }
    return c.data;
  }
  function cacheSet(key, data) {
    cache.set(key, { ts: Date.now(), data });
  }

  // Curated theme chips the panel surfaces by default.
  // GDELT theme codes are flat strings — full list at:
  //   http://data.gdeltproject.org/api/v2/guides/LOOKUP-GKGTHEMES.TXT
  const THEMES = {
    FED:         'ECON_CENTRALBANK',
    INFLATION:   'ECON_INFLATION',
    IRAN:        'TAX_FNCACT_IRAN',
    HORMUZ:      'HORMUZ',
    SAUDI:       'TAX_FNCACT_SAUDI',
    ISRAEL:      'TAX_ETHNICITY_ISRAEL',
    RUSSIA:      'TAX_FNCACT_RUSSIA',
    UKRAINE:     'TAX_FNCACT_UKRAINE',
    CHINA:       'TAX_FNCACT_CHINA',
    TAIWAN:      'TAX_FNCACT_TAIWAN',
    NORTH_KOREA: 'TAX_FNCACT_NORTHKOREA',
    NUCLEAR:     'WMD',
    TARIFF:      'ECON_TAXATION',
    OIL:         'ENV_OILPRODUCTION',
    CYBER:       'CYBER_ATTACK',
  };

  // Default chip set surfaced in the UI — tuned for market-moving signals.
  const DEFAULT_CHIPS = [
    { key: 'all',     label: 'All',       query: '' },
    { key: 'fed',     label: 'Fed',       query: 'federal reserve OR fomc OR powell' },
    { key: 'iran',    label: 'Iran',      query: 'iran' },
    { key: 'israel',  label: 'Israel',    query: 'israel' },
    { key: 'russia',  label: 'Russia',    query: 'russia' },
    { key: 'ukraine', label: 'Ukraine',   query: 'ukraine' },
    { key: 'china',   label: 'China',     query: 'china' },
    { key: 'taiwan',  label: 'Taiwan',    query: 'taiwan' },
    { key: 'nkorea',  label: 'N Korea',   query: '"north korea"' },
    { key: 'oil',     label: 'Oil',       query: 'oil prices OR crude OR opec' },
    { key: 'tariff',  label: 'Tariffs',   query: 'tariff OR tariffs' },
    { key: 'crypto',  label: 'Crypto',    query: 'bitcoin OR ethereum OR crypto' },
  ];

  // Conflict-tone keyword banks — used for the heuristic fallback when GDELT
  // doesn't return numeric tone/goldstein inside the artlist payload.
  const WAR_WORDS = [
    'attack','strike','missile','drone','airstrike','invasion','troops','seized',
    'bomb','bombing','killed','casualties','clash','war','assault','escalation',
    'sanction','blockade','strait','captured','retaliation','raid','explosion','siege',
  ];
  const PEACE_WORDS = [
    'ceasefire','truce','deal','talks','negotiation','agreement','reopen','resume',
    'cooperation','summit','accord','release','meeting','normalization','deescalation',
  ];

  // Score a headline on a -10..+10 scale using simple keyword counts.
  // Negative = conflictual, positive = cooperative.
  function scoreConflict(title) {
    if (!title) return 0;
    const t = title.toLowerCase();
    let score = 0;
    for (const w of WAR_WORDS)   if (t.includes(w)) score -= 2;
    for (const w of PEACE_WORDS) if (t.includes(w)) score += 2;
    if (score < -10) score = -10;
    if (score > 10)  score = 10;
    return score;
  }

  // Parse tone string "5.23,8.5,12.1,4.2,1.3,55" → first value is AvgTone.
  function parseTone(v) {
    if (v == null) return null;
    if (typeof v === 'number') return v;
    const first = String(v).split(',')[0];
    const n = parseFloat(first);
    return isFinite(n) ? n : null;
  }

  function normalizeArticle(a) {
    if (!a) return null;
    const tone      = parseTone(a.tone ?? a.avgtone ?? a.avg_tone);
    const goldstein = typeof a.goldstein === 'number'
      ? a.goldstein
      : scoreConflict(a.title);
    return {
      url:       a.url || '',
      title:     (a.title || '').trim(),
      domain:    a.domain || '',
      seendate:  a.seendate || '',
      country:   a.sourcecountry || '',
      language:  a.language || '',
      image:     a.socialimage || '',
      tone,
      goldstein,
    };
  }

  // GDELT `seendate` is "YYYYMMDDTHHMMSSZ" — turn it into epoch ms.
  function parseSeenDate(s) {
    if (!s || s.length < 15) return 0;
    const iso = `${s.slice(0,4)}-${s.slice(4,6)}-${s.slice(6,8)}T${s.slice(9,11)}:${s.slice(11,13)}:${s.slice(13,15)}Z`;
    const d = new Date(iso);
    return isNaN(d.getTime()) ? 0 : d.getTime();
  }

  // --------------------------- SEARCH ---------------------------
  // opts: { timespan='1d', maxrecords=75, sort='hybridrel', sourcecountry, theme }
  async function search(query, opts = {}) {
    const q = (query || '').trim();
    const timespan   = opts.timespan   || '1d';
    const maxrecords = Math.min(250, Math.max(1, opts.maxrecords || 75));
    const sort       = opts.sort       || 'hybridrel';
    const theme      = opts.theme      || '';
    const country    = opts.sourcecountry || '';

    // GDELT requires a non-empty query. If the caller passed "", fall back
    // to a broad macro+geopolitical query so the panel always has data.
    const effectiveQuery = q || 'market OR economy OR conflict';
    const themeQ   = theme   ? ` theme:${theme}` : '';
    const countryQ = country ? ` sourcecountry:${country}` : '';
    const finalQ = `${effectiveQuery}${themeQ}${countryQ}`;

    const cacheKey = 'search:' + finalQ + ':' + timespan + ':' + maxrecords + ':' + sort;
    const cached = cacheGet(cacheKey);
    if (cached) return cached;

    const url = BASE + '?' + [
      'query=' + encodeURIComponent(finalQ),
      'mode=ArtList',
      'format=json',
      'sort=' + encodeURIComponent(sort),
      'maxrecords=' + maxrecords,
      'timespan=' + encodeURIComponent(timespan),
    ].join('&');

    let articles = [];
    try {
      const r = await fetch(url);
      if (r.ok) {
        // GDELT sometimes sends non-JSON HTML banners — guard the parse.
        const text = await r.text();
        let j = null;
        try { j = JSON.parse(text); } catch (_) { j = null; }
        if (j && Array.isArray(j.articles)) {
          articles = j.articles.map(normalizeArticle).filter(Boolean);
        }
      } else if (r.status === 429) {
        console.warn('[GDELTData] 429 rate-limit — will retry on next interval');
      }
    } catch (e) {
      console.warn('[GDELTData] search fetch failed:', e.message);
    }
    cacheSet(cacheKey, articles);
    return articles;
  }

  // Shortcut — themed ArtList search.
  async function getByTheme(theme, limit = 50) {
    const themeCode = THEMES[theme] || theme;
    return await search('', { theme: themeCode, maxrecords: limit });
  }

  // --------------------------- TRENDING EVENTS ---------------------------
  // Uses "mode=timelinesourcecountry" to get an aggregated source-country
  // timeseries for the top geopolitical terms. Returns a summary:
  //   { countries: [{ name, count }], lastUpdated }
  async function getTrendingEvents(opts = {}) {
    const timespan = opts.timespan || '1d';
    const query    = opts.query    || 'conflict OR attack OR war OR sanctions';
    const cacheKey = 'trend:' + query + ':' + timespan;
    const cached = cacheGet(cacheKey);
    if (cached) return cached;

    const url = BASE + '?' + [
      'query=' + encodeURIComponent(query),
      'mode=TimelineSourceCountry',
      'format=json',
      'timespan=' + encodeURIComponent(timespan),
    ].join('&');

    let summary = { countries: [], lastUpdated: Date.now() };
    try {
      const r = await fetch(url);
      if (r.ok) {
        const text = await r.text();
        let j = null;
        try { j = JSON.parse(text); } catch (_) { j = null; }
        // Timeline mode returns { timeline: [ { series, data: [{date,value}] } ] }
        if (j && Array.isArray(j.timeline)) {
          const countries = j.timeline.map(t => ({
            name: t.series || t.seriesalias || '—',
            count: (t.data || []).reduce((sum, d) => sum + (d.value || 0), 0),
          })).sort((a, b) => b.count - a.count).slice(0, 25);
          summary = { countries, lastUpdated: Date.now() };
        }
      }
    } catch (e) {
      console.warn('[GDELTData] trending fetch failed:', e.message);
    }
    cacheSet(cacheKey, summary);
    return summary;
  }

  function clearCache() { cache.clear(); }

  window.GDELTData = {
    THEMES,
    DEFAULT_CHIPS,
    search,
    getByTheme,
    getTrendingEvents,
    scoreConflict,
    parseSeenDate,
    clearCache,
  };
})();
