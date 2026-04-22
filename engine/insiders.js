// ========== INSIDERS ==========
// SEC Form 4 insider-transaction feed via Finnhub.
// Documented alpha: cluster C-suite purchases ("P", open-market buys >$100k)
// frequently precede earnings beats and positive guidance. Form 4 dispositions
// "S" are noisier — often scheduled 10b5-1 sales — so default UI tab is BUYS.
//
// Endpoint:
//   https://finnhub.io/api/v1/stock/insider-transactions?symbol=X&from=Y&to=Z&token=KEY
//
// Returned row (Finnhub):
//   { change, currency, filingDate, id, isDerivative, name, share,
//     source, symbol, transactionCode, transactionDate, transactionPrice }
//
// transactionCode reference (SEC):
//   P = Open-market purchase  (BULLISH)
//   S = Open-market sale
//   A = Grant / award
//   M = Exercise of derivative
//   F = Tax withholding
//   G = Gift                  (ignored)
//   C = Conversion
//
// Exposes:
//   window.InsiderData.getRecent({ limit, tickers, force })   → Row[]
//   window.InsiderData.getForSymbol(sym, { limit, force })    → Row[]
//   window.InsiderData.isSignificant(row)                     → bool
//   window.InsiderData.isCSuite(relation)                     → bool
//
// Row shape (normalized):
//   { symbol, filerName, relation, transactionCode, typeLabel,
//     shares, price, value, transactionDate, filingDate, source,
//     significant, cSuite, gold }

