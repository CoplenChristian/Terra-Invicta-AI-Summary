/**
 * src/v2/panels/DirectiveBoard.jsx
 *
 * Purpose: React port of public/v2/js/components/directive-board.js — renders
 *   the Directive Engine v2 Cycle Plan into the COMMAND view's #directiveBoard
 *   mount.
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
 *
 * ---------------------------------------------------------------------------
 * TWO CONTRACTS THIS FILE IS NOT FREE TO RESTATE
 * ---------------------------------------------------------------------------
 *
 * 1. THE CROSS-PANEL SELECTOR. src/v2/panels/CouncilOrders.jsx:21-23 reaches
 *    into this board's DOM by id and class:
 *      document.getElementById('directiveBoard')
 *        .querySelector('.directive-assignment-card[data-assignment-index="N"]')
 *    The mount id belongs to public/v2/index.html; the two card attributes are
 *    emitted by `renderAssignmentCard` below and MUST keep those exact names.
 *    Renaming either silently kills that panel's click-through, and only one of
 *    the two components would be looking at the change.
 *
 * 2. THE BUDGET DENOMINATORS ARE NOT INVENTED (register defect #1, fixed).
 *    `renderBudgets` used to read `num(hate.cap ?? hate.ceiling) ?? 5.0` and
 *    three siblings, so an empty budgets payload rendered four filled meters
 *    against fabricated ceilings -- the bar LENGTH was fiction, not only the
 *    number. Each meter now routes its readout through <Value>, whose presence
 *    signal is explicit, and draws no fill at all when the ceiling was never
 *    measured.
 *
 * 3. FABRICATED FALLBACKS ARE STATED, NOT FILLED IN (register defect #17).
 *    Four absent readings used to render the reassuring end of their range:
 *    `'Free'` for an unmeasured cost, `'HIGH'` for an unrated confidence,
 *    `'None'` for an uncomputed opportunity cost, and a canned rationale for an
 *    assignment that recorded none. Each now routes through <Value> /
 *    resolveValue, which carry an explicit presence signal: an absent cost
 *    reads `COST UNAVAILABLE` / `Cost unavailable`, an unrated confidence reads
 *    `unrated`, an uncomputed opportunity cost reads `Not computed`, and an
 *    absent rationale reads `No rationale recorded`. A measured zero cost still
 *    says `Free` / `0 <resource>`. The risk-floor count fields are read with
 *    `num()` and LEFT null when the engine never emitted them: `?? 0` used to
 *    understate the "N further entries are omitted" line, and `?? held.length`
 *    made a capped list report itself complete.
 */

import React from 'react';
import { Value, resolveValue } from '../components/Value.jsx';

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
  // ABSENT STAYS NULL (register defect #17). `if (!cost) return 'Free'` reported
  // an unmeasured cost as a measured zero -- the most action-encouraging
  // reading available -- and `0` is falsy, so a measured zero cost was
  // indistinguishable from no cost at all. Null here is the honest absent
  // signal; callers route it through `<Value>` / `resolveValue`.
  if (cost === null || cost === undefined) return null;
  if (cost === 0) return 'Free';
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
    return <span className="directive-odds-tag directive-odds-tag--auto">100% AUTOMATIC</span>;
  }
  // A missing odds object and a computed 100% are not the same reading, and
  // the old `?? 50` turned "we have no mission rules for this" into a
  // confident coin flip on the card. Say what is actually known.
  const computed = num(odds?.point ?? (typeof odds?.chance === 'number' ? odds.chance * 100 : null));
  if (computed === null) {
    const basis = odds?.basis ? ` — ${odds.basis}` : '';
    return (
      <span className="directive-odds-tag directive-odds-tag--unknown" title={basis.slice(3)}>
        ODDS UNAVAILABLE
      </span>
    );
  }
  const pt = Math.round(computed);
  const low = odds.band?.[0] ?? (odds.success?.low ? Math.round(num(odds.success.low)) : null);
  const high = odds.band?.[1] ?? (odds.success?.high ? Math.round(num(odds.success.high)) : null);
  const bandText = (low !== null && high !== null) ? `[${low}–${high}%]` : '';

  let colorClass = 'directive-odds--good';
  if (pt < 50) colorClass = 'directive-odds--low';
  else if (pt < 75) colorClass = 'directive-odds--mid';

  return (
    <div className="directive-odds-wrapper">
      <div className="directive-odds-meter">
        <div
          className={`directive-odds-bar ${colorClass}`}
          style={{ width: `${Math.min(100, Math.max(5, pt))}%` }}
        />
      </div>
      <span className={`directive-odds-label ${colorClass}`}>
        <strong>{pt >= 100 ? '>99%' : `${pt}%`}</strong>{' '}
        <small>{bandText}</small>
      </span>
    </div>
  );
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

  return (
    <div className={`directive-risk-floor ${inForce ? 'directive-risk-floor--active' : ''}`}>
      <div className="directive-risk-floor__readout">
        <span className="directive-subheading">RISK TOLERANCE</span>
        <span className="directive-risk-floor__status">{statusText}</span>
      </div>
      {typeof onChange === 'function' ? (
        <label className="directive-risk-floor__control">
          <span>Minimum success odds</span>
          {/* Uncontrolled with a `key` on the resolved preference, so a new
              preference from the controller re-seeds the control exactly as the
              old innerHTML rewrite did, while a user's in-flight choice is not
              snapped back before loadData() returns. `''` is a real option that
              CLEARS the preference -- Number('') is 0, which is a different
              statement, so the conversion below must stay explicit. */}
          <select
            key={selected}
            defaultValue={selected}
            data-risk-floor-select=""
            aria-label="Minimum success odds for a recommended action"
            onChange={(event) => {
              const raw = event.target.value;
              onChange(raw === '' ? null : Number(raw));
            }}
          >
            <option value="">{`Server default${percent === null ? '' : ` (${percent}%)`}`}</option>
            <option value="0">Off — no floor</option>
            {RISK_FLOOR_CHOICES.map((value) => (
              <option key={value} value={String(value)}>{`${value}% minimum`}</option>
            ))}
          </select>
        </label>
      ) : null}
    </div>
  );
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
  if (!riskFloor) return null;
  if (riskFloor.outcome === 'unknown') {
    return (
      <div className="directive-risk-note directive-risk-note--unknown">
        <span className="directive-risk-note__tag">FLOOR NOT VERIFIED</span>
        {' '}
        {riskFloor.reason || 'Success odds could not be computed for this action.'}
      </div>
    );
  }
  if (riskFloor.outcome === 'pass' && riskFloor.marginal === true) {
    return (
      <div className="directive-risk-note directive-risk-note--marginal">
        <span className="directive-risk-note__tag">MARGINAL</span>
        {' '}
        {riskFloor.reason || ''}
      </div>
    );
  }
  return null;
}

