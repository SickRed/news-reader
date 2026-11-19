'use strict';

const state = {
  data: { items: [], topics: [], sources: [] },
  channel: { type: 'all' },
  selectedId: null,
  search: '',
  minUrgency: 'info',
  unreadOnly: false,
};

const $ = (id) => document.getElementById(id);
const topicName = (id) => state.data.topics.find((t) => t.id === id)?.name || id;

// ---------------------------------------------------------------------------
// Filtering

function channelMatches(it, ch) {
  switch (ch.type) {
    case 'pending':
      return it.needsAck;
    case 'unread':
      return !it.read;
    case 'urgency':
      return it.urgency === ch.value;
    case 'topic':
      return it.topics.includes(ch.value);
    case 'source':
      return it.sourceId === ch.value;
    default:
      return true;
  }
}

function visibleItems() {
  const q = state.search.trim().toLowerCase();
  const min = urgencyRank(state.minUrgency);
  return state.data.items.filter(
    (it) =>
      channelMatches(it, state.channel) &&
      urgencyRank(it.urgency) >= min &&
      (!state.unreadOnly || !it.read) &&
      (!q || `${it.title}\n${it.summary}\n${it.sourceName}\n${(it.cves || []).join(' ')}`.toLowerCase().includes(q))
  );
}

function countUnread(pred) {
  let n = 0;
  for (const it of state.data.items) if (!it.read && pred(it)) n++;
  return n;
}

// ---------------------------------------------------------------------------
// Rendering

function channelLink(label, channel, count, extraClass = '') {
  const active = state.channel.type === channel.type && state.channel.value === channel.value;
  return el(
    'a',
    {
      href: '#',
      class: `channel ${active ? 'active' : ''} ${extraClass}`,
      onclick: (e) => {
        e.preventDefault();
        state.channel = channel;
        state.selectedId = null;
        render();
      },
    },
    el('span', { class: 'label' }, label),
    count ? el('span', { class: 'count' }, count) : null
  );
}

function renderSidebar() {
  const nav = $('channels');
  const pending = state.data.items.filter((i) => i.needsAck).length;
  const groups = [];

  groups.push(
    el(
      'div',
      { class: 'group' },
      channelLink('⚠ Needs acknowledgement', { type: 'pending' }, pending, pending ? 'alerting' : ''),
      channelLink('All items', { type: 'all' }, countUnread(() => true)),
      channelLink('Unread', { type: 'unread' }, countUnread(() => true))
    )
  );

  groups.push(
    el(
      'div',
      { class: 'group' },
      el('div', { class: 'group-title' }, 'Urgency'),
      ...[...URGENCIES].reverse().map((u) =>
        channelLink(
          el('span', {}, el('span', { class: `dot u-${u}` }), URGENCY_LABEL[u]),
          { type: 'urgency', value: u },
          countUnread((i) => i.urgency === u)
        )
      )
    )
  );

  groups.push(
    el(
      'div',
      { class: 'group' },
      el('div', { class: 'group-title' }, 'Topics'),
      ...state.data.topics.map((t) =>
        channelLink(t.name, { type: 'topic', value: t.id }, countUnread((i) => i.topics.includes(t.id)))
      )
    )
  );

  const failing = state.data.sources.filter((s) => s.error).length;
  const details = el(
    'details',
    { class: 'group sources', open: state.channel.type === 'source' },
    el('summary', { class: 'group-title' }, `Sources (${state.data.sources.length})`, failing ? el('span', { class: 'warn' }, ` · ${failing} failing`) : ''),
    ...state.data.sources.map((s) => {
      const link = channelLink(
        el('span', { title: s.error ? `Error: ${s.error}` : s.lastOk ? `OK ${relTime(s.lastOk)}` : 'not fetched yet' },
          el('span', { class: `dot ${s.error ? 'err' : s.lastOk ? 'ok' : 'idle'}` }),
          s.name),
        { type: 'source', value: s.id },
        countUnread((i) => i.sourceId === s.id)
      );
      return link;
    })
  );
  groups.push(details);

  nav.replaceChildren(...groups);

  $('status').textContent = state.data.refreshing
    ? 'Refreshing…'
    : state.data.lastRefresh
      ? `Updated ${relTime(state.data.lastRefresh)}`
      : 'Not refreshed yet';
  $('btn-refresh').disabled = !!state.data.refreshing;
}

function channelTitle() {
  const ch = state.channel;
  switch (ch.type) {
    case 'pending':
      return 'Needs acknowledgement';
    case 'unread':
      return 'Unread';
    case 'urgency':
      return `Urgency: ${URGENCY_LABEL[ch.value]}`;
    case 'topic':
      return `Topic: ${topicName(ch.value)}`;
    case 'source':
      return `Source: ${state.data.sources.find((s) => s.id === ch.value)?.name || ch.value}`;
    default:
      return 'All items';
  }
}

