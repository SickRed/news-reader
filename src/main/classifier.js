'use strict';

const URGENCIES = ['info', 'normal', 'high', 'critical'];
const rank = (u) => Math.max(0, URGENCIES.indexOf(u));
const maxU = (a, b) => (rank(a) >= rank(b) ? a : b);
const minU = (a, b) => (rank(a) <= rank(b) ? a : b);

function escapeRe(s) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

// Keywords match as whole tokens, but digits/dots/dashes may follow,
// so "php" matches "php8.2" and "PHP-FPM" but not "phpinfo-lib" style words.
function keywordRegex(words) {
  if (!words.length) return null;
  const alt = words.map(escapeRe).join('|');
  return new RegExp(`(?<![a-z0-9])(?:${alt})(?![a-z])`, 'i');
}

function patternRegex(patterns) {
  if (!patterns || !patterns.length) return null;
  return new RegExp(patterns.map((p) => `(?:${p})`).join('|'), 'i');
}

function compileRules(config) {
  const topicRes = Object.entries(config.topicKeywords || {}).map(([topic, words]) => [topic, keywordRegex(words)]);
  return {
    topicRes: topicRes.filter(([, re]) => re),
    critical: patternRegex(config.criticalPatterns),
    high: patternRegex(config.highPatterns),
    noise: patternRegex(config.noisePatterns),
  };
}

function cvssUrgency(score) {
  if (score >= 9) return 'critical';
  if (score >= 7) return 'high';
  if (score >= 4) return 'normal';
  return 'info';
}

/**
 * Decide topics and urgency for a raw item.
 * Returns null if the item should be dropped (irrelevant for a broad source).
 *
 * raw: { title, summary, cvss?, kev?, ... }
 */
function classify(raw, source, rules, config) {
  // Broad sources (news sites, mailing lists) mention half the industry in their article bodies,
  // so their relevance and urgency are judged on the headline only.
  const headlineOnly = source.requireTopicMatch && !source.matchSummary;
  const text = headlineOnly ? raw.title || '' : `${raw.title || ''}\n${raw.summary || ''}`;
  const matched = rules.topicRes.filter(([, re]) => re.test(text)).map(([t]) => t);
  const dedicated = (source.topics || []).filter((t) => t !== 'security');
  const relevant = matched.length > 0 || dedicated.length > 0;

  if (source.requireTopicMatch && matched.length === 0) return null;

  const topics = [...new Set([...(source.topics || []), ...matched])];
  if (source.kind === 'security' && !topics.includes('security')) topics.push('security');

  const noise = rules.noise ? rules.noise.test(text) : false;
  let urgency = source.urgency || 'normal';
  const reasons = [];

  if (typeof raw.cvss === 'number') {
    urgency = cvssUrgency(raw.cvss);
    reasons.push(`CVSS ${raw.cvss}`);
  }

  if (raw.kev) {
    urgency = matched.length ? 'critical' : config.kev?.unmatchedUrgency || 'info';
    reasons.push('CISA KEV: exploited in the wild');
  }

  if (!noise && relevant && source.escalate !== false && typeof raw.cvss !== 'number') {
    const c = rules.critical && text.match(rules.critical);
    const h = rules.high && text.match(rules.high);
    if (c) {
      urgency = maxU(urgency, 'critical');
      reasons.push(`matched "${c[0]}"`);
    } else if (h) {
      urgency = maxU(urgency, 'high');
      reasons.push(`matched "${h[0]}"`);
    }
  }

  if (raw.nvd) {
    // NVD keyword hits without a real topic match (e.g. "Express" in an unrelated product) stay low,
    // and CVEs that have not been scored yet can at most be "high".
    if (!matched.length) urgency = minU(urgency, 'normal');
    if (typeof raw.cvss !== 'number') urgency = minU(urgency, 'high');
  }

  if (noise) {
    urgency = 'info';
    reasons.push('noise filter');
  }
  // Mailing-list replies repeat the original thread.
  if (/^\s*re:/i.test(raw.title || '')) urgency = minU(urgency, 'high');
  if (source.maxUrgency) urgency = minU(urgency, source.maxUrgency);

  return { topics, urgency, reasons, noise };
}

function extractCves(text) {
  const m = (text || '').match(/CVE-\d{4}-\d{4,7}/gi) || [];
  return [...new Set(m.map((s) => s.toUpperCase()))];
}

module.exports = { URGENCIES, rank, compileRules, classify, extractCves, cvssUrgency };
