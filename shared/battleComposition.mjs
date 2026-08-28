// shared/battleComposition.mjs
//
// Purpose: phase 0 + phase 1 of docs/engagement-matchup-spec.md — the weapon
//   template join and the per-side battle composition the Battle tab reasons
//   over. The spec abandons combat value: the matchup question is whether one
//   side's salvo overwhelms the other side's point defence, and everything here
//   is a reading that makes that question answerable. Pure ESM, no Node
//   built-ins — this runs in the Cloudflare worker like its siblings under
//   `shared/`, so template data is PASSED IN (`buildWeaponIndex`) rather than
//   read from disk.
//
// ---------------------------------------------------------------------------
// THE JOIN — TWO FAULTS, BOTH MEASURED 2026-08-27 ON ExitSave.gz
// ---------------------------------------------------------------------------
//
// Weapon systems in the save do not name templates exactly, and both faults
// silently discard real weapons:
//
//   1. THE SAVE INSERTS WARHEAD QUALIFIERS. `SidewinderShapedNuclearMissileBay`
//      (the save's `moduleTemplateName`) is `Sidewinder Nuclear Missile Bay` in
//      TIMissileTemplate.json. Normalising by stripping the word `Shaped`
//      (case-insensitive, whitespace-collapsed) resolved 32 of 207 observer
//      missile mounts.
//   2. TORPEDO BAYS CARRY NO `salvo_shots` FIELD AT ALL. Acheron Nuclear
//      Torpedo Bay, Tartarus Nuclear Torpedo Bay and Apollo Torpedo Bay have
//      `salvo_shots` absent on the installed templates. Absent means ONE shot,
//      not zero and not unresolved — treating it as unresolved discarded 175 of
//      207 of the observer's missile mounts, under-counting his own fleet by
//      85%. This is the "absent stays null" trap INVERTED: the game means a
//      default here. The index preserves the absence (`salvoShots: null`) and
//      the composition applies `SALVO_SHOTS_WHEN_ABSENT`, reporting the count
//      of mounts that took the assumed value (`salvoShotsAssumedMounts`) so the
//      interpretation is on the output, never silent.
//
// After both fixes the observer resolves 207 of 207 missile mounts and the
// aliens 485 of 485. The module still reports its join rate and marks a
// composition `complete: false` when anything did not resolve — under-counting
// weapons is the dangerous direction, and a verdict built on an incomplete
// join refuses rather than averaging.
//
// ---------------------------------------------------------------------------
// THE TAXONOMY — THE GAME'S FIELD IS THE SOURCE OF TRUTH
// ---------------------------------------------------------------------------
//
// | family           | file                        | PD-targetable |
// | :--              | :--                         | :--           |
// | Missile          | TIMissileTemplate.json (57) | all 57        |
// | Magnetic gun     | TIMagneticGunTemplate.json  | all 70        |
// | Laser            | TILaserWeaponTemplate.json  | none          |
// | Particle         | TIParticleWeaponTemplate    | none          |
// | Plasma           | TIPlasmaWeaponTemplate.json | none          |
//
// That table is the FALLBACK only. `pdTargetableShots` reads each resolved
// template's OWN `isPointDefenseTargetable` — the game's field — and the table
// classifies a system only when it did not resolve, in which case the
// composition says so (`tableFallbackUsed`). The table is NOT exactly the
// family list above: measured 2026-08-27, the field says `gun` is mixed (4 of
// 8) and the observer's `40mm Autocannon` mounts (33 of them) are NOT
// interceptable — an unguided slug — so they are excluded from
// `pdTargetableShots` and reported in `notPdTargetableMounts` instead of
// vanishing. See the divergence note in scripts/verify_battle_composition.js:
// the engagement-matchup-spec's expected table (505 observer shots) counts
// every kinetic mount; the field-true reading is 472, and the 33-mount gap is
// exactly the autocannons.
//
// POINT DEFENCE IS A ROLE, NOT A CATEGORY. A mount can be PD by role while its
// category is Laser ("Alien Point Defense Laser Turret"): loadout entries with
// `role === 'Point Defense'` are the screen, whatever family they belong to.
// PD-role beams are counted in `pointDefenceMounts`, never in
// `pdImmuneWeapons` — on ExitSave.gz the observer's 57 "PD-immune" weapons are
// its 305 beam mounts minus its 248 PD-role beams, exactly.
//
// ---------------------------------------------------------------------------
// THE SATURATION VERDICT — TWO THINGS IT MUST NOT DO
// ---------------------------------------------------------------------------
//
// `saturationVerdict` compares the attacker's `pdTargetableShots` against
// `defender.pointDefenceMounts * pdShotsPerMount`. The default multiple is
// `PD_OVERWHELM_MULTIPLE`, a NAMED, REPLACEABLE constant carrying the user's
// attribution and the date — it is a player heuristic, not a measured mechanic,
// and the verdict says so on its output.
//
// It rests on an assumption that is carried on every verdict: one PD mount
// neutralises roughly one incoming shot per exchange. The interception rule is
// NOT in TISpaceCombatTemplate.json — that file is a single RedBlueSpaceCombat
// test scenario with `active: false` (measured 2026-08-27) — so if a mount
// intercepts more than one shot, every shortfall reported here is understated.
//
// And it never folds `pdImmuneWeapons` into the saturation figure. PD-immune
// weapons are the count that ignores the whole question; averaging them in
// would hide exactly the case that kills you (a fleet whose salvo is
// untargetable defeats any amount of point defence). They are reported beside
// the verdict, never inside it.
//
// THE 40-SHIP CAP. The user stated (2026-08-27) that max battle size is 40
// ships per side, so a 60 v 50 engagement resolves in waves and the first 40
// are the decision. `MAX_BATTLE_SIDE_SHIPS` is exported with its attribution
// for the Battle tab to slice with; `composeBattleSide` itself composes
// whatever list it is given, whole — the verify script exercises whole-board
// compositions and the cap is the caller's slicing constant.

