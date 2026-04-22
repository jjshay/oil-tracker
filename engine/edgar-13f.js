// ========== EDGAR 13F ==========
// SEC Form 13F-HR institutional holdings. Every investment manager with >$100M
// AUM must disclose long US-equity positions 45 days after quarter-end. This
// is the primary data source for tracking Berkshire, Bridgewater, Renaissance,
// Citadel, Point72, Soros, Millennium, Two Sigma, D.E. Shaw, Vanguard,
// BlackRock.
//
// Flow:
//   1) Full-text search index → filings list
//        https://efts.sec.gov/LATEST/search-index?q=&forms=13F-HR&ciks=CIK
//   2) Accession → information table XML
//        https://www.sec.gov/cgi-bin/browse-edgar?action=getcompany&CIK=...
//        https://www.sec.gov/Archives/edgar/data/{cik}/{acc-no-dashes}/{infotable}.xml
//
// Notes:
//   - data.sec.gov and www.sec.gov both require a User-Agent with contact info
//     (see SEC Fair Access policy). We send "TradeRadar jjshay@gmail.com".
//   - infotable XML is stable; we parse <infoTable> blocks via DOMParser.
//   - CUSIP → ticker is NOT in the 13F. We ship a minimal CUSIP→ticker map
//     covering the most common mega-cap holdings; everything else is returned
//     as raw name (UI will show name instead of ticker).
//
// Exposes:
//   window.EDGAR13F.FUNDS                              — known-fund roster
//   window.EDGAR13F.getRecent13Fs({ limit, force })    — cross-fund feed
//   window.EDGAR13F.getFundHoldings(cik, acc)          — { filing, holdings[] }
//   window.EDGAR13F.getLatestForFund(fundKey, { force })

