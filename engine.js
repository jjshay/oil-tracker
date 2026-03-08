/* ============================================================
   OIL RADAR - Data Engine
   Monte Carlo, Black-Scholes, Correlation, Historical Data,
   Live API Integration, Backtesting
   ============================================================ */

// ========== MATH UTILITIES ==========
const MathUtil = {
    // Cumulative normal distribution (Abramowitz & Stegun approximation)
    normCDF(x) {
        const a1 = 0.254829592, a2 = -0.284496736, a3 = 1.421413741;
        const a4 = -1.453152027, a5 = 1.061405429, p = 0.3275911;
        const sign = x < 0 ? -1 : 1;
        x = Math.abs(x) / Math.SQRT2;
        const t = 1.0 / (1.0 + p * x);
        const y = 1.0 - (((((a5 * t + a4) * t) + a3) * t + a2) * t + a1) * t * Math.exp(-x * x);
        return 0.5 * (1.0 + sign * y);
    },
    // Standard normal PDF
    normPDF(x) {
        return Math.exp(-0.5 * x * x) / Math.sqrt(2 * Math.PI);
    },
    // Box-Muller transform for normal random variates
    randn() {
        let u = 0, v = 0;
        while (u === 0) u = Math.random();
        while (v === 0) v = Math.random();
        return Math.sqrt(-2.0 * Math.log(u)) * Math.cos(2.0 * Math.PI * v);
    },
    // Percentile of sorted array
    percentile(arr, p) {
        const sorted = [...arr].sort((a, b) => a - b);
        const idx = (p / 100) * (sorted.length - 1);
        const lo = Math.floor(idx), hi = Math.ceil(idx);
        return lo === hi ? sorted[lo] : sorted[lo] + (sorted[hi] - sorted[lo]) * (idx - lo);
    },
    // Mean
    mean(arr) {
        return arr.reduce((s, v) => s + v, 0) / arr.length;
    },
    // Standard deviation
    stdev(arr) {
        const m = MathUtil.mean(arr);
        return Math.sqrt(arr.reduce((s, v) => s + (v - m) ** 2, 0) / (arr.length - 1));
    },
    // Log returns from price series
    logReturns(prices) {
        const returns = [];
        for (let i = 1; i < prices.length; i++) {
            returns.push(Math.log(prices[i] / prices[i - 1]));
        }
        return returns;
    }
};

// ========== BLACK-SCHOLES OPTIONS PRICING ==========
const BlackScholes = {
    // d1 and d2
    _d1(S, K, T, r, sigma) {
        return (Math.log(S / K) + (r + sigma * sigma / 2) * T) / (sigma * Math.sqrt(T));
    },
    _d2(S, K, T, r, sigma) {
        return this._d1(S, K, T, r, sigma) - sigma * Math.sqrt(T);
    },

    // Call price
    call(S, K, T, r, sigma) {
        if (T <= 0) return Math.max(0, S - K);
        const d1 = this._d1(S, K, T, r, sigma);
        const d2 = this._d2(S, K, T, r, sigma);
        return S * MathUtil.normCDF(d1) - K * Math.exp(-r * T) * MathUtil.normCDF(d2);
    },

    // Put price
    put(S, K, T, r, sigma) {
        if (T <= 0) return Math.max(0, K - S);
        const d1 = this._d1(S, K, T, r, sigma);
        const d2 = this._d2(S, K, T, r, sigma);
        return K * Math.exp(-r * T) * MathUtil.normCDF(-d2) - S * MathUtil.normCDF(-d1);
    },

    // All Greeks
    greeks(S, K, T, r, sigma, type = 'call') {
        if (T <= 0) {
            const itm = type === 'call' ? S > K : K > S;
            return { delta: itm ? (type === 'call' ? 1 : -1) : 0, gamma: 0, theta: 0, vega: 0, rho: 0 };
        }
        const d1 = this._d1(S, K, T, r, sigma);
        const d2 = this._d2(S, K, T, r, sigma);
        const sqrtT = Math.sqrt(T);
        const nd1 = MathUtil.normPDF(d1);
        const Nd1 = MathUtil.normCDF(d1);
        const Nd2 = MathUtil.normCDF(d2);

        const gamma = nd1 / (S * sigma * sqrtT);
        const vega = S * nd1 * sqrtT / 100; // per 1% vol change

        if (type === 'call') {
            return {
                delta: Nd1,
                gamma,
                theta: (-(S * nd1 * sigma) / (2 * sqrtT) - r * K * Math.exp(-r * T) * Nd2) / 365,
                vega,
                rho: K * T * Math.exp(-r * T) * Nd2 / 100
            };
        } else {
            return {
                delta: Nd1 - 1,
                gamma,
                theta: (-(S * nd1 * sigma) / (2 * sqrtT) + r * K * Math.exp(-r * T) * MathUtil.normCDF(-d2)) / 365,
                vega,
                rho: -K * T * Math.exp(-r * T) * MathUtil.normCDF(-d2) / 100
            };
        }
    },

    // Implied volatility (Newton-Raphson)
    impliedVol(marketPrice, S, K, T, r, type = 'call', maxIter = 100) {
        let sigma = 0.3; // initial guess
        for (let i = 0; i < maxIter; i++) {
            const price = type === 'call' ? this.call(S, K, T, r, sigma) : this.put(S, K, T, r, sigma);
            const diff = price - marketPrice;
            if (Math.abs(diff) < 0.001) return sigma;
            const d1 = this._d1(S, K, T, r, sigma);
            const vegaRaw = S * MathUtil.normPDF(d1) * Math.sqrt(T);
            if (vegaRaw < 1e-10) break;
            sigma -= diff / vegaRaw;
            if (sigma <= 0.001) sigma = 0.001;
        }
        return sigma;
    }
};

