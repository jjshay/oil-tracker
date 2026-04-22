// engine/journal.js — TradeWatch personal trade journal + running P&L tracker.
//
// Exposes on window:
//   TRJournal.getEntries()              → array of all entries, newest-first
//   TRJournal.addEntry(partial)         → { ...entry } (generates id, computes pnl if closed)
//   TRJournal.updateEntry(id, patch)    → updated entry or null
//   TRJournal.deleteEntry(id)           → true/false
//   TRJournal.closeTrade(id, exitPrice, exitDate) → updated entry or null
//   TRJournal.getStats()                → { openCount, closedCount, totalPnl, winRate, avgWin,
//                                           avgLoss, expectancy, profitFactor, tradesPerWeek }
//   TRJournal.getOpenPositions()        → array of open entries
//   TRJournal.getPnLCurve()             → array of { date, cumulativePnl } for equity curve
//   TRJournal.exportCSV()               → CSV string
//   TRJournal.importCSV(text)           → { imported, skipped, errors }
//
// Storage: localStorage['tr_journal_entries'] — JSON array of entries.
// Entry shape:
//   { id, symbol, side: 'long'|'short'|'option', qty, entryPrice, entryDate,
//     exitPrice, exitDate, status: 'open'|'closed', pnl,
//     notes, tags: [], thesis, source: 'manual'|'tradier' }
//
// P&L math:
//   long   → (exit - entry) * qty
//   short  → (entry - exit) * qty
//   option → (exit - entry) * qty * 100   (contracts × multiplier)
//
// Pure JS, no external deps.