const EDGAR13F = {
    UA: 'TradeRadar jjshay@gmail.com',
    SEARCH: 'https://efts.sec.gov/LATEST/search-index',
    SUB:    'https://data.sec.gov/submissions',
    ARCH:   'https://www.sec.gov/Archives/edgar/data',

    // Canonical tracking list. CIK is the SEC identifier (10-digit, unpadded
    // ok in URL).
    FUNDS: [
        { key: 'berkshire',    cik: '1067983', name: 'Berkshire Hathaway',    manager: 'Warren Buffett' },
        { key: 'bridgewater',  cik: '1350694', name: 'Bridgewater Associates', manager: 'Ray Dalio' },
        { key: 'renaissance',  cik: '1037389', name: 'Renaissance Technologies', manager: 'RenTec' },
        { key: 'citadel',      cik: '1423053', name: 'Citadel Advisors',      manager: 'Ken Griffin' },
        { key: 'point72',      cik: '1603466', name: 'Point72 Asset Mgmt',    manager: 'Steve Cohen' },
        { key: 'soros',        cik: '1029160', name: 'Soros Fund Management', manager: 'George Soros' },
        { key: 'millennium',   cik: '1273087', name: 'Millennium Mgmt',       manager: 'Izzy Englander' },
        { key: 'twosigma',     cik: '1179392', name: 'Two Sigma Investments', manager: 'Two Sigma' },
        { key: 'deshaw',       cik: '1009207', name: 'D.E. Shaw & Co.',       manager: 'D.E. Shaw' },
        { key: 'vanguard',     cik: '0102909', name: 'Vanguard Group',        manager: 'Vanguard' },
        { key: 'blackrock',    cik: '1364742', name: 'BlackRock Inc.',        manager: 'Larry Fink' },
    ],

    // Minimal CUSIP → ticker map (mega-caps most likely to appear across
    // tracked funds). Extend organically. CUSIPs are 9-char, the first 6
    // identify the issuer.
    CUSIP2TKR: {
        '037833100': 'AAPL',    // Apple
        '594918104': 'MSFT',    // Microsoft
        '023135106': 'AMZN',    // Amazon
        '02079K305': 'GOOG',    // Alphabet C
        '02079K107': 'GOOGL',   // Alphabet A
        '30303M102': 'META',    // Meta
        '67066G104': 'NVDA',    // NVIDIA
        '88160R101': 'TSLA',    // Tesla
        '084670702': 'BRK-B',   // Berkshire B
        '46625H100': 'JPM',     // JP Morgan
        '931142103': 'WMT',     // Walmart
        '30231G102': 'XOM',     // Exxon
        '91324P102': 'UNH',     // UnitedHealth
        '532457108': 'LLY',     // Eli Lilly
        '92826C839': 'V',       // Visa
        '57636Q104': 'MA',      // Mastercard
        '437076102': 'HD',      // Home Depot
        '22160K105': 'COST',    // Costco
        '79466L302': 'CRM',     // Salesforce
        '68389X105': 'ORCL',    // Oracle
        '458140100': 'INTC',    // Intel
        '00724F101': 'ADBE',    // Adobe
        '17275R102': 'CSCO',    // Cisco
        '64110L106': 'NFLX',    // Netflix
        '11135F101': 'AVGO',    // Broadcom
        '191216100': 'KO',      // Coca-Cola
        '717081103': 'PFE',     // Pfizer
        '375558103': 'GILD',    // Gilead
        '06050Q104': 'BAC',     // Bank of America
        '949746101': 'WFC',     // Wells Fargo
    },

    cache: {
        recent: null,          // { time, rows }
        byFund: {},            // key -> { time, filings, holdings }
        holdings: {},          // `${cik}|${acc}` -> { time, data }
    },
    cacheExpiryMs: 60 * 60 * 1000, // 1h — 13Fs don't move intraday

    // -------------------------------------------------------------------
    // PUBLIC: getRecent13Fs — merge newest 13F filings across known funds
    // -------------------------------------------------------------------
    async getRecent13Fs(opts) {
        opts = opts || {};
        const limit = Math.max(1, Math.min(100, opts.limit || 20));
        const force = !!opts.force;

        const c = this.cache.recent;
        if (!force && c && Date.now() - c.time < this.cacheExpiryMs) {
            return c.rows.slice(0, limit);
        }

        const out = [];
        for (const f of this.FUNDS) {
            try {
                const filings = await this._listFundFilings(f.cik);
                if (!filings.length) continue;
                filings.forEach(fi => {
                    out.push({
                        fundKey: f.key,
                        fundName: f.name,
                        manager: f.manager,
                        cik: f.cik,
                        accession: fi.accession,
                        filedDate: fi.filedDate,
                        periodEnding: fi.periodEnding,
                        form: fi.form,
                    });
                });
            } catch (_) { /* soldier on */ }
        }

        out.sort((a, b) => {
            const da = a.filedDate ? new Date(a.filedDate).getTime() : 0;
            const db = b.filedDate ? new Date(b.filedDate).getTime() : 0;
            return db - da;
        });

        this.cache.recent = { time: Date.now(), rows: out };
        return out.slice(0, limit);
    },

    // -------------------------------------------------------------------
    // PUBLIC: getLatestForFund — returns { filing, holdings[] }
    // -------------------------------------------------------------------
    async getLatestForFund(fundKey, opts) {
        opts = opts || {};
        const fund = this.FUNDS.find(f => f.key === fundKey);
        if (!fund) return null;

        const force = !!opts.force;
        const cachedF = this.cache.byFund[fundKey];
        if (!force && cachedF && Date.now() - cachedF.time < this.cacheExpiryMs) {
            return cachedF.data;
        }

        const filings = await this._listFundFilings(fund.cik);
        if (!filings.length) return null;

        // Take the two most recent to support position-change highlighting.
        const latest = filings[0];
        const prior  = filings[1] || null;

        const latestHoldings = await this.getFundHoldings(fund.cik, latest.accession);
        let priorHoldings = [];
        if (prior) {
            try {
                const prev = await this.getFundHoldings(fund.cik, prior.accession);
                priorHoldings = (prev && prev.holdings) || [];
            } catch (_) { /* ignore */ }
        }

        const priorMap = new Map();
        priorHoldings.forEach(h => priorMap.set(h.cusip, h));

        const holdings = (latestHoldings && latestHoldings.holdings) || [];
        // Mark new / sold / held
        holdings.forEach(h => {
            const p = priorMap.get(h.cusip);
            if (!p) {
                h.status = 'new';
                h.changeFromPrior = h.value;
            } else {
                const delta = (h.value || 0) - (p.value || 0);
                h.status = delta > 0 ? 'added' : delta < 0 ? 'reduced' : 'held';
                h.changeFromPrior = delta;
            }
        });
        const soldPositions = priorHoldings
            .filter(p => !holdings.some(h => h.cusip === p.cusip))
            .map(p => Object.assign({}, p, { status: 'sold', changeFromPrior: -1 * (p.value || 0) }));

        const data = {
            fund,
            filing: latest,
            priorFiling: prior,
            holdings,
            soldPositions,
        };

        this.cache.byFund[fundKey] = { time: Date.now(), data };
        return data;
    },

    // -------------------------------------------------------------------
    // PUBLIC: getFundHoldings(cik, accession) → { filing, holdings[] }
    // -------------------------------------------------------------------
    async getFundHoldings(cik, accession) {
        const cacheKey = `${cik}|${accession}`;
        const cached = this.cache.holdings[cacheKey];
        if (cached && Date.now() - cached.time < 7 * 24 * 60 * 60 * 1000) {
            return cached.data;
        }
        const accNoDash = accession.replace(/-/g, '');
        const base = `${this.ARCH}/${Number(cik)}/${accNoDash}`;
        // Step 1: list files in the accession folder via index.json
        let files = [];
        try {
            const r = await fetch(base + '/index.json', { headers: { 'User-Agent': this.UA, 'Accept': 'application/json' } });
            if (r.ok) {
                const j = await r.json();
                files = ((j.directory && j.directory.item) || []).map(it => it.name);
            }
        } catch (_) { /* ignore */ }

        // Find information-table XML (usually ends with .xml and is NOT primary_doc.xml)
        const infoName = files.find(n => /infor?mation\s*table/i.test(n))
            || files.find(n => /infotable|inftable|holdings/i.test(n))
            || files.find(n => /\.xml$/i.test(n) && !/primary_doc/i.test(n));

        if (!infoName) {
            const empty = { filing: { cik, accession }, holdings: [] };
            this.cache.holdings[cacheKey] = { time: Date.now(), data: empty };
            return empty;
        }

        let xml = '';
        try {
            const r = await fetch(`${base}/${infoName}`, { headers: { 'User-Agent': this.UA, 'Accept': 'application/xml' } });
            if (r.ok) xml = await r.text();
        } catch (_) { /* ignore */ }

        const holdings = this._parseInfoTable(xml);
        // Aggregate duplicate CUSIP rows (multiple putCall / security classes)
        const agg = new Map();
        holdings.forEach(h => {
            const k = h.cusip || h.name;
            const e = agg.get(k);
            if (!e) { agg.set(k, Object.assign({}, h)); return; }
            e.value += h.value;
            e.shares += h.shares;
        });
        const merged = Array.from(agg.values());
        merged.sort((a, b) => (b.value || 0) - (a.value || 0));

        const data = { filing: { cik, accession }, holdings: merged };
        this.cache.holdings[cacheKey] = { time: Date.now(), data };
        return data;
    },

    // ===================================================================
    // Internals
    // ===================================================================
    async _listFundFilings(cik) {
        // Use data.sec.gov/submissions/CIK#########.json to get recent filings
        const paddedCik = String(cik).padStart(10, '0');
        const url = `${this.SUB}/CIK${paddedCik}.json`;
        let j = null;
        try {
            const r = await fetch(url, { headers: { 'User-Agent': this.UA, 'Accept': 'application/json' } });
            if (!r.ok) return [];
            j = await r.json();
        } catch (_) { return []; }

        const recent = (j.filings && j.filings.recent) || {};
        const forms   = recent.form || [];
        const accs    = recent.accessionNumber || [];
        const dates   = recent.filingDate || [];
        const periods = recent.reportDate || [];

        const out = [];
        for (let i = 0; i < forms.length; i++) {
            const f = forms[i];
            if (!/13F-HR/.test(f)) continue;
            out.push({
                accession: accs[i] || '',
                filedDate: dates[i] || '',
                periodEnding: periods[i] || '',
                form: f,
            });
            if (out.length >= 8) break;
        }
        return out;
    },

    _parseInfoTable(xml) {
        if (!xml) return [];
        try {
            const parser = new DOMParser();
            const doc = parser.parseFromString(xml, 'application/xml');
            const nodes = doc.getElementsByTagName('infoTable');
            if (!nodes || !nodes.length) {
                // Retry with namespace-stripped text if SEC ships a default ns
                const stripped = xml.replace(/<\/?([a-z0-9]+:)/gi, (m, p1) => m.replace(p1, ''));
                const doc2 = parser.parseFromString(stripped, 'application/xml');
                return this._parseInfoTableDoc(doc2);
            }
            return this._parseInfoTableDoc(doc);
        } catch (_) { return []; }
    },

    _parseInfoTableDoc(doc) {
        const nodes = doc.getElementsByTagName('infoTable');
        const out = [];
        for (let i = 0; i < nodes.length; i++) {
            const n = nodes[i];
            const t = tag => {
                const el = n.getElementsByTagName(tag);
                return el && el.length ? (el[0].textContent || '').trim() : '';
            };
            const name   = t('nameOfIssuer');
            const cusip  = t('cusip');
            const value  = parseFloat(t('value')) || 0;
            // SEC changed scaling in 2022: "value" is now raw dollars (not x1000).
            // Pre-2023 filings reported in thousands. Heuristic: if value < 1e7
            // and there's a shrsOrPrnAmt > value*100 it's probably thousands.
            const sharesStr = t('sshPrnamt');
            const shares = parseFloat(sharesStr) || 0;
            const classTitle = t('titleOfClass');
            const putCall = t('putCall');
            if (!name && !cusip) continue;
            // Use the modern raw-dollar convention; we'll format with K/M/B.
            out.push({
                name, cusip,
                value,
                shares,
                classTitle,
                putCall,
                ticker: (this.CUSIP2TKR[cusip] || '').toUpperCase(),
            });
        }
        return out;
    },
};

window.EDGAR13F = EDGAR13F;
