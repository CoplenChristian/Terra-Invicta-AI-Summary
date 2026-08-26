/**
 * src/v2/panels/fleetProcurementUtils.mjs
 *
 * Purpose: the DOM-free half of the FLEET procurement + refit advisor panel —
 *   every formatter, row model, armour comparison and detail-panel fact list,
 *   so the null discipline can be asserted without a browser.
 *
 * Ported from the deleted `public/v2/js/components/fleet-procurement.js` on
 * 2026-08-26. THE THREE RENDERING RULES OF THAT FILE STILL HOLD:
 *
 * 1. NOTHING IS INTERPOLATED RAW. `num` / `int` / `dec` / `mult` each return
 *    the em dash for an absent value and can never return a confident zero.
 * 2. ONLY STRINGS THIS FILE AUTHORS REACH THE DOM. Upstream prose — a
 *    `floorReason`, a `threatBasis`, a weapon `rationale` — is carried as
 *    `title` or as an explicitly-labelled detail-panel fact, never assembled
 *    into visible copy this file did not write.
 * 3. TRUNCATION ANNOUNCES ITSELF. `procurementView` carries `itemsShown` and
 *    `omittedCount` to the panel, which renders them through <TruncationNote>.
 *
 * ---------------------------------------------------------------------------
 * REGISTER DEFECT #4 IS FIXED HERE, NOT PORTED
 * ---------------------------------------------------------------------------
 *
 * The vanilla read:
 *
 *     const entry = ARMOR_DATA[armorId];
 *     if (!entry) return 1.0;
 *
 * An armour type absent from the hardcoded table scored a fabricated `1.0`,
 * which then divided into the recommended armour's real score and rendered as a
 * confident red "15.2× behind" badge. `ARMOR_DATA` is a fixed list of twelve
 * materials inside a component, so that path is reachable by an ordinary game
 * update, not only by bad data.
 *
 * `armorScore` now returns `null` for an unrecognised id, `armorComparison`
 * refuses to form a ratio from an unknown score, and the panel renders an
 * explicit "protection ratio unmeasured" affordance naming the material it
 * could not price. An unknown armour produces no number at all.
 *
 * The twelve entries below are the same twelve the save carries under
 * `componentStats.ship_armor` (verified 2026-08-26 against both frozen
 * fixtures), and the numbers are that block's `XRayResistance` /
 * `BaryonicResistance` specialties. The table is still hardcoded because the
 * refit-advisor payload carries resistances for the RECOMMENDED material only
 * (`xRayResistance` / `baryonicResistance`) and nothing at all for the fitted
 * one — plumbing the fitted side through would be a change to `shared/`, which
 * this migration is not allowed to touch. The fabricated fallback is gone
 * either way.
 */

export const UNAVAILABLE = '—';

export const DESIGN_ROLES = Object.freeze({
  warship: 'warship',
  transport: 'transport',
  unknown: 'unknown',
});

/**
 * X-ray and baryonic resistance per armour material.
 *
 * Threat weighting is `0.604 * XRayResistance + 0.396 * BaryonicResistance`;
 * unweighted is an even 0.5 / 0.5. Never derived from
 * `baryonicHalfValue_cm * density_kgm3` — that derivation was rejected in
 * research-advisor-spec.md.
 */
export const ARMOR_DATA = Object.freeze({
  SteelArmor: { displayName: 'Steel Armor', xRay: 0.27, baryonic: 1.0 },
  TitaniumArmor: { displayName: 'Titanium Armor', xRay: 0.44, baryonic: 1.11 },
  SiliconCarbideArmor: { displayName: 'Silicon Carbide Armor', xRay: 0.72, baryonic: 4.61 },
  BoronCarbideArmor: { displayName: 'Boron Carbide Armor', xRay: 1.0, baryonic: 0.62 },
  CompositeArmor: { displayName: 'Composite Armor', xRay: 1.11, baryonic: 5.21 },
  FoamedMetalArmor: { displayName: 'Foamed Metal Armor', xRay: 1.62, baryonic: 7.45 },
  NanotubeArmor: { displayName: 'Nanotube Armor', xRay: 2.53, baryonic: 19.78 },
  AdamantaneArmor: { displayName: 'Adamantane Armor', xRay: 4.82, baryonic: 31.02 },
  ExoticArmor: { displayName: 'Exotic Armor', xRay: 2.0, baryonic: 4.62 },
  HybridArmor: { displayName: 'Hybrid Armor', xRay: 1.8, baryonic: 4.4 },
  AlienAdamantaneArmor: { displayName: 'Alien Adamantane Armor', xRay: 4.82, baryonic: 31.02 },
  AlienExoticArmor: { displayName: 'Alien Exotic Armor', xRay: 2.0, baryonic: 4.62 },
});