// ========== MONTE CARLO ENGINE ==========
const MonteCarlo = {
    /**
     * Run Monte Carlo simulation using Geometric Brownian Motion
     * @param {Object} params
     * @param {number} params.S0 - Starting price
     * @param {number} params.mu - Annual drift (expected return)
     * @param {number} params.sigma - Annual volatility
     * @param {number} params.T - Time horizon in years
     * @param {number} params.steps - Number of time steps
     * @param {number} params.paths - Number of simulation paths
     * @param {number} [params.jumpProb] - Probability of jump per step (for jump diffusion)
     * @param {number} [params.jumpMean] - Mean jump size (log)
     * @param {number} [params.jumpVol] - Jump size volatility
     * @returns {Object} Results
     */
    run(params) {
        const { S0, mu, sigma, T, steps, paths = 1000, jumpProb = 0, jumpMean = 0, jumpVol = 0 } = params;
        const dt = T / steps;
        const sqrtDt = Math.sqrt(dt);

        const allPaths = [];
        const finalPrices = [];

        for (let p = 0; p < paths; p++) {
            const path = [S0];
            let S = S0;
            for (let t = 0; t < steps; t++) {
                const z = MathUtil.randn();
                let dS = (mu - 0.5 * sigma * sigma) * dt + sigma * sqrtDt * z;

                // Jump diffusion (Merton model)
                if (jumpProb > 0 && Math.random() < jumpProb * dt) {
                    dS += jumpMean + jumpVol * MathUtil.randn();
                }

                S = S * Math.exp(dS);
                path.push(S);
            }
            allPaths.push(path);
            finalPrices.push(S);
        }

        // Calculate statistics at each time step
        const stepStats = [];
        for (let t = 0; t <= steps; t++) {
            const prices = allPaths.map(p => p[t]);
            stepStats.push({
                time: (t / steps) * T,
                mean: MathUtil.mean(prices),
                median: MathUtil.percentile(prices, 50),
                p5: MathUtil.percentile(prices, 5),
                p25: MathUtil.percentile(prices, 25),
                p75: MathUtil.percentile(prices, 75),
                p95: MathUtil.percentile(prices, 95),
                min: Math.min(...prices),
                max: Math.max(...prices)
            });
        }

        // Final distribution stats
        const returns = finalPrices.map(p => (p - S0) / S0);
        return {
            paths: allPaths,
            stepStats,
            finalPrices,
            stats: {
                mean: MathUtil.mean(finalPrices),
                median: MathUtil.percentile(finalPrices, 50),
                stdev: MathUtil.stdev(finalPrices),
                p5: MathUtil.percentile(finalPrices, 5),
                p10: MathUtil.percentile(finalPrices, 10),
                p25: MathUtil.percentile(finalPrices, 25),
                p75: MathUtil.percentile(finalPrices, 75),
                p90: MathUtil.percentile(finalPrices, 90),
                p95: MathUtil.percentile(finalPrices, 95),
                probProfit: finalPrices.filter(p => p > S0).length / paths,
                probDouble: finalPrices.filter(p => p > S0 * 2).length / paths,
                VaR95: S0 - MathUtil.percentile(finalPrices, 5),
                CVaR95: S0 - MathUtil.mean(finalPrices.filter(p => p <= MathUtil.percentile(finalPrices, 5))),
                maxReturn: Math.max(...returns),
                minReturn: Math.min(...returns),
                meanReturn: MathUtil.mean(returns),
                sharpe: MathUtil.mean(returns) / MathUtil.stdev(returns)
            }
        };
    },

    // Portfolio Monte Carlo (correlated assets)
    runPortfolio(assets, correlation, T, steps, paths = 1000) {
        const n = assets.length;
        const dt = T / steps;
        const sqrtDt = Math.sqrt(dt);

        // Cholesky decomposition for correlated random variables
        const L = this._cholesky(correlation);

        const portfolioPaths = [];
        const finalValues = [];

        for (let p = 0; p < paths; p++) {
            const assetPaths = assets.map(a => [a.value]);
            const portfolioPath = [assets.reduce((s, a) => s + a.value, 0)];

            for (let t = 0; t < steps; t++) {
                // Generate correlated random numbers
                const z = Array.from({ length: n }, () => MathUtil.randn());
                const correlated = L.map((row, i) => row.reduce((s, v, j) => s + v * z[j], 0));

                let portfolioValue = 0;
                for (let i = 0; i < n; i++) {
                    const a = assets[i];
                    const dS = (a.mu - 0.5 * a.sigma * a.sigma) * dt + a.sigma * sqrtDt * correlated[i];
                    const newPrice = assetPaths[i][assetPaths[i].length - 1] * Math.exp(dS);
                    assetPaths[i].push(newPrice);
                    portfolioValue += newPrice;
                }
                portfolioPath.push(portfolioValue);
            }
            portfolioPaths.push(portfolioPath);
            finalValues.push(portfolioPath[portfolioPath.length - 1]);
        }

        const initialValue = assets.reduce((s, a) => s + a.value, 0);
        const stepStats = [];
        for (let t = 0; t <= steps; t++) {
            const values = portfolioPaths.map(p => p[t]);
            stepStats.push({
                time: (t / steps) * T,
                mean: MathUtil.mean(values),
                median: MathUtil.percentile(values, 50),
                p5: MathUtil.percentile(values, 5),
                p25: MathUtil.percentile(values, 25),
                p75: MathUtil.percentile(values, 75),
                p95: MathUtil.percentile(values, 95)
            });
        }

        return {
            paths: portfolioPaths,
            stepStats,
            finalValues,
            stats: {
                mean: MathUtil.mean(finalValues),
                median: MathUtil.percentile(finalValues, 50),
                p5: MathUtil.percentile(finalValues, 5),
                p95: MathUtil.percentile(finalValues, 95),
                probProfit: finalValues.filter(v => v > initialValue).length / paths,
                VaR95: initialValue - MathUtil.percentile(finalValues, 5),
                meanReturn: MathUtil.mean(finalValues.map(v => (v - initialValue) / initialValue)),
                sharpe: (() => {
                    const r = finalValues.map(v => (v - initialValue) / initialValue);
                    return MathUtil.mean(r) / MathUtil.stdev(r);
                })()
            }
        };
    },

    // Cholesky decomposition
    _cholesky(matrix) {
        const n = matrix.length;
        const L = Array.from({ length: n }, () => Array(n).fill(0));
        for (let i = 0; i < n; i++) {
            for (let j = 0; j <= i; j++) {
                let sum = 0;
                for (let k = 0; k < j; k++) sum += L[i][k] * L[j][k];
                if (i === j) {
                    L[i][j] = Math.sqrt(Math.max(0, matrix[i][i] - sum));
                } else {
                    L[i][j] = L[j][j] === 0 ? 0 : (matrix[i][j] - sum) / L[j][j];
                }
            }
        }
        return L;
    }
};

