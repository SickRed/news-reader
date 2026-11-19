'use strict';

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { EventEmitter } = require('events');
const { compileRules, classify, extractCves, rank } = require('./classifier');
const { fetchSource } = require('./fetchers');

const CONCURRENCY = 6;

function hash(s) {
  return crypto.createHash('sha1').update(s).digest('hex').slice(0, 16);
}

async function pool(tasks, n) {
  const results = [];
  let i = 0;
  const workers = Array.from({ length: Math.min(n, tasks.length) }, async () => {
    while (i < tasks.length) {
      const idx = i++;
      results[idx] = await tasks[idx]();
    }
  });
  await Promise.all(workers);
  return results;
}

/**
 * Fetches all sources, classifies items, persists state and decides which items need
 * an acknowledgement. Electron-independent so it can be exercised from plain Node.
 *
 * Events: 'updated', 'alert' (items[]), 'log' (string)
 */
class Engine extends EventEmitter {
  constructor({ dataDir, config }) {
    super();
    this.dataDir = dataDir;
    this.statePath = path.join(dataDir, 'state.json');
    this.items = new Map();
    this.sourceState = {};
    this.ackedCves = new Set();
    this.refreshing = false;
    this.lastRefresh = null;
    this.setConfig(config);
    this.load();
  }

  setConfig(config) {
    this.config = config;
    this.rules = compileRules(config);
    this.sources = (config.sources || []).filter(
      (s) => s.enabled !== false && !(s.type === 'nvd' && config.nvd?.enabled === false)
    );
  }

  load() {
    try {
      const data = JSON.parse(fs.readFileSync(this.statePath, 'utf8'));
      for (const it of data.items || []) this.items.set(it.id, it);
      this.sourceState = data.sourceState || {};
      this.ackedCves = new Set(data.ackedCves || []);
      this.lastRefresh = data.lastRefresh || null;
    } catch (err) {
      if (err.code !== 'ENOENT') this.emit('log', `Could not read state: ${err.message}`);
    }
  }

  save() {
    clearTimeout(this.saveTimer);
    this.saveTimer = setTimeout(() => this.saveNow(), 500);
  }

  saveNow() {
    clearTimeout(this.saveTimer);
    fs.mkdirSync(this.dataDir, { recursive: true });
    const tmp = `${this.statePath}.tmp`;
    fs.writeFileSync(
      tmp,
      JSON.stringify({
        items: [...this.items.values()],
        sourceState: this.sourceState,
        ackedCves: [...this.ackedCves],
        lastRefresh: this.lastRefresh,
      })
    );
    fs.renameSync(tmp, this.statePath);
  }

  isDue(source, force) {
    if (force) return true;
    const st = this.sourceState[source.id];
    if (!st?.lastAttempt) return true;
    const minutes = source.type === 'nvd' ? this.config.nvd?.refreshMinutes ?? 60 : this.config.refreshMinutes ?? 15;
    return Date.now() - new Date(st.lastAttempt).getTime() >= minutes * 60e3 - 5e3;
  }

  async refresh({ force = false } = {}) {
    if (this.refreshing) return;
    this.refreshing = true;
    this.emit('updated');
    const due = this.sources.filter((s) => this.isDue(s, force));
    const newAlerts = [];

    try {
      await pool(
        due.map((source) => async () => {
          const st = (this.sourceState[source.id] = this.sourceState[source.id] || {});
          st.lastAttempt = new Date().toISOString();
          try {
            const res = await fetchSource(source, st.cache, this.config, (m) => this.emit('log', m));
            if (!res.notModified) {
              st.cache = res.cache;
              const added = this.ingest(source, res.items);
              newAlerts.push(...added);
              st.itemCount = res.items.length;
            }
            st.lastOk = new Date().toISOString();
            st.error = res.partialErrors?.length ? res.partialErrors.join('; ') : null;
          } catch (err) {
            st.error = err.message || String(err);
            this.emit('log', `${source.id}: ${st.error}`);
          }
          this.emit('updated');
        }),
        CONCURRENCY
      );
      this.prune();
      this.lastRefresh = new Date().toISOString();
      this.save();
    } finally {
      this.refreshing = false;
      this.emit('updated');
    }
    if (newAlerts.length) this.emit('alert', newAlerts);
  }