export const RULE_SCALAR_KIND = 'rule-scalar';

export const RULE_SCALAR_TITLE = 'This module family has no engineering axis: the game gives each module one '
  + 'shared rule value and names no unit for it. The ratio is only formed against a module carrying the '
  + 'identical rule set. Ordered after every row whose axis has a unit.';

export const DELIVERY_FAILS_TITLE = 'Ranked below its damage. Each round that arrives has to survive '
  + 'measurably more point-defence fire than the best interceptable weapon you already field — usually '
  + 'because it is fired one round at a time while yours arrive in a salvo that splits the same '
  + 'defensive fire. Damage still leads the ordering; this decides whether the damage lands.';

export const DELIVERY_UNKNOWN_TITLE = 'Delivery could not be checked for this one. Either no point-defence '
  + 'battery is observable in this snapshot, you field nothing comparable to measure it against, or '
  + 'the templates do not describe its flight. This is not a pass — it is an unmeasured axis, and it '
  + 'does not move the row up or down.';

export const PROCUREMENT_UNAVAILABLE_HEADLINE = 'PROCUREMENT DATA UNAVAILABLE';

export const NO_ENDPOINT_ANSWER = 'The ranking endpoint did not answer for this snapshot.';

export const REFIT_UNAVAILABLE_HEADLINE = 'REFIT DATA UNAVAILABLE';

export const NO_REFIT_ENDPOINT_ANSWER = 'The refit-advisor endpoint did not answer for this snapshot.';

export const REFIT_FAILURE_ANSWER = 'The refit-advisor endpoint reported a failure for this snapshot.';

export const NOTHING_UNFIELDED = 'All researched components and ship hulls are currently in service across your fleet.';

export const NO_REFIT_CANDIDATES = 'No fielded ship designs were available for refit evaluation in this snapshot.';

export const NON_COMPOSABILITY_NOTICE = 'Drive performance numbers hold dry mass constant. Combining a drive '
  + 'swap with weapon or armour modifications changes ship dry mass, making combined performance uncomputable.';

export const REFIT_NOTICE = 'Drive figures hold dry mass constant. Combined drive + weapon + armour swaps '
  + 'yield uncomputable mass.';

/** The affordance defect #4's fabricated `1.0` used to stand in for. */
export const ARMOR_RATIO_UNMEASURED_TEXT = 'protection ratio unmeasured';

// ---------------------------------------------------------------------------
// FORMATTERS — absent stays absent
// ---------------------------------------------------------------------------