// ========== CORRELATION ANALYSIS ==========
const Correlation = {
    // Pearson correlation between two series
    pearson(x, y) {
        const n = Math.min(x.length, y.length);
        if (n < 3) return 0;
        const mx = MathUtil.mean(x.slice(0, n));
        const my = MathUtil.mean(y.slice(0, n));
        let num = 0, dx2 = 0, dy2 = 0;
        for (let i = 0; i < n; i++) {
            const dx = x[i] - mx;
            const dy = y[i] - my;
            num += dx * dy;
            dx2 += dx * dx;
            dy2 += dy * dy;
        }
        const denom = Math.sqrt(dx2 * dy2);
        return denom === 0 ? 0 : num / denom;
    },

    // Correlation matrix from object of series { name: [values] }
    matrix(seriesMap) {
        const names = Object.keys(seriesMap);
        const result = {};
        for (const a of names) {
            result[a] = {};
            for (const b of names) {
                result[a][b] = a === b ? 1.0 : this.pearson(
                    MathUtil.logReturns(seriesMap[a]),
                    MathUtil.logReturns(seriesMap[b])
                );
            }
        }
        return { names, matrix: result };
    },

    // Rolling correlation
    rolling(x, y, window = 30) {
        const results = [];
        for (let i = window; i <= Math.min(x.length, y.length); i++) {
            results.push({
                index: i,
                correlation: this.pearson(
                    MathUtil.logReturns(x.slice(i - window, i)),
                    MathUtil.logReturns(y.slice(i - window, i))
                )
            });
        }
        return results;
    }
};

