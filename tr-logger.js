// tr-logger.js — Runtime ring-buffer logger for fetch/cache activity.
// Exposes: window.TRLogger with push/entries/clear/subscribe.
//
// Each entry is normalized to:
//   { ts, kind, method, url, status, ms, cached, error }
//
//   kind   — 'fetch' | 'cache' | 'stale' | 'error' | custom string
//   method — 'GET' | 'POST' | etc. (defaults to 'GET')
//   status — numeric HTTP status, 0 if network error
//   ms     — round-trip ms (0 for cache hits)
//   cached — boolean; true if served from cache/stale
//   error  — optional error message string
//
// Buffer capped at 100; entries() returns newest-first.

(function () {
  const CAP = 100;
  const buf = [];          // append-only; trimmed to CAP from the head
  const listeners = new Set();

  function normalize(raw) {
    raw = raw || {};
    return {
      ts: typeof raw.ts === 'number' ? raw.ts : Date.now(),
      kind: raw.kind || 'fetch',
      method: raw.method || 'GET',
      url: raw.url || '',
      status: typeof raw.status === 'number' ? raw.status : 0,
      ms: typeof raw.ms === 'number' ? raw.ms : 0,
      cached: !!raw.cached,
      error: raw.error || null,
    };
  }

  function push(raw) {
    const entry = normalize(raw);
    buf.push(entry);
    if (buf.length > CAP) buf.splice(0, buf.length - CAP);
    listeners.forEach((fn) => {
      try { fn(entry); } catch { /* swallow listener errors */ }
    });
    return entry;
  }

  function entries() {
    // Newest first.
    return buf.slice().reverse();
  }

  function clear() {
    buf.length = 0;
    listeners.forEach((fn) => {
      try { fn(null); } catch { /* ignore */ }
    });
  }

  function subscribe(fn) {
    if (typeof fn !== 'function') return () => {};
    listeners.add(fn);
    return () => listeners.delete(fn);
  }

  window.TRLogger = { push, entries, clear, subscribe };
})();
