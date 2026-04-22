// tr-cache.js — Shared fetch cache with LRU + TTL + 429 backoff + in-flight dedupe.
// Exposes: window.trFetch(url, opts)
//
// Behavior:
//   - LRU cache keyed by `${method} ${url} ${body}` with TTL (default 30s).
//     Override per-call via opts.cacheMs.
//   - In-flight dedupe: concurrent calls with the same key share one promise.
//   - On HTTP 429: reads Retry-After (seconds) or defaults to 60s, schedules a
//     background retry, returns the stale cached response (cloned) if available,
//     else throws an Error with { rateLimited: true, retryAfter } fields.
//   - Max 200 entries, evicts oldest on overflow.
//   - Logs every fetch / cache-hit / error through window.TRLogger if present.
//
// Note: returns a Response-like object. For cache hits we return a fresh
// Response clone so callers can .json() / .text() as normal.

(function () {
  const DEFAULT_TTL = 30 * 1000;
  const DEFAULT_RETRY_AFTER = 60 * 1000;
  const MAX_ENTRIES = 200;

  // Map preserves insertion order → oldest entry is first key.
  const cache = new Map();         // key → { body, init, expires, storedAt }
  const inflight = new Map();      // key → Promise<Response>
  const retryTimers = new Map();   // key → timeout id

  const now = () => Date.now();

  function buildKey(url, opts) {
    const method = (opts && opts.method) || 'GET';
    let bodyKey = '';
    if (opts && opts.body) {
      try { bodyKey = typeof opts.body === 'string' ? opts.body : JSON.stringify(opts.body); }
      catch { bodyKey = String(opts.body); }
    }
    return `${method} ${url} ${bodyKey}`;
  }

  function touch(key, entry) {
    // Re-insert to move to newest slot.
    cache.delete(key);
    cache.set(key, entry);
  }

  function evictIfNeeded() {
    while (cache.size > MAX_ENTRIES) {
      const firstKey = cache.keys().next().value;
      if (firstKey === undefined) break;
      cache.delete(firstKey);
    }
  }

  function storeResponse(key, response, ttl) {
    // Snapshot the body so we can replay it. We read as ArrayBuffer to be
    // content-type-agnostic; callers can still call .json() on the replay.
    return response.clone().arrayBuffer().then((buf) => {
      const entry = {
        body: buf,
        init: {
          status: response.status,
          statusText: response.statusText,
          headers: Array.from(response.headers.entries()),
        },
        expires: now() + ttl,
        storedAt: now(),
      };
      touch(key, entry);
      evictIfNeeded();
      return response;
    }).catch(() => response);
  }

  function replayFromEntry(entry) {
    const headers = new Headers(entry.init.headers);
    return new Response(entry.body.slice(0), {
      status: entry.init.status,
      statusText: entry.init.statusText,
      headers,
    });
  }

  function parseRetryAfter(response) {
    const h = response.headers.get('retry-after') || response.headers.get('Retry-After');
    if (!h) return DEFAULT_RETRY_AFTER;
    const asNum = Number(h);
    if (!Number.isNaN(asNum) && asNum > 0) return Math.round(asNum * 1000);
    // Date form.
    const t = Date.parse(h);
    if (!Number.isNaN(t)) return Math.max(1000, t - now());
    return DEFAULT_RETRY_AFTER;
  }

  function scheduleRetry(key, url, opts, ttl, delayMs) {
    if (retryTimers.has(key)) return; // Already scheduled.
    const id = setTimeout(() => {
      retryTimers.delete(key);
      // Fire-and-forget refresh; will populate cache on success.
      doFetch(key, url, opts, ttl).catch(() => { /* swallow */ });
    }, delayMs);
    retryTimers.set(key, id);
  }

  function log(entry) {
    try {
      if (window.TRLogger && typeof window.TRLogger.push === 'function') {
        window.TRLogger.push(entry);
      }
    } catch { /* ignore */ }
  }

  function methodOf(opts) { return (opts && opts.method) || 'GET'; }

  function doFetch(key, url, opts, ttl) {
    if (inflight.has(key)) return inflight.get(key);
    const t0 = now();
    const promise = window.fetch(url, opts).then(async (res) => {
      const ms = now() - t0;
      if (res.status === 429) {
        const retryAfter = parseRetryAfter(res);
        log({ kind: 'fetch', url, method: methodOf(opts), status: 429, ms, cached: false, error: `rate limited; retry in ${Math.round(retryAfter / 1000)}s` });
        scheduleRetry(key, url, opts, ttl, retryAfter);
        const stale = cache.get(key);
        if (stale) {
          touch(key, stale); // Mark as recently used even though stale.
          log({ kind: 'stale', url, method: methodOf(opts), status: stale.init.status, ms: 0, cached: true, error: '429 served stale' });
          return replayFromEntry(stale);
        }
        const err = new Error(`429 rate limited; retry in ${Math.round(retryAfter / 1000)}s`);
        err.rateLimited = true;
        err.retryAfter = retryAfter;
        throw err;
      }
      log({ kind: 'fetch', url, method: methodOf(opts), status: res.status, ms, cached: false });
      if (res.ok) await storeResponse(key, res, ttl);
      return res;
    }).catch((err) => {
      if (!err || !err.rateLimited) {
        log({ kind: 'fetch', url, method: methodOf(opts), status: 0, ms: now() - t0, cached: false, error: err && err.message ? err.message : String(err) });
      }
      throw err;
    }).finally(() => {
      inflight.delete(key);
    });
    inflight.set(key, promise);
    return promise;
  }

  function trFetch(url, opts) {
    opts = opts || {};
    const ttl = typeof opts.cacheMs === 'number' ? opts.cacheMs : DEFAULT_TTL;
    const method = methodOf(opts);
    const key = buildKey(url, opts);

    // Fresh cache hit — only for idempotent GET/HEAD by default.
    const cached = cache.get(key);
    const fresh = cached && cached.expires > now();
    const isIdempotent = method === 'GET' || method === 'HEAD';
    if (fresh && isIdempotent) {
      touch(key, cached);
      log({ kind: 'cache', url, method, status: cached.init.status, ms: 0, cached: true });
      return Promise.resolve(replayFromEntry(cached));
    }

    return doFetch(key, url, opts, ttl);
  }

  window.trFetch = trFetch;

  // Diagnostic helpers (non-public surface but handy).
  window.__trCache = {
    size: () => cache.size,
    keys: () => Array.from(cache.keys()),
    clear: () => { cache.clear(); inflight.clear(); retryTimers.forEach(clearTimeout); retryTimers.clear(); },
  };
})();
