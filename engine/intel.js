// ========== AI ANALYSIS ENGINE ==========
// Telegram — outbound alerts via Bot API. User creates a bot at @BotFather,
// pastes the token + their chat_id in Settings. Then signals can push notes.
// To get chat_id: DM your bot any message, then fetch getUpdates.
const TelegramAlert = {
    token() {
        return (window.TR_SETTINGS && window.TR_SETTINGS.keys && window.TR_SETTINGS.keys.telegramBot) || '';
    },
    chatId() {
        return (window.TR_SETTINGS && window.TR_SETTINGS.keys && window.TR_SETTINGS.keys.telegramChatId) || '';
    },
    async send(text, { parseMode = 'HTML' } = {}) {
        const token = this.token();
        const chat  = this.chatId();
        if (!token || !chat) return { ok: false, error: 'no bot token or chat id' };
        try {
            const url = `https://api.telegram.org/bot${token}/sendMessage`;
            const r = await fetch(url, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ chat_id: chat, text, parse_mode: parseMode, disable_web_page_preview: true }),
            });
            const j = await r.json();
            return { ok: j.ok === true, result: j };
        } catch (e) { return { ok: false, error: e.message }; }
    },
    // Pull last 5 messages the bot received — useful to grab your own chat_id.
    async getUpdates() {
        const token = this.token();
        if (!token) return null;
        try {
            const r = await fetch(`https://api.telegram.org/bot${token}/getUpdates?limit=5`);
            const j = await r.json();
            return j;
        } catch (e) { return null; }
    },
};
window.TelegramAlert = TelegramAlert;

// MilitaryFlights — pulls live ADS-B state vectors from OpenSky Network.
// Free public API, no key required. Bounded query over the CENTCOM/Middle East
// theater (Iran, Iraq, Saudi, Gulf, eastern Med). Filters for US-origin
// callsigns that match known military prefixes (RCH/CNV/PAT/HAVEN/SPAR/BAT).
const MilitaryFlights = {
    // lat 15–40, lon 30–65 covers Egypt → eastern Iran, including all Gulf
    BBOX: { lamin: 15, lamax: 40, lomin: 30, lomax: 65 },
    CALLSIGN_PREFIXES: [
        'RCH',  // US Air Mobility Command (transport/tanker)
        'CNV',  // US Navy
        'PAT',  // US Army
        'SPAR', // USAF executive
        'HAVEN',// USAF tanker
        'BAT',  // USAF strategic
        'BLUE', // Various USAF
        'RYDR', // USN VP
        'SLAM', // USAF strategic
        'GOLD', // Various
    ],
    async getMidEast() {
        try {
            const b = this.BBOX;
            const url = `https://opensky-network.org/api/states/all?lamin=${b.lamin}&lomin=${b.lomin}&lamax=${b.lamax}&lomax=${b.lomax}`;
            const r = await fetch(url);
            if (!r.ok) return null;
            const data = await r.json();
            if (!data || !data.states) return null;
            // OpenSky state vector shape (positional array):
            // [icao24, callsign, originCountry, timePosition, lastContact, long, lat, baroAlt, onGround, velocity, heading, vertRate, sensors, geoAlt, squawk, spi, posSource]
            const all = data.states.map(s => ({
                icao24: s[0], callsign: (s[1] || '').trim(), country: s[2],
                lon: s[5], lat: s[6], alt: s[7], onGround: s[8], velocity: s[9],
            })).filter(a => a.callsign);

            const mil = all.filter(a => {
                if (a.country !== 'United States') return false;
                return this.CALLSIGN_PREFIXES.some(p => a.callsign.toUpperCase().startsWith(p));
            });

            return {
                timestamp: data.time,
                total: all.length,
                usMil: mil,
                usMilCount: mil.length,
                bbox: b,
            };
        } catch (e) { return null; }
    },
};
window.MilitaryFlights = MilitaryFlights;

// Tradier wrapper — sandbox/live. Reads key + mode from TR_SETTINGS. Sandbox
// data is 15-min delayed; production needs paid plan. All endpoints return
// null on error so screens can fall back to designed defaults.
