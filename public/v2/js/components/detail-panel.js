/* Shared detail surface for clickable Mission Control modules. */
(function attachDetailPanel(global) {
  const escapeHtml = (value) => String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');

  let lastTrigger = null;

  function focusableIn(dialog) {
    return Array.from(dialog.querySelectorAll('button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])'))
      .filter((node) => !node.disabled && !node.hidden && node.offsetParent !== null);
  }

  function ensurePanel() {
    let panel = document.getElementById('mcDetailPanel');
    if (panel) return panel;

    panel = document.createElement('section');
    panel.id = 'mcDetailPanel';
    panel.className = 'detail-panel';
    panel.hidden = true;
    panel.innerHTML = `
      <div class="detail-panel__backdrop" data-detail-close></div>
      <div class="detail-panel__dialog" role="dialog" aria-modal="true" aria-labelledby="detailPanelTitle">
        <header class="detail-panel__header">
          <div>
            <div id="detailPanelEyebrow" class="detail-panel__eyebrow"></div>
            <h2 id="detailPanelTitle"></h2>
          </div>
          <button class="init-btn" type="button" data-detail-close>Close</button>
        </header>
        <div class="detail-panel__body">
          <p id="detailPanelSummary" class="detail-panel__summary"></p>
          <dl id="detailPanelFacts" class="detail-panel__facts"></dl>
        </div>
      </div>
    `;
    document.body.appendChild(panel);

    panel.addEventListener('click', (event) => {
      if (event.target.closest('[data-detail-close]')) close();
    });
    document.addEventListener('keydown', (event) => {
      if (panel.hidden) return;
      if (event.key === 'Escape') {
        close();
        return;
      }
      if (event.key !== 'Tab') return;
      const dialog = panel.querySelector('[role="dialog"]');
      const nodes = focusableIn(dialog);
      if (!nodes.length) return;
      const first = nodes[0];
      const last = nodes[nodes.length - 1];
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    });
    return panel;
  }

  function open(options = {}) {
    const panel = ensurePanel();
    lastTrigger = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    panel.querySelector('#detailPanelEyebrow').textContent = options.eyebrow || 'DETAIL';
    panel.querySelector('#detailPanelTitle').textContent = options.title || 'Operational detail';
    panel.querySelector('#detailPanelSummary').textContent = options.summary || '';

    const facts = Array.isArray(options.facts) ? options.facts : [];
    panel.querySelector('#detailPanelFacts').innerHTML = facts.map((fact) => `
      <div class="detail-panel__fact">
        <dt>${escapeHtml(fact.label)}</dt>
        <dd>${escapeHtml(fact.value)}</dd>
      </div>
    `).join('');
    panel.hidden = false;
    document.body.classList.add('detail-panel-open');
    const closeButton = panel.querySelector('button[data-detail-close]');
    (closeButton || panel.querySelector('[data-detail-close]')).focus();
  }

  function close() {
    const panel = document.getElementById('mcDetailPanel');
    if (!panel) return;
    panel.hidden = true;
    document.body.classList.remove('detail-panel-open');
    if (lastTrigger && document.contains(lastTrigger)) lastTrigger.focus();
    lastTrigger = null;
  }

  global.MissionControlDetailPanel = { open, close };
})(window);
