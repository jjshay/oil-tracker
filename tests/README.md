# TradeRadar — Playwright Smoke Tests

Lightweight smoke suite that loads each of the 10 TradeRadar tabs, screenshots them, and asserts no unexpected console errors.

## Setup

```bash
cd tests
npm install
npx playwright install chromium
```

## Run

Start a static server from the repo root (in one terminal), then run the tests (in another):

```bash
# From /Users/johnshay/TradeWatch
python3 -m http.server 8000 &

# From /Users/johnshay/TradeWatch/tests
npm test
```

Or as a one-liner from the repo root:

```bash
python3 -m http.server 8000 & cd tests && npm install && npx playwright install chromium && npm test
```

## Outputs

- `tests/snapshots/{tab}.png` — one screenshot per tab (10 total)
- `tests/report.md` — pass/fail summary table, written after the run
- `tests/playwright-report/` — full HTML report (view with `npm run report`)

## Tabs covered

`summary`, `historical`, `projected`, `impact`, `recommend`, `news`, `calendar`, `signals`, `prices`, `flights`.

## Notes

- Known noisy network errors (401/403/429 from market/news APIs without keys) are whitelisted and do NOT fail tests.
- Chromium only, headless, 30s per-test timeout, 1 worker (serial) — keeps screenshots deterministic.
- Config assumes the app is served at `http://localhost:8000`. Change `baseURL` in `playwright.config.js` if needed.