import { toFiniteNumber, round, asArray } from './util.mjs';

/**
 * Max battle size per side, stated by the user (who plays the game),
 * 2026-08-27. NOT in the templates — cited as his, not as measured. A larger
 * engagement resolves in waves; the composition of the first `MAX_BATTLE_SIDE_SHIPS`
 * is the decision. The Battle tab slices with this; `composeBattleSide` itself
 * composes the full list it is given.
 */
export const MAX_BATTLE_SIDE_SHIPS = 40;

/** Attribution for `MAX_BATTLE_SIDE_SHIPS`, carried so the cap is never a bare number. */
export const MAX_BATTLE_SIDE_SHIPS_ATTRIBUTION = Object.freeze({
  source: 'the user, who plays the game',
  stated: '2026-08-27',
  claim: 'max battle size is 40 ships per side; a 60 v 50 engagement therefore resolves in waves',
  measured: false,
  inTemplates: false
});

/**
 * The user's saturation rule of thumb, stated 2026-08-27: 2x the defender's
 * point-defence mounts is a safe bet to overwhelm the screen. A PLAYER
 * HEURISTIC, not a measured mechanic — replaceable, and every verdict carries
 * this attribution on its output.
 */
export const PD_OVERWHELM_MULTIPLE = 2;

/** Attribution for `PD_OVERWHELM_MULTIPLE`, carried so the multiple is never a magic number. */
export const PD_OVERWHELM_RULE_ATTRIBUTION = Object.freeze({
  source: 'the user, who plays the game',
  stated: '2026-08-27',
  claim: '2x the defender\'s point-defence mounts is a safe bet to overwhelm the screen',
  measured: false
});

/**
 * Shots per missile mount when the template states no `salvo_shots`. The
 * torpedo bays (Acheron, Tartarus, Apollo, ...) carry no field at all on the
 * installed templates — absent means one shot, not zero and not unresolved
 * (measured 2026-08-27: treating it as unresolved discarded 175 of 207 of the
 * observer's missile mounts). This is the ONE place an absent field is read as
 * a game default; the composition reports how many mounts took it
 * (`salvoShotsAssumedMounts`).
 */
export const SALVO_SHOTS_WHEN_ABSENT = 1;

/**
 * The interception assumption every saturation verdict rests on. Carried on the
 * output, not buried in a comment: it is an assumption, and the direction of
 * its error is stated.
 */
