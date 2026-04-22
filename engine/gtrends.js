// ========== PUBLIC INTEREST (Wikipedia pageviews + Google Trends RSS) ==========
// Google Trends has no free public API. Wikipedia pageviews are a remarkably
// clean proxy for public search interest: free, key-less, CORS open, daily
// granularity. Paired with Google Trends' daily trending-searches RSS for a
// general "what is the country searching" signal.
//
// Endpoints:
//   https://wikimedia.org/api/rest_v1/metrics/pageviews/per-article/
//     en.wikipedia.org/all-access/all-agents/{article}/daily/{start}/{end}
//   https://trends.google.com/trending/rss?geo=US
//
// Ticker → Wikipedia article mapping is curated. Not every ticker has a 1-1
// article (e.g. "Bitcoin" covers BTC and IBIT, "Ethereum" for ETH/ETHE).
//
// Exposes:
//   window.PublicInterest.TICKER_ARTICLES
//   window.PublicInterest.getWikiPageviews(article, days=30)
//   window.PublicInterest.getTickerInterest(sym)       — alias
//   window.PublicInterest.getTrending({ force })       — Google Trends RSS
//
// Return shapes:
//   getWikiPageviews → { article, days, points: [{date, views}], total, avg, max }
//   getTrending      → { items: [{ title, traffic, pubDate, link, picture }] }

