# Tradewatch

> AI-powered market intelligence — crypto, oil, geopolitics & macro in one dashboard

Tradewatch is a single-page progressive web app that brings together real-time data across crypto, energy, equities, and geopolitical risk — then uses Claude AI to surface actionable intelligence. Built for traders who believe the biggest moves are driven by events, not charts alone.

---

## Features

### 📡 Crypto Radar
Live price cards for BTC, ETH, and the broader market. Swipe to watchlist, tap for AI-powered fundamental analysis.

### 🌍 GeoIntel
Three-pillar geopolitical-financial intelligence tool:
- **Historical** — Oil × BTC × S&P 500 correlation chart overlaid with annotated geopolitical events (Ukraine invasion, Iran nuclear talks, halving events, ETF approvals)
- **Projected** — Scenario model with sliders for Trump policy, Iran/Strait of Hormuz, Fed pivot, China, BTC institutional flow, and the CLARITY Act. Runs Monte Carlo projections through end of 2026
- **Impact** — Live options chain analysis via Tradier. AI picks the best risk/reward trade for your scenario

### 📈 Pulse
Real-time sentiment dashboard:
- Crypto & Equity Fear & Greed gauges
- VIX, AAII Bull/Bear survey, put/call ratio
- Yield curve (2s10s spread)
- BTC perpetual funding rate
- Augmento + LunarCrush social sentiment
- AFINN-scored news headlines
- Correlation matrix across BTC, Oil, Gold, DXY, S&P 500
- AI morning briefing

### 🎯 Predict
- **Markets** — Live Polymarket prediction markets (Economics, Crypto, Geopolitics, Politics, Middle East, Iran)
- **Futures** — WTI oil forward curve + BTC CME premium + Fed funds rate expectations
- **Flow** — Unusual options activity scanner (IBIT, COIN, USO, VXX) ranked by anomaly score
- **Accuracy** — Prediction market calibration tracker with Brier scores

### 💰 Portfolio
- Holdings tracker with live P&L
- Watchlist: BTC, IBIT, COIN, GLD, USO, VXX, UUP
- Price alerts with browser notifications
- Earnings calendar for watchlist tickers

### Additional Views
- **Research** — Deep-dive AI analysis on any crypto or macro topic
- **News** — RSS aggregation from 8 curated feeds + Messari
- **Analysis** — Technical indicators (RSI, MACD, Bollinger Bands, Fibonacci)
- **Charts** — Interactive candlestick charting
- **Dashboard** — Portfolio summary + macro overview
- **Tracker** — Position sizing and risk calculator

---

## Data Sources

| Source | Data | Auth |
|--------|------|------|
| FRED (St. Louis Fed) | WTI crude, S&P 500, VIX, yield curve, HY spreads, Gold, DXY | Free API key |
| Tradier | Live stocks, options chains, futures | Free API key |
| CoinGecko | Crypto prices, history, market data | None |
| Binance | BTC perpetual funding rate, CME premium | None |
| alternative.me | Crypto Fear & Greed index | None |
| Polymarket | Prediction market probabilities | None |
| Kalshi | US-regulated prediction markets | None |
| LunarCrush | Crypto social sentiment | API key |
| Augmento | Bitcoin social sentiment | API key |
| Blockchain.com | On-chain metrics (hash rate, mempool, addresses) | None |
| RSS.app | Curated news feeds | Subscription |
| Messari | Crypto news fallback | None |

---

## Setup

Tradewatch runs entirely in the browser — no backend, no build step.

```bash
git clone https://github.com/jjshay/tradewatch
cd tradewatch
# Serve locally — any static file server works
npx serve .
# or
python3 -m http.server 8080
```

Open `http://localhost:8080` and enter your API keys in **Settings** (⚙️ top right):
- **FRED API key** — [fred.stlouisfed.org/docs/api/api_key.html](https://fred.stlouisfed.org/docs/api/api_key.html) (free)
- **Tradier API key** — [tradier.com/api](https://developer.tradier.com) (free tier: 500 req/day)
- **Claude API key** — [console.anthropic.com](https://console.anthropic.com) (for AI analysis features)
- **LunarCrush key** — [lunarcrush.com/developers](https://lunarcrush.com/developers)
- **Augmento key** — [augmento.ai](https://augmento.ai)

### PWA Install
On mobile, tap **Share → Add to Home Screen** (iOS) or the install prompt (Android/Chrome) to install Tradewatch as a native-feeling app.

---

## Architecture

- **Vanilla JS** — no framework, no build toolchain, ships as static files
- **Progressive Web App** — service worker caches the app shell for offline use
- **`engine.js`** — core data engine: crypto prices, AI analysis (Claude), Black-Scholes, technical indicators
- **`geo-intel.js`** — FRED data fetcher, Tradier options API, GeoIntel scenario model
- **`pulse.js`** — sentiment engine: Fear & Greed, VIX, AAII, yield curve, funding rates, social sentiment, correlation matrix
- **`predict.js`** — prediction markets (Polymarket/Kalshi), futures curves, options flow scanner, calibration tracker
- **`portfolio.js`** — holdings, watchlist, price alerts, browser notifications
- **`onchain.js`** — Blockchain.com on-chain metrics
- **`events-db.js`** — ~80 annotated geopolitical and financial events (2020–2025)

---

## Strategy

See [STRATEGY.md](./STRATEGY.md) for the investment thesis behind the data this app tracks.

---

## License

MIT
