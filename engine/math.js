/* ============================================================
   CRYPTO RADAR - Data Engine
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