  /** Inserts/updates items; returns items that newly require acknowledgement. */
  ingest(source, rawItems) {
    const alerts = [];
    const alertCfg = this.config.alerts || {};
    const alertRank = rank(alertCfg.minUrgency || 'critical');
    const maxAgeMs = (alertCfg.maxAgeHours ?? 72) * 3600e3;
    const retentionMs = (this.config.retentionDays ?? 60) * 86400e3;
    const now = Date.now();

    for (const raw of rawItems) {
      const cls = classify(raw, source, this.rules, this.config);
      if (!cls) continue;
      const published = raw.published || null;
      const age = published ? now - new Date(published).getTime() : 0;
      if (age > retentionMs) continue;

      const id = hash(`${source.id}|${raw.key || raw.link || raw.title}`);
      const existing = this.items.get(id);
      const item = {
        ...(existing || {}),
        id,
        sourceId: source.id,
        sourceName: source.name,
        title: raw.title,
        link: raw.link,
        summary: raw.summary,
        published,
        fetched: existing?.fetched || new Date(now).toISOString(),
        topics: cls.topics,
        urgency: cls.urgency,
        reasons: cls.reasons,
        cves: extractCves(`${raw.title} ${raw.summary}`),
        cvss: typeof raw.cvss === 'number' ? raw.cvss : existing?.cvss ?? null,
        read: existing?.read ?? false,
        acknowledged: existing?.acknowledged ?? false,
        needsAck: existing?.needsAck ?? false,
        alerted: existing?.alerted ?? false,
      };

      // Only alert once per item, only for fresh items, and not for CVEs already acknowledged elsewhere.
      if (!item.alerted && !item.acknowledged && rank(item.urgency) >= alertRank) {
        const fresh = age <= maxAgeMs;
        const knownCve = item.cves.length > 0 && item.cves.every((c) => this.ackedCves.has(c));
        if (fresh && !knownCve) {
          item.needsAck = true;
          item.alerted = true;
          alerts.push(item);
        }
      }
      this.items.set(id, item);
    }
    return alerts;
  }

  prune() {
    const retentionMs = (this.config.retentionDays ?? 60) * 86400e3;
    const now = Date.now();
    for (const [id, it] of this.items) {
      const t = new Date(it.published || it.fetched).getTime();
      if (!it.needsAck && now - t > retentionMs) this.items.delete(id);
    }
    const max = this.config.maxItems ?? 6000;
    if (this.items.size > max) {
      const sorted = this.sortedItems().filter((it) => !it.needsAck);
      for (const it of sorted.slice(max)) this.items.delete(it.id);
    }
  }

  sortedItems() {
    return [...this.items.values()].sort(
      (a, b) => new Date(b.published || b.fetched) - new Date(a.published || a.fetched)
    );
  }

  pendingAlerts() {
    return this.sortedItems().filter((it) => it.needsAck);
  }

  acknowledge(ids) {
    for (const id of ids) {
      const it = this.items.get(id);
      if (!it) continue;
      it.needsAck = false;
      it.acknowledged = true;
      it.read = true;
      for (const c of it.cves || []) this.ackedCves.add(c);
    }
    // Acknowledging a CVE also clears other pending alerts that cover only that CVE.
    for (const it of this.items.values()) {
      if (it.needsAck && it.cves?.length && it.cves.every((c) => this.ackedCves.has(c))) {
        it.needsAck = false;
        it.acknowledged = true;
      }
    }
    this.save();
    this.emit('updated');
  }

  setRead(ids, read) {
    for (const id of ids) {
      const it = this.items.get(id);
      if (it) it.read = read;
    }
    this.save();
    this.emit('updated');
  }

  snapshot() {
    return {
      items: this.sortedItems(),
      topics: this.config.topics || [],
      sources: this.sources.map((s) => ({
        id: s.id,
        name: s.name,
        url: s.url || s.homepage || '',
        kind: s.kind,
        topics: s.topics,
        ...(({ cache, ...rest }) => rest)(this.sourceState[s.id] || {}),
      })),
      refreshing: this.refreshing,
      lastRefresh: this.lastRefresh,
      alertMinUrgency: this.config.alerts?.minUrgency || 'critical',
    };
  }
}

module.exports = { Engine };
