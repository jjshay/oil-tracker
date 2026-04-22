// engine/treasury.js — U.S. Treasury auction + yield-curve data.
//
// Sources (all public, CORS-ok):
//   1. Treasury FiscalData — avg interest rates
//        https://api.fiscaldata.treasury.gov/services/api/fiscal_service/v2/accounting/od/avg_interest_rates
//      → proxies as "recent auctions" view (tenor, issue date, avg rate).
//   2. home.treasury.gov — daily Treasury par yield curve CSV
//        https://home.treasury.gov/resource-center/data-chart-center/interest-rates/daily-treasury-rates.csv/{year}/all?type=daily_treasury_yield_curve&field_tdr_date_value_month={yyyymm}&_format=csv
//      → today + ~30-day-ago curve for comparison.
//
// Exposes on window:
//   TreasuryData.getRecentAuctions(limit)  → [{ date, tenor, rate, security }, …] newest-first
//   TreasuryData.getYieldCurve()            → {
//     today:    { date, points: [{ tenor:'1M'|'3M'|…|'30Y', yield:number }, …] },
//     priorMo:  { date, points: [ … ] }                   // ~30 days prior
//   }
//   TreasuryData.TENORS                     → canonical tenor order for UI
//   TreasuryData.clearCache()               → void
//
// Cache: in-memory, 30-minute TTL.