export function num(value) {
  if (value === null || value === undefined || value === '') return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

export function int(value) {
  const parsed = num(value);
  if (parsed === null) return UNAVAILABLE;
  return Math.round(parsed).toLocaleString('en-US');
}

export function dec(value, places = 1) {
  const parsed = num(value);
  return parsed === null ? UNAVAILABLE : parsed.toFixed(places);
}

/** "2.07×", "40.0×", "6.7M×". Absent stays absent — never "null×". */
export function mult(value) {
  const parsed = num(value);
  if (parsed === null) return UNAVAILABLE;
  const abs = Math.abs(parsed);
  if (abs >= 1e9) return `${(parsed / 1e9).toFixed(1)}B×`;
  if (abs >= 1e6) return `${(parsed / 1e6).toFixed(1)}M×`;
  if (abs >= 1000) return `${Math.round(parsed).toLocaleString('en-US')}×`;
  if (abs >= 10) return `${parsed.toFixed(1)}×`;
  return `${parsed.toFixed(2)}×`;
}

// ---------------------------------------------------------------------------
// ARMOUR
// ---------------------------------------------------------------------------

export function formatArmorName(armorId) {
  if (!armorId) return '';
  return ARMOR_DATA[armorId]?.displayName || String(armorId).replace(/([a-z])([A-Z])/g, '$1 $2');
}

/**
 * The threat-weighted protection score for one armour material, or `null`.
 *
 * REGISTER DEFECT #4. The vanilla returned a fabricated `1.0` for an id absent
 * from `ARMOR_DATA`, and `0` for an absent id. Both fed a division. `null` now
 * means "this material has no resistance figures here", and `armorComparison`
 * refuses to divide by it.
 */
export function armorScore(armorId, isWeighted = true) {
  if (!armorId) return null;
  const entry = ARMOR_DATA[armorId];
  if (!entry) return null;
  const xRayWeight = isWeighted ? 0.604 : 0.5;
  const baryonicWeight = isWeighted ? 0.396 : 0.5;
  return xRayWeight * entry.xRay + baryonicWeight * entry.baryonic;
}

/** Whether `armorScore` can price this id at all. */
export function isRatedArmor(armorId) {
  return Boolean(armorId) && Object.prototype.hasOwnProperty.call(ARMOR_DATA, armorId);
}

/**
 * How far behind the fitted armour is, or why that could not be measured.
 *
 * Returns `{ ratio, ratioText, measurable, unratedIds, missingIds, title }`.
 * `ratio` is `null` unless BOTH sides carry resistance figures — an unknown
 * material never produces a comparative claim.
 */
export function armorComparison(fittedId, recId, weighted = true) {
  const fittedScore = armorScore(fittedId, weighted);
  const recScore = armorScore(recId, weighted);

  const missingIds = [];
  const unratedIds = [];
  if (!fittedId) missingIds.push('fitted');
  else if (!isRatedArmor(fittedId)) unratedIds.push(String(fittedId));
  if (!recId) missingIds.push('recommended');
  else if (!isRatedArmor(recId)) unratedIds.push(String(recId));

  const measurable = fittedScore !== null && fittedScore > 0 && recScore !== null && recScore > 0;
  if (measurable) {
    const ratio = recScore / fittedScore;
    return {
      ratio,
      ratioText: `${dec(ratio, 1)}× behind`,
      measurable: true,
      unratedIds: [],
      missingIds: [],
      title: null,
    };
  }

  const reasons = [];
  if (unratedIds.length > 0) {
    reasons.push(`no X-ray or baryonic resistance is recorded here for ${unratedIds.join(' or ')}`);
  }
  if (missingIds.length > 0) {
    reasons.push(`the ${missingIds.join(' and ')} armour is not named on this design`);
  }
  const why = reasons.length > 0 ? reasons.join(', and ') : 'one side of the comparison could not be priced';

  return {
    ratio: null,
    ratioText: ARMOR_RATIO_UNMEASURED_TEXT,
    measurable: false,
    unratedIds,
    missingIds,
    title: `Armour protection could not be compared: ${why}. No ratio is shown rather than a fabricated `
      + 'one — this panel carries a fixed list of twelve materials and goes stale when the game adds another.',
  };
}

// ---------------------------------------------------------------------------
// PROCUREMENT
// ---------------------------------------------------------------------------

export function formatProcurementName(row) {
  const item = row.displayName ? String(row.displayName).trim() : 'unnamed candidate';
  const project = row.gateProjectName ? String(row.gateProjectName).trim() : null;

  return {
    lead: item,
    sub: null,
    tooltip: project ? `${item} — unlocked by ${project} (completed)` : item,
  };
}

/**
 * Which action a row describes.
 *
 * NOT FIXED HERE, AND NOT NEW: `row.action || (family === 'ship_hull' ? 'build'
 * : 'refit')` infers the verb when the payload does not state one, so an
 * unstated action renders as the confident word "refit". The live endpoint
 * always sets `action`, so this is latent rather than reachable today. It is
 * carried across deliberately — parity is the requirement of this migration and
 * the finding is reported rather than silently changed.
 */
export function procurementAction(row) {
  return row.action || ((row.context?.family === 'ship_hull' || row.classKey === 'ship_hull') ? 'build' : 'refit');
}

export function procurementRowModel(row) {
  const notes = [];
  if (row.closesDeficit === true) {
    notes.push({ key: 'deficit', className: 'ra-tag ra-tag--deficit', title: undefined, text: 'closes gap' });
  }
  if (row.clearsFloor === false) {
    notes.push({ key: 'floor', className: 'ra-tag ra-tag--warn', title: undefined, text: 'fails floor' });
  }
  if (row.clearsDeliveryFloor === false) {
    notes.push({ key: 'delivery-fail', className: 'ra-tag ra-tag--warn', title: DELIVERY_FAILS_TITLE, text: 'fails delivery' });
  } else if (row.clearsDeliveryFloor === null && row.context && row.context.delivery) {
    notes.push({ key: 'delivery-unknown', className: 'ra-tag', title: DELIVERY_UNKNOWN_TITLE, text: 'delivery unchecked' });
  }
  if (row.axisKind === RULE_SCALAR_KIND) {
    notes.push({ key: 'unitless', className: 'ra-tag ra-tag--unitless', title: RULE_SCALAR_TITLE, text: 'no unit' });
  }
  const duration = num(row.context && row.context.sustainedOutputDurationS);
  if (duration !== null) {
    notes.push({ key: 'duration', className: 'ra-tag', title: undefined, text: `${dec(duration, 0)}s of fire` });
  }

  return {
    name: formatProcurementName(row),
    axisTitle: row.axisBasis || row.axisLabel || '',
    axisLabel: row.axisLabel || 'unnamed axis',
    multipleText: mult(row.improvementMultiple),
    multiplePresent: num(row.improvementMultiple) !== null,
    metaText: procurementAction(row),
    notes,
  };
}

/**
 * The procurement half's whole state.
 *
 * `available: false` is the honest unavailable card — the endpoint did not
 * answer, so no ranking is shown rather than a placeholder one.
 *
 * NOT FIXED HERE, AND NOT NEW: `count` falls back to `items.length` when the
 * payload carries no count, which presents the page length as the total and
 * silently zeroes `omittedCount`. `shared/intel/researchRanking.mjs:1249` always
 * emits `count` beside `items`, so this is latent on the live endpoint. Carried
 * across for parity and reported.
 */
export function procurementView(payload) {
  if (!payload || payload.success === false || !payload.military) {
    return { available: false };
  }

  const procurement = payload.military.procurement;
  const items = (procurement && procurement.items) || [];
  const count = num(procurement && procurement.count) ?? items.length;
  const label = (procurement && procurement.label) || 'Already unlocked, not in service';

  if (items.length === 0) {
    return { available: true, empty: true, count: 0, countPresent: true, items: [], label };
  }

  const itemsShown = items.length;
  const omittedCount = Math.max(0, count - itemsShown);

  return {
    available: true,
    empty: false,
    count,
    countPresent: num(procurement && procurement.count) !== null,
    countText: int(count),
    label,
    items,
    itemsShown,
    omittedCount,
  };
}

export function procurementTruncationText({ shown, omitted }) {
  return `${int(shown)} shown · ${int(omitted)} omitted`;
}

// ---------------------------------------------------------------------------
// REFIT CARDS
// ---------------------------------------------------------------------------

export function roleBadge(role) {
  if (role === DESIGN_ROLES.warship) return { className: 'ra-tag ra-tag--deficit', text: 'WARSHIP' };
  if (role === DESIGN_ROLES.transport) return { className: 'ra-tag ra-tag--free', text: 'TRANSPORT' };
  return { className: 'ra-tag', text: 'UNKNOWN ROLE' };
}

/**
 * The four drive states, kept apart on purpose.
 *
 * `improved` / `already-fitted` / `fails-floor` / `unknown-floor` / `none`.
 * `unknown-floor` is NOT a pass: the baseline metrics were unmeasured, so the
 * floor could not be evaluated, and the card says exactly that.
 */
export function driveModel(design) {
  const base = design.baseline || {};
  const rec = design.recommendations || {};
  const driveRec = rec.drive;
  const fittedDriveId = base.drive?.driveId;
  const recDriveId = driveRec?.candidateDriveId || driveRec?.driveId;

  if (driveRec && driveRec.clearsFloor === true && recDriveId !== fittedDriveId) {
    return {
      state: 'improved',
      recName: driveRec.displayName || recDriveId,
      baseDeltaVText: dec(base.deltaVKps, 1),
      recDeltaVText: dec(driveRec.deltaVKps, 1),
      baseAccelText: dec(base.combatAccelerationMps2, 2),
      recAccelText: dec(driveRec.combatAccelerationMps2, 2),
      dryMassCaveat: driveRec.dryMassCaveat || null,
    };
  }
  if (driveRec && driveRec.clearsFloor === true && recDriveId === fittedDriveId) {
    return {
      state: 'already-fitted',
      fittedName: base.drive?.displayName || fittedDriveId || 'fitted drive',
    };
  }
  if (driveRec && driveRec.clearsFloor === false) {
    return {
      state: 'fails-floor',
      rejectedName: driveRec.displayName || recDriveId,
      floorReason: driveRec.floorReason || 'fails reach floor',
    };
  }
  if (driveRec && driveRec.clearsFloor === null) {
    return { state: 'unknown-floor' };
  }
  return { state: 'none', fittedName: base.drive?.displayName || 'drive' };
}

export function weaponModel(design) {
  const rec = design.recommendations || {};
  // Carried across, not introduced: `(rec.weapons || []).length` reads an absent
  // weapons array as zero upgrades and prints "Current armament optimal" — a
  // confident claim from an unread field. `buildRefitAdvisor` always emits the
  // array, so this is latent. Reported, not silently changed.
  const count = (rec.weapons || []).length;
  return { count, countText: int(count), hasUpgrades: count > 0 };
}

export function armorModel(design) {
  const rec = design.recommendations || {};
  const armorRec = rec.armor;
  if (!armorRec || !(armorRec.recommendedMaterial || armorRec.recommendedMaterialId)) return null;

  const fittedId = armorRec.currentArmor;
  const recId = armorRec.recommendedMaterialId || armorRec.recommendedMaterial;
  const fittedName = formatArmorName(fittedId) || fittedId || 'Fitted Armour';
  const recName = armorRec.recommendedMaterial || formatArmorName(recId) || recId;
  const isMatch = Boolean(fittedId && recId && (fittedId === recId || fittedName === recName));

  const threatBasisTitle = armorRec.threatBasis || (armorRec.weighted ? 'threat-weighted' : 'unweighted');
  const threatLabel = armorRec.weighted ? 'threat-weighted' : 'unweighted';

  if (isMatch) {
    return { state: 'match', fittedName, recName, threatBasisTitle, threatLabel };
  }

  const comparison = armorComparison(fittedId, recId, armorRec.weighted);
  const isObsolete = design.isObsolete === true;

  // The 2× threshold between amber (ra-tag--warn) and red (ra-tag--deficit) is a
  // presentation judgement for visual triage priority, not an in-game threshold.
  let badge = null;
  if (!isObsolete) {
    if (comparison.ratio === null) {
      // DEFECT #4. The vanilla scored an unrecognised material 1.0 and rendered
      // a confident "N× behind" from it. There is no number to show here.
      badge = {
        className: 'ra-tag',
        text: comparison.ratioText,
        title: comparison.title,
        measurable: false,
      };
    } else if (armorRec.weighted && comparison.ratio >= 2.0) {
      badge = { className: 'ra-tag ra-tag--deficit', text: comparison.ratioText, title: undefined, measurable: true };
    } else if (comparison.ratio > 1.0) {
      // Unweighted comparisons never raise the red badge: with no observable
      // alien loadout there is no threat mix to weight against.
      badge = { className: 'ra-tag ra-tag--warn', text: comparison.ratioText, title: undefined, measurable: true };
    }
  }

  return {
    state: 'mismatch',
    fittedName,
    recName,
    threatBasisTitle,
    threatLabel,
    ratio: comparison.ratio,
    badge,
  };
}

export function powerModel(design) {
  const powerInfo = design.budgets?.power;
  const factor = powerInfo?.thrustScalingFactor;
  // Preserved verbatim from the vanilla, including the `!== null` guard that
  // `undefined` passes: an absent factor then fails `< 1.0` and no badge is
  // shown, which is the correct outcome by accident rather than by design.
  const scaled = factor !== null && factor < 1.0;
  if (!scaled) return null;
  return {
    summary: powerInfo?.summary ?? '',
    percentText: dec(factor * 100, 0),
  };
}

export function refitCardModel(design) {
  const isObsolete = design.isObsolete === true;
  return {
    designId: design.designId,
    displayName: design.displayName || design.designId,
    hull: design.hull || 'Hull',
    isObsolete,
    role: roleBadge(design.role),
    drive: driveModel(design),
    weapons: weaponModel(design),
    armor: armorModel(design),
    power: powerModel(design),
  };
}

/** Active designs first, retired ones demoted, order otherwise preserved. */
export function sortRefitItems(refitItems) {
  const active = refitItems.filter(item => item.isObsolete !== true);
  const obsolete = refitItems.filter(item => item.isObsolete === true);
  return [...active, ...obsolete];
}

/**
 * Three refit states the panel must keep apart — a dead endpoint, an explicit
 * failure, and a measured-empty candidate list are not interchangeable.
 *
 * REGISTER DEFECT #20. The vanilla collapsed all three into `refitsRenderable`
 * and rendered nothing for each, beside a procurement half that reported its own
 * fetch failures. `unavailable` and `failed` now carry the same affordance
 * vocabulary as `procurementView`'s `available: false` branch.
 */
export function refitView(refits) {
  if (refits == null) {
    return {
      state: 'unavailable',
      headline: REFIT_UNAVAILABLE_HEADLINE,
      detail: NO_REFIT_ENDPOINT_ANSWER,
    };
  }

  if (refits.success === false) {
    const reason = typeof refits.error === 'string' ? refits.error.trim() : '';
    return {
      state: 'failed',
      headline: REFIT_UNAVAILABLE_HEADLINE,
      detail: reason || REFIT_FAILURE_ANSWER,
    };
  }

  const refitItems = refits.items || [];
  if (refitItems.length === 0) {
    return {
      state: 'empty',
      count: num(refits.count) ?? 0,
      refitItems,
    };
  }

  return {
    state: 'ready',
    count: num(refits.count) ?? refitItems.length,
    refitItems,
  };
}

/**
 * Normalises the two shapes `render` is called with.
 *
 * mission-control.js hands over `{ procurement, refit, military }` from
 * `fetchProcurement`; the ported tests hand a bare research-ranking payload and
 * a separate refit payload.
 */
export function normalizePayload(payload, refitPayload = null) {
  const procurementPayload = payload?.procurement ? payload.procurement : payload;
  const refits = refitPayload ?? payload?.refit ?? null;
  const refit = refitView(refits);
  return { procurementPayload, refits, refit };
}

// ---------------------------------------------------------------------------
// DETAIL PANEL
// ---------------------------------------------------------------------------

export function procurementFacts(payload) {
  const facts = [];
  const items = (payload?.military?.procurement?.items) || [];
  for (const row of items) {
    const delivery = (row.context && row.context.delivery) || null;
    const deliveryText = delivery
      ? ` · ${dec(delivery.shotsPerArrivingRound, 1)} PD shots per arriving round`
        + (num(delivery.flightTimeS) === null ? '' : `, ${dec(delivery.flightTimeS, 0)}s flight`)
        + (num(delivery.terminalSpeedKps) === null ? '' : ` at ${dec(delivery.terminalSpeedKps, 1)} km/s`)
      : '';
    const action = procurementAction(row);
    const projectTooltip = row.gateProjectName ? ` · unlocked by ${row.gateProjectName}` : '';
    facts.push({
      label: `PROCUREMENT · Already unlocked · ${row.displayName || 'unnamed candidate'}`,
      value: `${mult(row.improvementMultiple)} ${row.axisLabel || 'unnamed axis'} · ${action}${projectTooltip}`
        + (row.closesDeficit ? ' · closes the measured gap' : '')
        + (row.clearsFloor === false ? ' · fails its floor' : '')
        + deliveryText
        + (row.clearsDeliveryFloor === false ? ' · fails its delivery floor' : '')
        + (row.clearsDeliveryFloor === null && delivery ? ' · delivery floor could not be evaluated' : ''),
    });
  }

  if (facts.length === 0) {
    facts.push({
      label: 'No unfielded procurement items',
      value: 'All unlocked military technologies in this save are currently in service or have no measured upgrade candidate.',
    });
  }

  return facts;
}

export function procurementPanelOptions(payload) {
  return {
    eyebrow: 'FLEET PROCUREMENT',
    title: 'Already Unlocked, Not in Service',
    summary: 'Procurement decisions ready for immediate shipyard order or ship refit. '
      + 'These components cost zero additional research points and are fittable immediately. '
      + 'Ranked internally by improvement multiple over what you currently field.',
    facts: procurementFacts(payload),
    actions: [{ label: 'Close' }],
  };
}

export function refitFacts(designRow) {
  const facts = [];
  const base = designRow.baseline || {};
  const rec = designRow.recommendations || {};
  const budgets = designRow.budgets || {};

  facts.push({
    label: 'INFERRED ROLE',
    value: `${String(designRow.role).toUpperCase()} · ${designRow.roleBasis || 'Structural inference'}`,
  });

  if (designRow.isObsolete === true) {
    facts.push({ label: 'DESIGN STATUS', value: 'Marked obsolete by player · demoted in fleet recommendations' });
  } else if (designRow.isObsolete === false) {
    facts.push({ label: 'DESIGN STATUS', value: 'Active design in service' });
  } else if (designRow.isObsolete === null) {
    facts.push({ label: 'DESIGN STATUS', value: 'Obsolete status unknown (not recorded in save)' });
  }

  facts.push({
    label: 'BASELINE FITTING',
    value: `Drive: ${base.drive?.displayName || base.drive?.driveId || UNAVAILABLE} · ΔV: ${dec(base.deltaVKps, 1)} km/s · Combat Accel: ${dec(base.combatAccelerationMps2, 3)} m/s²`,
  });

  const fittedDriveId = base.drive?.driveId;
  const recDriveId = rec.drive?.candidateDriveId || rec.drive?.driveId;

  if (rec.drive && rec.drive.clearsFloor === true && recDriveId !== fittedDriveId) {
    facts.push({
      label: 'DRIVE SWAP (ASSUMES CURRENT WEAPONS & ARMOUR)',
      value: `→ ${rec.drive.displayName || recDriveId}: ΔV ${dec(base.deltaVKps, 1)} → ${dec(rec.drive.deltaVKps, 1)} km/s, Combat Accel ${dec(base.combatAccelerationMps2, 3)} → ${dec(rec.drive.combatAccelerationMps2, 3)} m/s²`
        + (rec.drive.dryMassCaveat ? ` (${rec.drive.dryMassCaveat})` : ''),
    });
  } else if (rec.drive && rec.drive.clearsFloor === true && recDriveId === fittedDriveId) {
    facts.push({
      label: 'DRIVE SWAP',
      value: `Best available drive already fitted (${base.drive?.displayName || fittedDriveId || 'fitted drive'}).`,
    });
  } else if (rec.drive && rec.drive.clearsFloor === false) {
    facts.push({
      label: 'DRIVE SWAP',
      value: `No available drive improves this design without unacceptable ΔV loss. Rejected alternative: ${rec.drive.displayName || recDriveId} (fails floor · ${rec.drive.floorReason || 'fails reach floor'})`,
    });
  } else if (rec.drive && rec.drive.clearsFloor === null) {
    facts.push({
      label: 'DRIVE SWAP',
      value: 'Drive refit reach floor unknown; baseline ship metrics are unmeasured in this snapshot.',
    });
  } else {
    facts.push({
      label: 'DRIVE SWAP',
      value: 'No unlocked drive candidate improves on the fitted drive under the role metric without failing the reach floor.',
    });
  }

  if (rec.weapons && rec.weapons.length > 0) {
    for (const w of rec.weapons) {
      facts.push({
        label: `WEAPON UPGRADE · ${String(w.slot).toUpperCase()} HARDPOINT`,
        value: `${w.rationale} (Performance impact unknown due to unpinned mass model)`,
      });
    }
  } else {
    facts.push({
      label: 'WEAPON UPGRADES',
      value: 'Fitted weapons match or exceed all available researchable/ungated options within hardpoint capacity.',
    });
  }

  if (rec.armor) {
    const fittedId = rec.armor.currentArmor;
    const recId = rec.armor.recommendedMaterialId || rec.armor.recommendedMaterial;
    const fittedName = formatArmorName(fittedId) || fittedId || 'Fitted Armour';
    const recName = rec.armor.recommendedMaterial || formatArmorName(recId) || recId;
    const isMatch = fittedId && recId && (fittedId === recId || fittedName === recName);
    const armorValue = isMatch
      ? `Best available armour already fitted: ${recName} · ${rec.armor.threatBasis}`
      : `${fittedName} → ${recName} · ${rec.armor.threatBasis} (Performance impact unknown due to mass changes)`;

    facts.push({ label: 'ARMOUR RECOMMENDATION', value: armorValue });
  }

  if (budgets.power) {
    facts.push({
      label: 'POWER BUDGET (INFORMATIONAL)',
      value: budgets.power.summary || 'Power evaluated',
    });
  }

  facts.push({ label: 'NON-COMPOSABILITY NOTICE', value: NON_COMPOSABILITY_NOTICE });

  return facts;
}

export function refitPanelOptions(designRow) {
  return {
    eyebrow: 'VALIDATED REFIT ADVISOR',
    title: `${designRow.displayName || designRow.designId} Refit Specification`,
    summary: `Refit analysis for ${designRow.displayName || designRow.designId} (${designRow.hull || 'Standard Hull'}). Holds hull geometry and evaluates drive, weapons, and armour against observed fleet data.`,
    facts: refitFacts(designRow),
    actions: [{ label: 'Close' }],
  };
}

/**
 * The shared detail overlay, resolved at call time.
 *
 * `public/v2/js/components/detail-panel.js` is migrating concurrently and the
 * React bridge takes over the same `window.MissionControlDetailPanel` name, so
 * this reads the global on every call rather than capturing it — and takes an
 * explicit `panel` argument so a test can hand in its own recorder.
 */
function resolveDetailPanel(panel) {
  if (panel) return panel;
  if (typeof globalThis === 'undefined') return null;
  return globalThis.MissionControlDetailPanel
    || (globalThis.window && globalThis.window.MissionControlDetailPanel)
    || null;
}

export function openProcurementDetails(payload, panel) {
  const target = resolveDetailPanel(panel);
  if (!target || typeof target.open !== 'function') return;
  target.open(procurementPanelOptions(payload));
}

export function openRefitDetails(designRow, panel) {
  const target = resolveDetailPanel(panel);
  if (!target || typeof target.open !== 'function' || !designRow) return;
  target.open(refitPanelOptions(designRow));
}

// ---------------------------------------------------------------------------
// FETCH
// ---------------------------------------------------------------------------

/**
 * Both endpoints, in parallel.
 *
 * A non-ok response becomes `null` rather than a partial object, and a thrown
 * fetch becomes `null` for the whole panel — which renders the honest
 * unavailable card. Never a placeholder ranking.
 */
export async function fetchProcurement(observerId, mode) {
  const observer = encodeURIComponent(String(observerId));
  const intelMode = encodeURIComponent(String(mode));
  try {
    const [procurementRes, refitRes] = await Promise.all([
      fetch(`/api/intel/research-ranking?observer=${observer}&mode=${intelMode}&detail=full`),
      fetch(`/api/intel/refit-advisor?observer=${observer}&mode=${intelMode}&detail=full`),
    ]);
    const procurement = procurementRes.ok ? await procurementRes.json() : null;
    const refit = refitRes.ok ? await refitRes.json() : null;
    return { procurement, refit, military: procurement?.military || null };
  } catch (err) {
    console.warn('[FleetProcurement] Failed to fetch fleet procurement or refit data:', err);
    return null;
  }
}
