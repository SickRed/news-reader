'use strict';

const esc = (s) =>
  String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&apos;' })[c]);

/** OPML of all RSS/Atom sources, grouped by first topic, for use in any feed reader. */
function toOpml(config) {
  const topicName = Object.fromEntries((config.topics || []).map((t) => [t.id, t.name]));
  const groups = new Map();
  for (const s of config.sources || []) {
    if ((s.type && s.type !== 'rss') || !s.url) continue;
    const topic = (s.topics || []).find((t) => t !== 'security') || (s.topics || [])[0] || 'general';
    const group = s.kind === 'security' ? 'Security & CVEs' : topicName[topic] || 'General';
    if (!groups.has(group)) groups.set(group, []);
    groups.get(group).push(s);
  }
  const body = [...groups.entries()]
    .map(
      ([group, sources]) =>
        `    <outline text="${esc(group)}" title="${esc(group)}">\n` +
        sources
          .map((s) => `      <outline type="rss" text="${esc(s.name)}" title="${esc(s.name)}" xmlUrl="${esc(s.url)}"/>`)
          .join('\n') +
        '\n    </outline>'
    )
    .join('\n');
  return `<?xml version="1.0" encoding="UTF-8"?>
<opml version="2.0">
  <head>
    <title>IT Updates – curated feeds</title>
    <dateCreated>${new Date().toUTCString()}</dateCreated>
  </head>
  <body>
${body}
  </body>
</opml>
`;
}

module.exports = { toOpml };