const InsiderData = {
    BASE: 'https://finnhub.io/api/v1/stock/insider-transactions',

    // Focus universe — liquid large/mid caps + retail-favorite tickers
    TICKERS: [
        'AAPL','MSFT','NVDA','GOOGL','META','AMZN','TSLA','AMD','NFLX','AVGO',
        'BRK.B','JPM','WMT','XOM','UNH','LLY','V','MA','HD','COST',
        'PLTR','SOFI','COIN','MSTR','HOOD','CRM','ORCL','INTC','CSCO','ADBE',
    ],

    cache: { rows: [], time: 0, bySymbol: {} },
    cacheExpiryMs: 20 * 60 * 1000, // 20m — Finnhub free tier: 60 req/min

    _key() {
        return (window.TR_SETTINGS && window.TR_SETTINGS.keys && window.TR_SETTINGS.keys.finnhub) || '';
    },

    // -------------------------------------------------------------------
    // PUBLIC: getRecent — sweeps TICKERS, merges recent trades.
    // opts = { limit?, tickers?: string[], force?: bool }
    // -------------------------------------------------------------------
    async getRecent(opts) {
        opts = opts || {};
        const limit = Math.max(1, Math.min(500, opts.limit || 30));
        const force = !!opts.force;
        const tickers = Array.isArray(opts.tickers) && opts.tickers.length
            ? opts.tickers
            : this.TICKERS;

        if (!force
            && this.cache.rows.length
            && Date.now() - this.cache.time < this.cacheExpiryMs) {
            return this.cache.rows.slice(0, limit);
        }

        const key = this._key();
        if (!key) {
            return this.cache.rows.length ? this.cache.rows.slice(0, limit) : [];
        }

        const to = this._todayStr();
        const from = this._daysAgoStr(90);

        const all = [];
        // Chunk to respect rate limits — 6 parallel requests per batch.
        const CHUNK = 6;
        for (let i = 0; i < tickers.length; i += CHUNK) {
            const slice = tickers.slice(i, i + CHUNK);
            const batch = await Promise.all(slice.map(sym =>
                this._fetchSymbol(sym, from, to, key).catch(() => [])));
            batch.forEach(rows => { if (rows && rows.length) all.push(...rows); });
            // small pause between chunks
            if (i + CHUNK < tickers.length) {
                await new Promise(r => setTimeout(r, 250));
            }
        }

        // Normalize, filter, sort
        const rows = all.map(r => this._normalize(r)).filter(Boolean);
        // Sort by filingDate desc then value desc
        rows.sort((a, b) => {
            const da = a.filingDate ? new Date(a.filingDate).getTime() : 0;
            const db = b.filingDate ? new Date(b.filingDate).getTime() : 0;
            return db - da || (b.value || 0) - (a.value || 0);
        });

        this.cache = { rows, time: Date.now(), bySymbol: this.cache.bySymbol };
        return rows.slice(0, limit);
    },

    // -------------------------------------------------------------------
    // PUBLIC: getForSymbol
    // -------------------------------------------------------------------
    async getForSymbol(sym, opts) {
        opts = opts || {};
        const limit = Math.max(1, Math.min(200, opts.limit || 20));
        const force = !!opts.force;
        sym = String(sym || '').toUpperCase().trim();
        if (!sym) return [];

        const cached = this.cache.bySymbol[sym];
        if (!force && cached && Date.now() - cached.time < this.cacheExpiryMs) {
            return cached.rows.slice(0, limit);
        }

        const key = this._key();
        if (!key) return cached ? cached.rows.slice(0, limit) : [];

        const to = this._todayStr();
        const from = this._daysAgoStr(180);
        const raw = await this._fetchSymbol(sym, from, to, key).catch(() => []);
        const rows = raw.map(r => this._normalize(r)).filter(Boolean);
        rows.sort((a, b) => {
            const da = a.filingDate ? new Date(a.filingDate).getTime() : 0;
            const db = b.filingDate ? new Date(b.filingDate).getTime() : 0;
            return db - da;
        });
        this.cache.bySymbol[sym] = { rows, time: Date.now() };
        return rows.slice(0, limit);
    },

    // -------------------------------------------------------------------
    // Filters
    // -------------------------------------------------------------------
    isCSuite(relation) {
        if (!relation) return false;
        const r = String(relation).toLowerCase();
        return /(ceo|cfo|coo|cto|president|chair|director|10%|officer)/.test(r);
    },
    isSignificant(row) {
        if (!row) return false;
        const isBuy = row.transactionCode === 'P';
        if (!isBuy) return false;
        if ((row.value || 0) >= 100000) return true;
        if (this.isCSuite(row.relation)) return true;
        return false;
    },

    // ===================================================================
    // Internals
    // ===================================================================
    async _fetchSymbol(sym, from, to, key) {
        const url = `${this.BASE}?symbol=${encodeURIComponent(sym)}&from=${from}&to=${to}&token=${encodeURIComponent(key)}`;
        const r = await fetch(url, { headers: { 'Accept': 'application/json' } });
        if (!r.ok) return [];
        const j = await r.json();
        if (!j || !Array.isArray(j.data)) return [];
        return j.data.map(row => Object.assign({ symbol: sym }, row));
    },

    _normalize(raw) {
        if (!raw || typeof raw !== 'object') return null;
        const code   = String(raw.transactionCode || '').toUpperCase().trim();
        const name   = String(raw.name || '').trim();
        // Finnhub does not provide "relation" — infer from filerName heuristics
        // plus known title keywords in the name column where present.
        const relation = this._inferRelation(name, raw);

        const shares = Number(raw.change) || 0;                // signed share delta
        const absShares = Math.abs(shares);
        const price  = Number(raw.transactionPrice) || 0;
        // For buys (P) value = shares*price; for sells (S) keep positive value.
        const value  = absShares * price;

        const symbol = String(raw.symbol || '').toUpperCase();
        const txDate = String(raw.transactionDate || '').slice(0, 10);
        const fDate  = String(raw.filingDate || '').slice(0, 10);

        const typeLabel = this._labelForCode(code, shares);

        const row = {
            symbol,
            filerName: name || '—',
            relation,
            transactionCode: code,
            typeLabel,
            shares: absShares,
            sharesDelta: shares,
            price,
            value,
            transactionDate: txDate,
            filingDate: fDate,
            source: raw.source || 'sec',
            id: raw.id || '',
        };
        row.cSuite = this.isCSuite(relation);
        row.significant = this.isSignificant(row);
        // Gold-highlight: CEO/CFO/Director buys above $500k
        row.gold = code === 'P'
            && value >= 500000
            && /(ceo|cfo|director|president|chair)/i.test(relation);
        return row;
    },

    _labelForCode(code, shares) {
        switch (code) {
            case 'P': return 'BUY';
            case 'S': return 'SELL';
            case 'A': return 'AWARD';
            case 'M': return 'EXERCISE';
            case 'F': return 'TAX WH';
            case 'G': return 'GIFT';
            case 'C': return 'CONVERT';
            case 'D': return 'DISP';
            case 'X': return 'EXPIRE';
            default:
                if (shares > 0) return code ? code + ' (+)' : 'ACQ';
                if (shares < 0) return code ? code + ' (-)' : 'DISP';
                return code || '—';
        }
    },

    _inferRelation(name, raw) {
        const n = String(name || '').toLowerCase();
        // Finnhub sometimes embeds a role hint in the name field.
        if (/ceo|chief executive/.test(n))  return 'CEO';
        if (/cfo|chief financial/.test(n))  return 'CFO';
        if (/coo|chief operating/.test(n))  return 'COO';
        if (/cto|chief technology/.test(n)) return 'CTO';
        if (/director/.test(n))             return 'Director';
        if (/10%|10 pct|beneficial owner/.test(n)) return '10% Owner';
        if (/officer/.test(n))              return 'Officer';
        // Fallback: try raw.position / raw.title if Finnhub ever adds it.
        return raw && (raw.position || raw.title || raw.relation) || '';
    },

    _todayStr() {
        const d = new Date();
        return d.toISOString().slice(0, 10);
    },
    _daysAgoStr(n) {
        const d = new Date();
        d.setDate(d.getDate() - n);
        return d.toISOString().slice(0, 10);
    },
};

window.InsiderData = InsiderData;
