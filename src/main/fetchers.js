'use strict';

const Parser = require('rss-parser');

const USER_AGENT =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 14_0) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Safari/605.1.15 IT-Updates/1.0';
const TIMEOUT_MS = 25000;

const parser = new Parser();

// Electron injects net.fetch (Chromium network stack, honours system proxy settings).
let doFetch = (...args) => fetch(...args);
function setFetch(fn) {
  doFetch = fn;
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const ENTITIES = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ' };

function stripHtml(html) {
  return String(html || '')
    .replace(/<(script|style)[\s\S]*?<\/\1>/gi, ' ')
    .replace(/<br\s*\/?>|<\/p>|<\/li>|<\/h\d>/gi, '\n')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&(#x?[0-9a-f]+|[a-z]+);/gi, (m, e) => {
      if (e[0] === '#') {
        const code = e[1].toLowerCase() === 'x' ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10);
        return Number.isFinite(code) ? String.fromCodePoint(code) : m;
      }
      return ENTITIES[e.toLowerCase()] ?? m;
    })
    .replace(/[ \t\f\v]+/g, ' ')
    .replace(/\s*\n\s*/g, '\n')
    .trim();
}

function truncate(s, n) {
  return s.length > n ? `${s.slice(0, n - 1)}…` : s;
}

function toIso(value) {
  if (!value) return null;
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? null : d.toISOString();
}

async function httpGet(url, { headers = {}, cache } = {}) {
  const h = { 'User-Agent': USER_AGENT, Accept: '*/*', ...headers };
  if (cache?.etag) h['If-None-Match'] = cache.etag;
  if (cache?.lastModified) h['If-Modified-Since'] = cache.lastModified;
  const res = await doFetch(url, { headers: h, redirect: 'follow', signal: AbortSignal.timeout(TIMEOUT_MS) });
  if (res.status === 304) return { notModified: true };
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return {
    body: await res.text(),
    etag: res.headers.get('etag'),
    lastModified: res.headers.get('last-modified'),
  };
}

/** RSS / Atom / RDF. Returns { items, cache } or { notModified: true }. */
async function fetchFeed(source, cache) {
  const res = await httpGet(source.url, {
    headers: { Accept: 'application/rss+xml, application/atom+xml, application/xml, text/xml;q=0.9, */*;q=0.8' },
    cache,
  });
  if (res.notModified) return { notModified: true };
  const feed = await parser.parseString(res.body);
  const items = (feed.items || []).map((it) => {
    const link = it.link || (typeof it.guid === 'string' && /^https?:/.test(it.guid) ? it.guid : '') || source.homepage || '';
    const summary = stripHtml(it.contentSnippet || it.summary || it.content || it['content:encoded'] || '');
    return {
      key: it.guid || it.id || link || it.title,
      title: stripHtml(it.title || '(untitled)'),
      link,
      summary: truncate(summary, 2000),
      published: toIso(it.isoDate || it.pubDate || it.published || it.updated),
    };
  });
  return { items, cache: { etag: res.etag, lastModified: res.lastModified } };
}

/** CISA Known Exploited Vulnerabilities catalog (JSON). */
async function fetchKev(source, cache, config) {
  const res = await httpGet(source.url, { headers: { Accept: 'application/json' }, cache });
  if (res.notModified) return { notModified: true };
  const data = JSON.parse(res.body);
  const maxAge = (config.kev?.maxAgeDays ?? 30) * 86400e3;
  const items = (data.vulnerabilities || [])
    .filter((v) => Date.now() - new Date(v.dateAdded).getTime() <= maxAge)
    .map((v) => ({
      key: `kev:${v.cveID}`,
      title: `${v.cveID}: ${v.vulnerabilityName}`,
      link: `https://nvd.nist.gov/vuln/detail/${v.cveID}`,
      summary: [
        `${v.vendorProject} – ${v.product}`,
        v.shortDescription,
        `Required action: ${v.requiredAction}`,
        `Due date (US federal): ${v.dueDate}`,
        v.knownRansomwareCampaignUse === 'Known' ? 'Known to be used in ransomware campaigns.' : '',
      ]
        .filter(Boolean)
        .join('\n'),
      published: toIso(`${v.dateAdded}T00:00:00Z`),
      kev: true,
    }));
  return { items, cache: { etag: res.etag, lastModified: res.lastModified } };
}

function nvdScore(metrics = {}) {
  for (const k of ['cvssMetricV40', 'cvssMetricV31', 'cvssMetricV30', 'cvssMetricV2']) {
    const list = metrics[k];
    if (list && list.length) {
      const primary = list.find((m) => m.type === 'Primary') || list[0];
      const score = primary?.cvssData?.baseScore;
      if (typeof score === 'number') return score;
    }
  }
  return null;
}

const nvdDate = (d) => d.toISOString();

/** NVD CVE API 2.0 – one request per keyword, respecting the public rate limit. */
async function fetchNvd(source, cache, config, log = () => {}) {
  const nvd = config.nvd || {};
  const end = new Date();
  const start = new Date(end.getTime() - (nvd.lookbackDays ?? 3) * 86400e3);
  const maxAge = (nvd.maxAgeDays ?? 21) * 86400e3;
  const delay = nvd.apiKey ? 800 : 6500; // 50 vs 5 requests per 30 s
  const byId = new Map();
  const errors = [];

  for (const [i, keyword] of (nvd.keywords || []).entries()) {
    if (i > 0) await sleep(delay);
    const params = new URLSearchParams({
      keywordSearch: keyword,
      lastModStartDate: nvdDate(start),
      lastModEndDate: nvdDate(end),
      resultsPerPage: '500',
    });
    try {
      const res = await httpGet(`https://services.nvd.nist.gov/rest/json/cves/2.0?${params}`, {
        headers: { Accept: 'application/json', ...(nvd.apiKey ? { apiKey: nvd.apiKey } : {}) },
      });
      const data = JSON.parse(res.body);
      for (const { cve } of data.vulnerabilities || []) {
        const published = new Date(`${cve.published}Z`);
        if (Date.now() - published.getTime() > maxAge) continue;
        if (cve.vulnStatus === 'Rejected') continue;
        const desc = (cve.descriptions || []).find((d) => d.lang === 'en')?.value || '';
        const score = nvdScore(cve.metrics);
        byId.set(cve.id, {
          key: `nvd:${cve.id}`,
          title: `${cve.id}${score !== null ? ` (CVSS ${score})` : ''}: ${truncate(desc.split('\n')[0], 160)}`,
          link: `https://nvd.nist.gov/vuln/detail/${cve.id}`,
          summary: truncate(desc, 2000),
          published: published.toISOString(),
          cvss: score,
          nvd: true,
        });
      }
    } catch (err) {
      errors.push(`${keyword}: ${err.message}`);
      log(`NVD "${keyword}" failed: ${err.message}`);
    }
  }
  if (errors.length === (nvd.keywords || []).length && errors.length) throw new Error(errors.join('; '));
  return { items: [...byId.values()], partialErrors: errors };
}

async function fetchSource(source, cache, config, log) {
  switch (source.type || 'rss') {
    case 'kev':
      return fetchKev(source, cache, config);
    case 'nvd':
      return fetchNvd(source, cache, config, log);
    default:
      return fetchFeed(source, cache);
  }
}

module.exports = { fetchSource, stripHtml, setFetch };