(function () {
  if (typeof window === 'undefined') return;

  var CACHE_TTL_MS = 30 * 60 * 1000;
  var FD_BASE = 'https://api.fiscaldata.treasury.gov/services/api/fiscal_service/v2/accounting/od/avg_interest_rates';
  var YIELD_CURVE_BASE = 'https://home.treasury.gov/resource-center/data-chart-center/interest-rates/daily-treasury-rates.csv';

  // Canonical tenor rendering order (maps CSV column names → short labels).
  var TENOR_COLUMNS = [
    { col: '1 Mo',    label: '1M',  months: 1 },
    { col: '2 Mo',    label: '2M',  months: 2 },
    { col: '3 Mo',    label: '3M',  months: 3 },
    { col: '4 Mo',    label: '4M',  months: 4 },
    { col: '6 Mo',    label: '6M',  months: 6 },
    { col: '1 Yr',    label: '1Y',  months: 12 },
    { col: '2 Yr',    label: '2Y',  months: 24 },
    { col: '3 Yr',    label: '3Y',  months: 36 },
    { col: '5 Yr',    label: '5Y',  months: 60 },
    { col: '7 Yr',    label: '7Y',  months: 84 },
    { col: '10 Yr',   label: '10Y', months: 120 },
    { col: '20 Yr',   label: '20Y', months: 240 },
    { col: '30 Yr',   label: '30Y', months: 360 },
  ];

  var cache = {
    auctions: null,     // { data, fetchedAt }
    yieldCurve: null,   // { data, fetchedAt }
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

  // ---------- recent auctions (avg interest rates proxy) ----------
  async function getRecentAuctions(limit) {
    var cached = cacheGet('auctions');
    if (cached) return cached.slice(0, Math.max(1, Math.min(100, limit || 10)));

    var lim = Math.max(1, Math.min(100, limit || 10));
    // Over-fetch so we can filter to "Marketable" only and still return `lim` rows.
    var page = Math.max(60, lim * 4);
    var url = FD_BASE
      + '?page%5Bsize%5D=' + page
      + '&sort=-record_date';
    try {
      var resp = await fetch(url, { method: 'GET' });
      if (!resp.ok) return null;
      var json = await resp.json();
      if (!json || !Array.isArray(json.data)) return null;
      var rows = [];
      for (var i = 0; i < json.data.length; i++) {
        var r = json.data[i];
        if (!r) continue;
        if (r.security_type_desc !== 'Marketable') continue;
        var rate = parseFloat(r.avg_interest_rate_amt);
        if (!isFinite(rate)) continue;
        rows.push({
          date:     r.record_date,
          tenor:    r.security_desc || '',
          rate:     rate,
          security: r.security_desc || '',
          type:     r.security_type_desc,
        });
      }
      cacheSet('auctions', rows);
      return rows.slice(0, lim);
    } catch (_) {
      return null;
    }
  }

  // ---------- CSV ----------
  function splitCsvRow(line) {
    var out = [];
    var cur = '';
    var inQ = false;
    for (var i = 0; i < line.length; i++) {
      var ch = line[i];
      if (ch === '"') {
        if (inQ && line[i + 1] === '"') { cur += '"'; i++; continue; }
        inQ = !inQ;
        continue;
      }
      if (ch === ',' && !inQ) { out.push(cur); cur = ''; continue; }
      cur += ch;
    }
    out.push(cur);
    return out;
  }

  // "MM/DD/YYYY" → "YYYY-MM-DD"
  function parseDate(s) {
    if (!s) return null;
    var m = String(s).trim().match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
    if (!m) return null;
    return m[3] + '-' + pad2(parseInt(m[1], 10)) + '-' + pad2(parseInt(m[2], 10));
  }
  function pad2(n) { return n < 10 ? '0' + n : '' + n; }

  function monthParam(d) {
    var y = d.getUTCFullYear();
    var m = d.getUTCMonth() + 1;
    return '' + y + pad2(m);
  }

  // Fetch one month of yield-curve CSV rows, newest-first.
  async function fetchYieldCurveMonth(year, yyyymm) {
    var url = YIELD_CURVE_BASE
      + '/' + year + '/all'
      + '?type=daily_treasury_yield_curve'
      + '&field_tdr_date_value_month=' + yyyymm
      + '&_format=csv';
    try {
      var resp = await fetch(url, { method: 'GET' });
      if (!resp.ok) return null;
      var text = await resp.text();
      if (!text || text.length < 50) return null;
      return parseYieldCurveCSV(text);
    } catch (_) { return null; }
  }

  function parseYieldCurveCSV(text) {
    var lines = text.split(/\r?\n/).map(function (l) { return l.trim(); }).filter(Boolean);
    if (lines.length < 2) return null;
    var header = splitCsvRow(lines[0]).map(function (h) { return h.replace(/^"|"$/g, '').trim(); });
    var colIndex = {};
    for (var i = 0; i < header.length; i++) colIndex[header[i]] = i;
    var rows = [];
    for (var r = 1; r < lines.length; r++) {
      var cells = splitCsvRow(lines[r]).map(function (c) { return c.replace(/^"|"$/g, '').trim(); });
      var dateISO = parseDate(cells[colIndex['Date']]);
      if (!dateISO) continue;
      var points = [];
      for (var t = 0; t < TENOR_COLUMNS.length; t++) {
        var tc = TENOR_COLUMNS[t];
        var idx = colIndex[tc.col];
        if (idx == null) continue;
        var raw = cells[idx];
        var n = parseFloat(raw);
        if (!isFinite(n)) continue;
        points.push({ tenor: tc.label, months: tc.months, yield: n });
      }
      if (points.length) rows.push({ date: dateISO, points: points });
    }
    // Newest-first.
    rows.sort(function (a, b) { return a.date < b.date ? 1 : a.date > b.date ? -1 : 0; });
    return rows;
  }

  async function getYieldCurve() {
    var cached = cacheGet('yieldCurve');
    if (cached) return cached;

    var now = new Date();
    var yyyy = now.getUTCFullYear();
    var yyyymmNow = monthParam(now);
    var prior = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - 1, 15));
    var yyyyPrior = prior.getUTCFullYear();
    var yyyymmPrior = monthParam(prior);

    var parts = await Promise.all([
      fetchYieldCurveMonth(yyyy, yyyymmNow),
      fetchYieldCurveMonth(yyyyPrior, yyyymmPrior),
    ]);

    var combined = [];
    if (parts[0]) combined = combined.concat(parts[0]);
    if (parts[1]) combined = combined.concat(parts[1]);
    if (!combined.length) return null;
    // Dedupe by date, newest-first.
    var seen = {};
    var rows = [];
    for (var i = 0; i < combined.length; i++) {
      if (seen[combined[i].date]) continue;
      seen[combined[i].date] = true;
      rows.push(combined[i]);
    }
    rows.sort(function (a, b) { return a.date < b.date ? 1 : a.date > b.date ? -1 : 0; });
    if (!rows.length) return null;

    var today = rows[0];
    // Target: ~30 calendar days before today.date
    var todayMs = Date.parse(today.date + 'T00:00:00Z');
    var priorRow = null;
    var bestDiff = Infinity;
    for (var j = 0; j < rows.length; j++) {
      var ms = Date.parse(rows[j].date + 'T00:00:00Z');
      var diff = Math.abs((todayMs - ms) - (30 * 86400000));
      if (todayMs - ms >= 15 * 86400000 && diff < bestDiff) {
        bestDiff = diff;
        priorRow = rows[j];
      }
    }
    // Fallback: last row we have.
    if (!priorRow) priorRow = rows[rows.length - 1];

    var data = { today: today, priorMo: priorRow, allRows: rows };
    cacheSet('yieldCurve', data);
    return data;
  }

  function clearCache() {
    cache = { auctions: null, yieldCurve: null };
  }

  window.TreasuryData = {
    getRecentAuctions: getRecentAuctions,
    getYieldCurve:     getYieldCurve,
    TENORS:            TENOR_COLUMNS.map(function (t) { return t.label; }),
    clearCache:        clearCache,
  };
})();
