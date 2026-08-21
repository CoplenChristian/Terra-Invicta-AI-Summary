/*
 * Directive Board v2
 * ------------------
 * Renders the Directive Engine v2 Cycle Plan (server/directiveEngine.js).
 *
 * Implements the cycle allocation model from docs/archive/directive-engine-v2.md:
 *   - Cycle Allocation Matrix: assigns available councilors to high-expected-value missions
 *   - Shared Portfolio Budgets: tracks set-level hate, influence, ops, and MC consumption
 *   - Strategic Clocks: tracks expiring wards, alien passive hate acceleration, and countdowns
 *   - Multi-Cycle Horizon: explains forward-looking enablement chains (e.g. Investigate -> Turn)
 *   - Benched Candidates: names what was displaced and why
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
    intelligence: 'INTEL',
    security: 'SECURITY',
    space: 'SPACE',
    research: 'RESEARCH',
    defense: 'DEFENSE'
  };

  function formatCost(cost) {
    if (!cost) return 'Free';
    const amount = num(cost.amount);
    const resource = cost.resource || 'Resource';
    if (amount !== null) return `${amount} ${resource}`;
    if (cost.kind === 'bonus') return `${resource} (Bonus)`;
    return `${resource} (Amount unavailable)`;
  }

  function formatOddsFact(odds) {
    if (odds && odds.automatic === true) return '100% (Automatic)';
    if (typeof odds?.point === 'number') {
      const pct = odds.point >= 100 ? '>99%' : `${odds.point}%`;
      return `${pct} (${odds.basis || 'Calculated'})`;
    }
    return `Unavailable — ${odds?.basis || 'mission rules not in this snapshot'}`;
  }

  function renderOddsGauge(odds) {
    // `point === 100` used to qualify as automatic, which labelled a contested
    // Control Nation roll of 99.8% "AUTOMATIC" -- a rounding artefact reported
    // as a rule of the game. Only the template's own `contested: false` says a
    // mission cannot fail.
    if (odds && (odds.automatic === true || odds.isAutomatic === true)) {
      return '<span class="directive-odds-tag directive-odds-tag--auto">100% AUTOMATIC</span>';
    }
    // A missing odds object and a computed 100% are not the same reading, and
    // the old `?? 50` turned "we have no mission rules for this" into a
    // confident coin flip on the card. Say what is actually known.
    const computed = num(odds?.point ?? (typeof odds?.chance === 'number' ? odds.chance * 100 : null));
    if (computed === null) {
      const basis = odds?.basis ? ` — ${odds.basis}` : '';
      return `<span class="directive-odds-tag directive-odds-tag--unknown" title="${escapeHtml(basis.slice(3))}">ODDS UNAVAILABLE</span>`;
    }
    const pt = Math.round(computed);
    const low = odds.band?.[0] ?? (odds.success?.low ? Math.round(num(odds.success.low)) : null);
    const high = odds.band?.[1] ?? (odds.success?.high ? Math.round(num(odds.success.high)) : null);
    const bandText = (low !== null && high !== null) ? `[${low}–${high}%]` : '';

    let colorClass = 'directive-odds--good';
    if (pt < 50) colorClass = 'directive-odds--low';
    else if (pt < 75) colorClass = 'directive-odds--mid';

    return `
      <div class="directive-odds-wrapper">
        <div class="directive-odds-meter">
          <div class="directive-odds-bar ${colorClass}" style="width: ${Math.min(100, Math.max(5, pt))}%"></div>
        </div>
        <span class="directive-odds-label ${colorClass}">
          <strong>${pt >= 100 ? '&gt;99%' : `${pt}%`}</strong> <small>${escapeHtml(bandText)}</small>
        </span>
      </div>`;
  }

  function renderBudgets(budgets) {
    if (!budgets) return '';
    const hate = budgets.alienHate || budgets.hate || {};
    const inf = budgets.influence || {};
    const ops = budgets.operations || budgets.ops || {};
    const mc = budgets.missionControl || {};

    const hateSpent = num(hate.used ?? hate.spent) ?? 0;
    const hateCeil = num(hate.cap ?? hate.ceiling) ?? 5.0;
    const hatePct = Math.min(100, Math.round((hateSpent / Math.max(0.1, hateCeil)) * 100));

    const infSpent = num(inf.used ?? inf.spent) ?? 0;
    const infStock = num(inf.cap ?? inf.stock) ?? 100;
    const infPct = Math.min(100, Math.round((infSpent / Math.max(1, infStock)) * 100));

    const opsSpent = num(ops.used ?? ops.spent) ?? 0;
    const opsStock = num(ops.cap ?? ops.stock) ?? 50;
    const opsPct = Math.min(100, Math.round((opsSpent / Math.max(1, opsStock)) * 100));

    const mcCur = num(mc.used ?? mc.current) ?? 0;
    const mcCap = num(mc.cap ?? mc.capacity) ?? 100;
    const mcPct = Math.min(100, Math.round((mcCur / Math.max(1, mcCap)) * 100));

    return `
      <div class="directive-budgets-bar">
        <div class="directive-budget-item">
          <div class="directive-budget-label">
            <span>ALIEN HATE BUDGET</span>
            <strong>${hateSpent.toFixed(1)} / ${hateCeil.toFixed(1)}</strong>
          </div>
          <div class="directive-budget-track">
            <div class="directive-budget-fill ${hateSpent > hateCeil ? 'directive-budget-fill--danger' : 'directive-budget-fill--warn'}" style="width: ${hatePct}%"></div>
          </div>
        </div>

        <div class="directive-budget-item">
          <div class="directive-budget-label">
            <span>INFLUENCE POOL</span>
            <strong>${infSpent} / ${infStock}</strong>
          </div>
          <div class="directive-budget-track">
            <div class="directive-budget-fill" style="width: ${infPct}%"></div>
          </div>
        </div>

        <div class="directive-budget-item">
          <div class="directive-budget-label">
            <span>OPERATIONS POOL</span>
            <strong>${opsSpent} / ${opsStock}</strong>
          </div>
          <div class="directive-budget-track">
            <div class="directive-budget-fill" style="width: ${opsPct}%"></div>
          </div>
        </div>

        <div class="directive-budget-item">
          <div class="directive-budget-label">
            <span>MISSION CONTROL</span>
            <strong>${mcCur} / ${mcCap}</strong>
          </div>
          <div class="directive-budget-track">
            <div class="directive-budget-fill directive-budget-fill--accent" style="width: ${mcPct}%"></div>
          </div>
        </div>
      </div>`;
  }

  function renderClocks(clocks) {
    if (!Array.isArray(clocks) || clocks.length === 0) return '';
    return `
      <div class="directive-clocks-section">
        <div class="directive-subheading">STRATEGIC CLOCKS & EXPIRATIONS</div>
        <div class="directive-clocks-grid">
          ${clocks.map(clock => {
            const urgencyClass = clock.urgency === 'HIGH' || clock.urgency === 'URGENT'
              ? 'directive-clock-badge--urgent'
              : (clock.urgency === 'MEDIUM' ? 'directive-clock-badge--active' : '');
            return `
              <div class="directive-clock-card">
                <div class="directive-clock-header">
                  <div class="directive-clock-title">${escapeHtml(clock.title)}</div>
                  <span class="directive-clock-badge ${urgencyClass}">
                    ${clock.daysRemaining !== undefined && clock.daysRemaining !== null ? `${clock.daysRemaining}d` : (clock.rate || clock.urgency || 'ACTIVE')}
                  </span>
                </div>
                <div class="directive-clock-detail">${escapeHtml(clock.detail || '')}</div>
              </div>`;
          }).join('')}
        </div>
      </div>`;
  }

  function renderAssignmentCard(assignment, index) {
    const councilor = assignment.councilor || {};
    const candidate = assignment.candidate || {};
    const odds = assignment.odds;
    const ev = num(assignment.expectedValue);
    const hateExp = num(assignment.expectedHate);
    const cost = candidate.cost;
    const whyList = Array.isArray(assignment.why) ? assignment.why : [];
    const fam = String(candidate.family || 'expansion').toLowerCase();
    const famLabel = FAMILY_LABEL[fam] || fam.toUpperCase();

    return `
      <div class="directive-assignment-card" data-assignment-index="${index}">
        <div class="directive-assignment-header">
          <div class="directive-councilor-badge">
            <span class="directive-councilor-num">${index + 1}</span>
            <div class="directive-councilor-info">
              <div class="directive-councilor-name">${escapeHtml(councilor.name || 'Councilor')}</div>
              <div class="directive-councilor-meta">
                ${escapeHtml(councilor.profession || 'Operative')} · ${escapeHtml(councilor.location || 'Earth')} · <strong>${escapeHtml(councilor.stat || '')}</strong>
              </div>
            </div>
          </div>
          <div class="directive-tags">
            <span class="directive-family-tag directive-family-tag--${fam}">${famLabel}</span>
            ${cost ? `<span class="directive-cost-tag">${escapeHtml(formatCost(cost))}</span>` : ''}
          </div>
        </div>

        <div class="directive-mission-block">
          <div class="directive-mission-title">${escapeHtml(candidate.title || candidate.friendlyName || 'Directive Assignment')}</div>
          <div class="directive-mission-target">${escapeHtml(candidate.target?.name || candidate.target?.nation || 'Designated Target')}</div>
        </div>

        <div class="directive-metrics-row">
          <div class="directive-metric-col">
            <div class="directive-metric-label">SUCCESS ODDS</div>
            ${renderOddsGauge(odds)}
          </div>
          <div class="directive-metric-col directive-metric-col--right">
            <div class="directive-metric-label">EXPECTED VALUE / HATE</div>
            <div class="directive-ev-hate-line">
              <span class="directive-ev-val">EV: <strong>${ev !== null ? ev.toFixed(2) : '—'}</strong></span>
              <span class="directive-hate-val ${hateExp > 0 ? 'directive-hate-val--warn' : ''}">
                ${hateExp !== null ? (hateExp === 0 ? '0 hate' : `+${hateExp.toFixed(2)} hate`) : 'hate unknown'}
              </span>
            </div>
          </div>
        </div>

        ${whyList.length ? `
          <ul class="directive-why-list">
            ${whyList.map(w => `<li>${escapeHtml(w)}</li>`).join('')}
          </ul>
        ` : ''}

        ${assignment.opportunityCost ? `
          <div class="directive-opp-cost">
            <span class="directive-opp-label">OPPORTUNITY COST:</span> ${escapeHtml(assignment.opportunityCost)}
          </div>
        ` : ''}
      </div>`;
  }

  function renderUnassigned(unassigned) {
    if (!Array.isArray(unassigned) || unassigned.length === 0) return '';
    return `
      <div class="directive-unassigned-section">
        <div class="directive-subheading">UNASSIGNED OPERATIVES (${unassigned.length})</div>
        <div class="directive-unassigned-list">
          ${unassigned.map(u => {
            const councilor = u.councilor || u;
            return `
              <div class="directive-unassigned-item">
                <div class="directive-unassigned-head">
                  <strong>${escapeHtml(councilor.name || 'Councilor')}</strong>
                  <span>${escapeHtml(councilor.profession || 'Operative')} · ${escapeHtml(councilor.location || 'Earth')}</span>
                </div>
                <div class="directive-unassigned-reason">${escapeHtml(u.reasonDetail || u.reason || 'No positive expected-value action matches theater constraints this cycle.')}</div>
                ${u.suggestedFreeAction ? `<div class="directive-unassigned-free">Free action: <strong>${escapeHtml(u.suggestedFreeAction)}</strong>${Array.isArray(u.freeActionOptions) && u.freeActionOptions.length > 1 ? ` <small>(or ${escapeHtml(u.freeActionOptions.slice(1).join(', '))})</small>` : ''}</div>` : ''}
              </div>`;
          }).join('')}
        </div>
      </div>`;
  }

  function renderBenched(benched) {
    if (!Array.isArray(benched) || benched.length === 0) return '';
    return `
      <div class="directive-benched-section">
        <div class="directive-subheading">BENCHED ALTERNATIVES & TRADE-OFFS</div>
        <div class="directive-benched-list">
          ${benched.slice(0, 5).map(b => {
            const candidate = b.candidate || b;
            const score = num(candidate.score);
            return `
              <div class="directive-benched-item">
                <div class="directive-benched-header">
                  <span class="directive-benched-title">${escapeHtml(candidate.title || candidate.missionType || 'Alternative')}</span>
                  ${score !== null ? `<span class="directive-benched-score">Score ${score.toFixed(2)}</span>` : ''}
                </div>
                <div class="directive-benched-reason">
                  <span class="directive-displaced-label">DISPLACED BY:</span> ${escapeHtml(b.displacedBy || 'Higher expected value team assignment.')}
                </div>
              </div>`;
          }).join('')}
        </div>
      </div>`;
  }

  function renderHorizon(horizon) {
    if (!Array.isArray(horizon) || horizon.length === 0) return '';
    return `
      <div class="directive-horizon-section">
        <div class="directive-subheading">MULTI-CYCLE HORIZON & ENABLEMENT CHAINS</div>
        <div class="directive-horizon-grid">
          ${horizon.map(h => `
            <div class="directive-horizon-card">
              <div class="directive-horizon-cycle">${escapeHtml(h.cycle || 'Upcoming')}</div>
              <div class="directive-horizon-content">
                <div class="directive-horizon-title">${escapeHtml(h.title || '')}</div>
                <div class="directive-horizon-enabler"><span class="directive-enabler-label">Enabler:</span> ${escapeHtml(h.enabler || '')}</div>
                <div class="directive-horizon-payoff">${escapeHtml(h.notes || h.expectedPayoff || '')}</div>
              </div>
            </div>
          `).join('')}
        </div>
      </div>`;
  }

  function renderDecisionReasoning(reasoning) {
    if (!reasoning) return '';
    const counts = reasoning.counts || {};
    const sources = Array.isArray(reasoning.sources) ? reasoning.sources : [];

    return `
      <div class="directive-reasoning-section">
        <div class="directive-subheading">${escapeHtml(reasoning.heading || 'ALLOCATION STRATEGY')}</div>
        <p class="directive-reasoning-summary">${escapeHtml(reasoning.summary || '')}</p>
        <div class="directive-reasoning-method">${escapeHtml(reasoning.selectionMethod || '')}</div>
        <div class="directive-reasoning-meta">
          <span>${counts.generated ?? 0} total evaluated</span> ·
          <span>${counts.assigned ?? 0} allocated</span> ·
          <span>${counts.benched ?? 0} benched</span> ·
          <span>Confidence: <strong>${escapeHtml(reasoning.confidence || 'HIGH')}</strong></span>
        </div>
        ${sources.length ? `
          <div class="directive-sources-list">
            <span class="directive-sources-label">FORMULA SOURCES:</span>
            <ul>
              ${sources.map(s => `<li>${escapeHtml(s)}</li>`).join('')}
            </ul>
          </div>
        ` : ''}
      </div>`;
  }

  function render(root, payload) {
    if (!root) return;
    const engineDirectives = payload && payload.engineDirectives;
    const cyclePlan = engineDirectives && engineDirectives.cyclePlan;

    if (!cyclePlan) {
      root.innerHTML = `
        <div class="directive-engine-v2">
          <div class="directive-header-strip">
            <div class="directive-header-left">
              <div class="directive-header-eyebrow">DIRECTIVE ENGINE v2 // CYCLE ALLOCATION</div>
              <div class="directive-header-title">COUNCILOR ASSIGNMENT PLAN</div>
            </div>
            <div class="directive-header-badges">
              <span class="directive-status-badge directive-status-badge--idle">CYCLE PLAN UNAVAILABLE</span>
            </div>
          </div>
          <div class="directive-empty-banner" style="padding: 24px; text-align: center; color: var(--color-text-muted, #8b949e); background: rgba(0,0,0,0.2); border-radius: 4px; border: 1px dashed rgba(255,255,255,0.1); margin-top: 16px;">
            Cycle allocation plan is unavailable for this snapshot. Ensure councilor intelligence and mission candidates are loaded.
          </div>
        </div>`;
      return;
    }

    const assignments = Array.isArray(cyclePlan.assignments) ? cyclePlan.assignments : [];
    const unassigned = Array.isArray(cyclePlan.unassigned) ? cyclePlan.unassigned : [];
    const benched = Array.isArray(cyclePlan.benched) ? cyclePlan.benched : [];
    const clocks = Array.isArray(cyclePlan.clocks) ? cyclePlan.clocks : [];
    const horizon = Array.isArray(cyclePlan.horizon) ? cyclePlan.horizon : [];
    const budgets = cyclePlan.budgets || {};
    const reasoning = cyclePlan.decisionReasoning || engineDirectives?.decisionReasoning;

    root.innerHTML = `
      <div class="directive-engine-v2">
        <div class="directive-header-strip">
          <div class="directive-header-left">
            <div class="directive-header-eyebrow">DIRECTIVE ENGINE v2 // CYCLE ALLOCATION</div>
            <div class="directive-header-title">COUNCILOR ASSIGNMENT PLAN</div>
          </div>
          <div class="directive-header-badges">
            <span class="directive-status-badge directive-status-badge--assigned">${assignments.length} ASSIGNED</span>
            ${unassigned.length ? `<span class="directive-status-badge directive-status-badge--idle">${unassigned.length} IDLE</span>` : ''}
          </div>
        </div>

        ${renderBudgets(budgets)}

        ${renderClocks(clocks)}

        <div class="directive-assignments-section">
          <div class="directive-subheading">ACTIVE COUNCILOR ASSIGNMENTS</div>
          <div class="directive-assignments-grid">
            ${assignments.length > 0
              ? assignments.map((a, idx) => renderAssignmentCard(a, idx)).join('')
              : '<div class="directive-empty-banner" style="padding: 16px; color: var(--color-text-muted);">No active councilor assignments feasible this cycle.</div>'}
          </div>
        </div>

        ${renderUnassigned(unassigned)}

        ${renderHorizon(horizon)}

        ${renderBenched(benched)}

        ${renderDecisionReasoning(reasoning)}
      </div>`;

    // Interactive inspection of assignments
    root.querySelectorAll('.directive-assignment-card').forEach(card => {
      card.style.cursor = 'pointer';
      card.addEventListener('click', () => {
        const idx = Number(card.dataset.assignmentIndex);
        const a = assignments[idx];
        if (!a || !window.MissionControlDetailPanel) return;
        const councilor = a.councilor || {};
        const candidate = a.candidate || {};
        const odds = a.odds;
        const ev = num(a.expectedValue);
        const hateExp = num(a.expectedHate);
        const whyList = Array.isArray(a.why) ? a.why : [];

        window.MissionControlDetailPanel.open({
          eyebrow: `COUNCILOR ASSIGNMENT #${idx + 1}`,
          title: `${councilor.name || 'Operative'} — ${candidate.friendlyName || candidate.missionType || 'Mission'}`,
          summary: candidate.title || `Assign ${councilor.name} to ${candidate.missionType} targeting ${candidate.target?.name || candidate.target?.nation || 'target'}.`,
          facts: [
            { label: 'Operative', value: `${councilor.name} (${councilor.profession || 'Councilor'}, ${councilor.location || 'Earth'})` },
            { label: 'Operative stats', value: councilor.stat || 'Assessed in-theater' },
            { label: 'Mission', value: candidate.missionType || 'UNAVAILABLE' },
            { label: 'Target', value: candidate.target?.name || candidate.target?.nation || 'Identified Target' },
            { label: 'Success odds', value: formatOddsFact(odds) },
            { label: 'Expected Value', value: ev !== null ? `${ev.toFixed(2)} pts` : '—' },
            { label: 'Expected Hate', value: hateExp !== null ? (hateExp === 0 ? '0 hate (Safe)' : `+${hateExp.toFixed(2)} hate`) : 'Not computable without mission odds' },
            { label: 'Resource cost', value: formatCost(candidate.cost) },
            { label: 'Opportunity cost', value: a.opportunityCost || 'None' },
            { label: 'Tactical rationale', value: whyList.join(' · ') || 'Optimal expected value under cycle budget constraints.' }
          ],
          actions: [
            { label: 'Open councilor roster', primary: true, onClick: () => {
              const btn = document.getElementById('openCouncilorRosterBtn');
              if (btn) btn.click();
            }}
          ]
        });
      });
    });
  }

  global.MissionControlDirectiveBoard = { render };
})(window);
