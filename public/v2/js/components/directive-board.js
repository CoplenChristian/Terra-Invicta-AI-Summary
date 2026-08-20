/*
 * Directive Board
 * ---------------
 * Renders the rule engine's output (server/directiveEngine.js).
 *
 * The point of the board is that the headline is always a constructive ACTION.
 * The reason an attractive alternative was deferred is shown separately as
 * decision reasoning, with the rule that changed its ranking and that rule's
 * source.
 *
 * Three lists, and the distinction between them is the whole design:
 *   - TRADE-OFFS a veto fired. This is evidence for the explanation, not a
 *                negative recommendation.
 *   - MORE DATA  a veto could not be evaluated. Not the same as safe, so
 *                these never become the recommendation, but they are shown
 *                rather than dropped.
 *   - FUTURE     unformed nations. Real opportunities that do not exist yet.
 */
(function exposeDirectiveBoard(global) {
  'use strict';

  const shared = global.MissionControlShared || {};
  const escapeHtml = shared.escapeHtml || (value => String(value ?? '')
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;'));

  function num(value) {
    if (value === null || value === undefined || value === '') return null;
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : null;
  }

  const FAMILY_LABEL = {
    expansion: 'EXPANSION',
    council: 'COUNCIL',
    intelligence: 'INTELLIGENCE'
  };

  /** Hate reads as a band, never a point value -- the game rolls 0.8-1.2. */
  function hateLabel(candidate) {
    if (!candidate.hate || !candidate.hate.toAliens) return 'no alien hate exposure';
    const low = num(candidate.hate.toAliens.low);
    const high = num(candidate.hate.toAliens.high);
    if (low === null || high === null) return 'UNAVAILABLE';
    if (low === 0 && high === 0) return 'no alien hate on success';
    return `~${low.toFixed(1)}–${high.toFixed(1)} alien hate`;
  }

  function costLabel(candidate) {
    if (!candidate.cost) return null;
    const amount = num(candidate.cost.amount);
    const resource = escapeHtml(candidate.cost.resource || 'resource');
    if (amount !== null) return `${amount} ${resource}`;
    // A bonus-cost mission's amount is chosen by the player and buys success
    // chance, so it is genuinely unfillable without an odds model.
    return candidate.cost.kind === 'bonus'
      ? `${resource} (player-chosen, scales success)`
      : `${resource} (amount UNAVAILABLE)`;
  }

  function scoreLabel(candidate) {
    const score = num(candidate.score);
    return score === null ? '—' : score.toFixed(2);
  }

  function renderPreconditions(candidate) {
    const list = Array.isArray(candidate.unmetPreconditions) ? candidate.unmetPreconditions : [];
    if (!list.length) return '';
    return `<ul class="directive-board-preconds">${
      list.map(p => `<li>${escapeHtml(p)}</li>`).join('')
    }</ul>`;
  }

  function renderReasons(reasons) {
    if (!Array.isArray(reasons) || !reasons.length) return '';
    return `<ul class="directive-board-reasons">${
      reasons.map(r => `<li><span class="directive-board-rule">${escapeHtml(r.ruleId)}</span> ${escapeHtml(r.reason)}</li>`).join('')
    }</ul>`;
  }

  function renderPrimary(candidate) {
    if (!candidate) {
      return '<div class="alien-hate-econ-empty">NO ENGINE OUTPUT</div>';
    }
    return `
      <div class="directive-board-primary">
        <div class="alien-hate-econ-eyebrow">RECOMMENDED ACTION</div>
        <div class="directive-board-primary-title">${escapeHtml(candidate.title || 'UNAVAILABLE')}</div>
        <div class="directive-board-meta">
          <span class="directive-board-chip">${escapeHtml(FAMILY_LABEL[candidate.family] || 'ACTION')}</span>
          <span class="directive-board-chip">${escapeHtml(candidate.missionType || 'UNAVAILABLE')}</span>
          <span class="directive-board-chip directive-board-chip--hate">${escapeHtml(hateLabel(candidate))}</span>
          ${costLabel(candidate) ? `<span class="directive-board-chip">${costLabel(candidate)}</span>` : ''}
          <span class="directive-board-chip directive-board-chip--score">score ${scoreLabel(candidate)}</span>
        </div>
        ${renderPreconditions(candidate)}
      </div>`;
  }

  function renderDecisionReasoning(reasoning) {
    if (!reasoning) return '';
    const factors = Array.isArray(reasoning.factors) ? reasoning.factors : [];
    const tradeoffs = Array.isArray(reasoning.tradeoffs) ? reasoning.tradeoffs : [];
    const sources = Array.isArray(reasoning.sources) ? reasoning.sources : [];
    const counts = reasoning.counts || {};
    const factorRows = factors.map(entry => `<li><span class="directive-board-rule">${escapeHtml(entry.ruleId)}</span> ${escapeHtml(entry.reason || 'Positive contribution')}</li>`).join('');
    const tradeoffRows = tradeoffs.map(entry => `<li><span class="directive-board-rule">${escapeHtml(entry.ruleId)}</span> ${escapeHtml(entry.reason || 'Trade-off')}</li>`).join('');
    const countText = [
      `${counts.generated ?? 0} considered`,
      `${counts.alternatives ?? 0} other actions available`,
      `${counts.uncertain ?? 0} needing more data`,
      `${counts.rejected ?? 0} trade-offs`,
      `${counts.future ?? 0} future opportunities`
    ].join(' · ');
    const sourceRows = sources.map(source => `<li>${escapeHtml(source)}</li>`).join('');
    return `
      <div class="alien-hate-econ-section directive-board-reasoning">
        <div class="alien-hate-econ-section-heading">${escapeHtml(reasoning.heading || 'WHY THIS ACTION')}</div>
        <div class="alien-hate-econ-note">${escapeHtml(reasoning.summary || '')}</div>
        <div class="directive-board-reasoning-method">${escapeHtml(reasoning.selectionMethod || '')}</div>
        <div class="directive-board-reasoning-grid">
          ${factorRows ? `<div><div class="directive-board-reasoning-label">SUPPORTING FACTORS</div><ul class="directive-board-reasons">${factorRows}</ul></div>` : ''}
          ${tradeoffRows ? `<div><div class="directive-board-reasoning-label">TRADE-OFFS IN THE SCORE</div><ul class="directive-board-reasons">${tradeoffRows}</ul></div>` : ''}
        </div>
        <div class="directive-board-reasoning-counts">${escapeHtml(countText)} · confidence: ${escapeHtml(reasoning.confidence || 'unknown')}</div>
        ${sourceRows ? `<div class="directive-board-reasoning-sources"><div class="directive-board-reasoning-label">RULE SOURCES</div><ul class="directive-board-reasons">${sourceRows}</ul></div>` : ''}
      </div>`;
  }

  function renderCandidateRow(candidate, extraReasons) {
    return `
      <li class="directive-board-row">
        <div class="directive-board-row-head">
          <span class="directive-board-score">${scoreLabel(candidate)}</span>
          <span class="directive-board-row-title">${escapeHtml(candidate.title || 'UNAVAILABLE')}</span>
        </div>
        <div class="directive-board-row-meta">
          ${escapeHtml(FAMILY_LABEL[candidate.family] || '')} · ${escapeHtml(hateLabel(candidate))}
        </div>
        ${renderReasons(extraReasons)}
      </li>`;
  }

  function renderSection(heading, note, rows) {
    if (!rows) return '';
    return `
      <div class="alien-hate-econ-section">
        <div class="alien-hate-econ-section-heading">${escapeHtml(heading)}</div>
        ${note ? `<div class="alien-hate-econ-note">${escapeHtml(note)}</div>` : ''}
        <ul class="directive-board-list">${rows}</ul>
      </div>`;
  }

  function render(root, payload) {
    if (!root) return;
    const result = payload && payload.engineDirectives;
    if (!result || !result.primary) {
      root.innerHTML = '<div class="alien-hate-econ-empty">DIRECTIVE ENGINE UNAVAILABLE</div>';
      return;
    }

    const alternatives = Array.isArray(result.alternatives) ? result.alternatives : [];
    const rejected = Array.isArray(result.rejected) ? result.rejected : [];
    const uncertain = Array.isArray(result.uncertain) ? result.uncertain : [];
    const future = Array.isArray(result.futureOpportunities) ? result.futureOpportunities : [];

    const altRows = alternatives.slice(0, 5).map(c => renderCandidateRow(c, null)).join('');
    const uncertainRows = uncertain.slice(0, 5)
      .map(c => renderCandidateRow(c, c.uncertaintyReasons)).join('');
    const rejectedRows = rejected.slice(0, 6)
      .map(c => renderCandidateRow(c, c.vetoReasons)).join('');

    root.innerHTML = `
      <div class="directive-board">
        ${renderPrimary(result.primary)}
        ${renderDecisionReasoning(result.decisionReasoning)}
        ${altRows ? renderSection('ALSO AVAILABLE', null, altRows) : ''}
        ${uncertainRows ? renderSection(
          'MORE DATA WOULD UNLOCK THESE ACTIONS',
          'A safety check needs information this save does not expose. These are not negative recommendations; they are opportunities to revisit after the missing evidence is available.',
          uncertainRows
        ) : ''}
        ${rejectedRows ? renderSection(
          'TRADE-OFFS CONSIDERED',
          rejected.length > 6 ? `Showing 6 of ${rejected.length}.` : null,
          rejectedRows
        ) : ''}
        ${future.length ? `
          <div class="alien-hate-econ-section">
            <div class="alien-hate-econ-section-heading">FUTURE OPPORTUNITIES</div>
            <div class="alien-hate-econ-note">
              ${future.length} unclaimed control point${future.length === 1 ? '' : 's'} sit in nations that have not
              formed yet — zero regions and zero population. They become takeable only when a formation project or
              event fires, so they are tracked separately rather than counted as available.
            </div>
          </div>` : ''}
      </div>`;
  }

  global.MissionControlDirectiveBoard = { render };
})(window);