// ========== LIVE DATA API ==========
const LiveData = {
    cache: {},
    cacheExpiry: 5 * 60 * 1000, // 5 min cache

    async _fetch(url, cacheKey) {
        if (this.cache[cacheKey] && Date.now() - this.cache[cacheKey].time < this.cacheExpiry) {
            return this.cache[cacheKey].data;
        }
        try {
            const resp = await fetch(url);
            if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
            const data = await resp.json();
            this.cache[cacheKey] = { data, time: Date.now() };
            return data;
        } catch (e) {
            console.warn('API fetch failed:', cacheKey, e.message);
            return null;
        }
    },

    // CoinGecko: current prices
    async getCryptoPrices() {
        const ids = 'bitcoin,matic-network,render-token,chainlink,kaspa';
        const url = `https://api.coingecko.com/api/v3/simple/price?ids=${ids}&vs_currencies=usd&include_24hr_change=true&include_market_cap=true&include_24hr_vol=true`;
        return this._fetch(url, 'crypto_prices');
    },

    // CoinGecko: historical prices (up to 365 days)
    async getCryptoHistory(coinId, days = 365) {
        const url = `https://api.coingecko.com/api/v3/coins/${coinId}/market_chart?vs_currency=usd&days=${days}&interval=daily`;
        return this._fetch(url, `crypto_hist_${coinId}_${days}`);
    },

    // CoinGecko: global market data
    async getCryptoGlobal() {
        const url = 'https://api.coingecko.com/api/v3/global';
        return this._fetch(url, 'crypto_global');
    },

    // Alternative.me: Fear & Greed Index
    async getFearGreed() {
        const url = 'https://api.alternative.me/fng/?limit=30&format=json';
        return this._fetch(url, 'fear_greed');
    },

    // Blockchain.com: BTC on-chain (hash rate, difficulty)
    async getBTCOnChain() {
        const metrics = {};
        try {
            const hashRate = await this._fetch('https://api.blockchain.info/charts/hash-rate?timespan=1year&format=json&cors=true', 'btc_hashrate');
            if (hashRate && hashRate.values) metrics.hashRate = hashRate.values;
        } catch (e) { /* skip */ }
        return metrics;
    },

    // Coinbase ticker (backup price source)
    async getBTCPrice() {
        const url = 'https://api.coinbase.com/v2/prices/BTC-USD/spot';
        const data = await this._fetch(url, 'btc_spot');
        return data?.data?.amount ? parseFloat(data.data.amount) : null;
    }
};

