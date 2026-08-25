/*
 * Directive Board v2
 * ------------------
 * Purpose: renders the Directive Engine v2 Cycle Plan.
 * Renders the Directive Engine v2 Cycle Plan (server/directiveEngine.js).
 *
 * Implements the cycle allocation model from docs/archive/directive-engine-v2.md:
 *   - Cycle Allocation Matrix: assigns available councilors to high-expected-value missions
 *   - Shared Portfolio Budgets: tracks set-level hate, influence, ops, and MC consumption
 *   - Strategic Clocks: tracks expiring wards, alien passive hate acceleration, and countdowns
 *   - Multi-Cycle Horizon: explains forward-looking enablement chains (e.g. Investigate -> Turn)
 *   - Benched Candidates: names what was displaced and why, one row per
 *     (mission, target) sibling group with the count each row stands for
 *   - Risk floor: the player's minimum success chance, the control that sets
 *     it, and every action it held back (docs/risk-tolerance-spec.md)
 *
 * The risk floor is rendered from `cyclePlan.riskFloor` -- the floor the SERVER
 * resolved -- not from the browser's stored preference, because an absent
 * preference means "use the configured default" and only the server knows what
 * that is. `null` percent is "not configured", `0` is "the player chose no
 * floor"; neither is a floor of zero that rejects everything, and the card must
 * not blur the three.
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

  // Offered floors. `''` is the deliberate "no stored preference" option: it
  // clears the setting so the request omits the parameter and the server's
  // configured default applies, which is NOT the same as choosing 0.
  const RISK_FLOOR_CHOICES = [50, 60, 70, 75, 80, 85, 90, 95];

  /**
   * The floor the server actually applied, plus the control that changes it.
   *
   * `inForce` is the honest three-way readout: a floor of 0 and an unconfigured
   * floor both hold nothing back, and saying "0% floor" for the unconfigured
   * case would report a setting nobody made.
   */
  function renderRiskFloor(riskFloor, preference, onChange) {
    const percent = num(riskFloor?.percent);
    const inForce = riskFloor?.inForce === true;
    const configured = riskFloor?.configured === true;

    const statusText = inForce
      ? `Actions must clear ${percent}% at the LOW end of their odds band.`
      : (configured
        ? 'No floor: every action is offered regardless of its success odds.'
        : 'No floor is configured for this snapshot, so nothing is held back on odds.');

    const selected = preference === null || preference === undefined ? '' : String(preference);
    const options = [
      `<option value=""${selected === '' ? ' selected' : ''}>Server default${percent === null ? '' : ` (${percent}%)`}</option>`,
      `<option value="0"${selected === '0' ? ' selected' : ''}>Off — no floor</option>`,
      ...RISK_FLOOR_CHOICES.map(value =>
        `<option value="${value}"${selected === String(value) ? ' selected' : ''}>${value}% minimum</option>`)
    ].join('');

    return `
      <div class="directive-risk-floor ${inForce ? 'directive-risk-floor--active' : ''}">
        <div class="directive-risk-floor__readout">
          <span class="directive-subheading">RISK TOLERANCE</span>
          <span class="directive-risk-floor__status">${escapeHtml(statusText)}</span>
        </div>
        ${typeof onChange === 'function' ? `
          <label class="directive-risk-floor__control">
            <span>Minimum success odds</span>
            <select data-risk-floor-select aria-label="Minimum success odds for a recommended action">
              ${options}
            </select>
          </label>` : ''}
      </div>`;
  }

  /**
   * The per-assignment risk note.
   *
   * Only three states earn a line: a floor that could not be CHECKED (an
   * unmeasured chance is not an acceptable one), a marginal clearance on an
   * assumed estimate, and nothing at all otherwise. A comfortable pass says
   * nothing, because a card that annotates everything annotates nothing.
   */
  function renderRiskNote(riskFloor) {
    if (!riskFloor) return '';
    if (riskFloor.outcome === 'unknown') {
      return `<div class="directive-risk-note directive-risk-note--unknown">
          <span class="directive-risk-note__tag">FLOOR NOT VERIFIED</span>
          ${escapeHtml(riskFloor.reason || 'Success odds could not be computed for this action.')}
        </div>`;
    }
    if (riskFloor.outcome === 'pass' && riskFloor.marginal === true) {
      return `<div class="directive-risk-note directive-risk-note--marginal">
          <span class="directive-risk-note__tag">MARGINAL</span>
          ${escapeHtml(riskFloor.reason || '')}
        </div>`;
    }
    return '';
  }

  /**
   * Actions the floor held back. Capped by the engine, so the true total and
   * the omitted count are printed rather than letting a 25-row slice read as
   * the whole set.
   */
  function renderRiskFloorHeld(cyclePlan) {
    const held = Array.isArray(cyclePlan.riskFloorVetoed) ? cyclePlan.riskFloorVetoed : [];
    const unverified = Array.isArray(cyclePlan.riskFloorUnverified) ? cyclePlan.riskFloorUnverified : [];
    const heldTotal = num(cyclePlan.riskFloorVetoedTotalCount) ?? held.length;
    const heldOmitted = num(cyclePlan.riskFloorVetoedOmittedCount) ?? 0;
    const unverifiedTotal = num(cyclePlan.riskFloorUnverifiedTotalCount) ?? unverified.length;
    const unverifiedOmitted = num(cyclePlan.riskFloorUnverifiedOmittedCount) ?? 0;
    if (heldTotal === 0 && unverifiedTotal === 0) return '';

    const row = (entry, tone) => `
      <div class="directive-risk-held-item directive-risk-held-item--${tone}">
        <div class="directive-risk-held-head">
          <span class="directive-risk-held-title">${escapeHtml(entry.title || 'Action')}</span>
          <span class="directive-risk-held-who">${escapeHtml(entry.councilorName || 'Operative')}</span>
        </div>
        <div class="directive-risk-held-reason">${escapeHtml(entry.reason || '')}</div>
      </div>`;

    return `
      <div class="directive-risk-held-section">
        <div class="directive-subheading">
          HELD BACK BY YOUR RISK FLOOR (${heldTotal}${unverifiedTotal ? ` + ${unverifiedTotal} UNVERIFIED` : ''})
        </div>
        <div class="directive-risk-held-list">
          ${held.map(entry => row(entry, 'veto')).join('')}
          ${unverified.map(entry => row(entry, 'unknown')).join('')}
        </div>
        ${heldOmitted > 0 || unverifiedOmitted > 0 ? `
          <div class="directive-risk-held-omitted">
            Showing ${held.length} of ${heldTotal} held back${unverifiedTotal
              ? ` and ${unverified.length} of ${unverifiedTotal} unverified` : ''};
            ${heldOmitted + unverifiedOmitted} further entr${heldOmitted + unverifiedOmitted === 1 ? 'y is' : 'ies are'} omitted from this view.
          </div>` : ''}
      </div>`;
  }

  function renderBudgets(budgets) {
    if (!budgets) return '';
    const hate = budgets.alienHate || budgets.hate || {};
    const inf = budgets.influence || {};
    const ops = budgets.operations || budgets.ops || {};
    const mc = budgets.missionControl || {};

    const hateSpent = num(hate.used ?? hate.spent);
    const hateCeil = num(hate.cap ?? hate.ceiling);
    const hateMeasured = hate.capMeasured === true && hateSpent !== null && hateCeil !== null;
    const hatePct = hateMeasured
      ? (hateCeil > 0 ? Math.min(100, Math.round((hateSpent / hateCeil) * 100)) : (hateSpent > 0 ? 100 : 0))
      : null;

    const infSpent = num(inf.used ?? inf.spent);
    const infStock = num(inf.cap ?? inf.stock);
    const infMeasured = inf.capMeasured === true && infSpent !== null && infStock !== null;
    const infPct = infMeasured
      ? (infStock > 0 ? Math.min(100, Math.round((infSpent / infStock) * 100)) : (infSpent > 0 ? 100 : 0))
      : null;

    const opsSpent = num(ops.used ?? ops.spent);
    const opsStock = num(ops.cap ?? ops.stock);
    const opsMeasured = ops.capMeasured === true && opsSpent !== null && opsStock !== null;
    const opsPct = opsMeasured
      ? (opsStock > 0 ? Math.min(100, Math.round((opsSpent / opsStock) * 100)) : (opsSpent > 0 ? 100 : 0))
      : null;

    const mcCur = num(mc.used ?? mc.current);
    const mcCap = num(mc.cap ?? mc.capacity);
    const mcMeasured = mc.capMeasured === true && mcCur !== null && mcCap !== null;
    const mcPct = mcMeasured
      ? (mcCap > 0 ? Math.min(100, Math.round((mcCur / mcCap) * 100)) : (mcCur > 0 ? 100 : 0))
      : null;

    return `
      <div class="directive-budgets-bar">
        <div class="directive-budget-item">
          <div class="directive-budget-label">
            <span>ALIEN HATE BUDGET</span>
            <strong>${hateMeasured ? `${hateSpent.toFixed(1)} / ${hateCeil.toFixed(1)}` : 'NOT MEASURED'}</strong>
          </div>
          <div class="directive-budget-track">
            ${hateMeasured ? `<div class="directive-budget-fill ${hateSpent > hateCeil ? 'directive-budget-fill--danger' : 'directive-budget-fill--warn'}" style="width: ${hatePct}%"></div>` : ''}
          </div>
        </div>

        <div class="directive-budget-item">
          <div class="directive-budget-label">
            <span>INFLUENCE POOL</span>
            <strong>${infMeasured ? `${infSpent} / ${infStock}` : 'NOT MEASURED'}</strong>
          </div>
          <div class="directive-budget-track">
            ${infMeasured ? `<div class="directive-budget-fill" style="width: ${infPct}%"></div>` : ''}
          </div>
        </div>

        <div class="directive-budget-item">
          <div class="directive-budget-label">
            <span>OPERATIONS POOL</span>
            <strong>${opsMeasured ? `${opsSpent} / ${opsStock}` : 'NOT MEASURED'}</strong>
          </div>
          <div class="directive-budget-track">
            ${opsMeasured ? `<div class="directive-budget-fill" style="width: ${opsPct}%"></div>` : ''}
          </div>
        </div>

        <div class="directive-budget-item">
          <div class="directive-budget-label">
            <span>MISSION CONTROL</span>
            <strong>${mcMeasured ? `${mcCur} / ${mcCap}` : 'NOT MEASURED'}</strong>
          </div>
          <div class="directive-budget-track">
            ${mcMeasured ? `<div class="directive-budget-fill directive-budget-fill--accent" style="width: ${mcPct}%"></div>` : ''}
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

        ${renderRiskNote(assignment.riskFloor)}

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

  /**
   * The bench, rendered WHOLE.
   *
   * There used to be a `BENCHED_RENDER_LIMIT = 5` here, slicing the engine's
   * eight a second time in generation order. It was correct by luck -- measured
   * 2026-08-22 on `ExitSave.gz`, the five it happened to show were the best
   * five in both modes -- and it was a second truncation stacked on the first,
   * announced by neither.
   *
   * The fix is to stop deciding, not to duplicate the rule. The engine's
   * selection (`shared/benchSelection.mjs`) is the only selection, and this
   * board renders every row it was handed. The comparator deliberately is NOT
   * reimplemented here: these components are classic `<script>` tags with no
   * `type="module"`, so they cannot import `shared/*.mjs` at all, and a
   * hand-copied comparator would be a second statement of the rule waiting to
   * drift from the first.
   *
   * Each row now stands for a whole (mission, target) sibling group, so three
   * numbers travel: how many ROWS are shown, how many CANDIDATES those rows
   * account for, and the true bench total.
   *
   * A FOURTH now travels with them: what the shown rows COST against the pool
   * that refused them, and how many of them could be taken TOGETHER. Eight rows
   * listed as alternatives read as eight independently available options; on
   * the frozen save's omniscient plan they share one 7.90 cycle hate cap with
   * 3.16 left and each charges 4.57, so NONE of them can be added. The board
   * renders that header before the list rather than after it, because the
   * number is what makes the list interpretable at all.
   */

  /**
   * The bench header: what the pool has left, and how many rows fit it.
   *
   * ABSENT STAYS NULL in every branch. An older payload with no `benchBudget`
   * renders no affordability claim at all rather than "0 fit", which would read
   * as a measured finding that nothing is affordable. A pool with no readable
   * cap says the check could not be run, never that the budget is zero.
   */
  function renderBenchBudget(cyclePlan) {
    const summary = cyclePlan && typeof cyclePlan.benchBudget === 'object'
      ? cyclePlan.benchBudget
      : null;
    const hate = cyclePlan && cyclePlan.budgets && typeof cyclePlan.budgets.alienHate === 'object'
      ? cyclePlan.budgets.alienHate
      : null;
    const parts = [];

    if (hate !== null) {
      const cap = num(hate.cap);
      const used = num(hate.used);
      if (hate.capMeasured !== true || cap === null || used === null) {
        parts.push('<span class="directive-bench-budget-unknown">Cycle hate budget NOT MEASURED — '
          + 'hate charges this cycle went unchecked, not cleared.</span>');
      } else {
        const left = Math.max(0, cap - used);
        // A cap derived from the Mission Control FLOOR is an upper bound on the
        // real budget, because true hate can only be at or above that floor.
        // Player mode redacts the hate reading, so this is the normal case
        // there and saying nothing would let an optimistic cap read as measured.
        const caveat = hate.capIsUpperBound === true
          ? ' <span class="directive-bench-budget-caveat">(from the MC hate floor — an UPPER BOUND, '
            + 'the real budget can only be smaller)</span>'
          : '';
        parts.push(`Cycle hate budget <strong>${used.toFixed(2)} / ${cap.toFixed(2)}</strong> used, `
          + `<strong>${left.toFixed(2)}</strong> left${caveat}`);
      }
    }

    if (summary !== null) {
      const fits = num(summary.jointlyAffordableCount);
      if (fits === null) {
        parts.push(`<span class="directive-bench-budget-unknown">Joint affordability NOT COMPUTED — `
          + `${escapeHtml(summary.reason || 'no reason was recorded')}</span>`);
      } else {
        const rows = num(summary.rowCount);
        const unpriced = num(summary.unpricedRowCount);
        parts.push(`<strong>${fits} of ${rows === null ? 'the' : rows} row(s) below fit</strong> what is left `
          + `— these are ALTERNATIVES sharing one ${escapeHtml(String(summary.pool || 'budget'))} pool, not `
          + `independent options`
          + (unpriced ? `; ${unpriced} carry no measured charge and are counted neither way` : ''));
      }
    }

    if (parts.length === 0) return '';
    return `<div class="directive-bench-budget">${parts.join(' · ')}</div>`;
  }

  /**
   * What a collapsed row may and may not claim on behalf of its siblings.
   *
   * `displacedBy` describes the REPRESENTATIVE. When a group's members were held
   * back for different reasons, presenting the representative's reason as the
   * group's is the same defect this whole change exists to remove, one level
   * down. `groupBudgetDisplacedCount` is what makes the mismatch visible, and it
   * is only rendered when it actually disagrees with the row's own verdict.
   */
  function renderGroupReasonCaveat(row) {
    const count = num(row.groupCount);
    const budgetHeld = num(row.groupBudgetDisplacedCount);
    if (count === null || count < 2 || budgetHeld === null) return '';
    const rowIsBudget = row.displacementCause === 'budget';
    if (rowIsBudget && budgetHeld === count) return '';
    if (!rowIsBudget && budgetHeld === 0) return '';
    return `<div class="directive-benched-group-caveat">Mixed group: ${budgetHeld} of ${count} `
      + `option(s) here were refused by a budget, so the reason above does not describe all of them.</div>`;
  }

  function renderBenched(cyclePlan) {
    const benched = Array.isArray(cyclePlan.benched) ? cyclePlan.benched : [];
    if (benched.length === 0) return '';
    // Absent count means an older payload that never carried one; fall back to
    // what is actually in hand rather than inventing a total, matching
    // renderRiskFloorHeld above.
    const total = num(cyclePlan.benchedTotalCount) ?? benched.length;
    // Absent stays null. A payload from before the grouping change carries no
    // represented count, and 0 would be a measurement of something nobody read.
    const represented = num(cyclePlan.benchedRepresentedCount);
    const omitted = Math.max(0, total - benched.length);
    return `
      <div class="directive-benched-section">
        <div class="directive-subheading">BENCHED ALTERNATIVES &amp; TRADE-OFFS (${total})</div>
        ${renderBenchBudget(cyclePlan)}
        <div class="directive-benched-list">
          ${benched.map(b => {
            const candidate = b.candidate || b;
            const score = num(candidate.score);
            // An older payload has no group fields at all. It renders as a
            // plain row -- never "+0 more", never "+undefined more".
            const groupCount = num(b.groupCount);
            const collapsed = groupCount !== null && groupCount > 1;
            const note = typeof b.groupNote === 'string' && b.groupNote.trim() !== ''
              ? b.groupNote
              : null;
            // A collapsed row with no note still says it is collapsed, without
            // inventing the target the note would have named.
            const groupLine = !collapsed
              ? ''
              : `<div class="directive-benched-group">${escapeHtml(
                note !== null
                  ? note
                  : `+${groupCount - 1} more sibling option${groupCount - 1 === 1 ? '' : 's'}`
              )}</div>`;
            return `
              <div class="directive-benched-item">
                <div class="directive-benched-header">
                  <span class="directive-benched-title">${escapeHtml(candidate.title || candidate.missionType || 'Alternative')}</span>
                  ${score !== null ? `<span class="directive-benched-score">Score ${score.toFixed(2)}</span>` : ''}
                </div>
                ${groupLine}
                <div class="directive-benched-reason">
                  <span class="directive-displaced-label">${b.displacementCause === 'budget' ? 'REFUSED BY BUDGET:' : 'NOT TAKEN BECAUSE:'}</span>
                  ${
                    // ABSENT STAYS NULL. A payload with no reason says the
                    // reason was not recorded; it does NOT fall back to a
                    // sentence about a councilor, which is the fabricated
                    // explanation this row used to carry on every entry.
                    escapeHtml(typeof b.displacedBy === 'string' && b.displacedBy.trim() !== ''
                      ? b.displacedBy
                      : 'This plan recorded no reason for holding it back. That is an unrecorded reason, not an absent one.')
                  }
                </div>
                ${renderGroupReasonCaveat(b)}
              </div>`;
          }).join('')}
        </div>
        ${omitted > 0 ? `
          <div class="directive-benched-omitted">
            Showing ${benched.length} row${benched.length === 1 ? '' : 's'} of ${total} benched,
            ${represented === null
              ? 'standing for an unrecorded number of candidates'
              : `standing for ${represented} candidate${represented === 1 ? '' : 's'}`};
            ${omitted} further alternative${omitted === 1 ? ' is' : 's are'} omitted from this view.
          </div>` : ''}
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

  function renderDecisionReasoning(reasoning, cyclePlan) {
    if (!reasoning) return '';
    const counts = reasoning.counts || {};
    const sources = Array.isArray(reasoning.sources) ? reasoning.sources : [];

    // `counts` carries generated/recommended/alternatives/uncertain/rejected/
    // future (server/engine/selection.js) -- it has never carried `assigned` or
    // `benched`, so reading them off it and defaulting to 0 printed a confident
    // "0 allocated · 0 benched" on every plan. Both are read from the cycle
    // plan instead, and a segment whose count cannot be established is dropped
    // rather than rendered as a zero.
    const generated = num(counts.generated);
    const allocated = Array.isArray(cyclePlan?.assignments) ? cyclePlan.assignments.length : null;
    const benchedTotal = num(cyclePlan?.benchedTotalCount)
      ?? (Array.isArray(cyclePlan?.benched) ? cyclePlan.benched.length : null);
    const metaSegments = [
      generated === null ? null : `<span>${generated} total evaluated</span>`,
      allocated === null ? null : `<span>${allocated} allocated</span>`,
      benchedTotal === null ? null : `<span>${benchedTotal} benched</span>`,
      `<span>Confidence: <strong>${escapeHtml(reasoning.confidence || 'HIGH')}</strong></span>`
    ].filter(Boolean);

    return `
      <div class="directive-reasoning-section">
        <div class="directive-subheading">${escapeHtml(reasoning.heading || 'ALLOCATION STRATEGY')}</div>
        <p class="directive-reasoning-summary">${escapeHtml(reasoning.summary || '')}</p>
        <div class="directive-reasoning-method">${escapeHtml(reasoning.selectionMethod || '')}</div>
        <div class="directive-reasoning-meta">
          ${metaSegments.join(' · ')}
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
    const clocks = Array.isArray(cyclePlan.clocks) ? cyclePlan.clocks : [];
    const horizon = Array.isArray(cyclePlan.horizon) ? cyclePlan.horizon : [];
    const budgets = cyclePlan.budgets;
    const reasoning = cyclePlan.decisionReasoning || engineDirectives?.decisionReasoning;
    const riskFloor = cyclePlan.riskFloor || null;
    const riskFloorPercent = num(riskFloor?.percent);
    const riskFloorInForce = riskFloor?.inForce === true;
    const riskHeldTotal = num(cyclePlan.riskFloorVetoedTotalCount) ?? 0;
    const onRiskFloorChange = payload?.onRiskFloorChange;

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
            ${riskFloorInForce
              ? `<span class="directive-status-badge directive-status-badge--risk">RISK FLOOR ${riskFloorPercent}%${
                  riskHeldTotal ? ` · ${riskHeldTotal} HELD` : ''}</span>`
              : ''}
          </div>
        </div>

        ${renderRiskFloor(riskFloor, payload?.riskFloorPreference, onRiskFloorChange)}

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

        ${renderRiskFloorHeld(cyclePlan)}

        ${renderHorizon(horizon)}

        ${renderBenched(cyclePlan)}

        ${renderDecisionReasoning(reasoning, cyclePlan)}
      </div>`;

    const riskSelect = root.querySelector('[data-risk-floor-select]');
    if (riskSelect && typeof onRiskFloorChange === 'function') {
      riskSelect.addEventListener('change', () => {
        onRiskFloorChange(riskSelect.value === '' ? null : Number(riskSelect.value));
      });
    }

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
            {
              label: 'Risk floor',
              // Three readings, never blurred: no floor set, a floor that could
              // not be checked, and a floor this action actually cleared.
              value: !riskFloorInForce
                ? 'No floor in force — success odds did not gate this recommendation.'
                : (a.riskFloor?.reason || `Cleared your ${riskFloorPercent}% floor.`)
            },
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
