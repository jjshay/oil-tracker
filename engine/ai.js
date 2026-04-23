const AIAnalysis = {
    // Keys come from TR_SETTINGS (new TradeRadar Settings sheet) OR the legacy
    // oilradar_ai_keys localStorage blob, whichever has a value. TR_SETTINGS wins.
    getKeys() {
        let legacy = {};
        try { legacy = JSON.parse(localStorage.getItem('oilradar_ai_keys') || '{}'); } catch {}
        const tr = (window.TR_SETTINGS && window.TR_SETTINGS.keys) || {};
        // Map TR_SETTINGS field names → legacy names where they differ
        const merged = {
            ...legacy,
            claude: tr.claude   || legacy.claude   || '',
            openai: tr.openai   || legacy.openai   || '',
            gemini: tr.gemini   || legacy.gemini   || '',
            grok:   tr.grok     || legacy.grok     || '',
        };
        return merged;
    },
    setKeys(keys) {
        localStorage.setItem('oilradar_ai_keys', JSON.stringify(keys));
    },
    get keys() {
        return this.getKeys();
    },

    // Run all configured LLMs in parallel on the same prompt → per-model results
    // plus a consensus block. Claude + ChatGPT + Gemini (+ optional Grok).
    async analyzeWithPerplexity(headlines) {
        try {
            const resp = await fetch('https://api.perplexity.ai/chat/completions', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${this.keys.perplexity}`
                },
                body: JSON.stringify({
                    model: 'sonar',
                    messages: [{ role: 'user', content: this._buildPrompt(headlines) }],
                    temperature: 0.3,
                    max_tokens: 1500
                })
            });
            if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
            const data = await resp.json();
            const text = data.choices?.[0]?.message?.content || '';
            return { model: 'Perplexity Sonar', result: this._parseJSON(text), raw: text, error: null };
        } catch (e) {
            return { model: 'Perplexity Sonar', result: null, raw: null, error: e.message };
        }
    },

    // Default: Claude + GPT only (the "main two"). Cuts cost + latency.
    // Opt in to more via options: { includeGemini, includeGrok, includePerplexity, full: true }
    async runMulti(headlines, opts = {}) {
        const { includeGemini, includeGrok, includePerplexity, full } = opts;
        const keys = this.getKeys();
        const skip = (model) => Promise.resolve({ model, result: null, raw: null, error: 'no key' });

        const tasks = {
            claude: keys.claude ? this.analyzeWithClaude(headlines) : skip('Claude Sonnet'),
            gpt:    keys.openai ? this.analyzeWithOpenAI(headlines) : skip('GPT-4o Mini'),
        };
        if (full || includeGemini)     tasks.gemini     = keys.gemini     ? this.analyzeWithGemini(headlines)     : skip('Gemini 2.5 Flash');
        if (full || includeGrok)       tasks.grok       = keys.grok       ? this.analyzeWithGrok(headlines)       : skip('Grok 4');
        if (full || includePerplexity) tasks.perplexity = keys.perplexity ? this.analyzeWithPerplexity(headlines) : skip('Perplexity Sonar');

        const keysArr = Object.keys(tasks);
        const vals = await Promise.all(keysArr.map(k => tasks[k]));
        const out = {};
        keysArr.forEach((k, i) => out[k] = vals[i]);

        // Consensus across whichever models returned valid results
        const valid = keysArr.filter(k => out[k].result);
        let consensus = null;
        if (valid.length >= 2) {
            const sentiments = valid.map(k => out[k].result.sentiment);
            const confs = valid.map(k => Number(out[k].result.confidence) || 0);
            const unique = [...new Set(sentiments)];
            const agree = unique.length === 1;
            const avgConf = (confs.reduce((a, b) => a + b, 0) / confs.length).toFixed(1);
            const modelNames = { claude: 'Claude', gpt: 'GPT', gemini: 'Gemini', grok: 'Grok' };
            consensus = {
                agree,
                sentiment: agree ? unique[0] : unique.join(' vs '),
                avgConfidence: avgConf,
                label: agree ? 'ALIGNED' : 'DIVERGENT',
                modelCount: valid.length,
                summary: agree
                    ? `All ${valid.length} models agree: ${unique[0].toUpperCase()}. Avg confidence ${avgConf}/10.`
                    : `${valid.length} models split — ${valid.map((k, i) => `${modelNames[k]} ${sentiments[i]} (${confs[i]}/10)`).join(' · ')}. Reduce size until alignment.`,
                opportunities: [].concat(...valid.map(k => out[k].result.opportunities || [])).slice(0, 6),
                risks:         [].concat(...valid.map(k => out[k].result.risks || [])).slice(0, 6),
            };
        }

        return { ...out, consensus };
    },

    // Backward-compat wrapper
    async runDual(headlines) { return this.runMulti(headlines); },

    _buildPrompt(headlines) {
        return `You are a crypto market analyst. Analyze these recent blockchain/crypto headlines and provide actionable trading insights.

HEADLINES:
${headlines.map((h, i) => `${i + 1}. [${h.source}] ${h.title}`).join('\n')}

Respond in this exact JSON format (no markdown, just raw JSON):
{
  "sentiment": "bullish" | "bearish" | "neutral",
  "confidence": 1-10,
  "summary": "2-3 sentence market summary",
  "actionable": [
    {"headline_index": 1, "action": "BUY/SELL/WATCH", "asset": "BTC/ETH/SOL/etc", "reasoning": "brief reason", "urgency": "high/medium/low"}
  ],
  "risks": ["risk 1", "risk 2"],
  "opportunities": ["opportunity 1", "opportunity 2"]
}`;
    },

    async analyzeWithGemini(headlines) {
        try {
            const resp = await fetch(
                `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key=${this.keys.gemini}`,
                {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                        contents: [{ parts: [{ text: this._buildPrompt(headlines) }] }],
                        generationConfig: { temperature: 0.3, maxOutputTokens: 1500 }
                    })
                }
            );
            if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
            const data = await resp.json();
            const text = data.candidates?.[0]?.content?.parts?.[0]?.text || '';
            return { model: 'Gemini 2.0 Flash', result: this._parseJSON(text), raw: text, error: null };
        } catch (e) {
            return { model: 'Gemini 2.0 Flash', result: null, raw: null, error: e.message };
        }
    },

    async analyzeWithOpenAI(headlines) {
        try {
            const resp = await fetch('https://api.openai.com/v1/chat/completions', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${this.keys.openai}`
                },
                body: JSON.stringify({
                    model: 'gpt-4o-mini',
                    messages: [{ role: 'user', content: this._buildPrompt(headlines) }],
                    temperature: 0.3,
                    max_tokens: 1500
                })
            });
            if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
            const data = await resp.json();
            const text = data.choices?.[0]?.message?.content || '';
            return { model: 'GPT-4o Mini', result: this._parseJSON(text), raw: text, error: null };
        } catch (e) {
            return { model: 'GPT-4o Mini', result: null, raw: null, error: e.message };
        }
    },

    async analyzeWithClaude(headlines) {
        try {
            const resp = await fetch('https://api.anthropic.com/v1/messages', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'x-api-key': this.keys.claude,
                    'anthropic-version': '2023-06-01',
                    'anthropic-dangerous-direct-browser-access': 'true'
                },
                body: JSON.stringify({
                    model: 'claude-sonnet-4-6',
                    max_tokens: 1500,
                    messages: [{ role: 'user', content: this._buildPrompt(headlines) }]
                })
            });
            if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
            const data = await resp.json();
            const text = data.content?.[0]?.text || '';
            return { model: 'Claude Sonnet', result: this._parseJSON(text), raw: text, error: null };
        } catch (e) {
            return { model: 'Claude Sonnet', result: null, raw: null, error: e.message };
        }
    },

    async analyzeWithGrok(headlines) {
        try {
            const resp = await fetch('https://api.x.ai/v1/chat/completions', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${this.keys.grok}`
                },
                body: JSON.stringify({
                    model: 'grok-3-mini-fast',
                    messages: [{ role: 'user', content: this._buildPrompt(headlines) }],
                    temperature: 0.3,
                    max_tokens: 1500
                })
            });
            if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
            const data = await resp.json();
            const text = data.choices?.[0]?.message?.content || '';
            return { model: 'Grok 3 Mini', result: this._parseJSON(text), raw: text, error: null };
        } catch (e) {
            return { model: 'Grok 3 Mini', result: null, raw: null, error: e.message };
        }
    },

    _buildBriefingPrompt(headlines) {
        return `You are a seasoned crypto market analyst delivering a 2-minute audio briefing. Cover: (1) overall crypto market sentiment from today's news, (2) key events that could move blockchain and crypto markets, (3) historical parallels (reference specific past events), (4) actionable trades with entry points and risk levels, (5) 1-week and 1-month outlook.

RECENT HEADLINES:
${headlines.map((h, i) => `${i + 1}. [${h.source}] ${h.title}`).join('\n')}

Write the briefing as natural spoken text (no JSON, no bullet points, no markdown). Use conversational language suitable for text-to-speech. Start with "Here's your market briefing." and end with a clear recommendation. Keep it under 500 words.`;
    },

    async getBriefing(headlines) {
        // Try Gemini first (most reliable for browser CORS), then fallback to others
        const attempts = [
            () => this._briefingGemini(headlines),
            () => this._briefingOpenAI(headlines),
            () => this._briefingGrok(headlines),
            () => this._briefingClaude(headlines)
        ];
        for (const attempt of attempts) {
            const result = await attempt();
            if (result.text) return result;
        }
        return { model: 'None', text: null, error: 'All AI models failed to respond.' };
    },

    async _briefingGemini(headlines) {
        try {
            const resp = await fetch(
                `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key=${this.keys.gemini}`,
                {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                        contents: [{ parts: [{ text: this._buildBriefingPrompt(headlines) }] }],
                        generationConfig: { temperature: 0.5, maxOutputTokens: 2000 }
                    })
                }
            );
            if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
            const data = await resp.json();
            return { model: 'Gemini 2.0 Flash', text: data.candidates?.[0]?.content?.parts?.[0]?.text || null, error: null };
        } catch (e) {
            return { model: 'Gemini 2.0 Flash', text: null, error: e.message };
        }
    },

    async _briefingOpenAI(headlines) {
        try {
            const resp = await fetch('https://api.openai.com/v1/chat/completions', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${this.keys.openai}` },
                body: JSON.stringify({
                    model: 'gpt-4o-mini',
                    messages: [{ role: 'user', content: this._buildBriefingPrompt(headlines) }],
                    temperature: 0.5, max_tokens: 2000
                })
            });
            if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
            const data = await resp.json();
            return { model: 'GPT-4o Mini', text: data.choices?.[0]?.message?.content || null, error: null };
        } catch (e) {
            return { model: 'GPT-4o Mini', text: null, error: e.message };
        }
    },

    async _briefingGrok(headlines) {
        try {
            const resp = await fetch('https://api.x.ai/v1/chat/completions', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${this.keys.grok}` },
                body: JSON.stringify({
                    model: 'grok-3-mini-fast',
                    messages: [{ role: 'user', content: this._buildBriefingPrompt(headlines) }],
                    temperature: 0.5, max_tokens: 2000
                })
            });
            if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
            const data = await resp.json();
            return { model: 'Grok 3 Mini', text: data.choices?.[0]?.message?.content || null, error: null };
        } catch (e) {
            return { model: 'Grok 3 Mini', text: null, error: e.message };
        }
    },

    async _briefingClaude(headlines) {
        try {
            const resp = await fetch('https://api.anthropic.com/v1/messages', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'x-api-key': this.keys.claude,
                    'anthropic-version': '2023-06-01',
                    'anthropic-dangerous-direct-browser-access': 'true'
                },
                body: JSON.stringify({
                    model: 'claude-sonnet-4-6',
                    max_tokens: 2000,
                    messages: [{ role: 'user', content: this._buildBriefingPrompt(headlines) }]
                })
            });
            if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
            const data = await resp.json();
            return { model: 'Claude Sonnet', text: data.content?.[0]?.text || null, error: null };
        } catch (e) {
            return { model: 'Claude Sonnet', text: null, error: e.message };
        }
    },

    async analyzeAll(headlines) {
        const results = await Promise.allSettled([
            this.analyzeWithGemini(headlines),
            this.analyzeWithOpenAI(headlines),
            this.analyzeWithClaude(headlines),
            this.analyzeWithGrok(headlines)
        ]);
        return results.map(r => r.status === 'fulfilled' ? r.value : { model: 'Unknown', result: null, error: r.reason?.message || 'Failed' });
    },

    _parseJSON(text) {
        try {
            // Try to extract JSON from the response (handle markdown code blocks)
            const jsonMatch = text.match(/\{[\s\S]*\}/);
            if (jsonMatch) return JSON.parse(jsonMatch[0]);
            return null;
        } catch (e) {
            return null;
        }
    },

    // Chat conversation management
    chatHistory: {},

    getChatHistory(model) {
        if (!this.chatHistory[model]) {
            try {
                this.chatHistory[model] = JSON.parse(localStorage.getItem(`cryptoradar_chat_${model}`) || '[]');
            } catch { this.chatHistory[model] = []; }
        }
        return this.chatHistory[model];
    },

    saveChatHistory(model) {
        const history = this.chatHistory[model] || [];
        // Keep last 50 messages
        const trimmed = history.slice(-50);
        localStorage.setItem(`cryptoradar_chat_${model}`, JSON.stringify(trimmed));
    },

    addMessage(model, role, content) {
        if (!this.chatHistory[model]) this.chatHistory[model] = [];
        this.chatHistory[model].push({ role, content, timestamp: Date.now() });
        this.saveChatHistory(model);
    },

    clearChatHistory(model) {
        this.chatHistory[model] = [];
        localStorage.removeItem(`cryptoradar_chat_${model}`);
    },

    _buildChatPrompt(question, context) {
        return `You are a crypto market analyst. The user is asking about crypto markets.

CURRENT MARKET CONTEXT:
${context || 'No market data available.'}

Answer the user's question concisely and actionably. Focus on specific assets, entry/exit points, and risk levels. If relevant, reference historical events and technical levels.

User's question: ${question}`;
    },

    async chatWithGemini(question, context) {
        const keys = this.getKeys();
        if (!keys.gemini) return { model: 'Gemini', text: null, error: 'No API key set' };
        const history = this.getChatHistory('gemini').slice(-6);
        const messages = history.map(m => ({ parts: [{ text: m.content }], role: m.role === 'user' ? 'user' : 'model' }));
        messages.push({ parts: [{ text: this._buildChatPrompt(question, context) }], role: 'user' });
        try {
            const resp = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key=${keys.gemini}`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ contents: messages, generationConfig: { temperature: 0.5, maxOutputTokens: 2000 } })
            });
            if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
            const data = await resp.json();
            const text = data.candidates?.[0]?.content?.parts?.[0]?.text || null;
            if (text) { this.addMessage('gemini', 'user', question); this.addMessage('gemini', 'assistant', text); }
            return { model: 'Gemini', text, error: null };
        } catch (e) { return { model: 'Gemini', text: null, error: e.message }; }
    },

    async chatWithOpenAI(question, context) {
        const keys = this.getKeys();
        if (!keys.openai) return { model: 'GPT-4o', text: null, error: 'No API key set' };
        const history = this.getChatHistory('openai').slice(-6);
        const messages = [{ role: 'system', content: 'You are a crypto market analyst. Be concise and actionable.' }];
        history.forEach(m => messages.push({ role: m.role === 'user' ? 'user' : 'assistant', content: m.content }));
        messages.push({ role: 'user', content: this._buildChatPrompt(question, context) });
        try {
            const resp = await fetch('https://api.openai.com/v1/chat/completions', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${keys.openai}` },
                body: JSON.stringify({ model: 'gpt-4o-mini', messages, temperature: 0.5, max_tokens: 2000 })
            });
            if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
            const data = await resp.json();
            const text = data.choices?.[0]?.message?.content || null;
            if (text) { this.addMessage('openai', 'user', question); this.addMessage('openai', 'assistant', text); }
            return { model: 'GPT-4o', text, error: null };
        } catch (e) { return { model: 'GPT-4o', text: null, error: e.message }; }
    },

    async chatWithClaude(question, context) {
        const keys = this.getKeys();
        if (!keys.claude) return { model: 'Claude', text: null, error: 'No API key set' };
        const history = this.getChatHistory('claude').slice(-6);
        const messages = history.map(m => ({ role: m.role === 'user' ? 'user' : 'assistant', content: m.content }));
        messages.push({ role: 'user', content: this._buildChatPrompt(question, context) });
        try {
            const resp = await fetch('https://api.anthropic.com/v1/messages', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json', 'x-api-key': keys.claude, 'anthropic-version': '2023-06-01', 'anthropic-dangerous-direct-browser-access': 'true' },
                body: JSON.stringify({ model: 'claude-sonnet-4-6', max_tokens: 2000, messages })
            });
            if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
            const data = await resp.json();
            const text = data.content?.[0]?.text || null;
            if (text) { this.addMessage('claude', 'user', question); this.addMessage('claude', 'assistant', text); }
            return { model: 'Claude', text, error: null };
        } catch (e) { return { model: 'Claude', text: null, error: e.message }; }
    },

    async chatWithGrok(question, context) {
        const keys = this.getKeys();
        if (!keys.grok) return { model: 'Grok', text: null, error: 'No API key set' };
        const history = this.getChatHistory('grok').slice(-6);
        const messages = [{ role: 'system', content: 'You are a crypto market analyst. Be concise and actionable.' }];
        history.forEach(m => messages.push({ role: m.role === 'user' ? 'user' : 'assistant', content: m.content }));
        messages.push({ role: 'user', content: this._buildChatPrompt(question, context) });
        try {
            const resp = await fetch('https://api.x.ai/v1/chat/completions', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${keys.grok}` },
                body: JSON.stringify({ model: 'grok-3-mini-fast', messages, temperature: 0.5, max_tokens: 2000 })
            });
            if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
            const data = await resp.json();
            const text = data.choices?.[0]?.message?.content || null;
            if (text) { this.addMessage('grok', 'user', question); this.addMessage('grok', 'assistant', text); }
            return { model: 'Grok', text, error: null };
        } catch (e) { return { model: 'Grok', text: null, error: e.message }; }
    },

    async chatWithPerplexity(question, context) {
        const keys = this.getKeys();
        if (!keys.perplexity) return { model: 'Perplexity', text: null, error: 'No API key set' };
        const history = this.getChatHistory('perplexity').slice(-6);
        const messages = [{ role: 'system', content: 'You are a crypto market analyst with real-time web search capabilities. Be concise and actionable. Cite sources when possible.' }];
        history.forEach(m => messages.push({ role: m.role === 'user' ? 'user' : 'assistant', content: m.content }));
        messages.push({ role: 'user', content: this._buildChatPrompt(question, context) });
        try {
            const resp = await fetch('https://api.perplexity.ai/chat/completions', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${keys.perplexity}` },
                body: JSON.stringify({ model: 'sonar', messages, temperature: 0.5, max_tokens: 2000 })
            });
            if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
            const data = await resp.json();
            const text = data.choices?.[0]?.message?.content || null;
            if (text) { this.addMessage('perplexity', 'user', question); this.addMessage('perplexity', 'assistant', text); }
            return { model: 'Perplexity', text, error: null };
        } catch (e) { return { model: 'Perplexity', text: null, error: e.message }; }
    },

    async chatAll(question, context) {
        return Promise.allSettled([
            this.chatWithGemini(question, context),
            this.chatWithOpenAI(question, context),
            this.chatWithClaude(question, context),
            this.chatWithGrok(question, context),
            this.chatWithPerplexity(question, context)
        ]).then(results => results.map(r => r.status === 'fulfilled' ? r.value : { model: 'Unknown', text: null, error: r.reason?.message }));
    }
};


// ========== COMPOSED EXPORT ==========
// Kept for back-compat with anything referencing window.DataEngine.
window.DataEngine = {
    MathUtil, BlackScholes, MonteCarlo, Correlation,
    LiveData, HISTORICAL_EVENTS, VOLATILITY_DB, CORRELATION_REF,
    Backtester, NewsFeed, AIAnalysis,
    TechnicalAnalysis, OnChainData, DeFiData, DerivativesData,
    CRYPTO_SCENARIOS,
};