// ========== HISTORICAL EVENTS DATABASE ==========
const HISTORICAL_EVENTS = {
    oil: [
        {
            id: 'kuwait_1990',
            name: 'Kuwait Invasion',
            date: '1990-08-02',
            category: 'Geopolitical',
            priceBefore: 21.54,
            pricePeak: 41.15,
            peakDays: 60,
            priceAfter90d: 33.50,
            priceRecovery: 21.00,
            recoveryDays: 210,
            pctToPeak: 91.0,
            supplyLost: 4.3,
            supplyPctGlobal: 6.4,
            duration: 210,
            description: 'Iraq invaded Kuwait, removing ~4.3M bbl/d from market. Oil doubled in 60 days. Coalition forces liberated Kuwait Feb 1991.',
            dailyPrices: [21.54,22.61,24.54,26.23,27.31,27.97,28.05,28.76,29.12,30.17,31.33,32.64,33.78,34.42,35.15,33.91,34.71,35.42,36.11,35.78,34.50,35.89,37.12,38.45,39.18,38.64,37.92,38.50,39.76,40.10,40.95,41.15,40.78,39.45,38.12,37.86,36.98,36.14,35.50,34.89,34.12,33.87,33.50,33.12,32.75,32.40,31.90,31.50,31.18,30.85,30.50,30.12,29.75,29.40,29.10,28.85,28.50,28.10,27.65,27.30]
        },
        {
            id: 'abqaiq_2019',
            name: 'Abqaiq/Khurais Attack',
            date: '2019-09-14',
            category: 'Supply Shock',
            priceBefore: 54.85,
            pricePeak: 62.90,
            peakDays: 1,
            priceAfter90d: 55.17,
            priceRecovery: 54.85,
            recoveryDays: 14,
            pctToPeak: 14.7,
            supplyLost: 5.7,
            supplyPctGlobal: 5.7,
            duration: 14,
            description: 'Drone/missile attack on Saudi Aramco Abqaiq. Removed 5.7M bbl/d (largest single disruption ever). Prices spiked 15% but recovered in 2 weeks as Saudi rapidly repaired.',
            dailyPrices: [54.85,62.90,62.40,59.34,58.64,58.11,57.50,56.87,56.30,55.90,55.60,55.40,55.20,55.17]
        },
        {
            id: 'covid_2020',
            name: 'COVID-19 Crash',
            date: '2020-03-06',
            category: 'Demand Shock',
            priceBefore: 46.78,
            pricePeak: -37.63,
            peakDays: 45,
            priceAfter90d: 40.46,
            priceRecovery: 46.78,
            recoveryDays: 240,
            pctToPeak: -180.4,
            supplyLost: -9.0,
            supplyPctGlobal: -9.0,
            duration: 240,
            description: 'OPEC+ price war + COVID lockdowns crashed demand by ~29M bbl/d. WTI went negative on Apr 20 (storage full). Historic demand destruction event.',
            dailyPrices: [46.78,45.90,41.28,34.36,31.73,30.10,28.70,27.34,24.01,22.43,20.48,19.84,20.31,23.16,24.74,23.63,20.09,19.46,18.27,20.48,25.09,25.78,26.42,24.56,23.99,22.76,21.04,20.29,20.11,19.87,18.84,18.27,16.50,14.10,11.57,-37.63,10.01,15.06,16.50,18.84,19.78,20.39,24.74,26.42,29.43,33.22,34.35,36.81,38.94,40.46,41.65,39.27,40.60,41.12,39.77,40.46]
        },
        {
            id: 'russia_2022',
            name: 'Russia-Ukraine Invasion',
            date: '2022-02-24',
            category: 'Geopolitical',
            priceBefore: 92.10,
            pricePeak: 130.50,
            peakDays: 12,
            priceAfter90d: 109.77,
            priceRecovery: 92.10,
            recoveryDays: 120,
            pctToPeak: 41.7,
            supplyLost: 3.0,
            supplyPctGlobal: 3.0,
            duration: 120,
            description: 'Russia invaded Ukraine. Sanctions on Russian oil threatened ~3M bbl/d. WTI spiked 42% in 12 days. Prices stayed elevated for months due to supply uncertainty.',
            dailyPrices: [92.10,93.54,95.72,99.10,103.41,107.67,110.60,115.68,119.40,123.70,126.51,130.50,128.26,124.30,119.50,116.80,112.34,109.33,108.26,106.95,104.27,103.41,105.96,108.70,109.50,107.25,106.40,104.76,103.28,101.56,99.76,98.52,99.10,100.40,101.20,102.78,104.89,106.10,108.36,109.77,108.43,107.50,105.90,104.12,102.60,101.33,100.10,99.25,98.50,97.40,96.80,95.70,94.50,93.80,93.10,92.50,92.10]
        },
        {
            id: 'libya_2011',
            name: 'Libya Civil War',
            date: '2011-02-15',
            category: 'Geopolitical',
            priceBefore: 84.32,
            pricePeak: 113.93,
            peakDays: 75,
            priceAfter90d: 100.30,
            priceRecovery: 84.32,
            recoveryDays: 365,
            pctToPeak: 35.1,
            supplyLost: 1.6,
            supplyPctGlobal: 1.8,
            duration: 365,
            description: 'Libyan civil war removed ~1.6M bbl/d of light sweet crude. Arab Spring contagion fears amplified the move. Oil stayed above $85 for most of 2011.',
            dailyPrices: [84.32,86.20,89.71,93.57,97.88,98.10,96.97,99.63,102.23,104.42,105.44,104.42,103.98,106.72,108.47,109.77,108.26,105.75,104.60,106.40,108.90,111.30,112.79,113.93,112.50,110.80,109.40,108.70,107.50,106.80,105.50,104.20,103.40,102.70,101.80,101.20,100.80,100.30]
        },
        {
            id: 'oil_crash_2008',
            name: '2008 Oil Spike & Crash',
            date: '2008-01-02',
            category: 'Bubble/Crash',
            priceBefore: 99.62,
            pricePeak: 145.31,
            peakDays: 180,
            priceAfter90d: 67.81,
            priceRecovery: 99.62,
            recoveryDays: 730,
            pctToPeak: 45.9,
            supplyLost: 0,
            supplyPctGlobal: 0,
            duration: 365,
            description: 'Oil spiked to $147 on speculation + China demand, then crashed to $32 during the financial crisis. The entire move (up AND down) took ~12 months.',
            dailyPrices: [99.62,100.10,104.52,109.71,105.48,110.21,117.48,119.93,125.96,132.32,134.56,138.54,139.64,140.21,143.67,145.31,141.37,127.35,115.46,109.71,104.08,96.37,86.59,78.68,73.85,67.81,62.73,60.77,55.36,49.28,44.60,40.81,36.22,33.87,32.40]
        },
        {
            id: 'oil_crash_2014',
            name: '2014-2016 Oil Crash',
            date: '2014-06-20',
            category: 'Supply Glut',
            priceBefore: 107.26,
            pricePeak: 26.21,
            peakDays: 570,
            priceAfter90d: 82.70,
            priceRecovery: 107.26,
            recoveryDays: -1,
            pctToPeak: -75.6,
            supplyLost: -3.0,
            supplyPctGlobal: -3.0,
            duration: 570,
            description: 'US shale revolution flooded the market with ~4M bbl/d of new supply. OPEC refused to cut. Oil fell 76% over 18 months. Never fully recovered pre-crash highs.',
            dailyPrices: [107.26,105.37,103.59,98.17,93.17,90.43,84.44,77.75,73.47,66.15,59.29,53.27,52.69,48.24,44.45,47.60,48.65,53.05,59.63,60.42,57.52,49.20,46.65,44.66,48.56,47.15,45.68,42.53,40.45,38.22,37.04,35.92,33.62,31.90,29.64,28.36,26.55,26.21,28.46,30.32,32.78,35.50,37.40,39.44,41.08,43.73,47.72]
        }
    ],

    crypto: [
        {
            id: 'btc_2017',
            name: '2017 BTC Bull Run',
            date: '2017-01-01',
            category: 'Bull Cycle',
            priceBefore: 998,
            pricePeak: 19783,
            peakDays: 350,
            pctToPeak: 1882,
            description: 'ICO mania drove BTC from $1K to $20K in 12 months. Retail FOMO, no institutional access. Ended with futures launch.',
            monthlyPrices: [998,1043,1215,1348,2300,2700,2875,4360,3674,4395,6457,8041,10975,13860,16500,19783,13412,8342,6914,6390]
        },
        {
            id: 'btc_2021',
            name: '2021 BTC Bull Run',
            date: '2021-01-01',
            category: 'Bull Cycle',
            priceBefore: 29374,
            pricePeak: 68789,
            peakDays: 315,
            pctToPeak: 134,
            description: 'Institutional adoption (MicroStrategy, Tesla), DeFi summer carryover, NFT boom. Double-top pattern with $64K April, $69K November.',
            monthlyPrices: [29374,33114,45137,58800,57684,35804,33572,38150,41512,47100,43790,61300,63500,57000,68789,46211,37708]
        },
        {
            id: 'ftx_2022',
            name: 'FTX Collapse',
            date: '2022-11-06',
            category: 'Black Swan',
            priceBefore: 21300,
            pricePeak: 15476,
            peakDays: 14,
            pctToPeak: -27.3,
            description: 'FTX exchange collapsed, wiping out ~$8B in customer funds. Contagion fears hit all crypto. BTC fell 27% in 2 weeks.',
            dailyPrices: [21300,20800,20200,20100,19400,18540,17167,16530,16800,16500,16200,16100,15700,15476,16100,16400,16550,16700,16800,16600,16800]
        },
        {
            id: 'etf_2024',
            name: 'BTC ETF Approval',
            date: '2024-01-10',
            category: 'Institutional',
            priceBefore: 46000,
            pricePeak: 73750,
            peakDays: 60,
            pctToPeak: 60.3,
            description: 'SEC approved 11 spot Bitcoin ETFs. $12B+ inflows in first 3 months. Institutional access opened. Historic moment for crypto legitimization.',
            dailyPrices: [46000,46500,47800,42500,43100,44200,43800,45300,48900,51800,52100,51200,52900,57000,61200,63100,62500,64800,67500,69200,71700,73750,69100,63400,65800,67900,69500,70100,68500,66800]
        },
        {
            id: 'terra_2022',
            name: 'Terra/LUNA Crash',
            date: '2022-05-07',
            category: 'Black Swan',
            priceBefore: 35500,
            pricePeak: 26700,
            peakDays: 14,
            pctToPeak: -24.8,
            description: 'UST algorithmic stablecoin depegged, LUNA went from $80 to $0. Contagion spread across DeFi. BTC fell 25% as leveraged positions unwound.',
            dailyPrices: [35500,34700,33800,33200,31000,29300,28200,27100,28900,29500,28700,27800,27200,26700,28100,29200,30100,29800,29400,28800,29100]
        },
        {
            id: 'covid_btc_2020',
            name: 'COVID BTC Crash',
            date: '2020-03-08',
            category: 'Macro Crash',
            priceBefore: 9100,
            pricePeak: 3858,
            peakDays: 5,
            pctToPeak: -57.6,
            description: 'Global pandemic panic caused BTC to crash 58% in 5 days. Massive leveraged liquidations. Fastest and deepest BTC crash ever. Full recovery took 6 months.',
            dailyPrices: [9100,8900,7950,7650,5700,5000,4800,3858,4900,5300,5600,5900,6200,6500,6700,6400,6600,6800,7100,7300]
        }
    ],

    // Macro reference data
    macro: {
        fedFundsRate: {
            label: 'Fed Funds Rate (%)',
            data: {'2020-01':1.75,'2020-03':0.25,'2020-12':0.25,'2021-12':0.25,'2022-03':0.50,'2022-06':1.75,'2022-09':3.25,'2022-12':4.50,'2023-03':5.00,'2023-07':5.50,'2023-12':5.50,'2024-09':5.00,'2024-12':4.50}
        },
        dxy: {
            label: 'US Dollar Index',
            data: {'2020-01':97.4,'2020-03':102.8,'2020-06':97.3,'2020-12':89.9,'2021-06':92.2,'2021-12':96.0,'2022-06':104.7,'2022-09':114.1,'2022-12':103.5,'2023-06':103.4,'2023-12':101.4,'2024-06':105.5,'2024-12':108.0}
        }
    }
};