function renderList() {
  const items = visibleItems();
  $('list-title').textContent = `${channelTitle()} — ${items.length} item${items.length === 1 ? '' : 's'}`;
  const list = $('list');
  const MAX = 500;
  list.replaceChildren(
    ...items.slice(0, MAX).map((it) =>
      el(
        'li',
        {
          class: `row u-${it.urgency} ${it.read ? 'read' : 'unread'} ${it.id === state.selectedId ? 'selected' : ''} ${it.needsAck ? 'pending' : ''}`,
          dataset: { id: it.id },
          onclick: () => select(it.id),
          ondblclick: () => window.api.openExternal(it.link),
        },
        el('div', { class: 'row-head' }, urgencyBadge(it.urgency), el('span', { class: 'row-source' }, it.sourceName), el('span', { class: 'row-time' }, relTime(it.published || it.fetched))),
        el('div', { class: 'row-title' }, it.title),
        el('div', { class: 'row-topics' }, ...it.topics.filter((t) => t !== 'security' || it.topics.length === 1).map((t) => el('span', { class: 'chip' }, topicName(t))))
      )
    ),
    items.length > MAX ? el('li', { class: 'more muted' }, `${items.length - MAX} more — narrow the filter to see them`) : null
  );
}

function renderDetail() {
  const box = $('detail');
  const it = state.data.items.find((i) => i.id === state.selectedId);
  if (!it) {
    box.className = 'empty';
    box.replaceChildren('Select an item');
    return;
  }
  box.className = '';
  const published = it.published ? new Date(it.published).toLocaleString() : 'unknown date';
  box.replaceChildren(
    el('div', { class: 'detail-head' }, urgencyBadge(it.urgency), it.cvss !== null && it.cvss !== undefined ? el('span', { class: 'badge cvss' }, `CVSS ${it.cvss}`) : null, ...it.topics.map((t) => el('span', { class: 'chip' }, topicName(t)))),
    el('h1', {}, it.title),
    el('div', { class: 'meta muted' }, `${it.sourceName} · ${published}`),
    it.cves?.length ? el('div', { class: 'cves' }, ...it.cves.map((c) => el('a', { href: '#', onclick: (e) => (e.preventDefault(), window.api.openExternal(`https://nvd.nist.gov/vuln/detail/${c}`)) }, c))) : null,
    el(
      'div',
      { class: 'actions' },
      el('button', { class: 'primary', onclick: () => window.api.openExternal(it.link), disabled: !it.link }, 'Open in browser'),
      it.needsAck ? el('button', { class: 'danger', onclick: () => window.api.acknowledge([it.id]) }, 'Acknowledge') : null,
      el('button', { onclick: () => window.api.setRead([it.id], !it.read) }, it.read ? 'Mark unread' : 'Mark read')
    ),
    el('div', { class: 'summary' }, it.summary || '(no summary in feed)'),
    it.reasons?.length ? el('div', { class: 'reasons muted' }, `Why ${URGENCY_LABEL[it.urgency]}: ${it.reasons.join('; ')}`) : null
  );
}

function render() {
  renderSidebar();
  renderList();
  renderDetail();
}

// ---------------------------------------------------------------------------
// Actions

function select(id) {
  state.selectedId = id;
  const it = state.data.items.find((i) => i.id === id);
  if (it && !it.read) {
    it.read = true;
    window.api.setRead([id], true);
  }
  render();
  document.querySelector(`#list li[data-id="${id}"]`)?.scrollIntoView({ block: 'nearest' });
}

function move(delta) {
  const items = visibleItems();
  if (!items.length) return;
  const idx = items.findIndex((i) => i.id === state.selectedId);
  const next = items[Math.min(items.length - 1, Math.max(0, idx + delta))];
  if (next) select(next.id);
}

$('search').addEventListener('input', (e) => {
  state.search = e.target.value;
  renderList();
});
$('min-urgency').addEventListener('change', (e) => {
  state.minUrgency = e.target.value;
  renderList();
});
$('unread-only').addEventListener('change', (e) => {
  state.unreadOnly = e.target.checked;
  renderList();
});
$('btn-mark-all').addEventListener('click', () => {
  const ids = visibleItems().filter((i) => !i.read).map((i) => i.id);
  if (ids.length) window.api.setRead(ids, true);
});
$('btn-refresh').addEventListener('click', () => window.api.refresh());
$('btn-config').addEventListener('click', () => window.api.openConfig());
$('btn-opml').addEventListener('click', () => window.api.exportOpml());

document.addEventListener('keydown', (e) => {
  if ((e.metaKey || e.ctrlKey) && e.key === 'r') {
    e.preventDefault();
    window.api.refresh();
    return;
  }
  if ((e.metaKey || e.ctrlKey) && e.key === 'f') {
    e.preventDefault();
    $('search').focus();
    return;
  }
  if (e.target.tagName === 'INPUT' || e.target.tagName === 'SELECT') return;
  const it = state.data.items.find((i) => i.id === state.selectedId);
  if (e.key === 'j' || e.key === 'ArrowDown') (e.preventDefault(), move(1));
  else if (e.key === 'k' || e.key === 'ArrowUp') (e.preventDefault(), move(-1));
  else if ((e.key === 'o' || e.key === 'Enter') && it) window.api.openExternal(it.link);
  else if (e.key === 'a' && it?.needsAck) window.api.acknowledge([it.id]);
  else if (e.key === 'm' && it) window.api.setRead([it.id], !it.read);
});

window.api.onState((s) => {
  state.data = s;
  render();
});
window.api.onSelectItem((id) => {
  state.channel = { type: 'all' };
  select(id);
});
window.api.getState().then((s) => {
  state.data = s;
  if (s.items.some((i) => i.needsAck)) state.channel = { type: 'pending' };
  render();
});
// Keep relative times fresh.
setInterval(() => renderSidebar(), 60e3);
