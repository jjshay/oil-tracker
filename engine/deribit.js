// engine/deribit.js — Deribit options intelligence (fully public, no API key).
//
// Exposes window.DeribitData with:
//   getIndexPrice(currency='BTC')          -> number (spot-ish index)
//   getDVOL(currency='BTC', days=30)       -> { current, series:[{t,o,h,l,c}], atmIv, hv30 }
//   getPutCallRatio(currency='BTC')        -> { oiRatio, volRatio, puts_oi, calls_oi,
//                                              puts_vol, calls_vol }
//   getTermStructure(currency='BTC')       -> [{ expiry, expiryMs, daysToExp, atmIv,
//                                                callIv, putIv, instruments }]
//   getSkew(currency='BTC', expiry=null)   -> { expiry, daysToExp, skew, callIv25, putIv25 }
//                                              (if expiry omitted returns the nearest)
//   getSkewAll(currency='BTC')             -> [{ expiry, daysToExp, skew, callIv25, putIv25 }]
//   getBiggestFlows(currency='BTC', limit=20)
//       -> [{ instrument, strike, expiry, daysToExp, type:'C'|'P',
//              oi, iv, mark, underlying, notional_usd, volume_usd }]
//
// All endpoints are public GET + CORS-friendly:
//   https://www.deribit.com/api/v2/public/get_volatility_index_data
//   https://www.deribit.com/api/v2/public/get_book_summary_by_currency
//   https://www.deribit.com/api/v2/public/get_index_price
//
// Caching: book summary 45s, DVOL 120s, index 20s.

