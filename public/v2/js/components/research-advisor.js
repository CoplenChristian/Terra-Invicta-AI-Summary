/*
 * Research Advisor Panel
 * ----------------------
 * Phase 4 of the research advisor, on screen. Renders
 * `/api/intel/research-ranking`: what to research next, in two parallel
 * rankings that are never added together.
 *
 * THREE RENDERING RULES, each of which this repo has broken before:
 *
 * 1. NOTHING IS INTERPOLATED RAW. The payload emits `null` deliberately and
 *    often -- an unmeasured cost, an absent baseline, a multiple that could not
 *    be formed -- so every value here goes through `int` / `dec` / `mult` /
 *    `months` / `quantity`, each of which returns the em dash rather than the
 *    text "null". The mining board shipped reading "1 MC · nulld" on 109 rows
 *    because one value went straight into a template literal.
 *
 * 2. ONLY STRINGS THIS FILE AUTHORS REACH THE DOM. The upstream `reason`
 *    fields are prose written for an API reader and several of them contain
 *    the word "null" as a technical term ("every comparison multiple is null
 *    rather than 1"). Rendering them verbatim would put that word on screen,
 *    which is indistinguishable from the bug rule 1 exists to prevent. They are
 *    attached as `title` tooltips, which `textContent` does not include, and
 *    every visible label is written here.
 *
 * 3. AN EMPTY GROUP IS AN ANSWER, NOT A BLANK. On a turn-1 save the observer
 *    fields nothing, so no military candidate has a baseline to be compared
 *    against and the entire military ranking is empty. That renders as the
 *    reason it is empty. A card that just shows nothing is the failure mode.
 */