// ========== VOLATILITY DATABASE ==========
// Annualized historical volatilities for key assets
const VOLATILITY_DB = {
    'WTI':  { vol30d: 0.35, vol90d: 0.38, vol1y: 0.40, longTermAvg: 0.35 },
    'BTC':  { vol30d: 0.55, vol90d: 0.60, vol1y: 0.65, longTermAvg: 0.70 },
    'POL':  { vol30d: 0.80, vol90d: 0.85, vol1y: 0.90, longTermAvg: 0.95 },
    'RNDR': { vol30d: 0.90, vol90d: 0.95, vol1y: 1.00, longTermAvg: 1.10 },
    'LINK': { vol30d: 0.70, vol90d: 0.75, vol1y: 0.80, longTermAvg: 0.85 },
    'KAS':  { vol30d: 1.00, vol90d: 1.10, vol1y: 1.20, longTermAvg: 1.30 },
    'UCO':  { vol30d: 0.65, vol90d: 0.70, vol1y: 0.75, longTermAvg: 0.70 },
    'GUSH': { vol30d: 0.70, vol90d: 0.75, vol1y: 0.80, longTermAvg: 0.75 },
    'XLE':  { vol30d: 0.25, vol90d: 0.28, vol1y: 0.30, longTermAvg: 0.28 },
    'OXY':  { vol30d: 0.40, vol90d: 0.45, vol1y: 0.50, longTermAvg: 0.48 },
    'XOM':  { vol30d: 0.22, vol90d: 0.25, vol1y: 0.28, longTermAvg: 0.25 },
    'SPY':  { vol30d: 0.15, vol90d: 0.17, vol1y: 0.18, longTermAvg: 0.16 },
    'GLD':  { vol30d: 0.14, vol90d: 0.15, vol1y: 0.16, longTermAvg: 0.15 }
};

