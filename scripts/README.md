# TradeRadar scripts

## daily-briefing.js — daily email digest

Sends a formatted HTML briefing to `jjshay@gmail.com` with BTC spot, Fear & Greed,
live BTC-tied portfolio (IBIT / MSTR / COIN / BITB / MARA), top headlines, and a
Claude + ChatGPT + Gemini + Grok consensus block.

**Runs:** 06:00 America/New_York, Monday through Friday (via macOS launchd).

Single Node script, zero external services besides the APIs it calls. Exits 0 on
success, 1 on any unrecoverable error (see `logs/briefing.err`). Missing LLM keys
are skipped silently — the script still runs as long as Gmail credentials are
present.

---

## One-time setup checklist

- [ ] **Enable 2-Step Verification** on your Google account (required before App
      Passwords exist as an option).
- [ ] **Generate a Gmail App Password** at
      <https://myaccount.google.com/apppasswords> — label it "TradeRadar". Copy
      the 16-character code.
- [ ] **Copy the env template:**
      ```bash
      cd /Users/johnshay/TradeWatch
      cp .env.example .env
      ```
      (The script reads `.env` from the repo root, not from `scripts/`.)
- [ ] **Paste the App Password** into `.env` as `GMAIL_APP_PW` (spaces optional).
- [ ] **Paste API keys** for whichever LLM providers you want. See
      [`scripts/.env.example`](./.env.example) for direct sign-up links. Any
      missing provider is gracefully skipped.
- [ ] **Install dependencies** (from the repo root, which owns the lockfile):
      ```bash
      npm install
      ```
- [ ] **Create the log directory** so launchd can write to it:
      ```bash
      mkdir -p /Users/johnshay/TradeWatch/logs
      ```

---

## Manual test

Fire the script right now, bypassing the schedule:

```bash
cd /Users/johnshay/TradeWatch
node scripts/daily-briefing.js
```

Expected output:

```
[briefing] fetching data…
[briefing] firing LLMs…
[briefing] 4/4 LLMs responded
[briefing] sent: <message-id>
```

And an email should arrive at `TO_EMAIL` within ~30 seconds. If you see
`0/4 LLMs responded`, keys are missing or invalid — the email still sends but
without the consensus block.

You can also use the npm alias from the repo root:

```bash
npm run briefing
```

---

## launchd install (macOS, recommended)

```bash
# 1. Verify node path (plist assumes /usr/local/bin/node — edit if different)
which node

# 2. Drop template into LaunchAgents, removing the .example suffix
cp /Users/johnshay/TradeWatch/scripts/com.traderadar.briefing.plist.example \
   ~/Library/LaunchAgents/com.traderadar.briefing.plist

# 3. Load (auto-loads on every login from this point forward)
launchctl load ~/Library/LaunchAgents/com.traderadar.briefing.plist

# 4. Smoke-test — fires the job immediately, does NOT wait for 06:00
launchctl start com.traderadar.briefing
tail -f /Users/johnshay/TradeWatch/logs/briefing.log
```

### Uninstall / reschedule

```bash
# Stop and unregister
launchctl unload ~/Library/LaunchAgents/com.traderadar.briefing.plist

# Edit the plist time/weekdays if needed, then reload
launchctl load ~/Library/LaunchAgents/com.traderadar.briefing.plist

# Or remove entirely
rm ~/Library/LaunchAgents/com.traderadar.briefing.plist
```

### Check status

```bash
launchctl list | grep traderadar         # presence = loaded, 3rd column = last exit code
tail -n 100 /Users/johnshay/TradeWatch/logs/briefing.log
tail -n 100 /Users/johnshay/TradeWatch/logs/briefing.err
```

---

## Alt: crontab

Cron does not inherit your shell PATH, so pin the node binary absolutely:

```bash
crontab -e
# add (runs 06:00 local Mon-Fri):
0 6 * * 1-5 cd /Users/johnshay/TradeWatch && /usr/local/bin/node scripts/daily-briefing.js >> logs/briefing.log 2>&1
```

For cloud-scheduled delivery (laptop-independent), port to a GitHub Action on
`schedule: cron: '0 10 * * 1-5'` (10:00 UTC = 06:00 ET during DST, 05:00 ET in
standard time — adjust for the season or use two schedules).

---

## Troubleshooting

| Symptom | Likely cause | Fix |
|---------|-------------|-----|
| `ERROR: set GMAIL_USER + GMAIL_APP_PW in .env` | `.env` missing, mis-located, or blank | Confirm `.env` lives at the **repo root** (`/Users/johnshay/TradeWatch/.env`), not inside `scripts/`. The script resolves `__dirname + ../..env`. |
| `Invalid login: 535-5.7.8 Username and Password not accepted` | Using your regular Gmail password, not an App Password. Or 2-Step Verification not enabled. | Generate an App Password at <https://myaccount.google.com/apppasswords>. Paste the 16-char code into `GMAIL_APP_PW`. |
| launchd job loads but never fires at 06:00 | Laptop was asleep at the scheduled time | launchd does NOT wake the Mac. Leave the lid open on power, or enable System Settings → Battery → "Wake for network access", or move to a cloud cron (GitHub Actions). |
| `/usr/local/bin/node: no such file or directory` in `briefing.err` | Apple-Silicon Homebrew installs node at `/opt/homebrew/bin/node`; nvm installs under `~/.nvm/…` | Run `which node` and paste that path into the plist's `<ProgramArguments>` first `<string>`, then `launchctl unload` + `load` to apply. |
| `0/4 LLMs responded` in logs, email has no consensus block | API keys absent, malformed, or out of quota | Keys are optional — add them to `.env`, or ignore. To diagnose, run manually and check stderr for HTTP status from each provider. |
| Email sends but portfolio block is missing | `FINNHUB_API_KEY` not set, or Finnhub free-tier rate-limited | Add the key or wait 60s and re-run. Free tier allows 60 req/min — 5 symbols is well under. |
| Consensus block says "Divergent" every day | Expected — it only reads "Aligned" when all responding LLMs return the same `sentiment` string. This is informational, not an error. | No action. |
| `Error: Cannot find module 'node-fetch'` | Dependencies not installed at repo root | `cd /Users/johnshay/TradeWatch && npm install` |
| Email arrives but HTML is broken / plain-text only | Gmail client rendering quirk (rare) | Open in Gmail web — inline CSS renders fine there. Outlook does not render some flexbox; if you forward, it may look uglier. |

### Most likely setup gotchas (in order)

1. **Using the regular Gmail password** instead of an App Password → `535-5.7.8` auth fail.
2. **`.env` placed in `scripts/.env` instead of the repo root** → script exits with "set GMAIL_USER + GMAIL_APP_PW".
3. **Laptop asleep at 06:00** → launchd silently skips; job runs at next wake.

---

## Files in this directory

| File | Purpose |
|------|---------|
| `daily-briefing.js` | The script itself. Node 20+. |
| `.env.example` | Fully-commented env template (also mirrored at repo root). |
| `package.json` | Local manifest declaring Node engine + deps. Repo-root `package.json` is the source of truth for installs. |
| `com.traderadar.briefing.plist.example` | launchd agent template (6am ET Mon–Fri). |
| `verify_fred.js` | Unrelated — FRED API smoke test. |
| `README.md` | This file. |
