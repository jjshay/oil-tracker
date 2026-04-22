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

const TradierAPI = {
    _base() {
        const meta = (window.TR_SETTINGS && window.TR_SETTINGS.meta) || {};
        return meta.tradierMode === 'live'
            ? 'https://api.tradier.com/v1'
            : 'https://sandbox.tradier.com/v1';
    },
    _token() {
        return (window.TR_SETTINGS && window.TR_SETTINGS.keys && window.TR_SETTINGS.keys.tradier) || '';
    },
    async _fetch(path) {
        const token = this._token();
        if (!token) return null;
        try {
            const r = await fetch(`${this._base()}${path}`, {
                headers: { Authorization: `Bearer ${token}`, Accept: 'application/json' },
            });
            if (!r.ok) return null;
            return await r.json();
        } catch (_) { return null; }
    },
    // Trading + account endpoints. Tradier requires form-urlencoded POST bodies
    // (NOT JSON). Returns parsed JSON or null on error. Caller must handle null.
    async _send(path, method, formObj) {
        const token = this._token();
        if (!token) return null;
        try {
            const init = {
                method,
                headers: {
                    Authorization: `Bearer ${token}`,
                    Accept: 'application/json',
                },
            };
            if (formObj) {
                init.headers['Content-Type'] = 'application/x-www-form-urlencoded';
                const body = new URLSearchParams();
                Object.keys(formObj).forEach(k => {
                    if (formObj[k] !== undefined && formObj[k] !== null && formObj[k] !== '') {
                        body.append(k, String(formObj[k]));
                    }
                });
                init.body = body.toString();
            }
            const r = await fetch(`${this._base()}${path}`, init);
            if (!r.ok) {
                let err = null; try { err = await r.json(); } catch (_) {}
                return { _error: true, status: r.status, body: err };
            }
            return await r.json();
        } catch (e) { return { _error: true, message: e && e.message }; }
    },
    _accountId() {
        const meta = (window.TR_SETTINGS && window.TR_SETTINGS.meta) || {};
        return meta.tradierAccount || 'VA43420796';
    },
    async getQuote(symbol) {
        const d = await this._fetch(`/markets/quotes?symbols=${encodeURIComponent(symbol)}`);
        return d && d.quotes && d.quotes.quote ? d.quotes.quote : null;
    },
    async getExpirations(symbol) {
        const d = await this._fetch(`/markets/options/expirations?symbol=${encodeURIComponent(symbol)}&includeAllRoots=true`);
        return d && d.expirations && d.expirations.date
            ? (Array.isArray(d.expirations.date) ? d.expirations.date : [d.expirations.date])
            : null;
    },
    async getChain(symbol, expiration) {
        const d = await this._fetch(`/markets/options/chains?symbol=${encodeURIComponent(symbol)}&expiration=${encodeURIComponent(expiration)}&greeks=true`);
        return d && d.options && d.options.option
            ? (Array.isArray(d.options.option) ? d.options.option : [d.options.option])
            : null;
    },
    // Account balance — normalized for sandbox (margin) and live (cash/pdt) shapes.
    async getAccount() {
        const id = this._accountId();
        const d = await this._fetch(`/accounts/${encodeURIComponent(id)}/balances`);
        if (!d || !d.balances) return null;
        const b = d.balances;
        const sub = b.margin || b.cash || b.pdt || {};
        return {
            total_equity: typeof b.total_equity === 'number' ? b.total_equity : null,
            cash: typeof b.total_cash === 'number' ? b.total_cash
                : (typeof sub.cash_available === 'number' ? sub.cash_available : null),
            day_change: typeof b.open_pl === 'number' ? b.open_pl
                : (typeof b.close_pl === 'number' ? b.close_pl : null),
            account_number: b.account_number || id,
            buying_power: typeof sub.stock_buying_power === 'number' ? sub.stock_buying_power
                : (typeof sub.option_buying_power === 'number' ? sub.option_buying_power : null),
            raw: b,
        };
    },
    async getPositions() {
        const id = this._accountId();
        const d = await this._fetch(`/accounts/${encodeURIComponent(id)}/positions`);
        if (!d || !d.positions || !d.positions.position) return [];
        const arr = Array.isArray(d.positions.position) ? d.positions.position : [d.positions.position];
        return arr.map(p => ({
            symbol: p.symbol,
            quantity: p.quantity,
            cost_basis: p.cost_basis,
            date_acquired: p.date_acquired,
            id: p.id,
        }));
    },
    async getOrders() {
        const id = this._accountId();
        const d = await this._fetch(`/accounts/${encodeURIComponent(id)}/orders?includeTags=true`);
        if (!d || !d.orders || !d.orders.order) return [];
        const arr = Array.isArray(d.orders.order) ? d.orders.order : [d.orders.order];
        return arr;
    },
    // Order construction — handles both equity and option tickets. For options
    // pass `option_symbol` (OCC format). `class` is auto-derived from presence
    // of option_symbol unless explicitly overridden.
    _buildOrderForm({ symbol, side, quantity, type, price, duration, option_symbol, klass, stop }) {
        const cls = klass || (option_symbol ? 'option' : 'equity');
        const form = {
            class: cls,
            symbol: (symbol || '').toUpperCase(),
            side: side,
            quantity: quantity,
            type: type || 'market',
            duration: duration || 'day',
        };
        if (option_symbol) form.option_symbol = String(option_symbol).toUpperCase();
        if (form.type === 'limit' || form.type === 'stop_limit') form.price = price;
        if (form.type === 'stop'  || form.type === 'stop_limit') form.stop  = stop;
        return form;
    },
    async previewOrder(opts) {
        const id = this._accountId();
        const form = this._buildOrderForm(opts);
        return await this._send(`/accounts/${encodeURIComponent(id)}/orders?preview=true`, 'POST', form);
    },
    async placeOrder(opts) {
        const id = this._accountId();
        const form = this._buildOrderForm(opts);
        return await this._send(`/accounts/${encodeURIComponent(id)}/orders`, 'POST', form);
    },
    async cancelOrder(orderId) {
        const id = this._accountId();
        return await this._send(`/accounts/${encodeURIComponent(id)}/orders/${encodeURIComponent(orderId)}`, 'DELETE', null);
    },
};
window.TradierAPI = TradierAPI;