export const INTERCEPTION_ASSUMPTION = Object.freeze({
  claim: 'one point-defence mount neutralises roughly one incoming shot per exchange',
  verified: false,
  whyNotVerified: 'the interception rule is not in TISpaceCombatTemplate.json, which is a RedBlueSpaceCombat test scenario with active: false',
  consequence: 'if a mount intercepts more than one shot, every shortfall this verdict reports is understated'
});

/**
 * The family taxonomy as a fallback table, used ONLY when a system did not
 * resolve (the game's `isPointDefenseTargetable` field is the source of truth
 * for resolved systems). `gun` is `null` — mixed on the installed templates (4
 * of 8) — so an unresolved gun-category system cannot be classified by the
 * table and stays unresolved rather than being guessed either way.
 */
export const PD_TARGETABLE_FAMILY_FALLBACK = Object.freeze({
  missile: true,
  magnetic_gun: true,
  gun: null,
  laser_weapon: false,
  particle_weapon: false,
  plasma_weapon: false
});

/**
 * Normalise a weapon name for the template join: whitespace-collapse, lowercase,
 * and strip the word `Shaped` (the save inserts warhead qualifiers the templates
 * do not carry — `SidewinderShapedNuclearMissileBay` vs
 * `Sidewinder Nuclear Missile Bay`). Both sides of the join go through this, so
 * the save form and the template form land on the same key.
 */
export function normalizeWeaponName(name) {
  const collapsed = String(name ?? '').replace(/\s+/g, ' ').trim().toLowerCase();
  // Whole-word only: `ShapedNuclear` must not become `Nuclear` inside a name
  // that legitimately contains "shaped" as part of another token.
  return collapsed.replace(/\bshaped\b/g, '').replace(/\s+/g, ' ').trim();
}

/**
 * Build the normalised weapon index from the installed template records.
 *
 * @param {Iterable<object>} templates — weapon template records in the shape
 *   `server/templateLoader.js` builds (`templateFamily`, `category`, `role`,
 *   `dataName`, `friendlyName`, `displayName`, `salvo_shots`,
 *   `isPointDefenseTargetable`). The loader's records carry `templateFamily`
 *   because `category` alone cannot separate magnetic guns from guns; a record
 *   without it is skipped and counted (`unclassifiedTemplates`) rather than
 *   silently misclassified.
 * @returns {{ lookup: Map<string, object>, templateCount: number,
 *   ambiguousNormalizedNames: string[], unclassifiedTemplates: number }} —
 *   `lookup` maps `normalizeWeaponName(name)` for every name variant
 *   (displayName, friendlyName, dataName) to an entry:
 *   `{ id, displayName, family, category, role, salvoShots, pdTargetable }`.
 *   `salvoShots` is null when the template states none — absence preserved, the
 *   `SALVO_SHOTS_WHEN_ABSENT` interpretation happens at composition time.
 *
 * NAME FORMS, AND WHY DISPLAY NAMES WIN. The loadout's `systems` entries are
 * DISPLAY names (that is what `server/snapshot/space.js:buildWeaponLoadout`
 * writes, and what the save's own loadouts carry), while the save's raw
 * `moduleTemplateName` is a DATA name — so the index keys both. The two forms
 * are not equal citizens: the game localises some entries onto a label another
 * entry already claims as its own friendlyName (measured 2026-08-27: Gen3
 * Alien Light Mag Battery displays as "Advanced Alien Light Mag Battery",
 * which is ALSO the Advanced tier's friendlyName). A loadout carrying
 * "Advanced Alien Light Mag Battery" means the Gen3 — the record whose DISPLAY
 * name that is. So display names register FIRST and shadow the secondary
 * (friendlyName/dataName) forms; a secondary registers only where its key is
 * still unclaimed. A genuine ambiguity is two different templates claiming the
 * same PRIMARY key, and only that drops the key into
 * `ambiguousNormalizedNames`.
 */