// ========== CORRELATION REFERENCE DATA ==========
// Approximate historical correlations (long-term averages)
const CORRELATION_REF = {
    names: ['WTI', 'BTC', 'SPY', 'DXY', 'GLD', 'XLE', 'POL'],
    matrix: {
        WTI: { WTI: 1.00, BTC: 0.25, SPY: 0.35, DXY: -0.45, GLD: 0.20, XLE: 0.85, POL: 0.15 },
        BTC: { WTI: 0.25, BTC: 1.00, SPY: 0.45, DXY: -0.35, GLD: 0.10, XLE: 0.20, POL: 0.75 },
        SPY: { WTI: 0.35, BTC: 0.45, SPY: 1.00, DXY: -0.20, GLD: -0.05, XLE: 0.65, POL: 0.40 },
        DXY: { WTI: -0.45, BTC: -0.35, DXY: 1.00, SPY: -0.20, GLD: -0.40, XLE: -0.30, POL: -0.30 },
        GLD: { WTI: 0.20, BTC: 0.10, SPY: -0.05, DXY: -0.40, GLD: 1.00, XLE: 0.15, POL: 0.05 },
        XLE: { WTI: 0.85, BTC: 0.20, SPY: 0.65, DXY: -0.30, GLD: 0.15, XLE: 1.00, POL: 0.15 },
        POL: { WTI: 0.15, BTC: 0.75, SPY: 0.40, DXY: -0.30, GLD: 0.05, XLE: 0.15, POL: 1.00 }
    }
};

