# TradeRadar — Project Brief for New Claude Chats

Paste this into a new Claude chat or into the System Prompt of a Claude Project to bring Claude up to speed instantly.

---

## What this is
**TradeRadar** — a personal trading dashboard that fuses real-time crypto + macro data with multi-LLM consensus analysis. Built for traders who want to see **cause before price**.

Repo: https://github.com/jjshay/TradeWatch
Owner: JJ Shay (jjshay@gmail.com) — Global Gauntlet AI, active options trader.

## Stack
- React 18 + Babel-standalone, **no build step** — every `*.jsx` is loaded via `<script type="text/babel">`
- Single-file Python HTTP server for local dev: `python3 -m http.server 8000`
- All state in localStorage (`tr_settings`, `tr_watchlist`, `tr_journal_entries`, `tr_alert_rules`, `tr_walkthrough_seen_v1`, etc.)
- CustomEvent bus (`tr:settings-changed`, `tr:tab-changed`, `tr:open-*`)
- No backend. All API calls are browser → third-party APIs with user-supplied keys in localStorage

## File layout
- `index.html` — app shell, routing, all script tags (~500 lines)
- `engine/*.js` — ~30 data-fetching modules (live-data, news, crypto, markets, fred, congress, prediction-markets, etc.)
- `screens/*.jsx` — 11 tab screens (drivers, summary, historical, projected, impact, recommend, news, calendar, signals, prices, flights)
- `tr-*.jsx` — shared UI and 25+ intelligence panel modals
- `scripts/` — optional morning briefing (Node script → Gmail SMTP)

## Key files to read first
| File | Purpose |
|---|---|
| `README.md` | High-level overview |
| `STRATEGY.md` | Why each tab exists, what it tells you |
| `TECHNICAL.md` | Architecture notes |
| `screens/drivers.jsx` | Landing page — the 15-tile scoreboard |
| `screens/summary.jsx` | Multi-LLM consensus predictions |
| `tr-header-extras.jsx` | Tab bar, live BTC ticker, gear menu |
| `tr-walkthrough.jsx` + `tr-walkthrough-content.jsx` | Per-tab first-visit guided tour |
| `engine/fred.js` | FRED macro data (uses corsproxy.io) |
| `engine/ai.js` | Multi-LLM orchestration (Claude / GPT / Gemini / Grok / Perplexity) |

## Data sources (CORS-friendly in-browser)
- **CoinGecko** — BTC + crypto prices, F&G, stablecoins (no key)
- **Finnhub** — stocks + ETF quotes (free key)
- **Stooq** — futures intraday (CORS-enabled for intraday, NOT daily)
- **FRED** — macro series, **requires CORS proxy** (corsproxy.io)
- **alternative.me** — Fear & Greed Index (no key)
- **GDELT** — news tone (no key, needs non-empty query)
- **OpenSky + ADSBExchange** — military aircraft tracking
- **LLMs** — Anthropic, OpenAI, Google (Gemini), xAI (Grok), Perplexity

## Known CORS gotchas
- FRED (CSV + JSON): no CORS headers — routed through `https://corsproxy.io/?`
- Stooq daily CSV (`/q/d/l`): blocked. Intraday (`/q/l/?`) works.
- Finnhub free tier returns zeros for `DX-Y.NYB`, `^VIX`, `^TNX` — use ETF proxies (UUP, VXX, IEF).

## Features currently shipped
- 11 screens, tabs + data-walk first-visit tours
- Multi-LLM predictions: Claude + GPT + Gemini + Grok (4 cards, consensus average)
- 22 intelligence panels accessible via ⌘⇧P launcher
- Position Sizing calc · Correlation Matrix · Scenario Playbook panels
- Trade Journal · Alerts (Telegram-ready) · Watchlist
- In-house TEST button that LLM-reviews every feature
- Tooltips (ℹ icons) on every metric
- Boot splash covers Babel compile time
- Self-pinned on LAN via `python3 -m http.server 8000`

## Color palette
```
ink000 #07090C  ink100 #0B0E13  ink200 #10141B  ink300 #171C24
edge rgba(255,255,255,0.06)
text #ffffff  textMid rgba(180,188,200,0.75)  textDim rgba(130,138,150,0.55)
signal #c9a227 (gold)  bull #6FCF8E  bear #D96B6B
btc #F7931A  oil #0077B5  spx #9AA3B2
claude #D97757  gpt #0077B5  gemini #4285F4  grok #B07BE6
```

## Conventions
- Every tab rendered at fixed 1280×820, scales down on mobile via CSS transform
- Tabs all render `TRTabBar` with `data-tab="<key>"` attrs for smoke tests
- Panels follow IIFE pattern (see `tr-13f-panel.jsx` as template)
- All new panels register in `index.html` PANEL_REG + `tr-panel-launcher.jsx` PANELS
- Parse-check before commit: `node -e "require('@babel/parser').parse(...)"`
- CI: `.github/workflows/smoke.yml` runs Playwright against every tab

## How to work on TradeRadar
1. `cd ~/TradeWatch && python3 -m http.server 8000`
2. Open `http://localhost:8000/`
3. Edit `*.jsx` → hard refresh browser (⌘⇧R)
4. No build step, no transpile
5. Settings gear → paste API keys in your browser's localStorage (or use `keys.local.js` which gitignored)

## What JJ values
- Direct, data-backed tone — no fluff
- Tight tables and bullet points
- Complete, functional code — never partial snippets
- Robust error handling with fallback strategies
- Parallel agent execution for multi-file work