export function buildWeaponIndex(templates) {
  const lookup = new Map();
  const ambiguousNormalizedNames = [];
  let templateCount = 0;
  let unclassifiedTemplates = 0;
  const byDisplayKey = new Map();
  const byRecord = [];
  const primaryKeys = new Set();

  for (const record of asArray(templates)) {
    if (!record || typeof record !== 'object') continue;
    const family = record.templateFamily;
    if (typeof family !== 'string' || family === '') {
      unclassifiedTemplates += 1;
      continue;
    }
    templateCount += 1;

    const entry = {
      id: record.dataName ?? null,
      displayName: record.displayName ?? record.friendlyName ?? record.dataName ?? null,
      family,
      category: record.category ?? null,
      role: record.role ?? null,
      // Absent stays null in the index: `salvo_shots` is the one field the game
      // means as a default when absent, and that interpretation is applied at
      // composition time with a visible count, not buried here.
      salvoShots: toFiniteNumber(record.salvo_shots),
      pdTargetable: record.isPointDefenseTargetable === true
    };
    byDisplayKey.set(entry, normalizeWeaponName(entry.displayName));
    byRecord.push({ record, entry });
  }

  // Pass 1 — primary keys (display names), the names loadouts carry.
  for (const [entry, displayKey] of byDisplayKey) {
    if (displayKey === '') continue;
    const existing = lookup.get(displayKey);
    if (!existing) {
      lookup.set(displayKey, entry);
      primaryKeys.add(displayKey);
    } else if (existing.id !== entry.id) {
      // The same display name on two different templates is a genuine
      // ambiguity: the join would be a guess, so the key is dropped and the
      // collision reported. (Distinct names inside one file cannot collide
      // here — the loader already refused ambiguous localised names.)
      if (!ambiguousNormalizedNames.includes(displayKey)) ambiguousNormalizedNames.push(displayKey);
      lookup.delete(displayKey);
    }
  }

  // Pass 2 — secondary keys (friendlyName, dataName), for raw-save names.
  // A secondary that collides with a PRIMARY is SHADOWED, not ambiguous: the
  // display name is what the loadout says, so the primary owns the key (Gen3
  // Alien Light Mag Battery displays as "Advanced Alien Light Mag Battery",
  // which is also the Advanced tier's friendlyName — the loadout means the
  // Gen3). Only a secondary colliding with another secondary is genuinely
  // ambiguous (the raw-save name could mean either) and is dropped.
  for (const { record, entry } of byRecord) {
    const displayKey = byDisplayKey.get(entry);
    for (const variant of new Set([record.friendlyName, record.dataName].filter(Boolean))) {
      const key = normalizeWeaponName(variant);
      if (key === '' || key === displayKey) continue;
      const existing = lookup.get(key);
      if (!existing) {
        lookup.set(key, entry);
      } else if (existing.id !== entry.id && !primaryKeys.has(key)) {
        if (!ambiguousNormalizedNames.includes(key)) ambiguousNormalizedNames.push(key);
        lookup.delete(key);
      }
      // `existing.id === entry.id`: the record's own variant is already the
      // mapped entry — nothing to do. `primaryKeys.has(key)`: shadowed by a
      // display name — the primary wins and the key stays.
    }
  }

  return {
    lookup,
    templateCount,
    ambiguousNormalizedNames,
    unclassifiedTemplates
  };
}

/** Median of a numeric array; null when empty. Absent stays null. */
function medianOf(values) {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2
    ? sorted[middle]
    : (sorted[middle - 1] + sorted[middle]) / 2;
}

/**
 * Compose one battle side from a list of ships.
 *
 * @param {object[]} ships — ships with `weaponLoadout` (entries
 *   `{ role, category, count, systems: string[] }`, the shape
 *   `server/snapshot/space.js:buildWeaponLoadout` produces) and `armorMedian`
 *   (the snapshot's per-ship median armour; absent stays null).
 * @param {{ lookup: Map<string, object> }} options.weaponIndex — the output of
 *   `buildWeaponIndex`.
 *
 * The loadout's `count` is MOUNT INSTANCES at the group's role; `systems` lists
 * the distinct systems inside the group, and a group can carry several. When a
 * group has exactly one system the attribution is exact (every mount is that
 * system). When it has several, the loadout does not state how the mounts
 * divide, so the composition splits `count` evenly per system and reports
 * `proportionalAttribution: true` — an assumption on the output, never silent.
 * The verify script feeds per-system groups, so the live-save numbers are exact.
 *
 * @returns {object} the composition block:
 *   `ships`, `pointDefenceMounts`, `pdTargetableShots`, `missileShots`,
 *   `kineticMounts`, `pdImmuneWeapons`, `notPdTargetableMounts`, `byCategory`,
 *   `armorMedian`, `join`, `complete`, `salvoShotsAssumedMounts`,
 *   `proportionalAttribution`, `tableFallbackUsed`.
 *
 *   `join` = `{ resolved, unresolved, rate, unresolvedSystems }` over
 *   group-system references (one per distinct system per group — a name either
 *   resolves or not, and every mount of a resolved name is resolved). `rate` is
 *   null when the side fields no weapon systems at all. `complete` is
 *   `unresolved === 0`; a verdict built on an incomplete side refuses.
 */