(function () {
  if (typeof window === 'undefined') return;

  var STORAGE_KEY = 'tr_journal_entries';
  var VALID_SIDES = ['long', 'short', 'option'];

  // ---------- storage helpers ----------
  function loadAll() {
    try {
      var raw = localStorage.getItem(STORAGE_KEY);
      if (!raw) return [];
      var parsed = JSON.parse(raw);
      if (!Array.isArray(parsed)) return [];
      return parsed;
    } catch (_) { return []; }
  }
  function saveAll(arr) {
    try { localStorage.setItem(STORAGE_KEY, JSON.stringify(arr || [])); }
    catch (_) { /* quota / private mode */ }
  }

  function mkId() {
    return 'tr_' + Math.random().toString(36).slice(2, 10)
      + Date.now().toString(36).slice(-4);
  }

  // ---------- normalization + P&L ----------
  function num(v) {
    if (v === null || v === undefined || v === '') return null;
    var n = Number(v);
    return isFinite(n) ? n : null;
  }

  function normalizeEntry(raw) {
    var side = String(raw.side || 'long').toLowerCase();
    if (VALID_SIDES.indexOf(side) === -1) side = 'long';
    var e = {
      id: raw.id || mkId(),
      symbol: String(raw.symbol || '').toUpperCase().trim(),
      side: side,
      qty: num(raw.qty) || 0,
      entryPrice: num(raw.entryPrice),
      entryDate: raw.entryDate || new Date().toISOString(),
      exitPrice: num(raw.exitPrice),
      exitDate: raw.exitDate || null,
      status: 'open',
      pnl: null,
      notes: raw.notes == null ? '' : String(raw.notes),
      tags: Array.isArray(raw.tags) ? raw.tags.slice() : [],
      thesis: raw.thesis == null ? '' : String(raw.thesis),
      source: raw.source === 'tradier' ? 'tradier' : 'manual',
    };
    // Compute status + pnl
    if (e.exitPrice != null && e.exitDate) {
      e.status = 'closed';
      e.pnl = computePnl(e);
    } else {
      e.status = 'open';
      e.pnl = null;
    }
    return e;
  }

  function computePnl(e) {
    if (e.entryPrice == null || e.exitPrice == null || !e.qty) return 0;
    var delta = 0;
    if (e.side === 'long')   delta = (e.exitPrice - e.entryPrice) * e.qty;
    if (e.side === 'short')  delta = (e.entryPrice - e.exitPrice) * e.qty;
    if (e.side === 'option') delta = (e.exitPrice - e.entryPrice) * e.qty * 100;
    return Math.round(delta * 100) / 100;
  }

  function sortNewestFirst(arr) {
    return arr.slice().sort(function (a, b) {
      var da = new Date(a.entryDate || 0).getTime();
      var db = new Date(b.entryDate || 0).getTime();
      return db - da;
    });
  }

  // ---------- public API ----------
  function getEntries() {
    return sortNewestFirst(loadAll());
  }

  function addEntry(partial) {
    var all = loadAll();
    var entry = normalizeEntry(partial || {});
    all.push(entry);
    saveAll(all);
    return entry;
  }

  function updateEntry(id, patch) {
    var all = loadAll();
    var idx = all.findIndex(function (e) { return e.id === id; });
    if (idx === -1) return null;
    var merged = Object.assign({}, all[idx], patch || {}, { id: id });
    var normalized = normalizeEntry(merged);
    all[idx] = normalized;
    saveAll(all);
    return normalized;
  }

  function deleteEntry(id) {
    var all = loadAll();
    var before = all.length;
    var next = all.filter(function (e) { return e.id !== id; });
    saveAll(next);
    return next.length !== before;
  }

  function closeTrade(id, exitPrice, exitDate) {
    return updateEntry(id, {
      exitPrice: num(exitPrice),
      exitDate: exitDate || new Date().toISOString(),
    });
  }

  function getOpenPositions() {
    return getEntries().filter(function (e) { return e.status === 'open'; });
  }

  function getStats() {
    var all = loadAll();
    var open = all.filter(function (e) { return e.status === 'open'; });
    var closed = all.filter(function (e) { return e.status === 'closed'; });

    var wins = closed.filter(function (e) { return (e.pnl || 0) > 0; });
    var losses = closed.filter(function (e) { return (e.pnl || 0) < 0; });
    var scratches = closed.length - wins.length - losses.length;

    var totalPnl = closed.reduce(function (s, e) { return s + (e.pnl || 0); }, 0);
    var grossWin = wins.reduce(function (s, e) { return s + e.pnl; }, 0);
    var grossLoss = losses.reduce(function (s, e) { return s + e.pnl; }, 0); // negative

    var winRate = closed.length ? (wins.length / closed.length) : 0;
    var avgWin = wins.length ? (grossWin / wins.length) : 0;
    var avgLoss = losses.length ? (grossLoss / losses.length) : 0; // negative
    var expectancy = closed.length
      ? (winRate * avgWin + (1 - winRate) * avgLoss)
      : 0;
    var profitFactor = grossLoss < 0
      ? (grossWin / Math.abs(grossLoss))
      : (grossWin > 0 ? Infinity : 0);

    // Trades per week — over span from earliest entryDate to now.
    var tradesPerWeek = 0;
    if (all.length) {
      var earliest = all.reduce(function (min, e) {
        var t = new Date(e.entryDate || 0).getTime();
        return (t && t < min) ? t : min;
      }, Date.now());
      var weeks = Math.max(1, (Date.now() - earliest) / (7 * 24 * 3600 * 1000));
      tradesPerWeek = all.length / weeks;
    }

    return {
      openCount: open.length,
      closedCount: closed.length,
      scratchCount: scratches,
      totalPnl: Math.round(totalPnl * 100) / 100,
      grossWin: Math.round(grossWin * 100) / 100,
      grossLoss: Math.round(grossLoss * 100) / 100,
      winRate: winRate,
      avgWin: Math.round(avgWin * 100) / 100,
      avgLoss: Math.round(avgLoss * 100) / 100,
      expectancy: Math.round(expectancy * 100) / 100,
      profitFactor: profitFactor,
      tradesPerWeek: Math.round(tradesPerWeek * 100) / 100,
    };
  }

  function getPnLCurve() {
    // Walk closed trades chronologically by exitDate, accumulate pnl.
    var closed = loadAll().filter(function (e) {
      return e.status === 'closed' && e.exitDate;
    });
    closed.sort(function (a, b) {
      return new Date(a.exitDate).getTime() - new Date(b.exitDate).getTime();
    });
    var cum = 0;
    var curve = [];
    // Seed origin if there's anything to plot
    if (closed.length) {
      var firstStart = closed[0].entryDate || closed[0].exitDate;
      curve.push({ date: firstStart, cumulativePnl: 0 });
    }
    closed.forEach(function (e) {
      cum += (e.pnl || 0);
      curve.push({ date: e.exitDate, cumulativePnl: Math.round(cum * 100) / 100 });
    });
    return curve;
  }

  // ---------- CSV import/export ----------
  var CSV_COLS = [
    'id', 'symbol', 'side', 'qty', 'entryPrice', 'entryDate',
    'exitPrice', 'exitDate', 'status', 'pnl',
    'notes', 'tags', 'thesis', 'source',
  ];

  function csvEscape(v) {
    if (v == null) return '';
    var s = String(v);
    if (s.indexOf(',') !== -1 || s.indexOf('"') !== -1 || s.indexOf('\n') !== -1) {
      return '"' + s.replace(/"/g, '""') + '"';
    }
    return s;
  }

  function exportCSV() {
    var rows = [CSV_COLS.join(',')];
    loadAll().forEach(function (e) {
      var row = CSV_COLS.map(function (k) {
        if (k === 'tags') return csvEscape((e.tags || []).join('|'));
        return csvEscape(e[k]);
      });
      rows.push(row.join(','));
    });
    return rows.join('\n');
  }

  // Robust-ish CSV parser: handles quoted fields + escaped quotes + embedded newlines.
  function parseCSV(text) {
    var rows = [];
    var row = [];
    var cur = '';
    var inQ = false;
    var i = 0;
    var len = text.length;
    while (i < len) {
      var c = text[i];
      if (inQ) {
        if (c === '"') {
          if (text[i + 1] === '"') { cur += '"'; i += 2; continue; }
          inQ = false; i++; continue;
        }
        cur += c; i++; continue;
      }
      if (c === '"') { inQ = true; i++; continue; }
      if (c === ',') { row.push(cur); cur = ''; i++; continue; }
      if (c === '\r') { i++; continue; }
      if (c === '\n') {
        row.push(cur); rows.push(row);
        row = []; cur = ''; i++; continue;
      }
      cur += c; i++;
    }
    // flush
    if (cur.length || row.length) { row.push(cur); rows.push(row); }
    return rows;
  }

  function importCSV(text) {
    var out = { imported: 0, skipped: 0, errors: [] };
    if (!text || typeof text !== 'string') {
      out.errors.push('empty input');
      return out;
    }
    var rows = parseCSV(text.trim());
    if (rows.length < 2) { out.errors.push('no data rows'); return out; }
    var header = rows[0].map(function (h) { return String(h || '').trim(); });
    var idx = {};
    CSV_COLS.forEach(function (k) { idx[k] = header.indexOf(k); });
    // symbol is the hard minimum
    if (idx.symbol === -1) { out.errors.push('missing symbol column'); return out; }

    var existing = loadAll();
    var existingIds = {};
    existing.forEach(function (e) { existingIds[e.id] = true; });

    for (var i = 1; i < rows.length; i++) {
      var r = rows[i];
      if (!r || r.length === 0 || (r.length === 1 && !r[0])) continue;
      var getV = function (key) {
        var j = idx[key];
        return j >= 0 && j < r.length ? r[j] : undefined;
      };
      var raw = {
        id: getV('id'),
        symbol: getV('symbol'),
        side: getV('side'),
        qty: getV('qty'),
        entryPrice: getV('entryPrice'),
        entryDate: getV('entryDate'),
        exitPrice: getV('exitPrice'),
        exitDate: getV('exitDate'),
        notes: getV('notes'),
        tags: (function () {
          var t = getV('tags');
          if (!t) return [];
          return String(t).split('|').map(function (x) { return x.trim(); }).filter(Boolean);
        })(),
        thesis: getV('thesis'),
        source: getV('source'),
      };
      if (!raw.symbol) { out.skipped++; continue; }
      if (raw.id && existingIds[raw.id]) { out.skipped++; continue; }
      try {
        var ent = normalizeEntry(raw);
        existing.push(ent);
        existingIds[ent.id] = true;
        out.imported++;
      } catch (e) {
        out.errors.push('row ' + i + ': ' + (e && e.message));
        out.skipped++;
      }
    }
    saveAll(existing);
    return out;
  }

  // ---------- export ----------
  window.TRJournal = {
    getEntries: getEntries,
    addEntry: addEntry,
    updateEntry: updateEntry,
    deleteEntry: deleteEntry,
    closeTrade: closeTrade,
    getStats: getStats,
    getOpenPositions: getOpenPositions,
    getPnLCurve: getPnLCurve,
    exportCSV: exportCSV,
    importCSV: importCSV,
    _computePnl: computePnl, // test hook
    _storageKey: STORAGE_KEY,
  };
})();
