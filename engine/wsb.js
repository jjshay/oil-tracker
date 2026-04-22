// ========== WSB SENTIMENT ==========
// r/wallstreetbets ticker-mention leaderboard. Reddit's public JSON endpoint
// returns post listings with title, selftext, score, num_comments.
//
// Method:
//   1) Pull top posts for 24h and 7d from
//      https://www.reddit.com/r/wallstreetbets/top.json?t=day  (no auth, CORS ok
//      with a real User-Agent)
//   2) Regex $TICKER and bare TICKER tokens from titles + selftext
//   3) Aggregate: mention count + upvote-weighted score, top comment excerpt
//
// Ranking heuristic:
//   rank = mentions * log10(1 + upvotes_sum)
//
// Exposes:
//   window.WSBSentiment.getTopTickers({ days, limit, force })
//   window.WSBSentiment.getPostsForTicker(tkr, days)
//   window.WSBSentiment.getTrending()    — alias: 1d + 7d combined momentum
//
// Row shape:
//   { ticker, mentions, upvotes, rank, topPost: {title,url,score,ups},
//     posts: [...], trend7d: number[] }

const WSBSentiment = {
    BASE: 'https://www.reddit.com/r/wallstreetbets',
    UA: 'TradeRadar/1.0 (contact jjshay@gmail.com)',

    // Block common English uppercase words that regex would otherwise pick up
    // as tickers (A, I, DD, YOLO, etc.) — WSB uses these constantly.
    STOPWORDS: new Set([
        'A','I','AM','AN','AS','AT','BE','BY','DO','GO','HE','IF','IN','IS','IT',
        'MY','NO','OF','ON','OR','SO','TO','UP','US','WE','ALL','AND','ARE','BUT',
        'CAN','DID','FOR','GET','GOT','HAD','HAS','HER','HIM','HIS','HOW','ITS',
        'LET','NOT','NOW','OUR','OUT','SEE','SHE','THE','TOO','WAS','WHO','WHY',
        'YOU','BEEN','DOES','DONT','DOWN','EACH','FROM','HAVE','HERE','JUST',
        'LIKE','MANY','MAKE','MORE','MUCH','ONLY','OVER','SAID','SAME','SHOULD',
        'SOME','SUCH','THAN','THAT','THEM','THEN','THEY','THIS','VERY','WHEN',
        'WHICH','WITH','WOULD','WHAT','WILL','DD','YOLO','TLDR','CEO','CFO','FBI',
        'SEC','FDA','IPO','ATH','ETF','CPI','GDP','PPI','QE','QT','EOD','EOW',
        'EPS','FOMO','FOMC','ICYMI','IMO','LMAO','LOL','LMFAO','MOASS','NGL',
        'OMG','OP','OTM','ITM','ATM','PNL','PRO','PSA','RH','SOLD','SOON','STFU',
        'STOCK','STONK','STONKS','SUS','TA','THE','TY','WEN','WSB','WTF','US','USA','EU',
        'IV','HF','NYSE','NASDAQ','AH','PM','RIP','GG','LFG','NFA','GFY','IRL',
        'OK','OP','POS','HODL','BULL','BEAR','PUT','PUTS','CALL','CALLS','LONG',
        'SHORT','BUY','SELL','HOLD','RED','GREEN','BIG','GAIN','LOSS','MOON',
        'PRINT','SHARE','SHARES','BAG','BAGS','BABY','GAIN','DAILY','WEEKLY',
        'MONTH','MONDAY','TUESDAY','FRIDAY','MARCH','APRIL','JUNE','JULY',
    ]),

    cache: {
        day:  null,        // { time, posts }
        week: null,        // { time, posts }
    },
    cacheExpiryMs: 10 * 60 * 1000, // 10m

    // -------------------------------------------------------------------
    // PUBLIC: getTopTickers
    // -------------------------------------------------------------------
    async getTopTickers(opts) {
        opts = opts || {};
        const days  = opts.days === 7 ? 7 : 1;
        const limit = Math.max(1, Math.min(50, opts.limit || 15));
        const force = !!opts.force;

        const posts = await this._fetchPosts(days, force);
        const leaderboard = this._aggregate(posts);
        // For risers: if 7d cache also present, compare mention share
        if (days === 1 && this.cache.week) {
            const weekAgg = this._aggregate(this.cache.week.posts);
            const weekMap = new Map(weekAgg.map(r => [r.ticker, r]));
            leaderboard.forEach(r => {
                const w = weekMap.get(r.ticker);
                if (!w) { r.riser = true; r.momentum = Infinity; return; }
                const expected = w.mentions / 7;
                r.momentum = expected > 0 ? r.mentions / expected : 1;
                r.riser = r.momentum >= 2;
            });
        }
        return leaderboard.slice(0, limit);
    },

    // -------------------------------------------------------------------
    // PUBLIC: getPostsForTicker
    // -------------------------------------------------------------------
    async getPostsForTicker(tkr, days) {
        tkr = String(tkr || '').toUpperCase().trim();
        if (!tkr) return [];
        days = days === 7 ? 7 : 1;
        const posts = await this._fetchPosts(days, false);
        return posts.filter(p => p._tickers && p._tickers.has(tkr));
    },

    // -------------------------------------------------------------------
    // PUBLIC: getTrending — alias for getTopTickers({days:1}) with riser flag
    // -------------------------------------------------------------------
    async getTrending(days) {
        return this.getTopTickers({ days: days || 1 });
    },

    // ===================================================================
    // Internals
    // ===================================================================
    async _fetchPosts(days, force) {
        const slot = days === 7 ? 'week' : 'day';
        const c = this.cache[slot];
        if (!force && c && Date.now() - c.time < this.cacheExpiryMs) {
            return c.posts;
        }
        const t = days === 7 ? 'week' : 'day';
        const url = `${this.BASE}/top.json?t=${t}&limit=100`;
        let j = null;
        try {
            const r = await fetch(url, { headers: { 'User-Agent': this.UA, 'Accept': 'application/json' } });
            if (!r.ok) {
                // Sometimes blocked — fall back to /hot endpoint
                const r2 = await fetch(`${this.BASE}/hot.json?limit=100`, {
                    headers: { 'User-Agent': this.UA, 'Accept': 'application/json' },
                });
                if (r2.ok) j = await r2.json();
            } else {
                j = await r.json();
            }
        } catch (_) { return c ? c.posts : []; }

        const items = ((j && j.data && j.data.children) || [])
            .map(c => c.data || {})
            .filter(p => p && p.title);

        // Pre-extract ticker sets and enrich
        items.forEach(p => {
            const haystack = `${p.title || ''} ${p.selftext || ''} ${p.link_flair_text || ''}`;
            p._tickers = this._extractTickers(haystack);
        });

        this.cache[slot] = { time: Date.now(), posts: items };
        return items;
    },

    _extractTickers(text) {
        const set = new Set();
        if (!text) return set;
        // 1) explicit $TICKER
        const reDollar = /\$([A-Z]{1,5})\b/g;
        let m;
        while ((m = reDollar.exec(text)) !== null) {
            const t = m[1];
            if (!this.STOPWORDS.has(t)) set.add(t);
        }
        // 2) bare uppercase TICKER — must be 3–5 chars to reduce noise
        const reBare = /\b([A-Z]{3,5})\b/g;
        while ((m = reBare.exec(text)) !== null) {
            const t = m[1];
            if (this.STOPWORDS.has(t)) continue;
            set.add(t);
        }
        return set;
    },

    _aggregate(posts) {
        const map = new Map();
        posts.forEach(p => {
            const ups = Number(p.ups) || 0;
            const tkrs = p._tickers || new Set();
            tkrs.forEach(t => {
                let e = map.get(t);
                if (!e) {
                    e = {
                        ticker: t, mentions: 0, upvotes: 0, posts: [],
                        topPost: null,
                    };
                    map.set(t, e);
                }
                e.mentions++;
                e.upvotes += ups;
                e.posts.push({
                    title: p.title || '',
                    url: p.permalink ? `https://www.reddit.com${p.permalink}` : (p.url || ''),
                    score: Number(p.score) || 0,
                    ups,
                    numComments: Number(p.num_comments) || 0,
                    flair: p.link_flair_text || '',
                    created: p.created_utc || 0,
                });
                if (!e.topPost || ups > (e.topPost.ups || 0)) {
                    e.topPost = e.posts[e.posts.length - 1];
                }
            });
        });
        const arr = Array.from(map.values());
        arr.forEach(e => {
            e.rank = e.mentions * Math.log10(1 + e.upvotes);
        });
        arr.sort((a, b) => b.rank - a.rank || b.mentions - a.mentions);
        return arr;
    },
};

window.WSBSentiment = WSBSentiment;
