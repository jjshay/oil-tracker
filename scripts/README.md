# TradeRadar scripts

## daily-briefing.js — Morning Brief (7-section HTML)

Emails a structured morning digest to `jjshay@gmail.com` every weekday at
**06:00 Pacific** (launchd) or via GitHub Actions cron (see below).

### What's in the email

| # | Section | Contents |
|---|---------|----------|
| — | **Header** | Logo + date + 6:00 AM PST stamp; 3-tile bar (BTC, WTI, VIX) |
| 1 | **Overnight Updates** | Top 6 relevance-scored news catalysts (keywords: fed, iran, hormuz, israel, crude, opec, bitcoin, etf, cpi, fomc, clarity, tariff, china, etc.) — headline · source · time · 1-line implication |
| 2 | **LLM Thought Shift** | Claude + GPT + Gemini + Grok in parallel. Each returns year-end BTC + WTI targets + 1-sentence delta. Consensus = mean of the 4; spread = high − low. Regime = dominant label across responders. |
| 3 | **Model Impact (Drivers)** | 6 TradeRadar driver IDs (regime-dxy, btc-ibit-flow, btc-funding, hormuz-mil, oil-opec, spx-10y) shown `prev → current`; shifted drivers highlighted gold. Verdict line: "Model-implied BTC $X · WTI $Y · Spread $Z." |
| 4 | **Oil Impact** | WTI spot, Brent–WTI spread, overnight oil catalysts, Hormuz read. Directional chip: **Oil: BULLISH / BEARISH / NEUTRAL · $X expected by YE**. |
| 5 | **Bitcoin Impact** | BTC spot, BTC-specific catalysts, ETF/MSTR/COIN notes. Directional chip: **BTC: BULLISH / BEARISH / NEUTRAL · $X expected by YE**. |
| 6 | **Overall Verdict** | Big chip `BULLISH · 72/100` style, 0–100 score (heuristic on regime + 24h + drivers), regime label (RISK-ON / MIXED / RISK-OFF), 2-sentence rationale. |
| 7 | **Investment Profile** (personalized) | Position table (BTC direct, COIN Dec $340C x2, cash). Per-position mkt value, P&L, % of book, and a `HOLD / ADD / TRIM / CLOSE` chip with reasoning. Ends with a cash-deployment suggestion conditioned on regime. |

### LLMs

| Provider | Model |
|----------|-------|
| Anthropic | `claude-sonnet-4-6` |
| OpenAI    | `gpt-4o-mini` |
| Google    | `gemini-2.5-flash` |
| xAI       | `grok-3-mini-fast` |