(function () {
  if (typeof window === 'undefined') return;

  const BOOK_TTL_MS  = 45 * 1000;
  const DVOL_TTL_MS  = 120 * 1000;
  const INDEX_TTL_MS = 20 * 1000;
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
    const to = setTimeout(() => ctl.abort(), opts.timeout || 8000);
    try {
      const r = await fetch(url, { signal: ctl.signal, cache: 'no-store' });
      if (!r.ok) throw new Error('HTTP ' + r.status);
      const j = await r.json();
      if (j && j.error) throw new Error('deribit: ' + (j.error.message || JSON.stringify(j.error)));
      return j;
    } finally {
      clearTimeout(to);
    }
  }

  function norm(ccy) {
    const c = String(ccy || 'BTC').toUpperCase();
    return (c === 'ETH') ? 'ETH' : 'BTC';
  }

  // ---------- index price ----------
  async function getIndexPrice(ccy) {
    const c = norm(ccy);
    const key = 'idx:' + c;
    const cached = cacheGet(key, INDEX_TTL_MS);
    if (cached != null) return cached;
    const j = await jget('https://www.deribit.com/api/v2/public/get_index_price?index_name=' +
                         c.toLowerCase() + '_usd');
    const p = j && j.result && Number(j.result.index_price);
    if (isFinite(p)) cacheSet(key, p);
    return p;
  }

  // ---------- book summary (all option contracts for a currency) ----------
  async function getBookSummary(ccy) {
    const c = norm(ccy);
    const key = 'book:' + c;
    const cached = cacheGet(key, BOOK_TTL_MS);
    if (cached) return cached;
    const j = await jget('https://www.deribit.com/api/v2/public/get_book_summary_by_currency?currency=' +
                         c + '&kind=option');
    const rows = (j && j.result) || [];
    cacheSet(key, rows);
    return rows;
  }

  // ---------- DVOL (volatility index) ----------
  // Deribit get_volatility_index_data returns an OHLC-like array:
  // data = [[timestampMs, open, high, low, close], ...]
  async function getDVOL(ccy, days) {
    const c = norm(ccy);
    const d = Math.max(1, Math.min(180, Number(days) || 30));
    const key = 'dvol:' + c + ':' + d;
    const cached = cacheGet(key, DVOL_TTL_MS);
    if (cached) return cached;

    const end = Date.now();
    const start = end - d * 86400 * 1000;
    // 1h buckets keep the payload manageable for 30d (~720 rows).
    const j = await jget('https://www.deribit.com/api/v2/public/get_volatility_index_data?currency=' + c +
                         '&resolution=3600&start_timestamp=' + start + '&end_timestamp=' + end);
    const raw = (j && j.result && j.result.data) || [];
    const series = raw.map(function (row) {
      return { t: Number(row[0]), o: Number(row[1]), h: Number(row[2]),
               l: Number(row[3]), c: Number(row[4]) };
    }).filter(function (r) { return isFinite(r.c); });
    const current = series.length ? series[series.length - 1].c : null;

    // Historical vol from DVOL isn't quite HV — DVOL *is* the 30d forward IV
    // index. We still compute a rough "realized vol" proxy = stdev of log
    // returns on the DVOL series itself for a comparison chip.
    let hv30 = null;
    if (series.length > 10) {
      const rets = [];
      for (let i = 1; i < series.length; i++) {
        const a = series[i - 1].c, b = series[i].c;
        if (a > 0 && b > 0) rets.push(Math.log(b / a));
      }
      if (rets.length) {
        const mean = rets.reduce(function (s, x) { return s + x; }, 0) / rets.length;
        const variance = rets.reduce(function (s, x) { return s + (x - mean) * (x - mean); }, 0) / rets.length;
        hv30 = Math.sqrt(variance) * Math.sqrt(24 * 365) * 100;
      }
    }

    // ATM IV = pull from book summary, pick the nearest-expiry ATM call/put mark_iv.
    let atmIv = null;
    try {
      const idx = await getIndexPrice(c);
      const book = await getBookSummary(c);
      if (idx && book && book.length) {
        const parsed = book.map(parseInstrument)
          .filter(function (x) { return x && x.daysToExp >= 0 && isFinite(x.iv); });
        // Group by expiry; pick nearest; take strike closest to idx; avg call+put IV.
        const byExp = {};
        parsed.forEach(function (x) {
          const k = x.expiry;
          if (!byExp[k]) byExp[k] = [];
          byExp[k].push(x);
        });
        const expiries = Object.keys(byExp).map(function (k) {
          return { expiry: k, daysToExp: byExp[k][0].daysToExp };
        }).sort(function (a, b) { return a.daysToExp - b.daysToExp; });
        if (expiries.length) {
          const near = byExp[expiries[0].expiry];
          near.sort(function (a, b) {
            return Math.abs(a.strike - idx) - Math.abs(b.strike - idx);
          });
          const atmStrike = near[0].strike;
          const sameStrike = near.filter(function (x) { return x.strike === atmStrike; });
          if (sameStrike.length) {
            const ivs = sameStrike.map(function (x) { return x.iv; }).filter(isFinite);
            if (ivs.length) atmIv = ivs.reduce(function (s, x) { return s + x; }, 0) / ivs.length;
          }
        }
      }
    } catch (_) {}

    const out = { current, series, atmIv, hv30 };
    cacheSet(key, out);
    return out;
  }

  // ---------- instrument parser ----------
  // Deribit instrument names: BTC-25DEC26-80000-C / BTC-25DEC26-80000-P
  const MON = { JAN:0, FEB:1, MAR:2, APR:3, MAY:4, JUN:5,
                JUL:6, AUG:7, SEP:8, OCT:9, NOV:10, DEC:11 };
  function parseInstrument(row) {
    if (!row || !row.instrument_name) return null;
    const parts = row.instrument_name.split('-');
    if (parts.length !== 4) return null;
    const [, expRaw, strikeRaw, type] = parts;
    const m = /^(\d{1,2})([A-Z]{3})(\d{2})$/.exec(expRaw);
    if (!m) return null;
    const day = Number(m[1]);
    const mon = MON[m[2]];
    const yr  = 2000 + Number(m[3]);
    if (mon == null) return null;
    // Deribit options expire at 08:00 UTC on expiry date.
    const expiryMs = Date.UTC(yr, mon, day, 8, 0, 0);
    const nowMs = Date.now();
    const daysToExp = (expiryMs - nowMs) / 86400000;
    const strike = Number(strikeRaw);
    const t = (type === 'C') ? 'C' : (type === 'P' ? 'P' : null);
    if (!t) return null;
    // mark_iv on Deribit is already in percent (e.g. 47.74 = 47.74% IV).
    return {
      instrument: row.instrument_name,
      expiry: expRaw,
      expiryMs,
      daysToExp,
      strike,
      type: t,
      iv: Number(row.mark_iv),
      mark: Number(row.mark_price),
      oi: Number(row.open_interest),
      volume: Number(row.volume),
      volume_usd: Number(row.volume_usd),
      underlying: Number(row.underlying_price) || Number(row.estimated_delivery_price) || null,
      bid: Number(row.bid_price),
      ask: Number(row.ask_price),
    };
  }

  // ---------- put/call ratio ----------
  async function getPutCallRatio(ccy) {
    const c = norm(ccy);
    const book = await getBookSummary(c);
    const parsed = book.map(parseInstrument).filter(Boolean);
    let putsOi = 0, callsOi = 0, putsVol = 0, callsVol = 0;
    parsed.forEach(function (x) {
      const oi = isFinite(x.oi) ? x.oi : 0;
      const v  = isFinite(x.volume) ? x.volume : 0;
      if (x.type === 'P') { putsOi += oi; putsVol += v; }
      else                { callsOi += oi; callsVol += v; }
    });
    return {
      oiRatio:  callsOi  > 0 ? putsOi  / callsOi  : null,
      volRatio: callsVol > 0 ? putsVol / callsVol : null,
      puts_oi: putsOi, calls_oi: callsOi,
      puts_vol: putsVol, calls_vol: callsVol,
    };
  }

  // ---------- term structure: IV by expiry ----------
  // For each expiry, ATM IV ≈ avg(mark_iv) of the call+put closest to the
  // underlying price (or the index price if underlying is missing).
  async function getTermStructure(ccy) {
    const c = norm(ccy);
    const [idx, book] = await Promise.all([getIndexPrice(c), getBookSummary(c)]);
    const parsed = book.map(parseInstrument)
      .filter(function (x) { return x && x.daysToExp >= 0 && isFinite(x.iv); });
    const groups = {};
    parsed.forEach(function (x) {
      const k = x.expiry;
      if (!groups[k]) groups[k] = [];
      groups[k].push(x);
    });
    const out = Object.keys(groups).map(function (k) {
      const list = groups[k];
      const under = list[0].underlying || idx;
      // strike closest to underlying
      const withDist = list.slice().sort(function (a, b) {
        return Math.abs(a.strike - under) - Math.abs(b.strike - under);
      });
      const atmStrike = withDist[0].strike;
      const atStrike = list.filter(function (x) { return x.strike === atmStrike; });
      const calls = atStrike.filter(function (x) { return x.type === 'C'; });
      const puts  = atStrike.filter(function (x) { return x.type === 'P'; });
      const avg = function (arr) {
        const vs = arr.map(function (x) { return x.iv; }).filter(isFinite);
        return vs.length ? vs.reduce(function (s, x) { return s + x; }, 0) / vs.length : null;
      };
      return {
        expiry: k,
        expiryMs: list[0].expiryMs,
        daysToExp: list[0].daysToExp,
        atmStrike,
        atmIv: avg(atStrike),
        callIv: avg(calls),
        putIv:  avg(puts),
        instruments: list.length,
      };
    }).filter(function (x) { return isFinite(x.atmIv); })
      .sort(function (a, b) { return a.daysToExp - b.daysToExp; });
    return out;
  }

  // ---------- 25-delta skew ----------
  // Without per-contract delta we approximate 25d strikes as the strike whose
  // mark is ~0.25 of underlying for a call (similarly for a put, in reverse).
  // Deribit mark_price for options is quoted in units of the underlying, so
  // a call mark of ~0.25 means "about 25% of underlying" — a reasonable proxy
  // for 25-delta in a browser context without full greeks.
  // Skew25 = putIv25 - callIv25 (positive = puts richer = bearish skew).
  function skewForExpiry(group) {
    const calls = group.filter(function (x) { return x.type === 'C' && isFinite(x.iv) && isFinite(x.mark); });
    const puts  = group.filter(function (x) { return x.type === 'P' && isFinite(x.iv) && isFinite(x.mark); });
    if (!calls.length || !puts.length) return null;
    // Calls: low-delta = OTM (high strike), mark small. Find mark closest to 0.25.
    const pickClosest = function (arr, target) {
      let best = null, bestD = Infinity;
      arr.forEach(function (x) {
        const d = Math.abs(x.mark - target);
        if (d < bestD) { bestD = d; best = x; }
      });
      return best;
    };
    const c25 = pickClosest(calls, 0.25);
    const p25 = pickClosest(puts,  0.25);
    if (!c25 || !p25) return null;
    return {
      expiry: group[0].expiry,
      expiryMs: group[0].expiryMs,
      daysToExp: group[0].daysToExp,
      callIv25: c25.iv,
      putIv25:  p25.iv,
      skew:     p25.iv - c25.iv,
      callStrike: c25.strike,
      putStrike:  p25.strike,
    };
  }

  async function getSkewAll(ccy) {
    const c = norm(ccy);
    const book = await getBookSummary(c);
    const parsed = book.map(parseInstrument).filter(Boolean);
    const groups = {};
    parsed.forEach(function (x) {
      const k = x.expiry;
      if (!groups[k]) groups[k] = [];
      groups[k].push(x);
    });
    const out = Object.keys(groups)
      .map(function (k) { return skewForExpiry(groups[k]); })
      .filter(Boolean)
      .sort(function (a, b) { return a.daysToExp - b.daysToExp; });
    return out;
  }

  async function getSkew(ccy, expiry) {
    const all = await getSkewAll(ccy);
    if (!all.length) return null;
    if (!expiry) return all[0];
    const match = all.filter(function (x) { return x.expiry === expiry; });
    return match.length ? match[0] : all[0];
  }

  // ---------- biggest open interest (USD notional) ----------
  async function getBiggestFlows(ccy, limit) {
    const c = norm(ccy);
    const n = Math.max(1, Math.min(100, Number(limit) || 20));
    const [idx, book] = await Promise.all([getIndexPrice(c), getBookSummary(c)]);
    const parsed = book.map(parseInstrument).filter(Boolean);
    const rows = parsed.map(function (x) {
      const under = x.underlying || idx || 0;
      const oi = isFinite(x.oi) ? x.oi : 0;
      const notional_usd = oi * under;
      const volume_usd = isFinite(x.volume_usd) ? x.volume_usd : 0;
      return {
        instrument: x.instrument,
        strike: x.strike,
        expiry: x.expiry,
        expiryMs: x.expiryMs,
        daysToExp: x.daysToExp,
        type: x.type,
        oi,
        iv: x.iv,
        mark: x.mark,
        underlying: under,
        notional_usd,
        volume_usd,
      };
    }).filter(function (r) { return r.oi > 0 && r.daysToExp >= 0; });
    rows.sort(function (a, b) { return b.notional_usd - a.notional_usd; });
    return rows.slice(0, n);
  }

  window.DeribitData = {
    getIndexPrice,
    getDVOL,
    getPutCallRatio,
    getTermStructure,
    getSkew,
    getSkewAll,
    getBiggestFlows,
    _parseInstrument: parseInstrument,
  };
})();