export function composeBattleSide(ships, { weaponIndex }) {
  const lookup = weaponIndex?.lookup ?? new Map();

  const side = {
    ships: asArray(ships).length,
    pointDefenceMounts: 0,
    pdTargetableShots: 0,
    missileShots: 0,
    kineticMounts: 0,
    pdImmuneWeapons: 0,
    // Resolved mounts the game marks NOT interceptable outside the beam
    // families (measured: the observer's 40mm Autocannon, family `gun`,
    // `isPointDefenseTargetable: false`). Excluded from `pdTargetableShots`
    // because the game field says so, and reported here so they do not vanish.
    notPdTargetableMounts: 0,
    byCategory: {},
    armorMedian: null,
    join: {
      resolved: 0,
      unresolved: 0,
      rate: null,
      unresolvedSystems: []
    },
    complete: false,
    salvoShotsAssumedMounts: 0,
    proportionalAttribution: false,
    tableFallbackUsed: false
  };

  const shipArmorMedians = [];
  const unresolvedNames = new Set();

  for (const ship of asArray(ships)) {
    const armorMedian = toFiniteNumber(ship?.armorMedian);
    if (armorMedian !== null) shipArmorMedians.push(armorMedian);

    for (const group of asArray(ship?.weaponLoadout)) {
      const systems = asArray(group?.systems);
      if (systems.length === 0) continue;

      const mounts = toFiniteNumber(group?.count);
      // A group without a usable count is malformed, not a measurement of zero
      // mounts: fall back to one mount per distinct system and say nothing
      // changed, because no real group on the live save exercises this.
      const usableCount = mounts !== null && mounts > 0 ? mounts : systems.length;
      const perSystem = systems.length === 1 ? usableCount : usableCount / systems.length;
      if (systems.length > 1) side.proportionalAttribution = true;

      for (const systemName of systems) {
        if (typeof systemName !== 'string' || systemName === '') continue;
        const entry = lookup.get(normalizeWeaponName(systemName));

        if (!entry) {
          side.join.unresolved += 1;
          unresolvedNames.add(systemName);
          classifyUnresolved(side, group, perSystem);
          continue;
        }
        side.join.resolved += 1;
        classifyResolved(side, entry, perSystem);
      }
    }
  }

  const attempts = side.join.resolved + side.join.unresolved;
  side.join.rate = attempts === 0 ? null : side.join.resolved / attempts;
  side.join.unresolvedSystems = [...unresolvedNames].sort((a, b) => a.localeCompare(b));
  side.complete = side.join.unresolved === 0;
  side.armorMedian = shipArmorMedians.length === 0
    ? null
    : round(medianOf(shipArmorMedians), 2);

  return side;
}

/**
 * One resolved system's contribution. Classification is per TEMPLATE — family
 * and the game's own `isPointDefenseTargetable` — not per group label, which is
 * exactly how the live-save measurements were taken.
 */
