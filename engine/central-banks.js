// engine/central-banks.js — Central-bank speech aggregator.
//
// Pulls the official speech RSS feeds from:
//   Fed   — https://www.federalreserve.gov/feeds/speeches.xml
//   ECB   — https://www.ecb.europa.eu/rss/fie.html
//   BOJ   — https://www.boj.or.jp/en/rss/whatsnew.xml
//   BOE   — https://www.bankofengland.co.uk/rss/speeches.xml
//   BIS   — https://www.bis.org/list/cbspeeches/from_01012010/rss.xml
//
// All feeds are public/free. We use the rss2json proxy (same pattern as
// engine/news.js) so the fetches work from the browser without CORS issues.
//
// Exposes window.CentralBanks:
//   fetchSpeeches({ banks, limit, people })  → Speech[]
//   KEY_PEOPLE                               → { bank: [names] }
//   BANK_META                                → { bank: { label, color, url } }
//
// Speech shape:
//   { bank, bankColor, speaker, title, link, date, excerpt, raw }

(function () {
  if (typeof window === 'undefined') return;

  var CACHE_TTL_MS = 15 * 60 * 1000;
  var cache = {}; // { bankId: { data, fetchedAt } }

  var BANK_META = {
    fed: {
      label: 'Federal Reserve',
      short: 'FED',
      color: '#2a7de1',
      rss:   'https://www.federalreserve.gov/feeds/speeches.xml',
    },
    ecb: {
      label: 'European Central Bank',
      short: 'ECB',
      color: '#f2b51c',
      rss:   'https://www.ecb.europa.eu/rss/fie.html',
    },
    boj: {
      label: 'Bank of Japan',
      short: 'BOJ',
      color: '#e84c3d',
      rss:   'https://www.boj.or.jp/en/rss/whatsnew.xml',
    },
    boe: {
      label: 'Bank of England',
      short: 'BOE',
      color: '#8e44ad',
      rss:   'https://www.bankofengland.co.uk/rss/speeches.xml',
    },
    bis: {
      label: 'Bank for Intl Settlements',
      short: 'BIS',
      color: '#27ae60',
      rss:   'https://www.bis.org/list/cbspeeches/from_01012010/rss.xml',
    },
  };

  // Key speakers — panel prioritizes these and offers quick filter pills.
  var KEY_PEOPLE = {
    fed: ['Powell', 'Williams', 'Waller', 'Jefferson', 'Cook', 'Bowman', 'Daly', 'Bostic'],
    ecb: ['Lagarde', 'de Guindos', 'Lane', 'Schnabel', 'Cipollone'],
    boj: ['Ueda', 'Himino', 'Uchida', 'Adachi'],
    boe: ['Bailey', 'Ramsden', 'Broadbent', 'Mann', 'Pill', 'Dhingra'],
    bis: ['Carstens', 'Kashyap'],
  };

  // Flatten helper.
  function allKeyPeople() {
    var out = [];
    Object.keys(KEY_PEOPLE).forEach(function (k) {
      out = out.concat(KEY_PEOPLE[k]);
    });
    return out;
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

  // Extract the speaker name from an RSS item. Banks vary widely — we look at
  // the title, then fall back to the author field.
  function inferSpeaker(bankId, item) {
    var titleRaw = (item.title || '').trim();
    var author   = (item.author || '').trim();
    var desc     = (item.description || '').replace(/<[^>]*>/g, '').trim();

    // 1. Author field is the most reliable when populated (Fed, BOE sometimes).
    if (author && author.length > 2 && author.length < 80) {
      return author;
    }

    // 2. Title prefix "By <Name>:" or "<Name> - Topic"
    var m = titleRaw.match(/^(?:Speech by|Remarks by|Statement by|By)\s+([^:–-]+?)(?:\s*[:–-]|$)/i);
    if (m) return m[1].trim();

    // 3. Search title + description for any known speaker surname.
    var people = allKeyPeople();
    var haystack = (titleRaw + ' ' + desc).toLowerCase();
    for (var i = 0; i < people.length; i++) {
      if (haystack.indexOf(people[i].toLowerCase()) !== -1) {
        return people[i];
      }
    }

    return '—';
  }

  // Pull an RSS feed for one bank via rss2json.
  async function fetchBankFeed(bankId) {
    var cached = cget(bankId);
    if (cached) return cached;

    var meta = BANK_META[bankId];
    if (!meta) return [];

    try {
      var proxy = 'https://api.rss2json.com/v1/api.json?rss_url='
                + encodeURIComponent(meta.rss);
      var resp = await fetch(proxy);
      if (!resp.ok) throw new Error('HTTP ' + resp.status);
      var json = await resp.json();
      if (!json || json.status !== 'ok' || !Array.isArray(json.items)) return [];

      var items = json.items.slice(0, 40).map(function (it) {
        var excerpt = (it.description || '')
          .replace(/<[^>]*>/g, '')
          .replace(/\s+/g, ' ')
          .trim()
          .slice(0, 320);
        return {
          bank:      bankId,
          bankShort: meta.short,
          bankColor: meta.color,
          speaker:   inferSpeaker(bankId, it),
          title:     (it.title || '').trim(),
          link:      it.link || '',
          date:      new Date(it.pubDate || Date.now()),
          excerpt:   excerpt,
          raw:       it,
        };
      });

      cset(bankId, items);
      return items;
    } catch (e) {
      console.warn('[CentralBanks] feed failed', bankId, e && e.message);
      return [];
    }
  }

  // Public: fetchSpeeches.
  async function fetchSpeeches(opts) {
    opts = opts || {};
    var banks  = opts.banks  || Object.keys(BANK_META);
    var limit  = Math.max(1, Math.min(200, opts.limit || 30));
    var people = opts.people;  // optional array of surnames to filter

    var results = await Promise.allSettled(banks.map(fetchBankFeed));
    var all = [];
    results.forEach(function (r) {
      if (r.status === 'fulfilled' && Array.isArray(r.value)) all.push.apply(all, r.value);
    });

    if (people && people.length) {
      var lc = people.map(function (p) { return p.toLowerCase(); });
      all = all.filter(function (s) {
        var sp = (s.speaker || '').toLowerCase();
        for (var i = 0; i < lc.length; i++) if (sp.indexOf(lc[i]) !== -1) return true;
        return false;
      });
    }

    all.sort(function (a, b) { return b.date - a.date; });
    return all.slice(0, limit);
  }

  function clearCache() { cache = {}; }

  window.CentralBanks = {
    fetchSpeeches: fetchSpeeches,
    KEY_PEOPLE:    KEY_PEOPLE,
    BANK_META:     BANK_META,
    clearCache:    clearCache,
  };
})();