All 4 fire in a single `Promise.all`, temperature `0.4`, max_tokens `1000`.
Any LLM that 4xx/5xx/times-out is skipped — email still ships with the
responders it has. JSON parsing is tolerant (strips ```json fences, falls
back to regex-extract the first `{…}`).

Missing LLM keys are optional. Missing `GMAIL_USER` / `GMAIL_APP_PW` are
fatal (the script exits 1).

---

## Schedule: 06:00 Pacific, Mon–Fri

**Old:** 06:00 ET (`Hour=6` on an ET Mac).
**New:** 06:00 PT — launchd uses LOCAL time, so set `<Hour>` to match
your Mac's TZ:

| Mac TZ | `<Hour>` in plist |
|--------|-------------------|
| America/Los_Angeles (PT) | **6** (default in the example file) |
| America/New_York (ET)    | 9 |
| America/Chicago (CT)     | 8 |
| America/Denver (MT)      | 7 |
| UTC                      | 13 (PST) / 14 (PDT) — drifts across DST |

Check your TZ: `sudo systemsetup -gettimezone`.

### Cloud cron alternative (laptop-independent)

launchd does NOT wake a sleeping Mac. For guaranteed delivery, run on
GitHub Actions:

```yaml
name: traderadar-morning-brief
on:
  schedule:
    - cron: '0 14 * * 1-5'   # 14:00 UTC = 7 AM EDT / 6 AM PDT (most of the year)
    - cron: '0 15 * * 1-5'   # 15:00 UTC = 7 AM EST / 6 AM PST (standard time)
  workflow_dispatch:
jobs:
  send:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with: { node-version: '20' }
      - run: npm ci
      - run: node scripts/daily-briefing.js
        env:
          GMAIL_USER:        ${{ secrets.GMAIL_USER }}
          GMAIL_APP_PW:      ${{ secrets.GMAIL_APP_PW }}
          ANTHROPIC_API_KEY: ${{ secrets.ANTHROPIC_API_KEY }}
          OPENAI_API_KEY:    ${{ secrets.OPENAI_API_KEY }}
          GEMINI_API_KEY:    ${{ secrets.GEMINI_API_KEY }}
          XAI_API_KEY:       ${{ secrets.XAI_API_KEY }}
          PUBLIC_URL:        https://traderadar.ggauntlet.com/
```

Two schedules cover both DST windows. DST caveat: GitHub cron granularity
is ~5 min and occasionally skips under load — still more reliable than a
sleeping MacBook.

---

## Positions file (Section 7)

The personalized investment profile pulls positions from (in priority order):

1. `$POSITIONS_JSON_PATH` env var (if set)
2. `~/Library/Application Support/TradeRadar/positions.json` (default)
3. The hardcoded `USER_POSITIONS_DEFAULT` constant inside `daily-briefing.js`

### Format

```json
{
  "cash": 4621,
  "positions": [
    {
      "symbol": "BTC",
      "kind": "spot",
      "qty": 0.01089,
      "costBasis": 98848,
      "currentValue": 1076.48
    },
    {
      "symbol": "COIN",
      "kind": "option",
      "right": "C",
      "strike": 340,
      "expiry": "2026-12-18",
      "contracts": 2,
      "costPerContract": 1525
    }
  ]
}
```

### Default (seeded in the script)

- BTC direct: 0.01089 @ cost $98,848 → ~$1,076 current
- COIN Dec 18 2026 $340C × 2 @ $1,525/contract → $3,050 premium
- Cash: $4,621
- Total book: ~$8,747

Spot positions are marked-to-market live against CoinGecko BTC. Option
positions show premium paid (live mark is TODO — Finnhub option chain or
Tradier needed).

### Create the override file

```bash
mkdir -p "$HOME/Library/Application Support/TradeRadar"
cat > "$HOME/Library/Application Support/TradeRadar/positions.json" <<'JSON'
{ "cash": 4621, "positions": [ ... ] }
JSON
```

---

## Env vars (all optional except Gmail)

| Var | Purpose |
|-----|---------|
| `GMAIL_USER`, `GMAIL_APP_PW` | **Required.** 16-char Gmail App Password. |
| `TO_EMAIL` | Recipient (default `jjshay@gmail.com`). |
| `ANTHROPIC_API_KEY` | Claude. |
| `OPENAI_API_KEY` | GPT. |
| `GEMINI_API_KEY` | Gemini. |
| `XAI_API_KEY` | Grok. |
| `FINNHUB_API_KEY` | Reserved for future option-chain MTM (not currently required). |
| `FRED_API_KEY` | Reserved; the script uses FRED's public CSV endpoint (no key needed). |
| `PUBLIC_URL` | Link target in header/footer (default `https://traderadar.ggauntlet.com/`). |
| `POSITIONS_JSON_PATH` | Override path for the positions file. |

---

## Manual test

```bash
cd /Users/johnshay/TradeWatch
node scripts/daily-briefing.js
```

Expected output:

```
[briefing] fetching overnight data…
[briefing] catalysts=6 · btc=68421 · wti=78.42
[briefing] firing 4 LLMs in parallel…
[briefing] 4/4 LLMs responded
[briefing] sent: <message-id>
```

Syntax check:

```bash
node --check scripts/daily-briefing.js
plutil -lint scripts/com.traderadar.briefing.plist.example
```

You can also use the npm alias from the repo root:

```bash
npm run briefing
```

---

## launchd install (macOS, recommended)

```bash
# 1. Verify node path
which node

# 2. Drop template into LaunchAgents
cp /Users/johnshay/TradeWatch/scripts/com.traderadar.briefing.plist.example \
   ~/Library/LaunchAgents/com.traderadar.briefing.plist

# 3. Pick the right <Hour> for your Mac's TZ (see table above)

# 4. Load (auto-loads on every login)
launchctl load ~/Library/LaunchAgents/com.traderadar.briefing.plist

# 5. Smoke-test
launchctl start com.traderadar.briefing
tail -f /Users/johnshay/TradeWatch/logs/briefing.log
```

### Uninstall / reschedule

```bash
launchctl unload ~/Library/LaunchAgents/com.traderadar.briefing.plist
# edit plist, then:
launchctl load   ~/Library/LaunchAgents/com.traderadar.briefing.plist
# or remove:
rm ~/Library/LaunchAgents/com.traderadar.briefing.plist
```

### Status

```bash
launchctl list | grep traderadar         # presence = loaded, 3rd column = last exit code
tail -n 100 /Users/johnshay/TradeWatch/logs/briefing.log
tail -n 100 /Users/johnshay/TradeWatch/logs/briefing.err
```

---

## Alt: crontab (local)

```bash
crontab -e
# 06:00 PT Mon-Fri:
0 6 * * 1-5 cd /Users/johnshay/TradeWatch && /usr/local/bin/node scripts/daily-briefing.js >> logs/briefing.log 2>&1
```

Cron does not inherit your shell PATH — pin the node binary absolutely.

---

## Troubleshooting

| Symptom | Likely cause | Fix |
|---------|-------------|-----|
| `ERROR: set GMAIL_USER + GMAIL_APP_PW in .env` | `.env` missing or mis-located | `.env` must live at repo root (`/Users/johnshay/TradeWatch/.env`), NOT in `scripts/`. |
| `Invalid login: 535-5.7.8` | Using regular Gmail password | Generate a 16-char App Password at <https://myaccount.google.com/apppasswords>. |
| launchd loads but never fires | Mac asleep at 06:00 | launchd does NOT wake the Mac. Use lid-open + power, or move to GitHub Actions cron. |
| Fires at wrong time after travel | Mac TZ changed | Edit `<Hour>` in the plist to match the new local time for 6 AM PT (see TZ table). |
| `0/4 LLMs responded` | Keys absent / rate-limited / invalid | Email still ships; Section 2 is empty, consensus + verdict fall back to neutrals. |
| Section 7 shows default positions | No `positions.json` override | Create `~/Library/Application Support/TradeRadar/positions.json` or set `POSITIONS_JSON_PATH`. |
| WTI / VIX tiles blank | FRED CSV endpoint timed out | Transient — retry. The script degrades gracefully. |
| Email HTML looks broken in Outlook | Outlook doesn't render flexbox | Open in Gmail web; the email is tested there. |

### Most likely failure modes

1. **rss2json rate limit** (free tier ~10k/day) — news section empties, LLM thought-shift runs without catalysts.
2. **All LLM keys unset** — sections 2/6 degrade; drivers/oil/BTC still render from macro + news.
3. **Mac asleep at 06:00 PT** — brief skipped until next wake. Move to GitHub Actions for reliability.

---

## Files

| File | Purpose |
|------|---------|
| `daily-briefing.js` | The 7-section morning brief script. Node 20+. |
| `.env.example` | Env template (mirrored at repo root). |
| `package.json` | Local manifest (repo-root is source of truth for installs). |
| `com.traderadar.briefing.plist.example` | launchd agent (06:00 local Mon–Fri). |
| `verify_fred.js` | Unrelated — FRED API smoke test. |
| `README.md` | This file. |
