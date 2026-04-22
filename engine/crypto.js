// ========== ON-CHAIN DATA ==========
const OnChainData = {
    cache: {},
    cacheExpiry: 15 * 60 * 1000, // 15 min

    // BTC mempool fees (mempool.space - free, CORS-friendly)
    async getBTCFees() {
        return this._fetch('https://mempool.space/api/v1/fees/recommended', 'btc_fees');
    },

    // BTC mempool stats
    async getBTCMempool() {
        return this._fetch('https://mempool.space/api/mempool', 'btc_mempool');
    },

    // BTC blocks
    async getBTCBlocks() {
        return this._fetch('https://mempool.space/api/v1/blocks', 'btc_blocks');
    },

    // BTC difficulty adjustment
    async getBTCDifficulty() {
        return this._fetch('https://mempool.space/api/v1/difficulty-adjustment', 'btc_difficulty');
    },

    // Internal fetch with caching
    async _fetch(url, key) {
        if (this.cache[key] && Date.now() - this.cache[key].time < this.cacheExpiry) {
            return this.cache[key].data;
        }
        try {
            const resp = await fetch(url);
            if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
            const data = await resp.json();
            this.cache[key] = { data, time: Date.now() };
            return data;
        } catch (e) {
            console.warn('OnChain fetch failed:', key, e.message);
            return null;
        }
    }
};

// ========== DEFI DATA (DefiLlama) ==========
const DeFiData = {
    cache: {},
    cacheExpiry: 15 * 60 * 1000,

    // Get top yield pools
    async getPools() {
        const data = await this._fetch('https://yields.llama.fi/pools', 'defi_pools');
        if (!data?.data) return [];
        // Return top 100 pools sorted by TVL
        return data.data
            .filter(p => p.tvlUsd > 1000000 && p.apy > 0)
            .sort((a, b) => b.tvlUsd - a.tvlUsd)
            .slice(0, 100)
            .map(p => ({
                pool: p.pool,
                chain: p.chain,
                project: p.project,
                symbol: p.symbol,
                tvl: p.tvlUsd,
                apy: p.apy,
                apyBase: p.apyBase,
                apyReward: p.apyReward
            }));
    },

    // Get protocol TVL
    async getProtocolTVL(protocol) {
        return this._fetch(`https://api.llama.fi/protocol/${protocol}`, `defi_tvl_${protocol}`);
    },

    // Get total DeFi TVL
    async getTotalTVL() {
        return this._fetch('https://api.llama.fi/v2/historicalChainTvl', 'defi_total_tvl');
    },

    async _fetch(url, key) {
        if (this.cache[key] && Date.now() - this.cache[key].time < this.cacheExpiry) {
            return this.cache[key].data;
        }
        try {
            const resp = await fetch(url);
            if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
            const data = await resp.json();
            this.cache[key] = { data, time: Date.now() };
            return data;
        } catch (e) {
            console.warn('DeFi fetch failed:', key, e.message);
            return null;
        }
    }
};

// ========== DERIVATIVES DATA (Binance via CORS proxy) ==========
const DerivativesData = {
    cache: {},
    cacheExpiry: 15 * 60 * 1000,
    proxyBase: 'https://api.allorigins.win/get?url=',

    // Get funding rates for top perpetuals
    async getFundingRates() {
        const symbols = ['BTCUSDT', 'ETHUSDT', 'SOLUSDT', 'BNBUSDT', 'XRPUSDT', 'DOGEUSDT', 'AVAXUSDT', 'LINKUSDT', 'ADAUSDT', 'MATICUSDT'];
        const results = {};
        for (const sym of symbols) {
            const url = encodeURIComponent(`https://fapi.binance.com/fapi/v1/fundingRate?symbol=${sym}&limit=1`);
            const data = await this._fetchProxy(url, `funding_${sym}`);
            if (data && data[0]) {
                results[sym] = {
                    rate: parseFloat(data[0].fundingRate),
                    time: data[0].fundingTime,
                    annualized: parseFloat(data[0].fundingRate) * 3 * 365 * 100 // 3x daily, annualized %
                };
            }
        }
        return results;
    },

    // Get open interest
    async getOpenInterest(symbol = 'BTCUSDT') {
        const url = encodeURIComponent(`https://fapi.binance.com/fapi/v1/openInterest?symbol=${symbol}`);
        return this._fetchProxy(url, `oi_${symbol}`);
    },

    async _fetchProxy(encodedUrl, key) {
        if (this.cache[key] && Date.now() - this.cache[key].time < this.cacheExpiry) {
            return this.cache[key].data;
        }
        try {
            const resp = await fetch(this.proxyBase + encodedUrl);
            if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
            const wrapper = await resp.json();
            const data = JSON.parse(wrapper.contents);
            this.cache[key] = { data, time: Date.now() };
            return data;
        } catch (e) {
            console.warn('Derivatives fetch failed:', key, e.message);
            return null;
        }
    }
};

