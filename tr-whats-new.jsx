// tr-whats-new.jsx — "What's new since last visit" helper for TradeRadar.
//
// Tracks per-tile state across sessions in localStorage. Flags tiles whose
// direction FLIPPED (long <-> short/neutral) or whose numeric value changed
// by more than 5% since the user's last visit.
//
// Exposes:
//   window.TRWhatsNew.recordTileState(tileId, { signal, value })
//   window.TRWhatsNew.getDiff(tileId, { signal, value }) -> null | diff
//   window.TRWhatsNew.Badge({ diff, T })                  React component
//   window.TRWhatsNew.NewRing()                           style object
//   window.TRWhatsNew.markAllSeen()                       clear "new" flags
//   window.TRWhatsNew.bumpVisit()                         update last-visit ts
//
// Storage keys:
//   tr_tile_state_v1  — { [tileId]: { value, signal, seenAt } }
//   tr_last_visit_v1  — ISO ms timestamp of the previous visit

(function () {
  const STATE_KEY = 'tr_tile_state_v1';
  const VISIT_KEY = 'tr_last_visit_v1';
  const PCT_THRESHOLD = 5;      // percent
  const MAX_ENTRIES = 500;
  const SESSION_START = Date.now();

  function safeParse(raw) {
    if (!raw) return {};
    try { const j = JSON.parse(raw); return (j && typeof j === 'object') ? j : {}; }
    catch (_) { return {}; }
  }

  function readState() {
    try { return safeParse(localStorage.getItem(STATE_KEY)); }
    catch (_) { return {}; }
  }

  function writeState(obj) {
    try {
      // Cap size: if over MAX_ENTRIES, drop oldest by seenAt.
      const keys = Object.keys(obj);
      if (keys.length > MAX_ENTRIES) {
        const sorted = keys
          .map(k => ({ k, t: Number(obj[k] && obj[k].seenAt) || 0 }))
          .sort((a, b) => a.t - b.t);
        const drop = sorted.slice(0, keys.length - MAX_ENTRIES);
        for (const d of drop) delete obj[d.k];
      }
      localStorage.setItem(STATE_KEY, JSON.stringify(obj));
    } catch (_) { /* quota or disabled */ }
  }

  function recordTileState(tileId, payload) {
    if (!tileId || !payload || typeof payload !== 'object') return;
    const s = readState();
    s[String(tileId)] = {
      value: (typeof payload.value === 'number' && isFinite(payload.value)) ? payload.value : null,
      signal: payload.signal || 'neutral',
      seenAt: Date.now(),
    };
    writeState(s);
  }

  function pctChange(prev, curr) {
    if (typeof prev !== 'number' || typeof curr !== 'number') return 0;
    if (!isFinite(prev) || !isFinite(curr) || prev === 0) return 0;
    return ((curr - prev) / Math.abs(prev)) * 100;
  }

  function sinceLabel(ts) {
    if (!ts) return '';
    const diff = Math.max(0, Date.now() - ts);
    const h = diff / 3600000;
    if (h < 1) {
      const m = Math.max(1, Math.round(diff / 60000));
      return m + 'm ago';
    }
    if (h < 24) return Math.round(h) + 'h ago';
    const d = Math.round(h / 24);
    return d + 'd ago';
  }

  function getDiff(tileId, current) {
    if (!tileId || !current || typeof current !== 'object') return null;
    const s = readState();
    const prev = s[String(tileId)];
    if (!prev) return null;

    // Ignore state that was recorded within this same session — we only
    // flag tiles whose prior state predates the current visit.
    const prevSeenAt = Number(prev.seenAt) || 0;
    if (prevSeenAt >= SESSION_START) return null;

    const prevSignal = prev.signal || 'neutral';
    const currSignal = current.signal || 'neutral';
    const flipped = prevSignal !== currSignal;

    const pv = (typeof prev.value === 'number' && isFinite(prev.value)) ? prev.value : null;
    const cv = (typeof current.value === 'number' && isFinite(current.value)) ? current.value : null;
    const pc = (pv != null && cv != null) ? pctChange(pv, cv) : 0;

    const meaningful = flipped || Math.abs(pc) > PCT_THRESHOLD;
    if (!meaningful) return null;

    return {
      prevSignal,
      prevValue: pv,
      flipped,
      pctChange: pc,
      since: sinceLabel(prevSeenAt),
    };
  }

  function markAllSeen() {
    const s = readState();
    const now = Date.now();
    for (const k of Object.keys(s)) {
      if (s[k] && typeof s[k] === 'object') s[k].seenAt = now;
    }
    writeState(s);
  }

  function bumpVisit() {
    try {
      const prev = localStorage.getItem(VISIT_KEY);
      localStorage.setItem(VISIT_KEY, String(Date.now()));
      return prev ? Number(prev) : null;
    } catch (_) { return null; }
  }

  function NewRing() {
    return { boxShadow: '0 0 0 1.5px #c9a22766, 0 0 14px #c9a22744' };
  }

  const PILL_BASE = {
    padding: '1px 6px',
    borderRadius: 3,
    fontSize: 8.5,
    fontWeight: 700,
    letterSpacing: 0.6,
    fontFamily: '"JetBrains Mono", ui-monospace, "SF Mono", Menlo, Consolas, monospace',
    display: 'inline-flex',
    alignItems: 'center',
    lineHeight: 1.3,
    whiteSpace: 'nowrap',
  };

  const FLIPPED_STYLE = {
    background: 'rgba(201,162,39,0.22)',
    border: '0.5px solid rgba(201,162,39,0.55)',
    color: '#c9a227',
  };

  const MOVED_STYLE = {
    background: 'rgba(180,188,200,0.14)',
    border: '0.5px solid rgba(180,188,200,0.35)',
    color: 'rgba(180,188,200,0.85)',
  };

  function Badge(props) {
    const diff = props && props.diff;
    if (!diff) return null;
    if (typeof React === 'undefined') return null;

    if (diff.flipped) {
      const tip = 'was ' + (diff.prevSignal || 'neutral') + ', now ' +
        (diff.pctChange != null ? 'updated' : 'changed') +
        (diff.since ? ' — ' + diff.since : '');
      return React.createElement(
        'span',
        { title: tip, style: Object.assign({}, PILL_BASE, FLIPPED_STYLE) },
        'NEW \u00B7 flipped'
      );
    }

    if (Math.abs(diff.pctChange || 0) > PCT_THRESHOLD) {
      const sign = diff.pctChange >= 0 ? '+' : '-';
      const mag = Math.abs(diff.pctChange).toFixed(
        Math.abs(diff.pctChange) >= 10 ? 0 : 1
      );
      const txt = sign + mag + '% since ' + (diff.since || 'last visit');
      return React.createElement(
        'span',
        { title: 'Moved ' + sign + mag + '% since ' + (diff.since || 'last visit'),
          style: Object.assign({}, PILL_BASE, MOVED_STYLE) },
        txt
      );
    }

    return null;
  }

  window.TRWhatsNew = {
    recordTileState: recordTileState,
    getDiff: getDiff,
    Badge: Badge,
    NewRing: NewRing,
    markAllSeen: markAllSeen,
    bumpVisit: bumpVisit,
    _SESSION_START: SESSION_START,
    _STATE_KEY: STATE_KEY,
    _VISIT_KEY: VISIT_KEY,
  };
})();
