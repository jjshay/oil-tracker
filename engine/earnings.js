// engine/earnings.js — Earnings calendar + surprise tracker.
//
// Primary: Finnhub (free tier, key in window.TR_SETTINGS.keys.finnhub)
//   /calendar/earnings?from=YYYY-MM-DD&to=YYYY-MM-DD
//   /stock/earnings?symbol=…  (returns per-quarter beat/miss)
//
// Fallback: NASDAQ public JSON
//   https://api.nasdaq.com/api/calendar/earnings?date=YYYY-MM-DD
//
// Exposes window.EarningsData:
//   getUpcoming({ days })                 → Row[] sorted asc by date
//   getRecent({ days, beats })            → Row[] sorted desc by date
//                                             beats: true = positive surprises,
//                                                    false = misses, null = all
//   getSurprise(symbol)                   → { epsActual, epsEstimate, epsWhisper,
//                                             revenueActual, revenueEstimate,
//                                             surprise_pct }
//   HIGHLIGHT_SYMBOLS                     → { btc, megacap, energy }
//
// Row shape:
//   { symbol, date:'YYYY-MM-DD', hour:'bmo'|'amc'|'dmh'|'',
//     epsEstimate, epsActual, epsWhisper,
//     revenueEstimate, revenueActual,
//     surprise_pct, source }

