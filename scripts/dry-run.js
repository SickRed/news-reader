#!/usr/bin/env node
'use strict';

// Fetches every configured source once without Electron and prints what would show up / alert.
// Usage: node scripts/dry-run.js [--no-nvd] [--verbose]

const os = require('os');
const fs = require('fs');
const path = require('path');
const { Engine } = require('../src/main/engine');

const args = process.argv.slice(2);
const config = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'config', 'default-config.json'), 'utf8'));
if (args.includes('--no-nvd')) config.nvd.enabled = false;

const dataDir = fs.mkdtempSync(path.join(process.env.TMPDIR || os.tmpdir(), 'it-updates-'));
const engine = new Engine({ dataDir, config });
engine.on('log', (m) => args.includes('--verbose') && console.error(`[log] ${m}`));
let alerts = [];
engine.on('alert', (a) => (alerts = a));

(async () => {
  const t0 = Date.now();
  await engine.refresh({ force: true });
  const snap = engine.snapshot();

  console.log(`\nFetched in ${((Date.now() - t0) / 1000).toFixed(1)} s, ${snap.items.length} items kept\n`);
  console.log('Source status:');
  for (const s of snap.sources) {
    console.log(`  ${s.error ? '✗' : '✓'} ${s.id.padEnd(22)} ${String(s.itemCount ?? '-').padStart(4)} items  ${s.error || ''}`);
  }

  const by = (key) =>
    snap.items.reduce((acc, it) => {
      for (const k of [].concat(it[key])) acc[k] = (acc[k] || 0) + 1;
      return acc;
    }, {});
  console.log('\nBy urgency:', by('urgency'));
  console.log('By topic:  ', by('topics'));

  for (const level of ['critical', 'high']) {
    console.log(`\n${level.toUpperCase()} (newest 25):`);
    for (const it of snap.items.filter((i) => i.urgency === level).slice(0, 25)) {
      console.log(`  ${(it.published || '').slice(0, 10)} [${it.sourceId}] ${it.title.slice(0, 110)}  <${it.reasons.join(', ')}>`);
    }
  }
  console.log(`\nWould raise ${alerts.length} acknowledgement alert(s):`);
  for (const it of alerts) console.log(`  ! [${it.sourceId}] ${it.title.slice(0, 120)}`);
  fs.rmSync(dataDir, { recursive: true, force: true });
})();
