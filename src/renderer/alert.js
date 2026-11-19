'use strict';

let pending = [];

function render() {
  document.getElementById('alert-title').textContent =
    pending.length === 1 ? '1 urgent update needs your attention' : `${pending.length} urgent updates need your attention`;
  document.getElementById('alert-list').replaceChildren(
    ...pending.map((it) =>
      el(
        'li',
        { class: `alert-item u-${it.urgency}` },
        el('div', { class: 'row-head' }, urgencyBadge(it.urgency), el('span', { class: 'row-source' }, it.sourceName), el('span', { class: 'row-time' }, relTime(it.published || it.fetched))),
        el('div', { class: 'alert-item-title' }, it.title),
        it.summary ? el('div', { class: 'alert-item-summary' }, it.summary.length > 280 ? `${it.summary.slice(0, 279)}…` : it.summary) : null,
        el(
          'div',
          { class: 'actions' },
          el('button', { onclick: () => window.api.openExternal(it.link), disabled: !it.link }, 'Open'),
          el('button', { onclick: () => window.api.showItem(it.id) }, 'Details'),
          el('button', { class: 'danger', onclick: () => window.api.acknowledge([it.id]) }, 'Acknowledge')
        )
      )
    )
  );
}

function update(s) {
  pending = s.items.filter((i) => i.needsAck);
  render();
}

document.getElementById('btn-ack-all').addEventListener('click', () => window.api.acknowledge(pending.map((i) => i.id)));
document.getElementById('btn-show-app').addEventListener('click', () => window.api.showItem(pending[0]?.id));

window.api.onState(update);
window.api.onShake(() => {
  document.body.classList.remove('shake');
  void document.body.offsetWidth;
  document.body.classList.add('shake');
});
window.api.getState().then(update);