const PublicInterest = {
    WIKI: 'https://wikimedia.org/api/rest_v1/metrics/pageviews/per-article/en.wikipedia.org/all-access/all-agents',
    RSS:  'https://trends.google.com/trending/rss?geo=US',
    RSS2JSON: 'https://api.rss2json.com/v1/api.json?rss_url=',

    // Curated ticker → English Wikipedia article slug.
    TICKER_ARTICLES: {
        SPY:   'S%26P_500',
        QQQ:   'Nasdaq-100',
        DIA:   'Dow_Jones_Industrial_Average',
        VIX:   'VIX',
        NVDA:  'Nvidia',
        AAPL:  'Apple_Inc.',
        MSFT:  'Microsoft',
        AMZN:  'Amazon_(company)',
        GOOGL: 'Alphabet_Inc.',
        META:  'Meta_Platforms',
        TSLA:  'Tesla,_Inc.',
        AMD:   'AMD',
        NFLX:  'Netflix',
        AVGO:  'Broadcom',
        // Crypto
        BTC:   'Bitcoin',
        ETH:   'Ethereum',
        SOL:   'Solana_(blockchain_platform)',
        DOGE:  'Dogecoin',
        // Crypto-adjacent equities
        IBIT:  'Bitcoin',
        FBTC:  'Bitcoin',
        MSTR:  'MicroStrategy',
        COIN:  'Coinbase',
        // Meme / retail favorites
        GME:   'GameStop',
        AMC:   'AMC_Theatres',
        PLTR:  'Palantir_Technologies',
        SOFI:  'SoFi',
        HOOD:  'Robinhood_Markets',
    },

    cache: {
        wiki: {},         // article -> { time, data }
        trends: null,     // { time, data }
    },
    cacheExpiryMs: 60 * 60 * 1000, // 1h — pageviews update daily

    // -------------------------------------------------------------------
    // PUBLIC: getWikiPageviews
    // -------------------------------------------------------------------
    async getWikiPageviews(article, days, opts) {
        days = Math.max(3, Math.min(180, days || 30));
        opts = opts || {};
        const force = !!opts.force;
        const key = `${article}|${days}`;
        const c = this.cache.wiki[key];
        if (!force && c && Date.now() - c.time < this.cacheExpiryMs) {
            return c.data;
        }

        const end = new Date();
        // Wikipedia data lags ~24h; end at yesterday.
        end.setDate(end.getDate() - 1);
        const start = new Date(end);
        start.setDate(start.getDate() - (days - 1));

        const startStr = this._ymdh(start);
        const endStr   = this._ymdh(end);
        const url = `${this.WIKI}/${encodeURIComponent(article)}/daily/${startStr}/${endStr}`;

        let j = null;
        try {
            const r = await fetch(url, { headers: { 'Accept': 'application/json' } });
            if (!r.ok) {
                const empty = { article, days, points: [], total: 0, avg: 0, max: 0, error: r.status };
                this.cache.wiki[key] = { time: Date.now(), data: empty };
                return empty;
            }
            j = await r.json();
        } catch (_) {
            const empty = { article, days, points: [], total: 0, avg: 0, max: 0, error: 'network' };
            this.cache.wiki[key] = { time: Date.now(), data: empty };
            return empty;
        }

        const points = ((j && j.items) || []).map(it => ({
            date: `${String(it.timestamp).slice(0, 4)}-${String(it.timestamp).slice(4, 6)}-${String(it.timestamp).slice(6, 8)}`,
            views: Number(it.views) || 0,
        }));
        const total = points.reduce((a, b) => a + b.views, 0);
        const avg   = points.length ? Math.round(total / points.length) : 0;
        const max   = points.reduce((m, p) => Math.max(m, p.views), 0);

        const data = { article, days, points, total, avg, max };
        this.cache.wiki[key] = { time: Date.now(), data };
        return data;
    },

    // -------------------------------------------------------------------
    // PUBLIC: getTickerInterest — maps sym → article, returns series
    // -------------------------------------------------------------------
    async getTickerInterest(sym, days, opts) {
        sym = String(sym || '').toUpperCase().trim();
        const article = this.TICKER_ARTICLES[sym];
        if (!article) {
            return { ticker: sym, article: null, days: days || 30, points: [], total: 0, avg: 0, max: 0, error: 'unmapped' };
        }
        const data = await this.getWikiPageviews(article, days, opts);
        return Object.assign({ ticker: sym }, data);
    },

    // -------------------------------------------------------------------
    // PUBLIC: getTrending — Google daily search trends RSS
    // -------------------------------------------------------------------
    async getTrending(opts) {
        opts = opts || {};
        const force = !!opts.force;
        const c = this.cache.trends;
        if (!force && c && Date.now() - c.time < this.cacheExpiryMs) {
            return c.data;
        }

        // Try rss2json proxy first (returns JSON + bypasses CORS on some browsers).
        let items = await this._fetchRssJson();
        if (!items || !items.length) items = await this._fetchRssDirect();

        const data = { items: items || [] };
        this.cache.trends = { time: Date.now(), data };
        return data;
    },

    // ===================================================================
    // Internals
    // ===================================================================
    async _fetchRssJson() {
        try {
            const url = this.RSS2JSON + encodeURIComponent(this.RSS);
            const r = await fetch(url);
            if (!r.ok) return null;
            const j = await r.json();
            if (!j || j.status !== 'ok' || !Array.isArray(j.items)) return null;
            return j.items.map(it => ({
                title: it.title || '',
                traffic: this._extractTraffic(it.description || it.content || ''),
                pubDate: it.pubDate || '',
                link: it.link || '',
                picture: (it.enclosure && it.enclosure.link) || '',
            }));
        } catch (_) { return null; }
    },

    async _fetchRssDirect() {
        try {
            const r = await fetch(this.RSS);
            if (!r.ok) return null;
            const xml = await r.text();
            const parser = new DOMParser();
            const doc = parser.parseFromString(xml, 'application/xml');
            const nodes = doc.getElementsByTagName('item');
            const out = [];
            for (let i = 0; i < nodes.length; i++) {
                const n = nodes[i];
                const get = tag => {
                    const el = n.getElementsByTagName(tag);
                    return el && el.length ? (el[0].textContent || '').trim() : '';
                };
                const trafficEls = n.getElementsByTagName('ht:approx_traffic');
                const traffic = trafficEls && trafficEls.length ? (trafficEls[0].textContent || '').trim() : '';
                out.push({
                    title: get('title'),
                    traffic,
                    pubDate: get('pubDate'),
                    link: get('link'),
                    picture: '',
                });
            }
            return out;
        } catch (_) { return null; }
    },

    _extractTraffic(desc) {
        if (!desc) return '';
        const m = String(desc).match(/(\d[\d,]*\+?)\s*(?:searches|searchess|\b)/i);
        return m ? m[1] : '';
    },

    _ymdh(d) {
        const y = d.getUTCFullYear();
        const m = String(d.getUTCMonth() + 1).padStart(2, '0');
        const day = String(d.getUTCDate()).padStart(2, '0');
        return `${y}${m}${day}00`;
    },
};

window.PublicInterest = PublicInterest;