function classifyResolved(side, entry, mounts) {
  // `byCategory` counts EVERY resolved mount, point-defence role included —
  // the PD screen is still a laser or particle battery on the category axis.
  const category = entry.category ?? null;
  if (category !== null) {
    side.byCategory[category] = (side.byCategory[category] ?? 0) + mounts;
  }

  if (entry.role === 'Point Defense') {
    // The screen is a ROLE, not a category (a mount can be PD by role while
    // its category is Laser). A PD-role beam is counted here, never below as
    // an immune weapon.
    side.pointDefenceMounts += mounts;
    return;
  }

  if (entry.family === 'missile') {
    // Absent stays null in the index; HERE the game means a default (torpedo
    // bays ship no `salvo_shots`), and the interpretation is counted so it is
    // visible on the output.
    const salvo = entry.salvoShots === null ? SALVO_SHOTS_WHEN_ABSENT : entry.salvoShots;
    if (entry.salvoShots === null) side.salvoShotsAssumedMounts += mounts;
    side.missileShots += salvo * mounts;
    if (entry.pdTargetable) side.pdTargetableShots += salvo * mounts;
    return;
  }

  if (entry.family === 'magnetic_gun' || entry.family === 'gun') {
    side.kineticMounts += mounts;
    // The game's own field decides whether the rounds can be intercepted at
    // all. `gun` is mixed (4 of 8 targetable, measured): the 40mm Autocannon is
    // NOT interceptable and is reported separately rather than folded in.
    if (entry.pdTargetable) {
      side.pdTargetableShots += mounts;
    } else {
      side.notPdTargetableMounts += mounts;
    }
    return;
  }

  if (isBeamFamily(entry.family)) {
    // Beams bypass point defence entirely (the game marks none of them
    // targetable). Never folded into `pdTargetableShots`.
    side.pdImmuneWeapons += mounts;
    if (entry.pdTargetable) side.pdTargetableShots += mounts;
    return;
  }

  // A family this module does not classify (none on the installed templates):
  // the mount is not dropped — it lands in `byCategory` above, and the side is
  // reported through the join/complete machinery if anything else unresolved.
}

/**
 * The table fallback for a system that did not resolve. The loadout group's own
 * `category` is the only handle left, and the fallback is flagged
 * (`tableFallbackUsed`) — the game's field is the source of truth and this is
 * the documented second choice.
 */
function classifyUnresolved(side, group, mounts) {
  side.tableFallbackUsed = true;
  const category = String(group?.category ?? '').toLowerCase();
  if (category === 'missile') {
    side.byCategory['Missile'] = (side.byCategory['Missile'] ?? 0) + mounts;
    // Salvo unknown for an unresolved missile — count the mount as one shot so
    // it is neither dropped nor dressed up as a confident salvo.
    side.missileShots += SALVO_SHOTS_WHEN_ABSENT * mounts;
    side.salvoShotsAssumedMounts += mounts;
    side.pdTargetableShots += mounts;
  } else if (category === 'kinetic') {
    side.byCategory['Kinetic'] = (side.byCategory['Kinetic'] ?? 0) + mounts;
    // `gun` is mixed on the installed templates, so an unresolved kinetic can
    // be either — the conservative reading for the attacker is that it IS
    // interceptable (over-stating the screen's workload), and it is flagged via
    // `tableFallbackUsed` rather than presented as measured.
    side.kineticMounts += mounts;
    side.pdTargetableShots += mounts;
  } else if (category === 'laser' || category === 'particle' || category === 'plasma') {
    const label = category.charAt(0).toUpperCase() + category.slice(1);
    side.byCategory[label] = (side.byCategory[label] ?? 0) + mounts;
    side.pdImmuneWeapons += mounts;
  } else {
    // Unknown category: the mount stays visible in `unresolvedSystems` and the
    // side is `complete: false`, so no consumer reasons over it silently.
  }
}

/** Laser, particle or plasma — the families nothing intercepts. */
function isBeamFamily(family) {
  return family === 'laser_weapon' || family === 'particle_weapon' || family === 'plasma_weapon';
}

