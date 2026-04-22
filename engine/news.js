// ========== NEWS FEED AGGREGATOR ==========
const NewsFeed = {
    feeds: [
        // Crypto-dedicated
        { name: 'CoinDesk',         url: 'https://www.coindesk.com/arc/outboundfeeds/rss/?outputType=xml', color: '#0052ff' },
        { name: 'CoinTelegraph',    url: 'https://cointelegraph.com/rss',             color: '#f7931a' },
        { name: 'CryptoSlate',      url: 'https://cryptoslate.com/feed/',             color: '#3861fb' },
        { name: 'Decrypt',          url: 'https://decrypt.co/feed',                   color: '#2aeaff' },
        { name: 'Bitcoin Magazine', url: 'https://bitcoinmagazine.com/.rss/full/',    color: '#f7931a' },
        { name: 'The Block',        url: 'https://www.theblock.co/rss.xml',           color: '#1652f0' },
        { name: 'CryptoPanic',      url: 'https://cryptopanic.com/feed/',             color: '#49eacb' },
        // Macro / markets
        { name: 'Reuters Markets',  url: 'https://feeds.reuters.com/reuters/businessNews', color: '#ff6600' },
        { name: 'Yahoo Finance',    url: 'https://finance.yahoo.com/news/rssindex',   color: '#720e9e' },
        { name: 'ZeroHedge',        url: 'https://feeds.feedburner.com/zerohedge/feed', color: '#c9a227' },
        { name: 'MarketWatch',      url: 'https://www.marketwatch.com/rss/topstories', color: '#00a038' },
        // Reddit communities (via native RSS)
        { name: 'r/Bitcoin',        url: 'https://www.reddit.com/r/Bitcoin/.rss',     color: '#ff4500' },
        { name: 'r/wallstreetbets', url: 'https://www.reddit.com/r/wallstreetbets/.rss', color: '#ff4500' },
        { name: 'r/CryptoCurrency', url: 'https://www.reddit.com/r/CryptoCurrency/.rss', color: '#ff4500' },
        { name: 'r/stocks',         url: 'https://www.reddit.com/r/stocks/.rss',      color: '#ff4500' },
        // Telegram public channels (via RSSHub CORS proxy) — OSINT + crypto signals
        { name: 'TG · @whale_alert',       url: 'https://rsshub.app/telegram/channel/whale_alert',      color: '#26a5e4' },
        { name: 'TG · @intelslava',        url: 'https://rsshub.app/telegram/channel/intelslava',       color: '#26a5e4' },
        { name: 'TG · @RocketChip',        url: 'https://rsshub.app/telegram/channel/RocketChip_bsky',  color: '#26a5e4' },
        { name: 'TG · @CryptoSlate',       url: 'https://rsshub.app/telegram/channel/CryptoSlate',      color: '#26a5e4' },
        { name: 'TG · @CoinDeskNews',      url: 'https://rsshub.app/telegram/channel/CoinDeskNews',     color: '#26a5e4' }
    ],
    cache: { articles: [], time: 0 },
    cacheExpiry: 10 * 60 * 1000, // 10 min cache

    async fetchAll() {
        if (this.cache.articles.length && Date.now() - this.cache.time < this.cacheExpiry) {
            return this.cache.articles;
        }
        const allArticles = [];
        // RSS feeds + StockTwits trader streams for BTC + SPY + crypto beta tickers.
        const results = await Promise.allSettled([
            ...this.feeds.map(feed => this._fetchFeed(feed)),
            this.fetchStockTwits('BTC.X'),
            this.fetchStockTwits('SPY'),
            this.fetchStockTwits('MSTR'),
            this.fetchStockTwits('NVDA'),
        ]);
        for (const r of results) {
            if (r.status === 'fulfilled' && r.value) {
                allArticles.push(...r.value);
            }
        }
        // Deduplicate by title similarity and sort by date
        const seen = new Set();
        const deduped = allArticles.filter(a => {
            const key = a.title.toLowerCase().replace(/[^a-z0-9]/g, '').slice(0, 60);
            if (seen.has(key)) return false;
            seen.add(key);
            return true;
        });
        deduped.sort((a, b) => b.date - a.date);
        this.cache = { articles: deduped, time: Date.now() };
        return deduped;
    },

    // StockTwits — free public stream API for trader chatter per symbol.
    // Use 'BTC.X' for Bitcoin, 'SPY' for S&P, 'AAPL' for a stock, etc.
    async fetchStockTwits(symbol = 'BTC.X') {
        try {
            const r = await fetch(`https://api.stocktwits.com/api/2/streams/symbol/${symbol}.json`);
            if (!r.ok) return [];
            const j = await r.json();
            if (!j || !j.messages) return [];
            return j.messages.slice(0, 15).map(m => ({
                title:       m.body || '',
                link:        `https://stocktwits.com/${m.user?.username || ''}/message/${m.id}`,
                description: `@${m.user?.username || 'trader'} · ${m.entities?.sentiment?.basic || 'neutral'} · ${m.user?.followers || 0} followers`,
                date:        new Date(m.created_at),
                source:      `StockTwits · $${symbol}`,
                sourceColor: '#40c4ff',
                thumbnail:   m.user?.avatar_url || '',
            }));
        } catch (e) { return []; }
    },

    async _fetchFeed(feed) {
        try {
            const proxyUrl = `https://api.rss2json.com/v1/api.json?rss_url=${encodeURIComponent(feed.url)}`;
            const resp = await fetch(proxyUrl);
            if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
            const data = await resp.json();
            if (data.status !== 'ok' || !data.items) return [];
            return data.items.slice(0, 15).map(item => ({
                title: item.title || '',
                link: item.link || '',
                description: (item.description || '').replace(/<[^>]*>/g, '').slice(0, 300),
                date: new Date(item.pubDate || Date.now()),
                source: feed.name,
                sourceColor: feed.color,
                thumbnail: item.thumbnail || item.enclosure?.link || ''
            }));
        } catch (e) {
            console.warn('Feed fetch failed:', feed.name, e.message);
            return [];
        }
    }
};