/**
 * Actions the floor held back. Capped by the engine, so the true total and
 * the omitted count are printed rather than letting a 25-row slice read as
 * the whole set.
 */
function renderRiskFloorHeld(cyclePlan) {
  const held = Array.isArray(cyclePlan.riskFloorVetoed) ? cyclePlan.riskFloorVetoed : [];
  const unverified = Array.isArray(cyclePlan.riskFloorUnverified) ? cyclePlan.riskFloorUnverified : [];
  // ABSENT STAYS NULL (register defect #17). `?? 0` on the omitted counts read
  // an engine field that was never emitted as a confident zero, which made the
  // "N further entries are omitted" line UNDERSTATE whenever one half's count
  // was present and the other's was not; `?? held.length` / `?? unverified.length`
  // replaced an unread total with the length of the page in hand, which made a
  // capped list report itself complete. None of these is a measurement of zero.
  const heldTotal = num(cyclePlan.riskFloorVetoedTotalCount);
  const heldOmitted = num(cyclePlan.riskFloorVetoedOmittedCount);
  const unverifiedTotal = num(cyclePlan.riskFloorUnverifiedTotalCount);
  const unverifiedOmitted = num(cyclePlan.riskFloorUnverifiedOmittedCount);

  // A measured zero and a fully-absent payload both have nothing to say. The
  // guard tests for ANY signal of held-back entries rather than coercing the
  // absent totals to zero -- the Number(null) === 0 trap that used to decide.
  const anyHeldBack = held.length > 0 || unverified.length > 0
    || (heldTotal ?? 0) > 0 || (unverifiedTotal ?? 0) > 0
    || (heldOmitted ?? 0) > 0 || (unverifiedOmitted ?? 0) > 0;
  if (!anyHeldBack) return null;

  const row = (entry, tone, key) => (
    <div className={`directive-risk-held-item directive-risk-held-item--${tone}`} key={key}>
      <div className="directive-risk-held-head">
        <span className="directive-risk-held-title">{entry.title || 'Action'}</span>
        <span className="directive-risk-held-who">{entry.councilorName || 'Operative'}</span>
      </div>
      <div className="directive-risk-held-reason">{entry.reason || ''}</div>
    </div>
  );

  // An omitted count the engine never emitted is not zero. With a measured
  // total the number is still derivable arithmetic (total - shown); with
  // neither, it is genuinely unrecorded and must not print as a confident 0.
  const resolveOmitted = (shown, total, omitted) => (
    omitted !== null ? omitted : (total !== null ? Math.max(0, total - shown) : null)
  );
  const heldOmittedResolved = resolveOmitted(held.length, heldTotal, heldOmitted);
  const unverifiedOmittedResolved = resolveOmitted(unverified.length, unverifiedTotal, unverifiedOmitted);
  const totalOmitted = heldOmittedResolved !== null && unverifiedOmittedResolved !== null
    ? heldOmittedResolved + unverifiedOmittedResolved
    : null;

  const headingTotal = `${heldTotal === null ? `${held.length} shown, total unrecorded` : heldTotal}`
    + (unverifiedTotal === null
      ? (unverified.length > 0 ? ` + ${unverified.length} unverified shown, total unrecorded` : '')
      : (unverifiedTotal > 0 ? ` + ${unverifiedTotal} UNVERIFIED` : ''));

  const heldShown = heldTotal === null
    ? `Showing ${held.length} held back — total unrecorded`
    : `Showing ${held.length} of ${heldTotal} held back`;
  const showUnverifiedClause = unverifiedTotal === null ? unverified.length > 0 : unverifiedTotal > 0;
  const unverifiedShown = !showUnverifiedClause
    ? null
    : (unverifiedTotal === null
      ? `and ${unverified.length} unverified — total unrecorded`
      : `and ${unverified.length} of ${unverifiedTotal} unverified`);
  const shownClause = `${heldShown}${unverifiedShown ? ` ${unverifiedShown}` : ''}`;

  let omittedClause = null;
  if (totalOmitted !== null && totalOmitted > 0) {
    omittedClause = `${totalOmitted} further entr${totalOmitted === 1 ? 'y is' : 'ies are'} omitted from this view.`;
  } else if (totalOmitted === null) {
    // At least one half's omitted count is unrecorded. Naming only the half
    // that IS known would understate the truncation, so the known parts are
    // named and the remainder is said to be unrecorded rather than printing a
    // partial total as though it were the whole.
    const knownOmitted = [];
    if (heldOmittedResolved !== null && heldOmittedResolved > 0) knownOmitted.push(`${heldOmittedResolved} held back`);
    if (unverifiedOmittedResolved !== null && unverifiedOmittedResolved > 0) knownOmitted.push(`${unverifiedOmittedResolved} unverified`);
    omittedClause = knownOmitted.length
      ? `${knownOmitted.join(' and ')} omitted from this view; the remaining omitted count is unrecorded.`
      : 'The number of further entries omitted from this view is unrecorded.';
  }

  return (
    <div className="directive-risk-held-section">
      <div className="directive-subheading">
        {`HELD BACK BY YOUR RISK FLOOR (${headingTotal})`}
      </div>
      <div className="directive-risk-held-list">
        {held.map((entry, index) => row(entry, 'veto', `veto-${index}`))}
        {unverified.map((entry, index) => row(entry, 'unknown', `unknown-${index}`))}
      </div>
      {omittedClause ? (
        <div className="directive-risk-held-omitted">
          {`${shownClause}; ${omittedClause}`}
        </div>
      ) : null}
    </div>
  );
}