/**
 * The saturation verdict: can the attacker's targetable salvo get through the
 * defender's point-defence screen?
 *
 * The user's rule (2x the defender's PD mounts is a safe bet to overwhelm the
 * screen) is encoded as the named, replaceable `PD_OVERWHELM_MULTIPLE` constant
 * and carried on the output with its attribution — a player heuristic, not a
 * measured mechanic. The verdict rests on `INTERCEPTION_ASSUMPTION` (one PD
 * mount neutralises roughly one incoming shot per exchange), which is carried
 * on the output, unverified, with the direction of its error stated.
 *
 * REFUSAL: a verdict on a side whose weapon join is incomplete refuses — an
 * unresolved system means the counts under-state weapons, and averaging over
 * them is the defect this module exists to prevent. The refusal names the side
 * and returns nulls, never numbers dressed up as measurements.
 *
 * PD-immune weapons are NEVER folded into the saturation figure. They are the
 * count that ignores the whole question, and they are reported beside the
 * verdict.
 *
 * @returns {object} `{ refused, refusalReasons, attackerPdTargetableShots,
 *   defenderPdMounts, pdShotsPerMount, interceptionCapacity, difference, ratio,
 *   ratioUnavailableReason, saturated, attackerPdImmuneWeapons,
 *   pdImmuneExcludedFromSaturation, attackerSalvoShotsAssumedMounts, heuristic,
 *   assumption }`. `difference` is signed: negative is a shortfall. `ratio` is
 *   null when the defender fields no point-defence mounts (there is no screen
 *   to saturate; every targetable shot arrives, which `saturated` still
 *   reports). All numbers are null when `refused`.
 */
export function saturationVerdict({ attacker, defender, pdShotsPerMount = PD_OVERWHELM_MULTIPLE }) {
  const refusalReasons = [];

  const attackerIncomplete = !attacker || attacker.join?.unresolved > 0;
  if (attackerIncomplete) {
    refusalReasons.push(attacker
      ? `attacker weapon join incomplete (${attacker.join.unresolved} unresolved system(s)); targetable-shot count under-states the salvo`
      : 'attacker side is missing');
  }

  const defenderIncomplete = !defender || defender.join?.unresolved > 0;
  if (defenderIncomplete) {
    refusalReasons.push(defender
      ? `defender weapon join incomplete (${defender.join.unresolved} unresolved system(s)); point-defence mount count is not a measurement`
      : 'defender side is missing');
  }

  const multiple = toFiniteNumber(pdShotsPerMount);
  if (multiple === null || !(multiple > 0)) {
    refusalReasons.push(`pdShotsPerMount must be a finite number > 0 (got ${pdShotsPerMount}); the default is PD_OVERWHELM_MULTIPLE (${PD_OVERWHELM_MULTIPLE})`);
  }

  const refused = refusalReasons.length > 0;

  if (refused) {
    return {
      refused: true,
      refusalReasons,
      attackerPdTargetableShots: null,
      defenderPdMounts: null,
      pdShotsPerMount: multiple ?? pdShotsPerMount,
      interceptionCapacity: null,
      difference: null,
      ratio: null,
      ratioUnavailableReason: null,
      saturated: null,
      attackerPdImmuneWeapons: null,
      pdImmuneExcludedFromSaturation: true,
      attackerSalvoShotsAssumedMounts: null,
      heuristic: PD_OVERWHELM_RULE_ATTRIBUTION,
      assumption: INTERCEPTION_ASSUMPTION
    };
  }

  const attackerShots = attacker.pdTargetableShots;
  const defenderMounts = defender.pointDefenceMounts;
  const capacity = defenderMounts * multiple;
  const difference = attackerShots - capacity;
  const noScreen = capacity === 0;

  return {
    refused: false,
    refusalReasons: null,
    attackerPdTargetableShots: attackerShots,
    defenderPdMounts: defenderMounts,
    pdShotsPerMount: multiple,
    interceptionCapacity: capacity,
    difference,
    ratio: noScreen ? null : attackerShots / capacity,
    ratioUnavailableReason: noScreen
      ? 'the defender fields no point-defence mounts; there is no screen to saturate and every targetable shot arrives'
      : null,
    saturated: attackerShots >= capacity,
    // Reported BESIDE the verdict, never inside the saturation arithmetic.
    attackerPdImmuneWeapons: attacker.pdImmuneWeapons,
    pdImmuneExcludedFromSaturation: true,
    // The absent-salvo interpretation (`SALVO_SHOTS_WHEN_ABSENT`) travels with
    // the verdict so the assumption is visible wherever the number is used.
    attackerSalvoShotsAssumedMounts: attacker.salvoShotsAssumedMounts ?? 0,
    heuristic: PD_OVERWHELM_RULE_ATTRIBUTION,
    assumption: INTERCEPTION_ASSUMPTION
  };
}