(function exposeResearchAdvisor(global) {
  'use strict';

  const shared = global.MissionControlShared || {};
  const escapeHtml = shared.escapeHtml || (value => String(value ?? ''));

  const UNAVAILABLE = '—';

  // How many availability groups to show per track, and how many rows in each.
  // The card lives in the COMMAND column that has the least slack, so this is a
  // measured budget rather than a taste call: see docs/v2-navigation-plan.md
  // section 4 on the page-height constraint.
  const GROUPS_SHOWN = 2;
  const ROWS_PER_GROUP = 2;

  // The one availability state whose monthly unlock roll is a fact about what
  // happens NEXT. On a researchable-now candidate the roll has already landed,
  // so printing "rolls 25%/mo" beside it describes a dice throw that is over --
  // exactly the state-collapsing error spec section 3b exists to prevent, only
  // inverted.
  const ROLLING_STATE = 'prereq-clear-but-unrolled';

  function num(value) {
    if (value === null || value === undefined || value === '') return null;
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : null;
  }

  function int(value) {
    const parsed = num(value);
    if (parsed === null) return UNAVAILABLE;
    return Math.round(parsed).toLocaleString('en-US');
  }

  function dec(value, places = 1) {
    const parsed = num(value);
    return parsed === null ? UNAVAILABLE : parsed.toFixed(places);
  }

  /** "9.95x", "40x", "6.7Mx". Absent stays absent -- never "nullx". */
  function mult(value) {
    const parsed = num(value);
    if (parsed === null) return UNAVAILABLE;
    const abs = Math.abs(parsed);
    if (abs >= 1e9) return `${(parsed / 1e9).toFixed(1)}B×`;
    if (abs >= 1e6) return `${(parsed / 1e6).toFixed(1)}M×`;
    if (abs >= 1000) return `${Math.round(parsed).toLocaleString('en-US')}×`;
    if (abs >= 10) return `${parsed.toFixed(1)}×`;
    return `${parsed.toFixed(2)}×`;
  }

  /** "11.1 mo", or the dash when research income was not measurable. */
  function months(value) {
    const parsed = num(value);
    if (parsed === null) return UNAVAILABLE;
    if (parsed < 1) return '<1 mo';
    return `${parsed.toFixed(1)} mo`;
  }

  const COMPACT_UNITS = [
    [1e12, 'T'],
    [1e9, 'B'],
    [1e6, 'M'],
    [1e3, 'k']
  ];

  function compact(value, places = 1) {
    const parsed = num(value);
    if (parsed === null) return UNAVAILABLE;
    const abs = Math.abs(parsed);
    for (const [scale, suffix] of COMPACT_UNITS) {
      if (abs >= scale) return `${(parsed / scale).toFixed(places)}${suffix}`;
    }
    return abs >= 10 ? parsed.toFixed(0) : parsed.toFixed(places);
  }

  /**
   * A monthly value with its unit.
   *
   * The unit strings come from the payload, so an unrecognised one still
   * renders -- `${number} ${unit}` -- rather than being dropped or relabelled.
   * Inventing a shorter name for a unit the endpoint did not send would be a
   * claim about what it measured.
   */
  function quantity(value, unit) {
    const parsed = num(value);
    if (parsed === null) return UNAVAILABLE;
    const sign = parsed > 0 ? '+' : '';
    const label = String(unit || '').trim();
    if (label === 'dollars/year') return `${sign}$${compact(parsed)}/yr`;
    if (label === 'tonnes/month') return `${sign}${compact(parsed)} t/mo`;
    if (label === 'research/month') return `${sign}${compact(parsed)} research/mo`;
    if (label.startsWith('mission control')) return `${sign}${dec(parsed, 1)} ${label}`;
    return `${sign}${compact(parsed)} ${label}`;
  }

  /**
   * The unlock-chance sentence for a candidate that is prerequisite-clear but
   * has not been offered yet.
   *
   * Section 3b of the spec: a plan whose last step is a coin flip that may never
   * land is a different proposition from one that merely costs research, and
   * the cap is the part that says which. Never collapsed into "soon".
   */
  function rollNote(chance, availabilityState) {
    if (!chance || availabilityState !== ROLLING_STATE) return null;
    const max = num(chance.maxPercent);
    const delta = num(chance.deltaPercentPerMonth);
    if (max === null && delta === null) return null;
    const rate = delta === null ? UNAVAILABLE : `${int(delta)}%/mo`;
    const cap = max === null ? UNAVAILABLE : `${int(max)}%`;
    const never = max !== null && max < 100 ? ' — may never land' : '';
    return `rolls ${rate}, cap ${cap}${never}`;
  }

  function attr(value) {
    return escapeHtml(value === null || value === undefined ? '' : String(value));
  }

  // -------------------------------------------------------------------------
  // ROWS
  // -------------------------------------------------------------------------

  // A multiple whose axis has no unit. The templates give a utility or hab
  // module ONE `specialModuleValue` shared across every rule it carries and
  // never name the quantity, so "1.5x FleetECM" is a ratio of two unnamed
  // scalars. These rows are ordered after every measured axis in their group;
  // the badge says why a smaller-looking number sits above them.
  const RULE_SCALAR_KIND = 'rule-scalar';
  const RULE_SCALAR_TITLE = 'This module family has no engineering axis: the game gives each module one '
    + 'shared rule value and names no unit for it. The ratio is only formed against a module carrying the '
    + 'identical rule set. Ordered after every row whose axis has a unit.';

  // Phase 5. A munition the game marks interceptable carries a second floor:
  // how much point-defence fire each ARRIVING round has to survive, against the
  // best such munition you already field. Three states, and the two that are
  // not "clears" get visibly different badges, because an unevaluated floor
  // must never read as a passed one.
  const DELIVERY_FAILS_TITLE = 'Ranked below its damage. Each round that arrives has to survive '
    + 'measurably more point-defence fire than the best interceptable weapon you already field — usually '
    + 'because it is fired one round at a time while yours arrive in a salvo that splits the same '
    + 'defensive fire. Damage still leads the ordering; this decides whether the damage lands.';
  const DELIVERY_UNKNOWN_TITLE = 'Delivery could not be checked for this one. Either no point-defence '
    + 'battery is observable in this snapshot, you field nothing comparable to measure it against, or '
    + 'the templates do not describe its flight. This is not a pass — it is an unmeasured axis, and it '
    + 'does not move the row up or down.';

  const ACTIONABLE_GROUPS = ['buildable-now', 'researchable-now'];
  const ASPIRATIONAL_GROUPS = ['prereq-clear-but-unrolled', 'prereq-blocked'];

  function militaryRow(row) {
    const notes = [];
    if (row.isZeroCost === true) {
      notes.push('<span class="ra-tag ra-tag--fittable">fittable now</span>');
    } else if (row.slotAction === 'free-slot') {
      notes.push('<span class="ra-tag ra-tag--free">free slot</span>');
    } else if (row.slotAction === 'occupied-slot') {
      notes.push('<span class="ra-tag">backlogs active</span>');
    }

    if (row.closesDeficit === true) notes.push('<span class="ra-tag ra-tag--deficit">closes gap</span>');
    // A candidate that wins its ranking axis by failing the floor on the axis it
    // trades against is phase 1's central finding, so it is a badge and not a
    // footnote.
    if (row.clearsFloor === false) notes.push('<span class="ra-tag ra-tag--warn">fails floor</span>');
    if (row.clearsDeliveryFloor === false) {
      notes.push(`<span class="ra-tag ra-tag--warn" title="${attr(DELIVERY_FAILS_TITLE)}">fails delivery</span>`);
    } else if (row.clearsDeliveryFloor === null && row.context && row.context.delivery) {
      // Only where a delivery figure exists but the floor could not be
      // evaluated. A reactor has no delivery axis at all and gets no badge.
      notes.push(`<span class="ra-tag" title="${attr(DELIVERY_UNKNOWN_TITLE)}">delivery unchecked</span>`);
    }
    if (row.axisKind === RULE_SCALAR_KIND) {
      notes.push(`<span class="ra-tag ra-tag--unitless" title="${attr(RULE_SCALAR_TITLE)}">no unit</span>`);
    }
    const duration = num(row.context && row.context.sustainedOutputDurationS);
    if (duration !== null) notes.push(`<span class="ra-tag">${attr(`${dec(duration, 0)}s of fire`)}</span>`);

    const meta = row.isZeroCost === true
      ? ['0 pts · refit/build']
      : [
        `${int(row.remainingResearchCost)} pts`,
        months(row.monthsAtCurrentIncome)
      ];
    const roll = rollNote(row.unlockChance, row.availabilityState);
    if (roll) meta.push(roll);

    // The upstream axis rationale is a tooltip, never body text: see rule 2.
    const axisTitle = row.axisBasis || row.axisLabel || '';

    return `
      <li class="ra-row">
        <div class="ra-row__head">
          <span class="ra-row__name" title="${attr(row.gateProjectName || row.gateProjectId || row.displayName)}">${escapeHtml(row.displayName)}</span>
          <span class="ra-row__metric" title="${attr(axisTitle)}">${attr(mult(row.improvementMultiple))} ${escapeHtml(row.axisLabel || 'unnamed axis')}</span>
        </div>
        <div class="ra-row__meta">${escapeHtml(meta.join(' · '))}${notes.length ? ` ${notes.join(' ')}` : ''}</div>
      </li>
    `;
  }

  function economicRow(row) {
    const notes = [];
    if (row.slotAction === 'free-slot') {
      notes.push('<span class="ra-tag ra-tag--free">free slot</span>');
    } else if (row.slotAction === 'occupied-slot') {
      notes.push('<span class="ra-tag">backlogs active</span>');
    }

    const meta = [
      `${int(row.remainingResearchCost)} pts`,
      months(row.monthsAtCurrentIncome)
    ];
    const roll = rollNote(row.unlockChance, row.availabilityState);
    if (roll) meta.push(roll);

    const effect = row.largestPricedEffect || null;
    const effectTitle = effect && effect.quantityLabel
      ? `against ${effect.quantityLabel}`
      : 'priced against this save’s own figures';

    return `
      <li class="ra-row">
        <div class="ra-row__head">
          <span class="ra-row__name" title="${attr(row.id)}">${escapeHtml(row.displayName)}</span>
          <span class="ra-row__metric" title="${attr(effectTitle)}">${attr(quantity(row.monthlyValue, row.unit))}</span>
        </div>
        <div class="ra-row__meta">${escapeHtml(meta.join(' · '))}${notes.length ? ` ${notes.join(' ')}` : ''}</div>
      </li>
    `;
  }

  /**
   * The first `GROUPS_SHOWN` groups that actually contain rows, separating
   * Actionable (buildable now, researchable now) from Aspirational.
   */
  function renderGroups(groups, renderRow) {
    const populated = (Array.isArray(groups) ? groups : []).filter(group => group.items && group.items.length > 0);
    if (populated.length === 0) return '';
    return populated.slice(0, GROUPS_SHOWN).map(group => `
      <div class="ra-group${ACTIONABLE_GROUPS.includes(group.state) ? ' is-actionable' : ' is-aspirational'}">
        <div class="ra-group__label">
          <span>${escapeHtml(group.label || group.state || 'Unknown')}</span>
          <small>${escapeHtml(`${int(group.count)} ranked`)}</small>
        </div>
        <ul class="ra-group__list">${group.items.slice(0, ROWS_PER_GROUP).map(renderRow).join('')}</ul>
      </div>
    `).join('');
  }

  /**
   * Current research queue & dynamic project capacity headline.
   */
  function renderQueue(slots) {
    if (!slots || slots.available !== true) return '';
    const cap = num(slots.projectSlotCapacity);
    const free = num(slots.freeProjectSlots);
    if (cap === null) return '';
    if (cap === 0 && (slots.slots || []).length === 0) {
      return `
        <div class="ra-queue">
          <span class="ra-queue__capacity">0 project slots</span>
          <span class="ra-queue__items">Turn 1 · no active research</span>
        </div>
      `;
    }
    const capHeadline = free !== null && free > 0
      ? `${int(free)} of ${int(cap)} project slots free`
      : `All ${int(cap)} project slots active`;
    const isFree = free !== null && free > 0;
    const active = (slots.activeProjects || []).map(p => {
      const pct = num(p.percent);
      const pctStr = pct === null ? '' : ` (${int(pct)}%)`;
      return `<span class="ra-queue__item">${escapeHtml(String(p.displayName || p.projectId))}<span class="ra-queue__item-val">${escapeHtml(pctStr)}</span></span>`;
    });
    const itemsHtml = active.length > 0
      ? active.join(' · ')
      : '<span class="ra-queue__item">no active projects</span>';

    return `
      <div class="ra-queue" title="${attr(SLOT_TITLE)}">
        <span class="ra-queue__capacity ${isFree ? 'is-free' : 'is-full'}">${escapeHtml(capHeadline)}</span>
        <div class="ra-queue__items">${itemsHtml}</div>
      </div>
    `;
  }

  /**
   * What could NOT be ranked, in this file's own words.
   *
   * Section 7 of the spec: unquantifiable is a state, never a zero. The counts come
   * from the payload; the sentences are written here so an upstream reason
   * cannot put the word "null" on screen.
   */
  const UNRANKABLE_LABELS = {
    'no-improvement': 'no gain',
    'no-research-required': 'buildable now',
    'cost-unmeasured': 'cost unknown',
    'not-comparable': 'no baseline'
  };

  const UNRANKABLE_TITLES = {
    'no-improvement': 'measured, and no better than the best you already field on that axis',
    'no-research-required': 'behind a finished project, or behind no project at all — costs no research',
    'cost-unmeasured': 'the remaining research cost is not measurable, so no value-per-point ratio exists',
    'not-comparable': 'you field nothing in that class, or the item lacks the stat the class ranks on'
  };

  const CENSUS_TITLE = 'Never scored zero. A candidate that cannot be scored is carried as its own state, '
    + 'because a silent zero ranks last and never surfaces. '
    + Object.keys(UNRANKABLE_LABELS).map(key => `${UNRANKABLE_LABELS[key]}: ${UNRANKABLE_TITLES[key]}`).join('. ');

  /**
   * The one extra military line phase 5 earns: what the delivery floor pushed
   * below its damage.
   *
   * A floor that silently removes a row from the top of a ranking is a
   * truncation, and truncation announces itself. One line, because the COMMAND
   * column is measured against a 3.00-screen budget -- see
   * docs/v2-navigation-plan.md section 4 -- and this card was already at 2.99
   * of it before section 6 rode in on the foot line.
   *
   * Returns '' when nothing was demoted, so a clean ranking costs no height.
   */
  const DELIVERY_DEMOTED_TITLE = 'Ranked below their damage. A weapon the game marks interceptable '
    + 'carries a second floor: how much point-defence fire each ARRIVING round has to survive, against '
    + 'the best interceptable weapon you already field. Damage still leads the ordering because it '
    + 'decides the outcome; this decides whether the outcome happens. The usual cause is salvo size — '
    + 'a bay firing eight rounds splits the same defensive fire eight ways, a launcher firing one '
    + 'absorbs all of it. No hit chance is estimated; the game publishes nothing to check one against.';

  function renderDeliveryDemoted(demoted) {
    if (!demoted) return '';
    const count = num(demoted.count);
    if (count === null || count < 1) return '';
    const lead = (demoted.items || [])[0] || null;
    const label = `${int(count)} ranked below ${count === 1 ? 'its' : 'their'} damage`;
    if (!lead) {
      return `<p class="ra-census" title="${attr(DELIVERY_DEMOTED_TITLE)}">${escapeHtml(label)}</p>`;
    }
    const name = lead.displayName ? String(lead.displayName) : 'unnamed candidate';
    const baseline = lead.floorBaselineDisplayName ? String(lead.floorBaselineDisplayName) : null;
    const detail = baseline
      ? `${mult(lead.multipleOfFloor)} the point-defence fire per round of ${baseline}`
      : `${dec(lead.shotsPerArrivingRound, 1)} point-defence shots per arriving round`;
    return `<p class="ra-census" title="${attr(DELIVERY_DEMOTED_TITLE)}">${escapeHtml(`${label}: ${name} — ${detail}`)}</p>`;
  }

  function renderCensus(unrankable, consideredLabel, suffix, suffixTitle) {
    const counts = (unrankable && unrankable.counts) || {};
    const parts = [consideredLabel];
    for (const key of Object.keys(UNRANKABLE_LABELS)) {
      if (num(counts[key]) !== null && counts[key] > 0) parts.push(`${int(counts[key])} ${UNRANKABLE_LABELS[key]}`);
    }
    if (suffix) parts.push(suffix);
    const title = suffixTitle ? `${CENSUS_TITLE} ${suffixTitle}` : CENSUS_TITLE;
    return `<p class="ra-census" title="${attr(title)}">${escapeHtml(parts.join(' · '))}</p>`;
  }

  // -------------------------------------------------------------------------
  // DEFICIT BANNER
  // -------------------------------------------------------------------------

  /**
   * The measured capability deficit that drives the military ordering.
   *
   * Three states, and they are not interchangeable. A measured gap is a fact
   * about the save; `canContest: 'unknown'` means the comparison could not be
   * made at all, which is NOT the same as no threat -- alien fleets only reach
   * a player-mode snapshot through a detection capability, so an empty sky can
   * mean a blind observer.
   */
  function renderDeficit(payload) {
    const deficit = payload.deficit || {};
    const capability = deficit.capability || {};

    if (deficit.applied === true) {
      const gap = deficit.ratio === null || deficit.ratio === undefined
        ? UNAVAILABLE
        : `${dec(deficit.ratio, 1)}×`;
      const ours = deficit.own === null || deficit.own === undefined
        ? UNAVAILABLE
        : `${dec(deficit.own, 1)}${deficit.unit ? ` ${deficit.unit}` : ''}`;
      const theirs = deficit.alien === null || deficit.alien === undefined
        ? UNAVAILABLE
        : `${dec(deficit.alien, 1)}${deficit.unit ? ` ${deficit.unit}` : ''}`;
      return `
        <p class="ra-deficit is-gap" title="${attr(deficit.reason || '')}">
          <span class="ra-deficit__top"><span class="ra-deficit__label">WIDEST MEASURED GAP</span>
            <strong>${escapeHtml(String(deficit.axisLabel || 'unnamed axis'))} ${escapeHtml(gap)}</strong></span>
          <span class="ra-deficit__detail">${escapeHtml(`${ours} ours vs ${theirs} alien`)} — research that moves it is ordered first.
            <em class="ra-deficit__judgement">Our inference from a measurement, not shipped data.</em></span>
        </p>
      `;
    }

    if (capability.canContest === 'unknown') {
      return `
        <p class="ra-deficit is-unknown" title="${attr(capability.verdictReason || '')}">
          <span class="ra-deficit__top"><span class="ra-deficit__label">NO MEASURED GAP</span>
            <strong>Alien capability could not be compared</strong></span>
          <span class="ra-deficit__detail">Alien fleets only appear through a detection capability, so this is not the same as no threat. Ordering is by value per research point alone.</span>
        </p>
      `;
    }

    // A measured comparison that found no decisive gap, or a deficit whose
    // remedy is not research at all (hull count is production, not research).
    const axis = deficit.axisLabel ? String(deficit.axisLabel) : null;
    return `
      <p class="ra-deficit is-flat" title="${attr(deficit.reason || capability.verdictReason || '')}">
        <span class="ra-deficit__top"><span class="ra-deficit__label">NO RESEARCH REMEDY</span>
          <strong>${escapeHtml(axis ? `Widest gap: ${axis}` : 'No decisive capability gap')}</strong></span>
        <span class="ra-deficit__detail">${escapeHtml(axis && deficit.remedyKind === 'production'
          ? 'Its remedy is production, not research, so no candidate is promoted for it.'
          : 'Ordering is by value per research point alone.')}</span>
      </p>
    `;
  }

  // -------------------------------------------------------------------------
  // FULL RANKING (detail panel)
  // -------------------------------------------------------------------------

  /**
   * The observer's slot allocation, in this file's own words.
   *
   * Spec section 6. The card has no room for a table, and the honest headline is
   * short: how many of the weighted slots carry pips, and how many holdings are
   * receiving nothing. The full layout and the reason no reallocation is
   * recommended live in the detail panel.
   *
   * Returns null when the snapshot does not carry the weights, so the foot line
   * shows the income alone rather than an invented "0 of 0 slots".
   */
  function slotSummary(slots) {
    if (!slots || slots.available !== true) return null;
    const withPips = num(slots.slotsWithPips);
    const count = num(slots.slotCount);
    if (withPips === null || count === null) return null;
    const parts = [`${int(withPips)}/${int(count)} slots weighted`];
    // Three counts, summed only if all three are measured. `num(x) || 0` would
    // turn an unmeasured count into a confident zero and understate the total.
    const idleParts = [slots.occupiedWithoutPips, slots.pipsWithoutOccupant, slots.unweightedOccupantCount]
      .map(num);
    if (!idleParts.includes(null)) {
      const idle = idleParts.reduce((sum, value) => sum + value, 0);
      if (idle > 0) parts.push(`${int(idle)} idle`);
    }
    return parts.join(' · ');
  }

  const SLOT_TITLE = 'Which research slots your pips are on, read from the save. No reallocation is '
    + 'recommended: the published allocation formula does not reproduce your own measured research '
    + 'delivery, so an "optimal" split would be a confident number resting on an unverified model. '
    + 'Idle counts slots that hold something with no pips, pips with nothing to spend them on, and '
    + 'projects parked beyond the last weighted slot.';

  /** Slot rows for the detail panel. Every visible string is authored here. */
  function slotFacts(slots) {
    if (!slots) return [];
    if (slots.available !== true) {
      return [{
        label: 'SLOT ALLOCATION',
        value: 'Not available on this snapshot — the save\'s research slot weights were not published. '
          + 'Re-publish the save to restore them.'
      }];
    }
    const facts = [];
    const free = num(slots.freeProjectSlots);
    const cap = num(slots.projectSlotCapacity);
    const capText = cap !== null
      ? (free !== null && free > 0 ? `${int(free)} of ${int(cap)} project slots free` : `All ${int(cap)} project slots active`)
      : UNAVAILABLE;
    facts.push({
      label: 'PROJECT CAPACITY',
      value: `${capText}. Stopping a project moves it to the backlog with progress intact; backlogging costs time, not research points.`
    });

    for (const slot of slots.slots || []) {
      const pips = num(slot.pips);
      const pipText = pips === null ? UNAVAILABLE : `${int(pips)} pip${pips === 1 ? '' : 's'}`;
      const progress = num(slot.accumulatedResearch) === null
        ? UNAVAILABLE
        : `${int(slot.accumulatedResearch)}${num(slot.totalCost) === null ? '' : ` of ${int(slot.totalCost)}`} pts${num(slot.percent) !== null ? ` (${int(slot.percent)}%)` : ''}`;
      const held = slot.displayName ? String(slot.displayName) : 'nothing assigned';
      const category = slot.category ? ` · ${String(slot.category)}` : '';
      const idle = slot.idleReason ? ` · ${slot.idleReason}` : '';
      facts.push({
        label: `SLOT ${int(slot.index)} · ${String(slot.kindLabel || 'Slot')}`,
        value: `${held}${category} · ${pipText} · ${progress}${idle}`
      });
    }

    for (const extra of slots.unweightedOccupants || []) {
      const progress = num(extra.accumulatedResearch) === null
        ? UNAVAILABLE
        : `${int(extra.accumulatedResearch)}${num(extra.totalCost) === null ? '' : ` of ${int(extra.totalCost)}`} pts (${int(extra.percent)}%)`;
      facts.push({
        label: `BACKLOG · Slot ${int(extra.index)}`,
        value: `${String(extra.displayName || 'unnamed')} · ${progress} · parked in backlog with progress intact`
      });
    }

    facts.push({
      label: 'REALLOCATION',
      value: 'Not offered. The published allocation formula does not reproduce measured delivery: the '
        + 'same slot with the same pips returned 1.147x the prediction over one 15.5-day interval and '
        + '0.993x over the next, and the two project slots imply a project bonus of −0.209 — a penalty. '
        + 'Two of the formula\'s four terms appear in no shipped template.'
    });
    return facts;
  }

  function openFullRanking(payload) {
    const panel = global.MissionControlDetailPanel;
    if (!panel || typeof panel.open !== 'function') return;

    const facts = [];
    for (const group of (payload.military && payload.military.groups) || []) {
      for (const row of group.items || []) {
        // Phase 5's figures ride on the existing military fact rather than
        // taking rows of their own: the panel is a list and every extra row is
        // height. Null-safe throughout -- a reactor has no delivery axis and
        // simply contributes nothing here.
        const delivery = (row.context && row.context.delivery) || null;
        const deliveryText = delivery
          ? ` · ${dec(delivery.shotsPerArrivingRound, 1)} PD shots per arriving round`
            + (num(delivery.flightTimeS) === null ? '' : `, ${dec(delivery.flightTimeS, 0)}s flight`)
            + (num(delivery.terminalSpeedKps) === null ? '' : ` at ${dec(delivery.terminalSpeedKps, 1)} km/s`)
          : '';
        const slotNote = row.slotNote ? ` · ${row.slotNote}` : '';
        facts.push({
          label: `MILITARY · ${group.label} · ${row.displayName}`,
          value: `${mult(row.improvementMultiple)} ${row.axisLabel || 'unnamed axis'} · `
            + `${int(row.remainingResearchCost)} pts · ${months(row.monthsAtCurrentIncome)}`
            + (row.closesDeficit ? ' · closes the measured gap' : '')
            + (row.clearsFloor === false ? ' · fails its floor' : '')
            + deliveryText
            + (row.clearsDeliveryFloor === false ? ' · fails its delivery floor' : '')
            + (row.clearsDeliveryFloor === null && delivery ? ' · delivery floor could not be evaluated' : '')
            + slotNote
        });
      }
    }
    for (const item of ((payload.military && payload.military.deliveryDemoted) || {}).items || []) {
      facts.push({
        label: `DELIVERY · ranked below its damage · ${item.displayName || 'unnamed candidate'}`,
        value: `${dec(item.shotsPerArrivingRound, 1)} point-defence shots per arriving round against `
          + `${dec(item.floorValue, 1)} for ${item.floorBaselineDisplayName || 'the best you field'} — `
          + `${mult(item.multipleOfFloor)} as much fire on each round that gets through. Damage still `
          + 'leads the ordering; delivery decides whether the damage lands.'
      });
    }
    const environment = ((payload.sources && payload.sources.militaryValue) || {}).deliveryEnvironment || null;
    if (environment) {
      facts.push({
        label: 'DELIVERY · measured against',
        value: environment.available === true
          ? `${environment.selected === 'observer-own' ? 'your own hulls, as a stand-in' : 'every faction other than you'} · `
            + `${int(environment.hullsRead)} hulls · ${int(environment.pointDefenseInstallations)} point-defence mounts · `
            + `${dec(environment.meanMountsPerHull, 2)} per hull on average. Modelled, not a figure the game publishes: `
            + 'flight time is an upper bound and arrival speed a lower one, and no hit chance is estimated.'
          : 'No point-defence battery is observable in this snapshot, so delivery is unmeasured. That is '
            + 'not the same as an undefended target — no candidate is credited with arriving unopposed.'
      });
    }
    for (const unit of (payload.economic && payload.economic.units) || []) {
      for (const group of unit.groups || []) {
        for (const row of group.items || []) {
          facts.push({
            label: `ECONOMIC · ${group.label} · ${row.displayName}`,
            value: `${quantity(row.monthlyValue, row.unit)} · ${int(row.remainingResearchCost)} pts · `
              + `${months(row.monthsAtCurrentIncome)}`
          });
        }
      }
    }
    if (facts.length === 0) {
      facts.push({
        label: 'Nothing ranked',
        value: 'No candidate in this snapshot could be scored. The counts on the card say why.'
      });
    }

    panel.open({
      eyebrow: 'RESEARCH ADVISOR',
      title: 'Full research ranking',
      summary: 'Two parallel rankings, never one score. Military value and economic value have no '
        + 'exchange rate, so they are ordered separately and the position of one below the other '
        + 'carries no claim about which is worth more. Within a track, ordering is by value per '
        + 'research point inside one availability group, and a multiple on a module rule value — which '
        + 'has no unit — is ordered after every multiple that does. The slot section below says where '
        + 'your research currently goes.',
      facts: [...facts, ...slotFacts(payload.slots)],
      // The detail panel closes on any action by default, so a bare label is
      // the whole contract here.
      actions: [{ label: 'Close' }]
    });
  }

  // -------------------------------------------------------------------------
  // RENDER
  // -------------------------------------------------------------------------

  function renderUnavailable(container, headline, detail) {
    container.innerHTML = `
      <div class="research-advisor">
        <p class="research-advisor__empty">${escapeHtml(headline)}</p>
        ${detail ? `<p class="ra-census">${escapeHtml(detail)}</p>` : ''}
      </div>
    `;
  }

  function render(container, payload) {
    if (!container) return;

    if (!payload || payload.success === false || !payload.military || !payload.economic) {
      renderUnavailable(
        container,
        'RESEARCH RANKING UNAVAILABLE',
        'The ranking endpoint did not answer for this snapshot. No ranking is shown rather than a '
          + 'placeholder one.'
      );
      return;
    }

    const sources = payload.sources || {};
    // Every upstream phase missing means the ranking has no inputs at all. That
    // is a different fact from "nothing is worth researching", and the two must
    // not render the same way.
    const blocked = ['propulsion', 'militaryValue', 'economicValue']
      .filter(key => sources[key] && sources[key].available === false);
    if (blocked.length === 3) {
      renderUnavailable(
        container,
        'RESEARCH RANKING UNAVAILABLE',
        'None of the valuation inputs are present on this snapshot. Re-publish the save to restore '
          + 'the component, effect and drive catalogues.'
      );
      return;
    }

    const militaryBody = renderGroups(payload.military.groups, militaryRow)
      || `<p class="ra-empty-group">${escapeHtml(
        sources.militaryValue && sources.militaryValue.available === false
          ? 'The component catalogue is missing from this snapshot, so nothing could be compared.'
          : 'Nothing can be ranked yet — with no hulls or habs in service there is no baseline to '
            + 'compare a candidate against.'
      )}</p>`;

    const economicUnits = (payload.economic.units || []).filter(unit => (unit.groups || [])
      .some(group => group.items && group.items.length > 0));
    const leadUnit = economicUnits[0] || null;
    const economicBody = leadUnit
      ? renderGroups(leadUnit.groups, economicRow)
      : `<p class="ra-empty-group">${escapeHtml(
        'Nothing could be priced against this save’s own figures yet.'
      )}</p>`;

    const otherUnits = economicUnits.slice(1).map(unit => String(unit.unit));
    // The unit is named in the track heading rather than on its own row: it is
    // the heading's subject, and the two lines said the same thing.
    const economicCaption = leadUnit
      ? `${String(leadUnit.unit || 'unnamed unit')} · never summed`
      : 'per unit, never summed';
    const research = payload.research || {};
    const incomeLabel = research.monthlyResearchIncome === null || research.monthlyResearchIncome === undefined
      ? 'research income not measurable — no completion times shown'
      : `${int(research.monthlyResearchIncome)} research/mo`;
    const slotLabel = slotSummary(payload.slots);
    const footLabel = slotLabel ? `${incomeLabel} · ${slotLabel}` : incomeLabel;
    const footTitle = slotLabel
      ? `Time to complete is against this figure. Absent income means no honest number of months, so the dash is shown instead of a zero. ${SLOT_TITLE}`
      : 'Time to complete is against this figure. Absent income means no honest number of months, so the dash is shown instead of a zero.';

    container.innerHTML = `
      <div class="research-advisor">
        ${renderDeficit(payload)}
        ${renderQueue(payload.slots)}
        <div class="ra-tracks">
          <section class="ra-track">
            <div class="ra-track__head">
              <h4>MILITARY</h4>
              <small title="A multiple on one class's axis is not commensurable with a multiple on another's. Every row names its own axis; this ordering is a triage aid, not an exchange rate.">× your best, per point</small>
            </div>
            ${militaryBody}
            ${renderCensus(payload.military.unrankable, `${int(payload.military.rankedCount)} of ${int(payload.military.candidatesConsidered)} ranked`)}
            ${renderDeliveryDemoted(payload.military.deliveryDemoted)}
          </section>
          <section class="ra-track">
            <div class="ra-track__head">
              <h4>ECONOMIC</h4>
              <small title="Units are never summed and never ranked against each other. Tonnes per month and dollars per year have no exchange rate.">${escapeHtml(economicCaption)}</small>
            </div>
            ${economicBody}
            ${renderCensus(
              payload.economic.unrankable,
              `${int(payload.economic.rankedCount)} of ${int(payload.economic.candidatesConsidered)} ranked`,
              otherUnits.length > 0 ? `+${int(otherUnits.length)} more units` : null,
              otherUnits.length > 0 ? `Also priced in ${otherUnits.join(', ')}. Open the full ranking for those.` : null
            )}
          </section>
        </div>
        <div class="ra-foot">
          <span title="${attr(footTitle)}">${escapeHtml(footLabel)}</span>
          <button type="button" class="init-btn ra-foot__btn" data-research-advisor-full>Full ranking</button>
        </div>
      </div>
    `;

    const button = container.querySelector('[data-research-advisor-full]');
    if (button) button.addEventListener('click', () => openFullRanking(payload));
  }

  async function fetchResearchRanking(observerId, mode) {
    const observer = encodeURIComponent(String(observerId));
    const intelMode = encodeURIComponent(String(mode));
    try {
      const res = await fetch(`/api/intel/research-ranking?observer=${observer}&mode=${intelMode}&limit=6`);
      if (!res.ok) return null;
      return await res.json();
    } catch (err) {
      console.warn('[ResearchAdvisor] Failed to fetch the research ranking:', err);
      return null;
    }
  }

  global.MissionControlResearchAdvisor = {
    render,
    fetchResearchRanking
  };
})(window);
