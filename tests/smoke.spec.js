// @ts-check
// TradeRadar smoke test suite.
// For each of the 10 tabs: load the app, click the tab, wait for the header,
// screenshot, and assert no non-whitelisted console errors.
// After all tabs run, a combined tests/report.md is written.

const { test, expect } = require('@playwright/test');
const fs = require('fs');
const path = require('path');

const TABS = [
  'summary', 'historical', 'projected', 'impact', 'recommend',
  'news', 'calendar', 'signals', 'prices', 'flights',
];

// Label (case-insensitive) used to click the tab. The TR header renders each
// tab as a <div> containing the capitalized label, so we click by text.
const TAB_LABEL = {
  summary:    'Summary',
  historical: 'Historical',
  projected:  'Projected',
  impact:     'Impact',
  recommend:  'Recommend',
  news:       'News',
  calendar:   'Calendar',
  signals:    'Signals',
  prices:     'Prices',
  flights:    'Flights',
};

// Regexes for known network noise we DO NOT want to fail the test on:
// 401 / 403 / 429 from upstream market/news APIs are expected when keys
// are absent in the test environment. Leaflet tile CORS / AbortError
// and benign React dev warnings are also tolerated.
const ALLOWED_ERROR_PATTERNS = [
  /401/i,
  /403/i,
  /429/i,
  /Failed to load resource/i,
  /net::ERR_/i,
  /AbortError/i,
  /CORS/i,
  /ERR_BLOCKED_BY_CLIENT/i,
  /coingecko|cryptocompare|alternative\.me|tradier|polygon|newsapi|gdeltproject|aviationstack|openskynetwork|fixer|yahoo/i,
];

function isAllowedError(msg) {
  if (!msg) return true;
  return ALLOWED_ERROR_PATTERNS.some((re) => re.test(msg));
}

const SNAPSHOT_DIR = path.join(__dirname, 'snapshots');
const REPORT_PATH = path.join(__dirname, 'report.md');

// Aggregated results collected across all test cases, then flushed to report.md.
const results = [];

test.beforeAll(() => {
  if (!fs.existsSync(SNAPSHOT_DIR)) {
    fs.mkdirSync(SNAPSHOT_DIR, { recursive: true });
  }
});

test.afterAll(() => {
  const lines = [];
  lines.push('# TradeRadar Smoke Test Report');
  lines.push('');
  lines.push(`Generated: ${new Date().toISOString()}`);
  lines.push('');
  lines.push('| Tab | Result | Console Errors | Notes |');
  lines.push('|---|---|---|---|');
  let pass = 0;
  let fail = 0;
  for (const r of results) {
    if (r.ok) pass += 1;
    else fail += 1;
    const status = r.ok ? 'PASS' : 'FAIL';
    const notes = (r.notes || '').replace(/\|/g, '\\|');
    lines.push(`| ${r.tab} | ${status} | ${r.errorCount} | ${notes} |`);
  }
  lines.push('');
  lines.push(`**Totals:** ${pass} passed, ${fail} failed, ${results.length} total.`);
  lines.push('');
  fs.writeFileSync(REPORT_PATH, lines.join('\n'), 'utf8');
});

for (const tab of TABS) {
  test(`tab: ${tab} renders without blocking errors`, async ({ page }) => {
    const consoleErrors = [];
    const pageErrors = [];

    page.on('console', (msg) => {
      if (msg.type() === 'error') {
        const text = msg.text();
        if (!isAllowedError(text)) consoleErrors.push(text);
      }
    });
    page.on('pageerror', (err) => {
      const text = err && err.message ? err.message : String(err);
      if (!isAllowedError(text)) pageErrors.push(text);
    });

    let ok = false;
    let notes = '';
    try {
      await page.goto('/', { waitUntil: 'domcontentloaded' });

      // The app boots via Babel-standalone — give React a beat to mount the shell.
      await page.waitForSelector('.tr-shell', { timeout: 15_000 });

      // Navigate to the requested tab. Summary is the default; for every other
      // tab, click its label in the TR header nav bar.
      if (tab !== 'summary') {
        const label = TAB_LABEL[tab];
        // Multiple headers may exist (some screens render their own), so pick
        // the first visible match.
        const navTarget = page.getByText(label, { exact: true }).first();
        await navTarget.waitFor({ state: 'visible', timeout: 10_000 });
        await navTarget.click();
      }

      // Allow the screen to render its header + first paint.
      await page.waitForTimeout(1200);

      // Basic header sanity check — TradeRadar wordmark is present on every screen.
      await expect(page.getByText('TradeRadar').first()).toBeVisible({ timeout: 5_000 });

      // Capture screenshot.
      await page.screenshot({
        path: path.join(SNAPSHOT_DIR, `${tab}.png`),
        fullPage: false,
      });

      const totalErrors = consoleErrors.length + pageErrors.length;
      if (totalErrors > 0) {
        notes = `errors: ${[...consoleErrors, ...pageErrors].slice(0, 3).join(' | ')}`;
      }
      expect(totalErrors, `Unexpected console/page errors on tab "${tab}"`).toBe(0);
      ok = true;
    } catch (err) {
      notes = (err && err.message ? err.message : String(err)).split('\n')[0];
      throw err;
    } finally {
      results.push({
        tab,
        ok,
        errorCount: consoleErrors.length + pageErrors.length,
        notes,
      });
    }
  });
}