// ========== TECHNICAL ANALYSIS ==========
const TechnicalAnalysis = {
    // Simple Moving Average
    sma(data, period) {
        const result = [];
        for (let i = 0; i < data.length; i++) {
            if (i < period - 1) {
                result.push(null);
            } else {
                let sum = 0;
                for (let j = i - period + 1; j <= i; j++) sum += data[j];
                result.push(sum / period);
            }
        }
        return result;
    },

    // Exponential Moving Average
    ema(data, period) {
        const result = [];
        const k = 2 / (period + 1);
        let ema = null;
        for (let i = 0; i < data.length; i++) {
            if (i < period - 1) {
                result.push(null);
            } else if (i === period - 1) {
                let sum = 0;
                for (let j = 0; j < period; j++) sum += data[j];
                ema = sum / period;
                result.push(ema);
            } else {
                ema = data[i] * k + ema * (1 - k);
                result.push(ema);
            }
        }
        return result;
    },

    // RSI (Wilder's smoothing, period=14 default)
    rsi(closes, period = 14) {
        const result = [];
        let avgGain = 0, avgLoss = 0;
        for (let i = 0; i < closes.length; i++) {
            if (i === 0) {
                result.push(null);
                continue;
            }
            const change = closes[i] - closes[i - 1];
            const gain = change > 0 ? change : 0;
            const loss = change < 0 ? -change : 0;
            if (i <= period) {
                avgGain += gain;
                avgLoss += loss;
                if (i < period) {
                    result.push(null);
                } else {
                    avgGain /= period;
                    avgLoss /= period;
                    const rs = avgLoss === 0 ? 100 : avgGain / avgLoss;
                    result.push(100 - 100 / (1 + rs));
                }
            } else {
                avgGain = (avgGain * (period - 1) + gain) / period;
                avgLoss = (avgLoss * (period - 1) + loss) / period;
                const rs = avgLoss === 0 ? 100 : avgGain / avgLoss;
                result.push(100 - 100 / (1 + rs));
            }
        }
        return result;
    },

    // MACD (12, 26, 9 default)
    macd(closes, fast = 12, slow = 26, signal = 9) {
        const emaFast = this.ema(closes, fast);
        const emaSlow = this.ema(closes, slow);
        const macdLine = [];
        for (let i = 0; i < closes.length; i++) {
            if (emaFast[i] === null || emaSlow[i] === null) {
                macdLine.push(null);
            } else {
                macdLine.push(emaFast[i] - emaSlow[i]);
            }
        }
        // Filter out nulls for signal line calculation
        const macdValues = macdLine.filter(v => v !== null);
        const signalLine = this.ema(macdValues, signal);
        // Map signal line back to full length
        const fullSignal = [];
        let idx = 0;
        for (let i = 0; i < closes.length; i++) {
            if (macdLine[i] === null) {
                fullSignal.push(null);
            } else {
                fullSignal.push(signalLine[idx] || null);
                idx++;
            }
        }
        const histogram = [];
        for (let i = 0; i < closes.length; i++) {
            if (macdLine[i] === null || fullSignal[i] === null) {
                histogram.push(null);
            } else {
                histogram.push(macdLine[i] - fullSignal[i]);
            }
        }
        return { macdLine, signalLine: fullSignal, histogram };
    },

    // Bollinger Bands (period=20, stdDev=2)
    bollingerBands(closes, period = 20, mult = 2) {
        const middle = this.sma(closes, period);
        const upper = [], lower = [], bandwidth = [];
        for (let i = 0; i < closes.length; i++) {
            if (middle[i] === null) {
                upper.push(null);
                lower.push(null);
                bandwidth.push(null);
            } else {
                let sumSq = 0;
                for (let j = i - period + 1; j <= i; j++) {
                    sumSq += (closes[j] - middle[i]) ** 2;
                }
                const std = Math.sqrt(sumSq / period);
                upper.push(middle[i] + mult * std);
                lower.push(middle[i] - mult * std);
                bandwidth.push(middle[i] !== 0 ? (mult * std * 2) / middle[i] : 0);
            }
        }
        return { upper, middle, lower, bandwidth };
    },

    // All indicators at once for a given close array
    analyze(closes) {
        const rsi = this.rsi(closes);
        const macd = this.macd(closes);
        const bollinger = this.bollingerBands(closes);
        const sma20 = this.sma(closes, 20);
        const sma50 = this.sma(closes, 50);
        const sma200 = this.sma(closes, 200);
        const ema12 = this.ema(closes, 12);
        const ema26 = this.ema(closes, 26);

        // Generate signals based on latest values
        const signals = [];
        const last = closes.length - 1;
        const price = closes[last];

        // RSI signals
        const lastRsi = rsi[last];
        if (lastRsi !== null) {
            if (lastRsi < 30) signals.push({ type: 'buy', indicator: 'RSI', description: `RSI oversold at ${lastRsi.toFixed(1)}` });
            if (lastRsi > 70) signals.push({ type: 'sell', indicator: 'RSI', description: `RSI overbought at ${lastRsi.toFixed(1)}` });
        }

        // MACD signals
        if (macd.histogram[last] !== null && macd.histogram[last - 1] !== null) {
            if (macd.histogram[last] > 0 && macd.histogram[last - 1] <= 0) signals.push({ type: 'buy', indicator: 'MACD', description: 'MACD bullish crossover' });
            if (macd.histogram[last] < 0 && macd.histogram[last - 1] >= 0) signals.push({ type: 'sell', indicator: 'MACD', description: 'MACD bearish crossover' });
        }

        // Bollinger Band signals
        if (bollinger.lower[last] !== null) {
            if (price <= bollinger.lower[last]) signals.push({ type: 'buy', indicator: 'Bollinger', description: 'Price at lower Bollinger Band' });
            if (price >= bollinger.upper[last]) signals.push({ type: 'sell', indicator: 'Bollinger', description: 'Price at upper Bollinger Band' });
        }

        // SMA signals
        if (sma20[last] !== null && sma50[last] !== null) {
            if (sma20[last] > sma50[last] && sma20[last - 1] <= sma50[last - 1]) signals.push({ type: 'buy', indicator: 'SMA', description: 'SMA 20/50 golden cross' });
            if (sma20[last] < sma50[last] && sma20[last - 1] >= sma50[last - 1]) signals.push({ type: 'sell', indicator: 'SMA', description: 'SMA 20/50 death cross' });
        }
        if (sma50[last] !== null && sma200[last] !== null) {
            if (sma50[last] > sma200[last] && sma50[last - 1] <= sma200[last - 1]) signals.push({ type: 'buy', indicator: 'SMA', description: 'SMA 50/200 golden cross' });
            if (sma50[last] < sma200[last] && sma50[last - 1] >= sma200[last - 1]) signals.push({ type: 'sell', indicator: 'SMA', description: 'SMA 50/200 death cross' });
        }

        return { rsi, macd, bollinger, sma20, sma50, sma200, ema12, ema26, signals };
    }
};