/**
 * One portfolio meter.
 *
 * `measured` is the ONLY thing that licenses a number or a bar. It is computed
 * by the caller from the payload's own `capMeasured` flag AND the presence of
 * both readings, so a ceiling nobody read renders NOT MEASURED and an empty
 * track -- never an invented denominator with a fill drawn against it.
 */
function renderBudgetMeter({ label, measured, text, percent, fillClass }) {
  return (
    <div className="directive-budget-item">
      <div className="directive-budget-label">
        <span>{label}</span>
        <strong>
          <Value
            present={measured}
            value={text}
            format={(value) => String(value)}
            absentLabel="NOT MEASURED"
          />
        </strong>
      </div>
      <div className="directive-budget-track">
        {measured ? <div className={fillClass} style={{ width: `${percent}%` }} /> : null}
      </div>
    </div>
  );
}

function renderBudgets(budgets) {
  if (!budgets) return null;
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

  return (
    <div className="directive-budgets-bar">
      {renderBudgetMeter({
        label: 'ALIEN HATE BUDGET',
        measured: hateMeasured,
        text: hateMeasured ? `${hateSpent.toFixed(1)} / ${hateCeil.toFixed(1)}` : null,
        percent: hatePct,
        fillClass: `directive-budget-fill ${hateMeasured && hateSpent > hateCeil
          ? 'directive-budget-fill--danger'
          : 'directive-budget-fill--warn'}`
      })}
      {renderBudgetMeter({
        label: 'INFLUENCE POOL',
        measured: infMeasured,
        text: infMeasured ? `${infSpent} / ${infStock}` : null,
        percent: infPct,
        fillClass: 'directive-budget-fill'
      })}
      {renderBudgetMeter({
        label: 'OPERATIONS POOL',
        measured: opsMeasured,
        text: opsMeasured ? `${opsSpent} / ${opsStock}` : null,
        percent: opsPct,
        fillClass: 'directive-budget-fill'
      })}
      {renderBudgetMeter({
        label: 'MISSION CONTROL',
        measured: mcMeasured,
        text: mcMeasured ? `${mcCur} / ${mcCap}` : null,
        percent: mcPct,
        fillClass: 'directive-budget-fill directive-budget-fill--accent'
      })}
    </div>
  );
}

