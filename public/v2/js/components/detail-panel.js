/* Shared detail surface for clickable Mission Control modules.
 * Purpose: the shared detail surface for clickable Mission Control modules —
 * facts, grouped list sections and caveat notes in one dialog.
 *
 * One modal, not one per caller. Alongside the label/value `facts` list it
 * renders two optional blocks so a caller with a LIST to show does not need a
 * second dialog:
 *
 *   sections  ordered groups of rows -- { title, caption, rows[], empty }
 *             where a row is { label, sublabel, status, statusTone, meta }
 *   notes     caveat paragraphs under everything, for the things a figure
 *             cannot say about itself
 *
 * Nothing here interpolates raw: every caller-supplied string is escaped, and
 * an absent value renders as the caller's own text or not at all -- never as 0. */
(function attachDetailPanel(global) {
  const escapeHtml = (global.MissionControlShared && global.MissionControlShared.escapeHtml) ||
    ((value) => String(value ?? '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#039;'));

  let lastTrigger = null;

  function focusableIn(dialog) {
    return Array.from(dialog.querySelectorAll('button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])'))
      .filter((node) => !node.disabled && !node.hidden && node.offsetParent !== null);
  }

  function syncPageInert() {
    const overlayOpen = Boolean(document.querySelector(
      '#factionIntelScreen:not([hidden]), #intelligenceLibraryScreen:not([hidden]), #mcDetailPanel:not([hidden])'
    ));
    document.querySelector('.init-topbar')?.toggleAttribute('inert', overlayOpen);
    const views = document.querySelectorAll('.init-view');
    if (views.length > 0) {
      views.forEach((section) => {
        if (overlayOpen) {
          section.setAttribute('inert', '');
        } else {
          section.toggleAttribute('inert', section.hidden);
        }
      });
      document.querySelector('main')?.removeAttribute('inert');
    } else {
      document.querySelector('main')?.toggleAttribute('inert', overlayOpen);
    }
  }

  function setPanelOpen(panel, open) {
    panel.hidden = !open;
    panel.toggleAttribute('inert', !open);
    panel.setAttribute('aria-hidden', open ? 'false' : 'true');
    document.body.classList.toggle('detail-panel-open', open);
    syncPageInert();
  }

  function ensurePanel() {
    let panel = document.getElementById('mcDetailPanel');
    if (panel) return panel;

    panel = document.createElement('section');
    panel.id = 'mcDetailPanel';
    panel.className = 'detail-panel';
    panel.hidden = true;
    panel.setAttribute('inert', '');
    panel.setAttribute('aria-hidden', 'true');
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
          <div id="detailPanelSections" class="detail-panel__sections"></div>
          <div id="detailPanelNotes" class="detail-panel__notes"></div>
          <div id="detailPanelActions" class="detail-panel__actions"></div>
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

  const STATUS_TONES = ['ok', 'warn', 'block', 'unknown', 'neutral'];

  /** One row inside a section. Absent parts are omitted, never defaulted. */
  function sectionRow(row) {
    if (!row || !row.label) return '';
    const tone = STATUS_TONES.indexOf(row.statusTone) === -1 ? 'neutral' : row.statusTone;
    return `
      <li class="detail-panel__row">
        <div class="detail-panel__row-main">
          <span class="detail-panel__row-label">${escapeHtml(row.label)}</span>
          ${row.sublabel ? `<span class="detail-panel__row-sub">${escapeHtml(row.sublabel)}</span>` : ''}
        </div>
        <div class="detail-panel__row-side">
          ${row.status ? `<span class="detail-panel__status detail-panel__status--${tone}">${escapeHtml(row.status)}</span>` : ''}
          ${row.meta ? `<span class="detail-panel__row-meta">${escapeHtml(row.meta)}</span>` : ''}
        </div>
      </li>`;
  }

  function renderSections(panel, sections) {
    const root = panel.querySelector('#detailPanelSections');
    if (!root) return;
    const list = Array.isArray(sections) ? sections.filter(Boolean) : [];
    root.innerHTML = list.map((section) => {
      const rows = Array.isArray(section.rows) ? section.rows : [];
      // An empty section still renders, saying so in the caller's own words:
      // a section that vanishes reads as "not applicable" when it means "none".
      const body = rows.length > 0
        ? `<ul class="detail-panel__rows">${rows.map(sectionRow).join('')}</ul>`
        : `<div class="detail-panel__empty">${escapeHtml(section.empty || 'None.')}</div>`;
      return `
        <section class="detail-panel__section">
          <div class="detail-panel__section-head">
            <h3 class="detail-panel__section-title">${escapeHtml(section.title || '')}</h3>
            ${section.caption ? `<span class="detail-panel__section-caption">${escapeHtml(section.caption)}</span>` : ''}
          </div>
          ${body}
        </section>`;
    }).join('');
    root.hidden = list.length === 0;
  }

  function renderNotes(panel, notes) {
    const root = panel.querySelector('#detailPanelNotes');
    if (!root) return;
    const list = (Array.isArray(notes) ? notes : []).filter(note => typeof note === 'string' && note.trim().length > 0);
    root.innerHTML = list.map(note => `<p class="detail-panel__note">${escapeHtml(note)}</p>`).join('');
    root.hidden = list.length === 0;
  }

  function renderActions(panel, actions) {
    const root = panel.querySelector('#detailPanelActions');
    if (!root) return;
    root.replaceChildren();
    (Array.isArray(actions) ? actions : []).forEach((action) => {
      if (!action?.label) return;
      const button = document.createElement('button');
      button.type = 'button';
      button.className = action.primary ? 'init-btn init-btn-cyan' : 'init-btn';
      button.textContent = action.label;
      button.addEventListener('click', () => {
        if (action.close !== false) close();
        if (typeof action.onClick === 'function') action.onClick();
      });
      root.appendChild(button);
    });
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
    renderSections(panel, options.sections);
    renderNotes(panel, options.notes);
    renderActions(panel, options.actions);
    setPanelOpen(panel, true);
    // A re-open must not inherit the previous caller's scroll position.
    const body = panel.querySelector('.detail-panel__body');
    if (body) body.scrollTop = 0;
    const closeButton = panel.querySelector('button[data-detail-close]');
    (closeButton || panel.querySelector('[data-detail-close]')).focus();
  }

  function close() {
    const panel = document.getElementById('mcDetailPanel');
    if (!panel) return;
    setPanelOpen(panel, false);
    if (lastTrigger && document.contains(lastTrigger)) lastTrigger.focus();
    lastTrigger = null;
  }

  global.MissionControlDetailPanel = { open, close, syncPageInert };
})(window);