// ========== BACKTESTING ENGINE ==========
const Backtester = {
    /**
     * Run our Hormuz model against a historical oil event
     */
    testHormuzModel(event, modelParams) {
        const C = modelParams.constants;
        const actualPrices = event.dailyPrices;
        const modelPrices = [];
        const basePrice = event.priceBefore;

        let cumulativeLost = 0;
        for (let d = 0; d < actualPrices.length; d++) {
            const grossDisruption = (event.supplyLost > 0 ? event.supplyLost : C.hormuzFlow * 0.5);
            const altOffset = Math.min(C.altRouteCapacity * 0.5, grossDisruption);
            const sprOffset = Math.min(C.sprReleaseRate, grossDisruption - altOffset);
            const netDeficit = Math.max(0, grossDisruption - altOffset - sprOffset);
            cumulativeLost += netDeficit;
            const deficitPct = (netDeficit / C.globalDemand) * 100;
            let fear = d < 3 ? C.fearPremiumPeak : Math.max(1, C.fearPremiumPeak - C.fearDecayRate * (d - 3));
            let demandDest = d > 14 ? Math.min(C.demandDestructionCap, C.demandDestructionRate * (d - 14)) : 0;
            const impact = deficitPct * C.priceSensitivity * fear * (1 - demandDest);
            modelPrices.push(basePrice * (1 + impact / 100));
        }

        // Compare
        const errors = actualPrices.map((a, i) => {
            const m = modelPrices[i] || modelPrices[modelPrices.length - 1];
            return ((m - a) / a) * 100;
        });

        return {
            eventName: event.name,
            actualPrices,
            modelPrices: modelPrices.slice(0, actualPrices.length),
            meanError: MathUtil.mean(errors.map(Math.abs)),
            maxError: Math.max(...errors.map(Math.abs)),
            directionAccuracy: errors.filter((e, i) => {
                if (i === 0) return true;
                const actualDir = actualPrices[i] > actualPrices[i - 1];
                const modelDir = modelPrices[i] > modelPrices[i - 1];
                return actualDir === modelDir;
            }).length / errors.length * 100,
            peakActual: Math.max(...actualPrices),
            peakModel: Math.max(...modelPrices.slice(0, actualPrices.length)),
            peakError: ((Math.max(...modelPrices.slice(0, actualPrices.length)) - Math.max(...actualPrices)) / Math.max(...actualPrices)) * 100
        };
    }
};

// ========== EXPORT FOR HTML ==========
window.DataEngine = {
    MathUtil,
    BlackScholes,
    MonteCarlo,
    Correlation,
    LiveData,
    HISTORICAL_EVENTS,
    VOLATILITY_DB,
    CORRELATION_REF,
    Backtester
};
