// Quick node verification for engine/fred.js — exercises the public CSV path.
// Run: node scripts/verify_fred.js
globalThis.window = globalThis;
globalThis.fetch = async (url) => {
  const https = require('https');
  return new Promise((resolve, reject) => {
    https.get(url, (res) => {
      const chunks = [];
      res.on('data', (c) => chunks.push(c));
      res.on('end', () => resolve({
        ok: res.statusCode === 200,
        status: res.statusCode,
        text: async () => Buffer.concat(chunks).toString('utf8'),
        json: async () => JSON.parse(Buffer.concat(chunks).toString('utf8')),
      }));
    }).on('error', reject);
  });
};
require('../engine/fred.js');
(async () => {
  const b = await window.FREDData.getBundle();
  for (const k of Object.keys(b)) {
    const v = b[k];
    process.stdout.write(k + ' ' + (v ? ('latest=' + v.latest + ' prior=' + v.prior + ' delta=' + (v.delta==null?'-':v.delta.toFixed(3))) : 'NULL') + '\n');
  }
  const rec = await window.FREDData.getSeries('RECPROUSM156N', 5);
  process.stdout.write('RECPROUSM156N 5 rows: ' + (rec ? JSON.stringify(rec) : 'NULL') + '\n');
})();