function renderClocks(clocks) {
  if (!Array.isArray(clocks) || clocks.length === 0) return null;
  return (
    <div className="directive-clocks-section">
      <div className="directive-subheading">STRATEGIC CLOCKS &amp; EXPIRATIONS</div>
      <div className="directive-clocks-grid">
        {clocks.map((clock, index) => {
          const urgencyClass = clock.urgency === 'HIGH' || clock.urgency === 'URGENT'
            ? 'directive-clock-badge--urgent'
            : (clock.urgency === 'MEDIUM' ? 'directive-clock-badge--active' : '');
          return (
            <div className="directive-clock-card" key={index}>
              <div className="directive-clock-header">
                <div className="directive-clock-title">{clock.title}</div>
                <span className={`directive-clock-badge ${urgencyClass}`}>
                  {clock.daysRemaining !== undefined && clock.daysRemaining !== null
                    ? `${clock.daysRemaining}d`
                    : (clock.rate || clock.urgency || 'ACTIVE')}
                </span>
              </div>
              <div className="directive-clock-detail">{clock.detail || ''}</div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

/**
 * One assignment card.
 *
 * `directive-assignment-card` and `data-assignment-index` are the cross-panel
 * contract named in this file's header. Council Orders resolves a card by them.
 */
function renderAssignmentCard(assignment, index, onOpen) {
  const councilor = assignment.councilor || {};
  const candidate = assignment.candidate || {};
  const odds = assignment.odds;
  const ev = num(assignment.expectedValue);
  const hateExp = num(assignment.expectedHate);
  const cost = candidate.cost;
  const whyList = Array.isArray(assignment.why) ? assignment.why : [];
  const fam = String(candidate.family || 'expansion').toLowerCase();
  const famLabel = FAMILY_LABEL[fam] || fam.toUpperCase();

  return (
    <div
      className="directive-assignment-card"
      data-assignment-index={index}
      key={index}
      style={{ cursor: 'pointer' }}
      onClick={() => onOpen(index)}
    >
      <div className="directive-assignment-header">
        <div className="directive-councilor-badge">
          <span className="directive-councilor-num">{index + 1}</span>
          <div className="directive-councilor-info">
            <div className="directive-councilor-name">{councilor.name || 'Councilor'}</div>
            <div className="directive-councilor-meta">
              {`${councilor.profession || 'Operative'} · ${councilor.location || 'Earth'} · `}
              <strong>{councilor.stat || ''}</strong>
            </div>
          </div>
        </div>
        <div className="directive-tags">
          <span className={`directive-family-tag directive-family-tag--${fam}`}>{famLabel}</span>
          {/* Absent stays null: an unmeasured cost reads COST UNAVAILABLE, never
              'Free' and never nothing, and a measured zero keeps saying Free. */}
          <span className="directive-cost-tag">
            <Value
              present={cost !== null && cost !== undefined}
              value={formatCost(cost)}
              format={(value) => String(value)}
              absentLabel="COST UNAVAILABLE"
            />
          </span>
        </div>
      </div>

      <div className="directive-mission-block">
        <div className="directive-mission-title">
          {/* `displayName` is the game's own mission name; `friendlyName` is the
              engine identity key it falls back to. See defect register #10. */}
          {candidate.title || candidate.displayName || candidate.friendlyName || 'Directive Assignment'}
        </div>
        <div className="directive-mission-target">
          {candidate.target?.name || candidate.target?.nation || 'Designated Target'}
        </div>
      </div>

      <div className="directive-metrics-row">
        <div className="directive-metric-col">
          <div className="directive-metric-label">SUCCESS ODDS</div>
          {renderOddsGauge(odds)}
        </div>
        <div className="directive-metric-col directive-metric-col--right">
          <div className="directive-metric-label">EXPECTED VALUE / HATE</div>
          <div className="directive-ev-hate-line">
            <span className="directive-ev-val">
              {'EV: '}
              <strong>{ev !== null ? ev.toFixed(2) : '—'}</strong>
            </span>
            <span className={`directive-hate-val ${hateExp > 0 ? 'directive-hate-val--warn' : ''}`}>
              {hateExp !== null ? (hateExp === 0 ? '0 hate' : `+${hateExp.toFixed(2)} hate`) : 'hate unknown'}
            </span>
          </div>
        </div>
      </div>

      {renderRiskNote(assignment.riskFloor)}

      {whyList.length ? (
        <ul className="directive-why-list">
          {whyList.map((w, i) => <li key={i}>{w}</li>)}
        </ul>
      ) : null}

      {assignment.opportunityCost ? (
        <div className="directive-opp-cost">
          <span className="directive-opp-label">OPPORTUNITY COST:</span>
          {' '}
          {assignment.opportunityCost}
        </div>
      ) : null}
    </div>
  );
}

function renderUnassigned(unassigned) {
  if (!Array.isArray(unassigned) || unassigned.length === 0) return null;
  return (
    <div className="directive-unassigned-section">
      <div className="directive-subheading">{`UNASSIGNED OPERATIVES (${unassigned.length})`}</div>
      <div className="directive-unassigned-list">
        {unassigned.map((u, index) => {
          const councilor = u.councilor || u;
          const alternates = Array.isArray(u.freeActionOptions) && u.freeActionOptions.length > 1
            ? u.freeActionOptions.slice(1).join(', ')
            : null;
          return (
            <div className="directive-unassigned-item" key={index}>
              <div className="directive-unassigned-head">
                <strong>{councilor.name || 'Councilor'}</strong>
                <span>{`${councilor.profession || 'Operative'} · ${councilor.location || 'Earth'}`}</span>
              </div>
              <div className="directive-unassigned-reason">
                {u.reasonDetail || u.reason
                  || 'No positive expected-value action matches theater constraints this cycle.'}
              </div>
              {u.suggestedFreeAction ? (
                <div className="directive-unassigned-free">
                  {'Free action: '}
                  <strong>{u.suggestedFreeAction}</strong>
                  {alternates ? <>{' '}<small>{`(or ${alternates})`}</small></> : null}
                </div>
              ) : null}
            </div>
          );
        })}
      </div>
    </div>
  );
}

/**
 * The bench, rendered WHOLE.
 *
 * There used to be a `BENCHED_RENDER_LIMIT = 5` here, slicing the engine's
 * eight rows a second time in generation order. It was correct by luck --
 * measured 2026-08-22 on `ExitSave.gz`, the five it happened to show were the
 * best five in both modes -- and it was a second truncation stacked on the
 * first, announced by neither.
 *
 * The fix is to stop deciding, not to duplicate the rule. The engine's
 * selection (`shared/benchSelection.mjs`) is the only selection, and this
 * board renders every row it was handed. The comparator deliberately is NOT
 * reimplemented here: a hand-copied comparator would be a second statement of
 * the rule waiting to drift from the first.
 *
 * Each row stands for a whole (mission, target) sibling group, so three
 * numbers travel: how many ROWS are shown, how many CANDIDATES those rows
 * account for, and the true bench total.
 *
 * A FOURTH travels with them: what the shown rows COST against the pool that
 * refused them, and how many of them could be taken TOGETHER. Eight rows
 * listed as alternatives read as eight independently available options; on the
 * frozen save's omniscient plan they share one 7.90 cycle hate cap with 3.16
 * left and each charges 4.57, so NONE of them can be added. The board renders
 * that header before the list rather than after it, because the number is what
 * makes the list interpretable at all.
 *
 * And a FIFTH thing travels with the rows, which is not a number: the ORDER IS
 * NOT A RANKING (register defect #15). `server/engine/assignment.js:1287-1289`
 * says the carried array is emitted in generation order and "must not be read
 * as a ranking"; every row prints a prominent `Score N.NN` and the browser was
 * the one surface that had lost the caveat. The footer sentence below is
 * lifted from `shared/markdownExports.mjs:2410-2411` so the two agree word for
 * word. Fixing it does NOT mean re-sorting: generation order is deliberate and
 * `assignment.js:1279-1286` records two measured alternatives that were both
 * worse.
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
      parts.push(
        <span className="directive-bench-budget-unknown">
          Cycle hate budget NOT MEASURED — hate charges this cycle went unchecked, not cleared.
        </span>
      );
    } else {
      const left = Math.max(0, cap - used);
      // A cap derived from the Mission Control FLOOR is an upper bound on the
      // real budget, because true hate can only be at or above that floor.
      // Player mode redacts the hate reading, so this is the normal case
      // there and saying nothing would let an optimistic cap read as measured.
      const caveat = hate.capIsUpperBound === true
        ? (
          <>
            {' '}
            <span className="directive-bench-budget-caveat">
              (from the MC hate floor — an UPPER BOUND, the real budget can only be smaller)
            </span>
          </>
        )
        : null;
      parts.push(
        <>
          {'Cycle hate budget '}
          <strong>{`${used.toFixed(2)} / ${cap.toFixed(2)}`}</strong>
          {' used, '}
          <strong>{left.toFixed(2)}</strong>
          {' left'}
          {caveat}
        </>
      );
    }
  }

  if (summary !== null) {
    const fits = num(summary.jointlyAffordableCount);
    if (fits === null) {
      parts.push(
        <span className="directive-bench-budget-unknown">
          {`Joint affordability NOT COMPUTED — ${summary.reason || 'no reason was recorded'}`}
        </span>
      );
    } else {
      const rows = num(summary.rowCount);
      const unpriced = num(summary.unpricedRowCount);
      const upperBoundCaveat = summary.jointlyAffordableIsUpperBound === true
        ? (
          <>
            {' '}
            <span className="directive-bench-budget-caveat">
              (an UPPER BOUND — cheapest-first is the most that fit, not a measured total)
            </span>
          </>
        )
        : null;
      parts.push(
        <>
          <strong>{`${fits} of ${rows === null ? 'the' : rows} row(s) below fit`}</strong>
          {upperBoundCaveat}
          {` what is left — these are ALTERNATIVES sharing one ${String(summary.pool || 'budget')} pool, `
            + `not independent options`
            + (unpriced ? `; ${unpriced} carry no measured charge and are counted neither way` : '')}
        </>
      );
    }
  }

  if (parts.length === 0) return null;
  return (
    <div className="directive-bench-budget">
      {parts.map((part, index) => (
        <React.Fragment key={index}>
          {index > 0 ? ' · ' : null}
          {part}
        </React.Fragment>
      ))}
    </div>
  );
}

/**
 * What a collapsed row may and may not claim on behalf of its siblings.
 *
 * `displacedBy` describes the REPRESENTATIVE. When a group's members were held
 * back for different reasons, presenting the representative's reason as the
 * group's is the same defect this whole change exists to remove, one level
 * down. `groupBudgetDisplacedCount` is what makes the mismatch visible, and it
 * is only rendered when it actually disagrees with the row's own verdict --
 * a caveat printed on every row is a caveat nobody reads on the one row where
 * it matters.
 */
function renderGroupReasonCaveat(row) {
  const count = num(row.groupCount);
  const budgetHeld = num(row.groupBudgetDisplacedCount);
  if (count === null || count < 2 || budgetHeld === null) return null;
  const rowIsBudget = row.displacementCause === 'budget';
  if (rowIsBudget && budgetHeld === count) return null;
  if (!rowIsBudget && budgetHeld === 0) return null;
  return (
    <div className="directive-benched-group-caveat">
      {`Mixed group: ${budgetHeld} of ${count} option(s) here were refused by a budget, `
        + `so the reason above does not describe all of them.`}
    </div>
  );
}

const BENCH_ORDER_NOTE = 'Ordered by generation rather than by score, so the sequence is '
  + 'NOT a ranking and the row count counts groups rather than options.';

function renderBenched(cyclePlan) {
  const benched = Array.isArray(cyclePlan.benched) ? cyclePlan.benched : [];
  if (benched.length === 0) return null;
  // Absent count means an older payload that never carried one; fall back to
  // what is actually in hand rather than inventing a total, matching
  // renderRiskFloorHeld above.
  const total = num(cyclePlan.benchedTotalCount) ?? benched.length;
  // Absent stays null. A payload from before the grouping change carries no
  // represented count, and 0 would be a measurement of something nobody read.
  const represented = num(cyclePlan.benchedRepresentedCount);
  const omitted = Math.max(0, total - benched.length);
  const omittedSentence = omitted > 0
    ? `Showing ${benched.length} row${benched.length === 1 ? '' : 's'} of ${total} benched, `
      + `${represented === null
        ? 'standing for an unrecorded number of candidates'
        : `standing for ${represented} candidate${represented === 1 ? '' : 's'}`}; `
      + `${omitted} further alternative${omitted === 1 ? ' is' : 's are'} omitted from this view. `
    : '';
  return (
    <div className="directive-benched-section">
      <div className="directive-subheading">{`BENCHED ALTERNATIVES & TRADE-OFFS (${total})`}</div>
      {renderBenchBudget(cyclePlan)}
      <div className="directive-benched-list">
        {benched.map((b, index) => {
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
            ? null
            : (
              <div className="directive-benched-group">
                {note !== null
                  ? note
                  : `+${groupCount - 1} more sibling option${groupCount - 1 === 1 ? '' : 's'}`}
              </div>
            );
          return (
            <div className="directive-benched-item" key={index}>
              <div className="directive-benched-header">
                <span className="directive-benched-title">
                  {candidate.title || candidate.missionType || 'Alternative'}
                </span>
                {score !== null
                  ? <span className="directive-benched-score">{`Score ${score.toFixed(2)}`}</span>
                  : null}
              </div>
              {groupLine}
              <div className="directive-benched-reason">
                <span className="directive-displaced-label">
                  {b.displacementCause === 'budget' ? 'REFUSED BY BUDGET:' : 'NOT TAKEN BECAUSE:'}
                </span>
                {' '}
                {/* ABSENT STAYS NULL. A payload with no reason says the reason
                    was not recorded; it does NOT fall back to a sentence about
                    a councilor, which is the fabricated explanation this row
                    used to carry on every entry. */}
                {typeof b.displacedBy === 'string' && b.displacedBy.trim() !== ''
                  ? b.displacedBy
                  : 'This plan recorded no reason for holding it back. '
                    + 'That is an unrecorded reason, not an absent one.'}
              </div>
              {renderGroupReasonCaveat(b)}
            </div>
          );
        })}
      </div>
      <div className="directive-benched-omitted">
        {`${omittedSentence}${BENCH_ORDER_NOTE}`}
      </div>
    </div>
  );
}

function renderHorizon(horizon) {
  if (!Array.isArray(horizon) || horizon.length === 0) return null;
  return (
    <div className="directive-horizon-section">
      <div className="directive-subheading">MULTI-CYCLE HORIZON &amp; ENABLEMENT CHAINS</div>
      <div className="directive-horizon-grid">
        {horizon.map((h, index) => (
          <div className="directive-horizon-card" key={index}>
            <div className="directive-horizon-cycle">{h.cycle || 'Upcoming'}</div>
            <div className="directive-horizon-content">
              <div className="directive-horizon-title">{h.title || ''}</div>
              <div className="directive-horizon-enabler">
                <span className="directive-enabler-label">Enabler:</span>
                {' '}
                {h.enabler || ''}
              </div>
              <div className="directive-horizon-payoff">{h.notes || h.expectedPayoff || ''}</div>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

function renderDecisionReasoning(reasoning, cyclePlan) {
  if (!reasoning) return null;
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
    generated === null ? null : <span>{`${generated} total evaluated`}</span>,
    allocated === null ? null : <span>{`${allocated} allocated`}</span>,
    benchedTotal === null ? null : <span>{`${benchedTotal} benched`}</span>,
    <span>
      {'Confidence: '}
      <strong>
        {/* Absent stays null: an unrated recommendation must not read as the
            highest rating the field can take (register defect #17). */}
        <Value
          present={typeof reasoning.confidence === 'string' && reasoning.confidence.trim() !== ''}
          value={reasoning.confidence}
          format={(value) => String(value)}
          absentLabel="unrated"
        />
      </strong>
    </span>
  ].filter(Boolean);

  return (
    <div className="directive-reasoning-section">
      <div className="directive-subheading">{reasoning.heading || 'ALLOCATION STRATEGY'}</div>
      <p className="directive-reasoning-summary">{reasoning.summary || ''}</p>
      <div className="directive-reasoning-method">{reasoning.selectionMethod || ''}</div>
      <div className="directive-reasoning-meta">
        {metaSegments.map((segment, index) => (
          <React.Fragment key={index}>
            {index > 0 ? ' · ' : null}
            {segment}
          </React.Fragment>
        ))}
      </div>
      {sources.length ? (
        <div className="directive-sources-list">
          <span className="directive-sources-label">FORMULA SOURCES:</span>
          <ul>
            {sources.map((s, index) => <li key={index}>{s}</li>)}
          </ul>
        </div>
      ) : null}
    </div>
  );
}

function DirectiveBoardUnavailable() {
  return (
    <div className="directive-engine-v2">
      <div className="directive-header-strip">
        <div className="directive-header-left">
          <div className="directive-header-eyebrow">DIRECTIVE ENGINE v2 // CYCLE ALLOCATION</div>
          <div className="directive-header-title">COUNCILOR ASSIGNMENT PLAN</div>
        </div>
        <div className="directive-header-badges">
          <span className="directive-status-badge directive-status-badge--idle">
            CYCLE PLAN UNAVAILABLE
          </span>
        </div>
      </div>
      <div
        className="directive-empty-banner"
        style={{
          padding: '24px',
          textAlign: 'center',
          color: 'var(--color-text-muted, #8b949e)',
          background: 'rgba(0,0,0,0.2)',
          borderRadius: '4px',
          border: '1px dashed rgba(255,255,255,0.1)',
          marginTop: '16px'
        }}
      >
        Cycle allocation plan is unavailable for this snapshot. Ensure councilor intelligence and
        mission candidates are loaded.
      </div>
    </div>
  );
}

/**
 * Opens the shared detail panel for one assignment.
 *
 * `window.MissionControlDetailPanel` is another component's API and the
 * `#openCouncilorRosterBtn` lookup is this board's one reach outside its own
 * subtree. Both are preserved verbatim from the vanilla component; a missing
 * detail panel is a no-op rather than a throw.
 */
function openAssignmentDetail(assignment, index, riskFloorInForce, riskFloorPercent) {
  if (typeof window === 'undefined' || !window.MissionControlDetailPanel) return;
  const councilor = assignment.councilor || {};
  const candidate = assignment.candidate || {};
  const cost = candidate.cost;
  const odds = assignment.odds;
  const ev = num(assignment.expectedValue);
  const hateExp = num(assignment.expectedHate);
  const whyList = Array.isArray(assignment.why) ? assignment.why : [];

  window.MissionControlDetailPanel.open({
    eyebrow: `COUNCILOR ASSIGNMENT #${index + 1}`,
    title: `${councilor.name || 'Operative'} — ${candidate.displayName || candidate.friendlyName || candidate.missionType || 'Mission'}`,
    summary: candidate.title
      || `Assign ${councilor.name} to ${candidate.missionType} targeting ${candidate.target?.name || candidate.target?.nation || 'target'}.`,
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
          : (assignment.riskFloor?.reason || `Cleared your ${riskFloorPercent}% floor.`)
      },
      { label: 'Expected Value', value: ev !== null ? `${ev.toFixed(2)} pts` : '—' },
      { label: 'Expected Hate', value: hateExp !== null ? (hateExp === 0 ? '0 hate (Safe)' : `+${hateExp.toFixed(2)} hate`) : 'Not computable without mission odds' },
      { label: 'Resource cost', value: resolveValue({
        // Absent stays null: an unmeasured cost reads as unavailable, never as
        // 'Free' (register defect #17). `formatCost` returns null for absent.
        present: cost !== null && cost !== undefined,
        value: formatCost(cost),
        format: (v) => String(v),
        absentLabel: 'Cost unavailable'
      }).text },
      { label: 'Opportunity cost', value: resolveValue({
        // Absent stays null: an uncomputed opportunity cost is not the claim
        // 'None', which asserts nothing was given up (register defect #17).
        present: typeof assignment.opportunityCost === 'string' && assignment.opportunityCost.trim() !== '',
        value: assignment.opportunityCost,
        format: (v) => String(v),
        absentLabel: 'Not computed'
      }).text },
      { label: 'Tactical rationale', value: resolveValue({
        // Absent stays null: an assignment that recorded no rationale must not
        // be handed a canned expected-value sentence (register defect #17).
        present: whyList.length > 0,
        value: whyList.join(' · '),
        format: (v) => String(v),
        absentLabel: 'No rationale recorded'
      }).text }
    ],
    actions: [
      {
        label: 'Open councilor roster',
        primary: true,
        onClick: () => {
          const btn = document.getElementById('openCouncilorRosterBtn');
          if (btn) btn.click();
        }
      }
    ]
  });
}

export function DirectiveBoard({ payload }) {
  const engineDirectives = payload && payload.engineDirectives;
  const cyclePlan = engineDirectives && engineDirectives.cyclePlan;

  if (!cyclePlan) return <DirectiveBoardUnavailable />;

  const assignments = Array.isArray(cyclePlan.assignments) ? cyclePlan.assignments : [];
  const unassigned = Array.isArray(cyclePlan.unassigned) ? cyclePlan.unassigned : [];
  const clocks = Array.isArray(cyclePlan.clocks) ? cyclePlan.clocks : [];
  const horizon = Array.isArray(cyclePlan.horizon) ? cyclePlan.horizon : [];
  const budgets = cyclePlan.budgets;
  const reasoning = cyclePlan.decisionReasoning || engineDirectives?.decisionReasoning;
  const riskFloor = cyclePlan.riskFloor || null;
  const riskFloorPercent = num(riskFloor?.percent);
  const riskFloorInForce = riskFloor?.inForce === true;
  // Absent stays null (register defect #17): a held count the engine never
  // emitted is not a measured zero, and the truthiness gate below already
  // suppresses the "· N HELD" segment for an unmeasured total.
  const riskHeldTotal = num(cyclePlan.riskFloorVetoedTotalCount);
  const onRiskFloorChange = payload?.onRiskFloorChange;

  const openDetail = (index) => {
    const assignment = assignments[index];
    if (!assignment) return;
    openAssignmentDetail(assignment, index, riskFloorInForce, riskFloorPercent);
  };

  return (
    <div className="directive-engine-v2">
      <div className="directive-header-strip">
        <div className="directive-header-left">
          <div className="directive-header-eyebrow">DIRECTIVE ENGINE v2 // CYCLE ALLOCATION</div>
          <div className="directive-header-title">COUNCILOR ASSIGNMENT PLAN</div>
        </div>
        <div className="directive-header-badges">
          <span className="directive-status-badge directive-status-badge--assigned">
            {`${assignments.length} ASSIGNED`}
          </span>
          {unassigned.length ? (
            <span className="directive-status-badge directive-status-badge--idle">
              {`${unassigned.length} IDLE`}
            </span>
          ) : null}
          {riskFloorInForce ? (
            <span className="directive-status-badge directive-status-badge--risk">
              {`RISK FLOOR ${riskFloorPercent}%${riskHeldTotal ? ` · ${riskHeldTotal} HELD` : ''}`}
            </span>
          ) : null}
        </div>
      </div>

      {renderRiskFloor(riskFloor, payload?.riskFloorPreference, onRiskFloorChange)}

      {renderBudgets(budgets)}

      {renderClocks(clocks)}

      <div className="directive-assignments-section">
        <div className="directive-subheading">ACTIVE COUNCILOR ASSIGNMENTS</div>
        <div className="directive-assignments-grid">
          {assignments.length > 0
            ? assignments.map((a, idx) => renderAssignmentCard(a, idx, openDetail))
            : (
              <div
                className="directive-empty-banner"
                style={{ padding: '16px', color: 'var(--color-text-muted)' }}
              >
                No active councilor assignments feasible this cycle.
              </div>
            )}
        </div>
      </div>

      {renderUnassigned(unassigned)}

      {renderRiskFloorHeld(cyclePlan)}

      {renderHorizon(horizon)}

      {renderBenched(cyclePlan)}

      {renderDecisionReasoning(reasoning, cyclePlan)}
    </div>
  );
}

export default DirectiveBoard;
