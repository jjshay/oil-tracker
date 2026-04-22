// engine/eth-staking.js — Ethereum validator + LSD aggregator.
//
// Free public data sources:
//   GET https://ultrasound.money/api/v2/fees/supply-parts
//       → { beaconBalancesSum (Gwei), slot, blockNumber }  (CORS-ok)
//   GET https://beaconcha.in/api/v1/validators/queue    → queue counts (CORS-
//       gated, routed through public proxy; optional — we degrade if missing)
//   GET https://api.llama.fi/protocols                   → filtered to ETH-chain
//                                                         "Liquid Staking" cat
//                                                         (DeFiLlama killed the
//                                                         dedicated /lsd route,
//                                                         so we filter locally)
//
// Validator count is derived: active validators ≈ floor(beaconBalancesSum /
// 32e9 Gwei). Close-enough — most validators sit at the effective cap.
//
// Exposes on window:
//   ETHStaking.getValidatorStats()   → { total_active, queued, exiting,
//                                         avg_balance, apr, finalized_epoch,
//                                         total_staked_eth, eth_supply,
//                                         pct_of_supply }
//   ETHStaking.getLSDBreakdown()     → [{ name, symbol, tvl, pegRatio,
//                                         mcap, ethPeg, change1d, change7d,
//                                         marketShare }, ...]
//
// Cache: 10-minute TTL per endpoint.