(function () {
  if (typeof window === 'undefined') return;

  var CACHE_TTL_MS = 10 * 60 * 1000;
  var cache = {}; // { key: { data, fetchedAt } }

  // Highlight buckets used by the UI for color / emphasis.
  var HIGHLIGHT_SYMBOLS = {
    btc:     ['MSTR', 'COIN', 'MARA', 'IBIT', 'CLSK', 'RIOT', 'HUT', 'WULF', 'HOOD', 'SQ'],
    megacap: ['NVDA', 'TSLA', 'AAPL', 'MSFT', 'GOOGL', 'GOOG', 'AMZN', 'META'],
    energy:  ['XOM', 'CVX', 'COP', 'OXY', 'SLB', 'EOG', 'MPC', 'PSX', 'VLO'],
  };

  function resolveFinnhubKey() {
    try {
      var k = window.TR_SETTINGS && window.TR_SETTINGS.keys && window.TR_SETTINGS.keys.finnhub;
      if (typeof k === 'string' && k.trim()) return k.trim();
    } catch (_) {}
    return '';
  }

  function cget(key) {
    var e = cache[key];
    if (!e) return null;
    if (Date.now() - e.fetchedAt > CACHE_TTL_MS) return null;
    return e.data;
  }
  function cset(key, data) {
    cache[key] = { data: data, fetchedAt: Date.now() };
  }

  function fmtDate(d) {
    var dt = (d instanceof Date) ? d : new Date(d);
    var y = dt.getFullYear();
    var m = String(dt.getMonth() + 1).padStart(2, '0');
    var day = String(dt.getDate()).padStart(2, '0');
    return y + '-' + m + '-' + day;
  }
  function addDays(d, n) {
    var dt = new Date(d);
    dt.setDate(dt.getDate() + n);
    return dt;
  }

  // --- Finnhub calendar fetch -----------------------------------------
  async function fetchFinnhubRange(fromISO, toISO) {
    var key = resolveFinnhubKey();
    if (!key) return null;
    var url = 'https://finnhub.io/api/v1/calendar/earnings'
      + '?from=' + encodeURIComponent(fromISO)
      + '&to='   + encodeURIComponent(toISO)
      + '&token=' + encodeURIComponent(key);

    try {
      var r = await fetch(url);
      if (!r.ok) return null;
      var j = await r.json();
      if (!j || !Array.isArray(j.earningsCalendar)) return null;
      return j.earningsCalendar.map(function (row) {
        var est  = (row.epsEstimate != null) ? Number(row.epsEstimate) : null;
        var act  = (row.epsActual   != null) ? Number(row.epsActual)   : null;
        var surp = null;
        if (est != null && act != null && est !== 0) {
          surp = ((act - est) / Math.abs(est)) * 100;
        }
        return {
          symbol:          row.symbol,
          date:            row.date,
          hour:            row.hour || '',
          epsEstimate:     est,
          epsActual:       act,
          epsWhisper:      null, // Finnhub free doesn't ship whispers
          revenueEstimate: row.revenueEstimate != null ? Number(row.revenueEstimate) : null,
          revenueActual:   row.revenueActual   != null ? Number(row.revenueActual)   : null,
          surprise_pct:    surp,
          source:          'finnhub',
        };
      });
    } catch (e) {
      console.warn('[EarningsData] finnhub failed', e && e.message);
      return null;
    }
  }

  // --- NASDAQ fallback (single date) ----------------------------------
  async function fetchNasdaqDate(isoDate) {
    try {
      var url = 'https://api.nasdaq.com/api/calendar/earnings?date=' + isoDate;
      var r = await fetch(url, { headers: { 'Accept': 'application/json' } });
      if (!r.ok) return null;
      var j = await r.json();
      var rows = j && j.data && j.data.rows;
      if (!Array.isArray(rows)) return null;
      return rows.map(function (row) {
        var est = parseFloat(String(row.epsForecast || '').replace(/[$,]/g, ''));
        var act = parseFloat(String(row.eps         || '').replace(/[$,]/g, ''));
        var surp = null;
        if (isFinite(est) && isFinite(act) && est !== 0) {
          surp = ((act - est) / Math.abs(est)) * 100;
        }
        return {
          symbol:          row.symbol,
          date:            isoDate,
          hour:            (row.time || '').toLowerCase().indexOf('before') !== -1
                             ? 'bmo'
                             : (row.time || '').toLowerCase().indexOf('after') !== -1
                               ? 'amc' : '',
          epsEstimate:     isFinite(est) ? est : null,
          epsActual:       isFinite(act) ? act : null,
          epsWhisper:      null,
          revenueEstimate: null,
          revenueActual:   null,
          surprise_pct:    surp,
          source:          'nasdaq',
        };
      });
    } catch (e) {
      console.warn('[EarningsData] nasdaq failed', e && e.message);
      return null;
    }
  }

  async function fetchNasdaqRange(fromDate, toDate) {
    var rows = [];
    var d = new Date(fromDate);
    var end = new Date(toDate);
    var days = 0;
    while (d <= end && days < 30) {
      var iso = fmtDate(d);
      var r = await fetchNasdaqDate(iso);
      if (Array.isArray(r)) rows = rows.concat(r);
      d = addDays(d, 1);
      days++;
    }
    return rows;
  }

  // --- getUpcoming / getRecent ----------------------------------------
  async function getUpcoming(opts) {
    opts = opts || {};
    var days = Math.max(1, Math.min(30, opts.days || 7));
    var from = new Date();
    var to   = addDays(from, days);
    var key  = 'upcoming:' + fmtDate(from) + ':' + fmtDate(to);
    var hit  = cget(key);
    if (hit) return hit;

    var rows = await fetchFinnhubRange(fmtDate(from), fmtDate(to));
    if (!rows || !rows.length) {
      rows = (await fetchNasdaqRange(from, to)) || [];
    }
    rows.sort(function (a, b) { return (a.date || '').localeCompare(b.date || ''); });
    cset(key, rows);
    return rows;
  }

  async function getRecent(opts) {
    opts = opts || {};
    var days = Math.max(1, Math.min(30, opts.days || 7));
    var beats = (opts.beats === true || opts.beats === false) ? opts.beats : null;
    var to    = new Date();
    var from  = addDays(to, -days);
    var key   = 'recent:' + fmtDate(from) + ':' + fmtDate(to);
    var hit   = cget(key);
    var rows  = hit;
    if (!rows) {
      rows = await fetchFinnhubRange(fmtDate(from), fmtDate(to));
      if (!rows || !rows.length) {
        rows = (await fetchNasdaqRange(from, to)) || [];
      }
      cset(key, rows);
    }
    // Only keep rows with an actual print.
    var withActual = rows.filter(function (r) { return r.epsActual != null; });
    if (beats === true)  withActual = withActual.filter(function (r) { return (r.surprise_pct || 0) > 0; });
    if (beats === false) withActual = withActual.filter(function (r) { return (r.surprise_pct || 0) < 0; });
    withActual.sort(function (a, b) { return (b.date || '').localeCompare(a.date || ''); });
    return withActual;
  }

  async function getSurprise(symbol) {
    if (!symbol) return null;
    var key = 'surprise:' + symbol;
    var hit = cget(key);
    if (hit) return hit;

    var fk = resolveFinnhubKey();
    if (!fk) return null;

    try {
      var url = 'https://finnhub.io/api/v1/stock/earnings?symbol=' + encodeURIComponent(symbol)
              + '&token=' + encodeURIComponent(fk);
      var r = await fetch(url);
      if (!r.ok) return null;
      var j = await r.json();
      if (!Array.isArray(j) || !j.length) return null;
      var latest = j[0];
      var est = latest.estimate != null ? Number(latest.estimate) : null;
      var act = latest.actual   != null ? Number(latest.actual)   : null;
      var surp = (est != null && act != null && est !== 0) ? ((act - est) / Math.abs(est)) * 100 : null;
      var out = {
        symbol:          symbol,
        epsEstimate:     est,
        epsActual:       act,
        epsWhisper:      null,
        revenueEstimate: null,
        revenueActual:   null,
        surprise_pct:    surp,
        period:          latest.period || null,
      };
      cset(key, out);
      return out;
    } catch (e) {
      return null;
    }
  }

  function clearCache() { cache = {}; }

  window.EarningsData = {
    getUpcoming:        getUpcoming,
    getRecent:          getRecent,
    getSurprise:        getSurprise,
    HIGHLIGHT_SYMBOLS:  HIGHLIGHT_SYMBOLS,
    clearCache:         clearCache,
  };
})();
