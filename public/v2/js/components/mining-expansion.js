/*
 * Mining Expansion Board Component
 * --------------------------------
 * Purpose: the mining expansion board — capacity, runways, and need-weighted
 *   site scoring on screen.
 * Answers three core strategic questions:
 *   1. How much mining capacity do I have left? (Mine limit, headroom, quadratic MC & hate cost)
 *   2. Which sites are open? (Unowned sites, reachability filtered)
 *   3. Which of those are worth taking? (Need-weighted saturating marginal utility scoring)
 *
 * RENDERING RULE: the payload deliberately emits null for anything the save
 * did not measure, so EVERY value here has to be routed through `fmt` / `int`
 * / `unit` before it reaches a template literal. Interpolating a raw null puts
 * the literal text "null" on screen -- this board shipped reading
 * "1 MC · nulld" on all 109 rows because `${c.buildTimeDays}d` was written
 * directly. A raw null in rendered text is a bug, not an honest unavailable
 * state; an honest unavailable state is the em dash plus a title that says why.
 */
(function exposeMiningExpansion(global) {
  'use strict';

  const shared = global.MissionControlShared || {};
  const escapeHtml = shared.escapeHtml || (value => String(value ?? ''));

  const UNAVAILABLE = '—';

  function num(value) {
    if (value === null || value === undefined || value === '') return null;
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : null;
  }

  // Fixed-decimal number, or the unavailable dash. Never "null", never "NaN".
  function fmt(value, decimals = 1) {
    const parsed = num(value);
    return parsed === null ? UNAVAILABLE : parsed.toFixed(decimals);
  }

  // Integer-ish number, or the unavailable dash.
  function int(value) {
    const parsed = num(value);
    return parsed === null ? UNAVAILABLE : String(Math.round(parsed));
  }

  // A number with a unit suffix, where an absent number drops the suffix too:
  // "nulld" and "—d" are both nonsense, so an absent value renders as "—".
  function unit(value, suffix, decimals = 0) {
    const parsed = num(value);
    if (parsed === null) return UNAVAILABLE;
    return `${decimals > 0 ? parsed.toFixed(decimals) : Math.round(parsed)}${suffix}`;
  }

  function attr(value) {
    return escapeHtml(String(value === null || value === undefined ? '' : value));
  }

  const RESOURCE_LABELS = [
    ['water', 'W'],
    ['volatiles', 'V'],
    ['metals', 'M'],
    ['nobleMetals', 'N'],
    ['fissiles', 'F']
  ];

  /**
   * Yields render in three states, because they have three: measured and
   * productive, measured and barren, and never measured. Collapsing the third
   * into "trace yields" claimed a reading the payload does not have.
   */
  function formatYields(yields) {
    if (!yields || typeof yields !== 'object') {
      return { text: 'YIELDS UNAVAILABLE', unmeasured: RESOURCE_LABELS.map(([key]) => key) };
    }
    const parts = [];
    const unmeasured = [];
    for (const [key, label] of RESOURCE_LABELS) {
      const entry = yields[key];
      const monthly = num(entry && entry.monthly);
      // `measured === false` and an absent rate are the same thing here; both
      // mean "the save carries no rate", which is not the same as zero.
      if (monthly === null || (entry && entry.measured === false)) {
        unmeasured.push(key);
        continue;
      }
      if (monthly > 0) parts.push(`${label}: +${monthly.toFixed(1)}`);
    }
    if (parts.length) return { text: parts.join(' · '), unmeasured };
    if (unmeasured.length === RESOURCE_LABELS.length) {
      return { text: 'YIELDS UNMEASURED', unmeasured };
    }
    return { text: 'No measured yield', unmeasured };
  }

  async function fetchMiningExpansion(observerId = 4712, mode = 'player') {
    try {
      const res = await fetch(`/api/intel/mining-expansion?observer=${observerId}&mode=${mode}`);
      if (!res.ok) return null;
      return await res.json();
    } catch (err) {
      console.warn('[MiningExpansion] Failed to fetch expansion data:', err);
      return null;
    }
  }

  function renderStatus(capacity) {
    const minesBuilt = num(capacity.minesBuilt);
    const mineLimit = num(capacity.mineLimit);
    const headroom = num(capacity.headroom);
    const penaltyMC = num(capacity.penaltyMC);
    const penaltyHate = num(capacity.penaltyHate);
    const hateAvailable = capacity.hateCostAvailable !== false && num(capacity.baseHateMultiplier) !== null;

    const countLabel = `${int(minesBuilt)} / ${int(mineLimit)} MINES`;

    if (capacity.overLimit === true) {
      const marginalMC = num(capacity.marginalNextMinePenaltyMC);
      const marginalHate = num(capacity.marginalNextMinePenaltyHate);
      return {
        tone: 'is-danger',
        label: `OVER LIMIT (+${int(penaltyMC)} MC${hateAvailable ? ` / +${fmt(penaltyHate, 1)} HATE` : ' / HATE UNAVAILABLE'})`,
        note: `Quadratic penalty active. Next mine costs +${int(marginalMC)} MC`
          + (hateAvailable
            ? ` (+${fmt(marginalHate, 1)} hate).`
            : ' (hate cost unavailable: the save carries no readable difficulty).')
      };
    }

    if (headroom === null || minesBuilt === null || mineLimit === null) {
      return {
        tone: 'is-warning',
        label: `${countLabel} (CAPACITY UNMEASURED)`,
        note: 'Mine headroom could not be computed from this snapshot, so the quadratic MC penalty distance is unknown.'
      };
    }

    if (headroom <= 2) {
      return {
        tone: 'is-warning',
        label: `${countLabel} (CAPACITY TIGHT)`,
        note: `Only ${headroom} mine slot(s) left before penalty. Next mission tech unlocks +3 to +6.`
      };
    }

    return {
      tone: 'is-safe',
      label: countLabel,
      note: `${headroom} mine(s) headroom remaining before quadratic MC penalty.`
    };
  }

  function renderRunwayPill(runway) {
    if (!runway || typeof runway !== 'object') return '';
    const key = String(runway.key || '');
    if (!key) return '';
    const label = key.charAt(0).toUpperCase() + key.slice(1);
    const status = String(runway.status || 'unknown');
    const months = num(runway.runwayMonths);

    let text;
    let title = `${label}: ${status}`;
    if (months !== null) {
      text = `${months}mo`;
    } else if (status.includes('surplus')) {
      text = 'Surplus';
    } else if (status === 'unmeasured' || status === 'consumption_unknown' || status === 'unknown') {
      // An unmeasured runway is not a comfortable one. It says so.
      text = 'Unmeasured';
      title = status === 'consumption_unknown'
        ? `${label}: stockpile read, but monthly consumption is not in this snapshot`
        : `${label}: no stockpile reading in this snapshot`;
    } else {
      text = UNAVAILABLE;
    }

    let badgeClass = 'is-neutral';
    if (status === 'critical' || status === 'depleted') badgeClass = 'is-danger';
    else if (status === 'tight') badgeClass = 'is-warning';
    else if (status === 'comfortable' || status.includes('surplus')) badgeClass = 'is-safe';

    return `<span class="mining-runway-pill ${badgeClass}" title="${attr(title)}"><strong>${escapeHtml(label)}:</strong> ${escapeHtml(text)}</span>`;
  }

  function renderCandidateRow(c) {
    const hateCost = num(c.hateCost);
    const hateKnown = hateCost !== null;
    let hateBadge;
    if (!hateKnown) {
      hateBadge = '<span class="mining-tag mining-tag--unknown" title="The alien-hate cost could not be evaluated: the save carries no readable difficulty, and the floor multiplier is what converts Mission Control into hate.">HATE UNKNOWN</span>';
    } else if (hateCost === 0) {
      hateBadge = '<span class="mining-tag mining-tag--free">FREE</span>';
    } else {
      hateBadge = `<span class="mining-tag mining-tag--hate">+${fmt(hateCost, 2)} hate</span>`;
    }

    const yieldInfo = formatYields(c.yields);
    const densityAssumed = c.siteDensityAssumed === true || c.siteDensityMeasured === false;
    const densityText = `Density: ${fmt(c.siteDensity, 2)}x`;
    const densityMarkup = densityAssumed
      ? `<small class="mining-density is-assumed" title="${attr(c.siteDensitySource || 'Assumed 1.0 — the site template density could not be resolved.')}">${escapeHtml(densityText)} (assumed)</small>`
      : `<small class="mining-density">${escapeHtml(densityText)}</small>`;

    const valueMeasured = num(c.siteValue) !== null;
    const partial = valueMeasured && c.scoreInputsComplete === false;
    const valueTitle = !valueMeasured
      ? 'Not scoreable: none of the five mined resources could be evaluated against a measured runway.'
      : partial
        ? `Partial score: ${(c.unmeasuredResources || []).join(', ') || 'some resources'} could not be evaluated.`
        : 'Net saturating utility across the five mined resources.';

    // `${c.buildTimeDays}d` printed "nulld" on every row: an unowned site has
    // no mine under construction, so the save records no build duration.
    const buildDays = num(c.buildTimeDays);
    const costLine = buildDays === null
      ? `${unit(c.mcCost, ' MC')} · build n/a`
      : `${unit(c.mcCost, ' MC')} · ${unit(buildDays, 'd')}`;
    const costTitle = buildDays === null
      ? 'Build duration is not recorded for an unowned site — it only exists once a mine is queued.'
      : 'Recorded build duration for this site.';

    const theaterKey = c.spaceTheaterKey ? String(c.spaceTheaterKey).toUpperCase() : 'UNASSIGNED';
    const assumedDestination = typeof c.destinationTechSource === 'string'
      && c.destinationTechSource.indexOf('assumed') === 0;

    return `
      <tr class="mining-candidate-row" data-site-id="${attr(c.siteId)}">
        <td class="mining-site-cell">
          <strong class="mining-site-name">${escapeHtml(c.displayName || 'Unnamed site')}</strong>
          <small class="mining-site-body">${escapeHtml(c.parentBodyName || 'Unknown body')} (${escapeHtml(theaterKey)})${
            assumedDestination
              ? ' <span class="mining-assumed-flag" title="This body is not in the space-theater table, so its destination tech is assumed to be Mission to the Asteroids.">assumed reach</span>'
              : ''
          }</small>
        </td>
        <td class="mining-yields-cell">
          <div class="mining-yields-text${yieldInfo.unmeasured.length ? ' is-partial' : ''}"${
            yieldInfo.unmeasured.length ? ` title="${attr(`Unmeasured in this snapshot: ${yieldInfo.unmeasured.join(', ')}`)}"` : ''
          }>${escapeHtml(yieldInfo.text)}</div>
          ${densityMarkup}
        </td>
        <td class="mining-value-cell">
          <strong class="mining-value-score${valueMeasured ? '' : ' is-unmeasured'}" title="${attr(valueTitle)}">${fmt(c.siteValue, 2)}${partial ? '*' : ''}</strong>
          <small class="mining-value-label">${
            !valueMeasured ? 'not scoreable' : (partial ? 'partial utility' : 'net utility')
          }</small>
        </td>
        <td class="mining-cost-cell">
          <div>${hateBadge}</div>
          <small class="mining-mc-cost" title="${attr(costTitle)}">${escapeHtml(costLine)}</small>
        </td>
      </tr>
    `;
  }

  function render(root, payload) {
    if (!root) return;

    const expansion = payload?.miningExpansion || payload;
    const capacity = expansion?.capacity;
    const available = Array.isArray(expansion?.available) ? expansion.available : [];
    const techGated = Array.isArray(expansion?.techGated) ? expansion.techGated : [];
    const unreachable = expansion?.unreachable || {};
    const runways = expansion?.resourceRunways || {};

    if (!capacity) {
      root.innerHTML = '<div class="alien-hate-econ-empty">MINING EXPANSION DATA UNAVAILABLE</div>';
      return;
    }

    const status = renderStatus(capacity);
    const warFloorDist = num(capacity.mcWarFloorDistance);
    const hateAvailable = capacity.hateCostAvailable !== false && num(capacity.baseHateMultiplier) !== null;

    const runwaysSummary = Object.values(runways).map(renderRunwayPill).join(' ');

    const ROW_LIMIT = 8;
    // The true total, not the length of the truncated view. A count that is
    // silently the capped length reads as "this is everything".
    const totalAvailable = num(expansion?.availableTotalCount) ?? available.length;
    const shownRows = available.slice(0, ROW_LIMIT);
    const availableRows = shownRows.map(renderCandidateRow).join('');

    // A group with an unreadable site count must not fold into the total as a
    // zero -- the header would then under-report a known-incomplete figure.
    const gatedCounts = techGated.map(g => num(g.siteCount));
    const gatedTotal = gatedCounts.some(count => count === null)
      ? null
      : gatedCounts.reduce((acc, count) => acc + count, 0);
    const techGatedCards = techGated.slice(0, 4).map(g => {
      const unmeasuredSites = num(g.unmeasuredSiteCount);
      return `
      <div class="mining-gated-item">
        <div class="mining-gated-header">
          <strong class="mining-gated-tech">${escapeHtml(g.missingTechName || g.missingTech || 'Unknown tech')}</strong>
          <span class="mining-gated-count">${int(g.siteCount)} sites</span>
        </div>
        <div class="mining-gated-meta">
          <span>Top site value: <strong>${fmt(g.bestSiteValue, 2)}</strong></span>
          <small class="mining-gated-sub">${
            unmeasuredSites !== null && unmeasuredSites > 0
              ? `${unmeasuredSites} unscored`
              : 'Research argument'
          }</small>
        </div>
      </div>
    `;
    }).join('');

    const unreachableTotal = num(unreachable.totalSites);

    // The projected yields below are the save's DEPOSIT rate lifted by the
    // observer's completed mine projects. A reader has to be able to tell an
    // adjusted figure from a raw one, and an UNRESOLVED multiplier has to read
    // as unresolved rather than as "no bonus" -- so this line is rendered in
    // all three states and never omitted.
    const bonus = expansion?.miningTechBonus || null;
    const bonusBoosted = Array.isArray(bonus?.boostedResources) ? bonus.boostedResources : [];
    let bonusNote;
    if (!bonus) {
      bonusNote = 'MINE TECH BONUSES NOT REPORTED by this snapshot — yields are raw deposit rates.';
    } else if (bonus.available !== true) {
      bonusNote = 'MINE TECH BONUSES UNRESOLVED — yields are raw deposit rates and are a lower bound, '
        + 'not a measured "no bonus".';
    } else if (bonusBoosted.length === 0) {
      bonusNote = 'No completed project raises mine output, so yields are the raw deposit rates. '
        + 'They exclude the mine module\'s own 1.0-4.0 multiplier.';
    } else {
      // The multiplier is 1.15 or 1.15^2 = 1.3225, so it needs up to four
      // decimals and looks wrong padded to four. An UNREADABLE multiplier
      // reaches here only if `boostedResources` named a resource the byResource
      // table does not carry, which is a payload contradiction, so it renders
      // as the unavailable dash rather than as a number.
      const named = bonusBoosted
        .map((key) => {
          const multiplier = num(bonus.byResource?.[key]?.multiplier);
          const grants = bonus.byResource?.[key]?.grants;
          const from = Array.isArray(grants) && grants.length ? grants.join(' + ') : 'source not named';
          return `${key} ×${multiplier === null ? UNAVAILABLE : String(multiplier)} (${from})`;
        })
        .join(', ');
      bonusNote = `Yields include completed-project mine bonuses: ${named}. They still exclude the mine `
        + 'module\'s own 1.0-4.0 multiplier, so they remain a lower bound.';
    }

    root.innerHTML = `
      <div class="mining-expansion-board">
        <div class="alien-hate-econ-statusbar">
          <div>
            <span class="alien-hate-econ-eyebrow">MINING CAPACITY</span>
            <strong class="alien-hate-econ-status ${status.tone}">${escapeHtml(status.label)}</strong>
          </div>
          <div class="alien-hate-econ-sub">${escapeHtml(status.note)}</div>
        </div>

        ${hateAvailable ? '' : `
          <div class="mining-unavailable-banner" title="Difficulty selects the alien minimum-hate floor multiplier (Cinematic 0.05 / Normal 0.30 / Veteran 0.60 / Brutal 1.00).">
            ALIEN-HATE COSTS UNAVAILABLE — this snapshot carries no readable difficulty, so mine hate cost cannot be priced.
          </div>
        `}

        <div class="mining-runways-bar">
          <span class="mining-runways-label">RUNWAYS:</span>
          ${runwaysSummary || '<span class="mining-runway-pill is-neutral">No runway data</span>'}
          ${warFloorDist !== null
            ? `<span class="mining-war-floor-pill">War Floor: <strong>${fmt(warFloorDist, 1)} MC</strong> away</span>`
            : '<span class="mining-war-floor-pill is-unknown" title="Needs both used Mission Control and the difficulty multiplier.">War Floor: <strong>unavailable</strong></span>'}
        </div>

        <div class="mining-yield-basis">${escapeHtml(bonusNote)}</div>

        <div class="mining-section-title">
          <span>AVAILABLE EXPANSION SITES (${int(totalAvailable)})</span>
          <small>${
            totalAvailable > shownRows.length
              ? `Top ${shownRows.length} of ${int(totalAvailable)}, ranked by saturating utility per unit of alien hate`
              : 'Ranked by saturating utility per unit of alien hate'
          }</small>
        </div>

        <div class="mining-table-wrap">
          <table class="mining-table">
            <thead>
              <tr>
                <th>Site &amp; Body</th>
                <th>Resource Yields</th>
                <th>Utility Value</th>
                <th>Cost</th>
              </tr>
            </thead>
            <tbody>
              ${availableRows || '<tr><td colspan="4" class="mining-empty-cell">No unowned reachable sites available in current theater.</td></tr>'}
            </tbody>
          </table>
        </div>

        ${techGated.length > 0 ? `
          <div class="mining-section-title mining-section-title--gated">
            <span>TECH-GATED OPPORTUNITIES (${gatedTotal === null ? 'site count unavailable' : `${int(gatedTotal)} sites`})</span>
            <small>Requires destination or mine module research</small>
          </div>
          <div class="mining-gated-grid">
            ${techGatedCards}
          </div>
        ` : ''}

        ${unreachableTotal !== null && unreachableTotal > 0 ? `
          <div class="mining-unreachable-summary">
            <small>${int(unreachableTotal)} outer system / unprobed sites currently unreachable without deep system mission projects.</small>
          </div>
        ` : ''}
      </div>
    `;
  }

  global.MissionControlMiningExpansion = {
    render,
    fetchMiningExpansion
  };
})(window);