(function () {
  if (typeof window === 'undefined') return;

  var CACHE_TTL_MS = 10 * 60 * 1000;

  // Network-wide ETH supply estimate (post-merge, ~120.3M circulating, slowly
  // deflating). Used when the beacon API doesn't provide a supply figure.
  var ETH_SUPPLY_ESTIMATE = 120_400_000;

  // Stake APR is derivable from effective balance × issuance curve; beacon
  // doesn't return it directly. We derive a clean estimate: yearly issuance
  // per 32 ETH validator ≈ 166√activeBalance (Gwei) / 10^9. The shorthand
  // 2.9% → 3.5% range tracks actively; for display we just compute:
  //   apr_pct = 166 * sqrt(N) / (32e9) * epochs_per_year * 100
  // where N = total active balance in Gwei. epochs_per_year = 365.25*24*60*60/384.
  var SECS_PER_EPOCH = 384;
  var EPOCHS_PER_YEAR = (365.25 * 24 * 3600) / SECS_PER_EPOCH;

  var cache = {}; // key → { data, fetchedAt }
  function cacheGet(k) {
    var e = cache[k];
    if (!e) return null;
    if (Date.now() - e.fetchedAt > CACHE_TTL_MS) return null;
    return e.data;
  }
  function cacheSet(k, d) { cache[k] = { data: d, fetchedAt: Date.now() }; }

  // beaconcha.in enforces auth on some IPs + Cloudflare blocks XHR from
  // browsers. Proxy wrappers tried in order; unwrap per-proxy.
  var PROXIES = [
    { wrap: function (u) { return u; }, unwrap: function (t) { return t; }, asJson: false },
    { wrap: function (u) { return 'https://api.allorigins.win/raw?url=' + encodeURIComponent(u); }, unwrap: function (t) { return t; }, asJson: false },
    { wrap: function (u) { return 'https://corsproxy.io/?' + encodeURIComponent(u); }, unwrap: function (t) { return t; }, asJson: false },
    { wrap: function (u) { return 'https://api.codetabs.com/v1/proxy/?quest=' + encodeURIComponent(u); }, unwrap: function (t) { return t; }, asJson: false },
  ];

  async function fetchJson(url, useProxy) {
    var cached = cacheGet(url);
    if (cached != null) return cached;
    var proxies = useProxy ? PROXIES : [PROXIES[0]];
    for (var i = 0; i < proxies.length; i++) {
      var p = proxies[i];
      try {
        var r = await fetch(p.wrap(url), { method: 'GET' });
        if (!r.ok) continue;
        var body = p.asJson ? p.unwrap(await r.json()) : p.unwrap(await r.text());
        if (!body) continue;
        var j;
        try { j = typeof body === 'string' ? JSON.parse(body) : body; }
        catch (_) { continue; }
        if (j == null) continue;
        // beacon-style wrappers sometimes return { status: 'ERROR', ... }
        if (j && j.status === 'ERROR') continue;
        cacheSet(url, j);
        return j;
      } catch (_) { /* try next */ }
    }
    return null;
  }

  // ---------- validator stats ----------
  async function getValidatorStats() {
    // Primary: ultrasound.money supply-parts (CORS-open, no auth).
    var usm = await fetchJson('https://ultrasound.money/api/v2/fees/supply-parts', false);
    // Optional: beaconcha.in queue (proxied; null on failure).
    var queue = await fetchJson('https://beaconcha.in/api/v1/validators/queue', true);

    if (!usm && !queue) return null;

    var activeBalanceGwei = 0;
    var slot = null;
    if (usm && usm.beaconBalancesSum) {
      // beaconBalancesSum is a numeric string in Gwei.
      activeBalanceGwei = Number(usm.beaconBalancesSum) || 0;
      slot = Number(usm.slot) || null;
    }
    // beaconcha.in queue payload shape varies; unwrap defensively.
    var qData = (queue && queue.data) ? queue.data : queue;

    var activeValidators = activeBalanceGwei > 0
      ? Math.floor(activeBalanceGwei / 32e9)
      : 0;
    var avgBalanceGwei = activeValidators > 0 ? (activeBalanceGwei / activeValidators) : 0;
    var finalizedEpoch = slot != null ? Math.floor(slot / 32) : null;

    var totalStakedEth = activeBalanceGwei / 1e9;
    var avgBalanceEth  = avgBalanceGwei / 1e9;

    // APR approximation: base_reward_per_epoch × epochs/year / effective_balance.
    // Simplified: issuance per validator/year ≈ 166 √N, where N is total
    // active balance in Gwei. Per-validator yield ≈ issuance_per_validator / 32.
    var apr = null;
    if (activeBalanceGwei > 0 && activeValidators > 0) {
      // base_reward = effective_balance * 64 / sqrt(total_active_balance) per epoch (Gwei)
      // A validator's annual reward in ETH = base_reward * epochs/year / 1e9
      var effBalanceGwei = 32e9; // per validator
      var baseReward = effBalanceGwei * 64 / Math.sqrt(activeBalanceGwei);
      var annualRewardEth = baseReward * EPOCHS_PER_YEAR / 1e9;
      apr = (annualRewardEth / 32) * 100; // percent
    }

    var queued   = Number(qData && (qData.beaconchain_entering || qData.beaconChainEntering || qData.entering)) || 0;
    var exiting  = Number(qData && (qData.beaconchain_exiting  || qData.beaconChainExiting  || qData.exiting))  || 0;
    var pctOfSupply = totalStakedEth > 0 ? (totalStakedEth / ETH_SUPPLY_ESTIMATE) * 100 : null;

    return {
      total_active:    activeValidators,
      queued:          queued,
      exiting:         exiting,
      avg_balance:     avgBalanceEth,
      apr:             apr,
      finalized_epoch: finalizedEpoch,
      total_staked_eth: totalStakedEth,
      eth_supply:       ETH_SUPPLY_ESTIMATE,
      pct_of_supply:    pctOfSupply,
    };
  }

  // ---------- LSD breakdown ----------
  // DeFiLlama deprecated the /lsd endpoint. We fetch /protocols, filter to
  // category "Liquid Staking" on chain Ethereum (primary chain OR in .chains).
  // We also drop Solana-only LSDs (Jito, Sanctum, Jupiter…) since this panel
  // is ETH-specific.
  var SOLANA_ONLY = /sanctum|marinade|jito|jupiter|doublezero|solana|staked sol/i;
  async function getLSDBreakdown() {
    var arr = await fetchJson('https://api.llama.fi/protocols');
    if (!Array.isArray(arr)) return null;

    var eth = arr.filter(function (p) {
      if (!p || typeof p.name !== 'string') return false;
      var cat = (p.category || '').toLowerCase();
      if (cat !== 'liquid staking' && cat !== 'liquid restaking') return false;
      if (SOLANA_ONLY.test(p.name)) return false;
      // Must have ETH exposure
      var chain = (p.chain || '').toLowerCase();
      var chains = Array.isArray(p.chains) ? p.chains.map(function (c) { return String(c).toLowerCase(); }) : [];
      if (chain === 'ethereum') return true;
      if (chains.indexOf('ethereum') >= 0) return true;
      return false;
    });

    var totalTvl = 0;
    var rows = eth.map(function (p) {
      var tvl = Number(p.tvl) || 0;
      totalTvl += tvl;
      return {
        name:     p.name,
        symbol:   p.symbol || null,
        tvl:      tvl,
        mcap:     Number(p.mcap) || null,
        pegRatio: null,   // not available in /protocols payload
        ethPeg:   null,
        change1d: Number(p.change_1d) || 0,
        change7d: Number(p.change_7d) || 0,
      };
    });
    rows.sort(function (a, b) { return b.tvl - a.tvl; });
    for (var i = 0; i < rows.length; i++) {
      rows[i].marketShare = totalTvl > 0 ? (rows[i].tvl / totalTvl) * 100 : 0;
    }
    return rows;
  }

  window.ETHStaking = {
    getValidatorStats: getValidatorStats,
    getLSDBreakdown:   getLSDBreakdown,
    clearCache:        function () { cache = {}; },
  };
})();
