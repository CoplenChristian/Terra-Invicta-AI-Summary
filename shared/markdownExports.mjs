// shared/markdownExports.mjs
//
// Purpose: shared markdown export renderers for the model-facing .md endpoints
//   (latest-snapshot, latest-war-room, latest-threats).
//
// Shared markdown export renderers for model-facing interfaces:
//   * /latest-snapshot.md  (macro campaign state, ~14 KB)
//   * /latest-threats.md   (immediate danger within 365 days, < 10 KB)
//   * /latest-war-room.md  (operational military/economic brief, 20-30 KB)
//
// Design principles (see docs/archive/markdown-export-plan.md):
//   1. Consumes the filtered snapshot DIRECTLY, never the stripped /api/intel projections.
//   2. Pure ESM with no Node built-ins -- runnable in Express and Cloudflare Worker.
//   3. Deterministic: same snapshot -> byte-identical markdown.
//   4. Absence-preserving: unmeasured values render as UNAVAILABLE, never 0.
//   5. No fabricated fallbacks: interception state is explicitly UNAVAILABLE.
//   6. Human-readable design rollups: joins ship.hullName against shipDesigns.
//   7. Hostile filtering with explicit omitted count.
//   8. Zero-detection coverage vs no-threats distinction.
//   9. Hard byte budget: the stated ceilings are enforced, not hoped for, and
//      every entry cut to meet them is counted and stated -- separately from
//      entries cut for irrelevance. See BYTE BUDGET ENGINE below.

import {
  ALIEN_FACTION_ID,
  INITIATIVE_DISPLAY_NAME,
  SERVANTS_DISPLAY_NAME,
  ALIEN_FACTION_DISPLAY_NAME
} from './constants.mjs';
import {
  asArray,
  toFiniteNumber as num,
  sameId,
  round,
  MS_PER_DAY,
  ONE_TRILLION,
  resolveObserverFaction
} from './util.mjs';
import {
  SHIP_CONSTRUCTION_MODULES,
  HAB_CONSTRUCTION_MODULES
} from './strategicSnapshot.mjs';
import { DRIVE_AVAILABILITY, driveExplorerResource } from './intel/driveExplorer.mjs';
import { researchRankingResource } from './intel/researchRanking.mjs';
import { buildResearchCategoryBonuses } from './researchCategoryBonus.mjs';
// `ENGAGEMENT_VERDICTS` is deliberately NOT imported any more: /latest-threats.md
// stopped publishing the hull requirement those verdicts label on 2026-08-28,
// and re-importing it would be the first step back to printing it. Reachability
// and the ranking survive, so `FLEET_REACHABILITY_STATES` does.
import {
  FLEET_REACHABILITY_STATES,
  buildFleetEngagement
} from './fleetEngagement.mjs';
import {
  MINING_BONUS_RULES,
  MINING_BONUS_STACKING,
  MINING_BONUS_STATES,
  UNMODELLED_FACTORS,
  buildMiningTechBonuses
} from './miningTechBonus.mjs';
import {
  CONTROL_POINT_CAP_ACCURACY,
  OVER_CAP_EXPOSED_MISSIONS,
  RECORDED_POSITION,
  buildControlPointCapReport
} from './controlPointCap.mjs';
// Section 1d. Unlike sections 1c, 10 and 11 this needs NO hand-in from the
// serving runtime: `componentStats` and each ship's `weaponLoadout` both travel
// on the filtered snapshot (and therefore on every published Supabase row), and
// this module is pure ESM, so the Cloudflare worker composes exactly what the
// local server does.
import {
  INTERCEPTION_ASSUMPTION,
  MAX_BATTLE_SIDE_SHIPS,
  MAX_BATTLE_SIDE_SHIPS_ATTRIBUTION,
  PD_OVERWHELM_MULTIPLE,
  PD_OVERWHELM_RULE_ATTRIBUTION,
  SALVO_SHOTS_WHEN_ABSENT,
  buildWeaponIndex,
  composeBattleSide,
  saturationVerdict,
  weaponTemplatesFromComponentStats
} from './battleComposition.mjs';

// The hostile-movement summary the whole-board endpoint already builds. We
// re-evaluate it from filteredSnapshot rather than trust the filter pipeline
// to publish it: the export runs in both Express and the Cloudflare Worker
// from the same inputs, and computing here keeps the absent-from-payload path
// explicit -- hostileMovement that fails to compute is "measurement was not
// read", never "no movement observed".
import {
  HOSTILE_MOVEMENT_STATE,
  theaterBoardResource
} from './intel/theaters.mjs';
// Absence-preserving formatting helpers
export const isMeasured = (value) =>
  value !== null && value !== undefined && value !== '' && Number.isFinite(Number(value));

export const fixedOr = (value, decimals, fallback = 'UNAVAILABLE') =>
  (isMeasured(value) ? Number(value).toFixed(decimals) : fallback);

export const localeOr = (value, fallback = 'UNAVAILABLE') =>
  (isMeasured(value) ? Number(value).toLocaleString() : fallback);

/**
 * An acceleration, to three SIGNIFICANT figures rather than three decimals.
 *
 * Measured acceleration across the drive catalogue spans five orders of
 * magnitude -- 0.00016846 to 20.59560406 m/s2 on the live save (2026-08-22) --
 * so `toFixed(3)` renders the bottom of the range as `0.000`, which a reader
 * cannot tell from a measured zero. That was fixed on the DRIVES panel in
 * `7352a44` (`accel()` in public/v2/js/components/drive-explorer.js) and the
 * same rule now applies to section 9 of this export, which had inherited the
 * `toFixed(3)` form. Section 9's own population does not reach the bottom of
 * the range on the current save (its smallest measured cruise acceleration is
 * 0.018194 m/s2), so this is a latent defect being closed rather than a live
 * one -- but the population is "fittable today", and it moves every time a
 * drive project completes.
 *
 * A measured 0 stays `0`: it is a reading, and it is deliberately NOT what an
 * absent value renders as.
 */
export const accelOr = (value, fallback = 'UNAVAILABLE') => {
  if (!isMeasured(value)) return fallback;
  const parsed = Number(value);
  if (parsed === 0) return '0';
  if (Math.abs(parsed) >= 1000) return Math.round(parsed).toLocaleString();
  // `Number(...)` drops the zeros `toPrecision` pads with, so 20.6 does not
  // read as 20.600 beside 0.000168.
  return String(Number(parsed.toPrecision(3)));
};

export const normalizeBody = (body) =>
  String(body || '').trim().replace(/\s+orbit$/i, '').toLowerCase();

/**
 * Builds a lookup map from ship design template ID (e.g. 'playerShipTemplate584')
 * to { displayName, hullClass, combatValue } from snapshot.shipDesigns.
 */
export function buildDesignLookup(shipDesigns) {
  const lookup = new Map();
  for (const d of asArray(shipDesigns)) {
    if (!d || !d.dataName) continue;
    const name = d._displayName || d.displayName || d.friendlyName || d.hullName || d.dataName;
    const hullClass = d.hullName || 'Ship';
    const cv = isMeasured(d._unnormalizedCombatValue) ? Number(d._unnormalizedCombatValue) : null;
    lookup.set(d.dataName, {
      dataName: d.dataName,
      displayName: name,
      hullClass,
      combatValue: cv
    });
  }
  return lookup;
}

/**
 * Aggregates hab modules for each hab ID into capability totals:
 * { mines, shipyards, construction, defense, research, powerOperational }
 */
export function buildHabModuleAggregates(habModules) {
  const shipSet = new Set(SHIP_CONSTRUCTION_MODULES.map(s => s.toLowerCase()));
  const habSet = new Set(HAB_CONSTRUCTION_MODULES.map(s => s.toLowerCase()));
  const habConstructionPattern = /Construction|Nanofact|Assembler/i;

  const agg = new Map();
  for (const m of asArray(habModules)) {
    if (!m || m.destroyed) continue;
    const habId = Number(m.habId);
    if (!habId && habId !== 0) continue;

    if (!agg.has(habId)) {
      agg.set(habId, {
        mines: 0,
        shipyards: 0,
        construction: 0,
        defense: 0,
        research: 0,
        operational: 0,
        underConstruction: 0
      });
    }
    const entry = agg.get(habId);
    const isOperational = m.constructionStatus === 'operational' || m.constructionCompleted === true;

    if (isOperational) {
      entry.operational += 1;
      const template = String(m.templateName || '');
      const key = template.toLowerCase();
      const isYard = m.isShipyard === true || shipSet.has(key);

      if (isYard) entry.shipyards += 1;
      if (/Mining/i.test(template)) entry.mines += 1;
      if (/Defense|Battery|Laser|Gun|Missile|Array/i.test(template)) entry.defense += 1;
      if (!isYard && (habSet.has(key) || habConstructionPattern.test(template))) {
        entry.construction += 1;
      }
      if (/Lab|Research|Science/i.test(template)) entry.research += 1;
    } else {
      entry.underConstruction += 1;
    }
  }
  return agg;
}

/**
 * Summarizes weapon systems and calculates total Point Defense counts.
 */
export function extractWeaponAndPdSummary(fleetOrShip) {
  let weaponSummary = fleetOrShip.weaponSummary || null;
  let pdCount = 0;
  const roleCounts = new Map();

  const breakdown = fleetOrShip.weaponBreakdown || fleetOrShip.weaponLoadout || [];
  if (Array.isArray(breakdown) && breakdown.length > 0) {
    for (const entry of breakdown) {
      const role = entry.role || entry.category || 'Unknown';
      const count = Number(entry.count) || (Array.isArray(entry.systems) ? entry.systems.length : 1);
      if (/Point\s*Defense/i.test(role)) {
        pdCount += count;
      }
      roleCounts.set(role, (roleCounts.get(role) || 0) + count);
    }
    if (!weaponSummary && roleCounts.size > 0) {
      weaponSummary = [...roleCounts.entries()]
        .map(([role, count]) => `${role} x${count}`)
        .join(' • ');
    }
  }

  // Fallback to searching ships array if weaponBreakdown was empty
  if (pdCount === 0 && Array.isArray(fleetOrShip.ships)) {
    for (const ship of fleetOrShip.ships) {
      const loadout = ship.weaponLoadout || [];
      for (const entry of loadout) {
        if (/Point\s*Defense/i.test(entry.role || entry.category || '')) {
          pdCount += (Number(entry.count) || 1);
        }
      }
    }
  }

  return {
    summary: weaponSummary || 'No weapon summary available',
    pdCount,
    dominantWeapon: fleetOrShip.dominantWeaponType || null
  };
}

/**
 * Formats a friendly fleet's compact design rollup:
 *   - 6× Patapsco (Escort)
 *   - 3× Xingu (Monitor)
 */
export function formatFleetDesignRollup(fleet, designLookup) {
  const ships = asArray(fleet.ships);
  if (ships.length === 0) return ['  - (No ship manifest available)'];

  const designCounts = new Map();
  for (const ship of ships) {
    const rawHull = ship.hullName || 'Unknown';
    const info = designLookup.get(rawHull);
    const key = info ? `${info.displayName} (${info.hullClass})` : rawHull;
    designCounts.set(key, (designCounts.get(key) || 0) + 1);
  }

  return [...designCounts.entries()]
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .map(([name, count]) => `  - ${count}× ${name}`);
}

/**
 * Determines whether a faction is genuinely hostile (Aliens, priority target / Servants, or at war).
 */
export function isGenuinelyHostileFaction(factionId, factionName, filteredSnapshot) {
  const observerId = filteredSnapshot?.observerFactionId;
  if (sameId(factionId, observerId)) return false;

  if (sameId(factionId, ALIEN_FACTION_ID) || factionName === ALIEN_FACTION_DISPLAY_NAME) {
    return true;
  }

  const priorityId = filteredSnapshot?.priorityTargetFaction?.id;
  const priorityName = filteredSnapshot?.priorityTargetFaction?.name;
  if (priorityId && sameId(factionId, priorityId)) return true;
  if (priorityName && factionName === priorityName) return true;
  if (factionName === SERVANTS_DISPLAY_NAME) return true;

  const fObj = asArray(filteredSnapshot?.factions).find(f => sameId(f.ID, factionId));
  if (fObj && (fObj.isAlien || fObj.atWarWithObserver || fObj.isEnemy || fObj.atWar)) return true;

  return false;
}

/**
 * Evaluates whether a hostile fleet meets the war-room relevance criteria:
 *   1. Targeting observer hab directly (regardless of ship count)
 *   2. Inbound transfer to observer orbit/theater arriving within 365 days
 *   3. Co-located at the same specific orbit/station with an observer asset AND shipsCount >= 5 (Sol excluded)
 *   4. Major combat fleet (shipsCount >= 10)
 *
 * Returns { isRelevant, reasons, daysRemaining, rank }.
 *
 * `rank` is a lexicographically-comparable tuple used by the byte-budget pass
 * to decide which RELEVANT fleets to drop when the document will not fit.
 * Lower sorts first and is kept longest. It is derived from the same criteria
 * as `reasons` -- degradation is by relevance, never by truncating the tail.
 * Inclusion semantics (`isRelevant` / `reasons`) are unchanged by the rank.
 */
export function evaluateHostileRelevance(fleet, ourHabIds, ourOrbits, gameDate) {
  const reasons = [];
  const ships = num(fleet.shipsCount) ?? (Array.isArray(fleet.ships) ? fleet.ships.length : 0);

  const destId = num(fleet.destinationId);
  const isTargetingOurHab = destId !== null && ourHabIds.has(destId);

  const destOrbit = normalizeBody(fleet.destination);
  let daysRemaining = null;
  if (fleet.arrivalDate && gameDate && !Number.isNaN(gameDate.getTime())) {
    const arr = new Date(fleet.arrivalDate);
    if (!Number.isNaN(arr.getTime())) {
      daysRemaining = Math.max(0, Math.round((arr - gameDate) / MS_PER_DAY));
    }
  }

  const isInboundToOurTheater = (isTargetingOurHab || (destOrbit && ourOrbits.has(destOrbit))) &&
    daysRemaining !== null && daysRemaining <= 365;

  if (isTargetingOurHab) {
    reasons.push('targeting observer hab');
  } else if (isInboundToOurTheater) {
    reasons.push(`inbound transfer to observer theater (${daysRemaining}d)`);
  }

  const curOrbit = normalizeBody(fleet.orbitBody);
  const isCoLocated = curOrbit && ourOrbits.has(curOrbit) && curOrbit !== 'sol' && curOrbit !== 'deep space';

  if (isCoLocated && ships >= 5) {
    reasons.push(`co-located in observer orbit (${fleet.orbitBody}, ${ships} ships)`);
  }

  if (ships >= 10 && reasons.length === 0) {
    reasons.push(`major combat fleet (${ships} ships)`);
  }

  // Relevance tiers, most relevant first. A fleet aimed at one of our habs is
  // the most actionable contact there is; a fleet merely large and far away is
  // the least. Ties break on time-to-impact, then on size, then on identity so
  // the ordering is deterministic for a given snapshot.
  let tier = 4;
  if (isTargetingOurHab) tier = 0;
  else if (isInboundToOurTheater) tier = 1;
  else if (isCoLocated && ships >= 5) tier = 2;
  else if (reasons.length > 0) tier = 3;

  const idKey = num(fleet.ID);
  const rank = [
    tier,
    daysRemaining === null ? Number.MAX_SAFE_INTEGER : daysRemaining,
    -ships,
    idKey === null ? Number.MAX_SAFE_INTEGER : idKey,
    String(fleet.displayName || '')
  ];

  return {
    isRelevant: reasons.length > 0,
    reasons,
    daysRemaining,
    rank
  };
}

// ---------------------------------------------------------------------------
// BYTE BUDGET ENGINE
//
// The stated size ceilings used to be an observation about one save rather
// than a guarantee: nothing bounded the output, so at 5x the current fleet
// count /latest-war-room.md rendered 36 KB against its own 30 KB ceiling.
// The engine below makes the ceiling a hard cap with graceful, *announced*
// degradation.
//
// Two omission reasons exist and are deliberately never conflated:
//   * "below relevance threshold" -- the entry did not qualify for the
//     document at all (the pre-existing hostile-relevance filter).
//   * "omitted to fit the size budget" -- the entry WAS relevant and was cut
//     only because the document would otherwise exceed its ceiling.
// A reader must be able to tell that something relevant was cut, so the two
// counts are printed separately in the section each entry came from.
//
// Section headers are never dropped. A section degraded to zero entries still
// renders its header and states why it is empty -- a missing section reads as
// "nothing to report", which is the same failure class as fabricating data.
// ---------------------------------------------------------------------------

/**
 * The one line that tells an agent what basis every RP figure in a research
 * section is on.
 *
 * It exists because the figures MOVED on 2026-08-22 and nothing else in these
 * documents would say so. This campaign's `researchSpeedMultiplier` acts on the
 * effective research COST -- measured; see `shared/researchCostScaling.mjs` --
 * so "43 / 50 RP" is what the game charges while the wiki and the shipped
 * templates both state 100 for the same project. An agent comparing the two
 * without this line would conclude the export was wrong.
 *
 * Returns '' when there is nothing to say, so a caller can push it blindly:
 * a stock campaign needs no note, and a snapshot published before the scaling
 * existed says its multiplier is unknown rather than claiming a basis.
 *
 * @param {Object|null} filteredSnapshot
 * @returns {string}
 */
export function researchCostBasisLine(filteredSnapshot) {
  const scaling = filteredSnapshot?.metadata?.researchCostScaling || null;
  if (!scaling) return '';
  if (scaling.state === 'campaign-scaled') {
    const percent = scaling.multiplierPercent;
    return `*Every RP figure below is the EFFECTIVE cost: template cost ÷ this campaign's `
      + `${percent}% research speed setting. The shipped templates state ${scaling.costDivisor}× these `
      + `numbers; the game charges these.*`;
  }
  if (scaling.state === 'campaign-multiplier-unknown') {
    return `*RP figures below are raw template costs. This snapshot carries no readable campaign research `
      + `speed multiplier, so whether the game charges these has NOT been checked.*`;
  }
  return '';
}

/** Hard ceiling for /latest-war-room.md. Output is guaranteed strictly below. */
export const WAR_ROOM_BYTE_BUDGET = 30720; // 30 KB
/** Hard ceiling for /latest-threats.md. Output is guaranteed strictly below. */
export const THREATS_BYTE_BUDGET = 10240; // 10 KB

// Dropping entries also ADDS the omission notice, so each drop pass frees a
// little more than the raw overflow to avoid oscillating around the ceiling.
const BUDGET_SLACK_BYTES = 512;

// The hate-venting condition list is the only unbounded list inside an
// otherwise fixed-size section. Cap it so the non-degradable residue of the
// document is bounded by construction, and announce the cap.
const MAX_VENTING_CONDITIONS = 12;

/**
 * UTF-8 byte length without Node's Buffer -- this module also runs in the
 * Cloudflare Worker, which has no Buffer. Lone surrogates count as 3 bytes,
 * matching what Buffer.byteLength / TextEncoder produce for U+FFFD.
 */
export function utf8ByteLength(text) {
  const str = String(text);
  let bytes = 0;
  for (let i = 0; i < str.length; i += 1) {
    const code = str.charCodeAt(i);
    if (code < 0x80) {
      bytes += 1;
    } else if (code < 0x800) {
      bytes += 2;
    } else if (code >= 0xd800 && code <= 0xdbff) {
      const next = i + 1 < str.length ? str.charCodeAt(i + 1) : 0;
      if (next >= 0xdc00 && next <= 0xdfff) {
        bytes += 4;
        i += 1;
      } else {
        bytes += 3;
      }
    } else {
      bytes += 3;
    }
  }
  return bytes;
}

const linesByteLength = (lines) => {
  let total = 0;
  for (const line of lines) total += utf8ByteLength(line) + 1; // + '\n' from join
  return total;
};

/** Lexicographic comparison of rank tuples. Numbers and strings only. */
function compareRank(a, b) {
  const len = Math.max(a.length, b.length);
  for (let i = 0; i < len; i += 1) {
    const x = a[i];
    const y = b[i];
    if (x === y) continue;
    if (x === undefined) return -1;
    if (y === undefined) return 1;
    return x < y ? -1 : 1;
  }
  return 0;
}

/** A block of lines that always renders verbatim (headers, fixed tables). */
function fixedBlock(key, headingLines, bodyLines = []) {
  return {
    kind: 'fixed',
    key,
    headingLines,
    bodyLines,
    bodySuppressed: false,
    suppressedNoteLines: ['*Section body omitted to fit the size budget.*', '']
  };
}

/** A block of ranked entries that the budget pass may thin or compact. */
function listBlock(key, config) {
  return {
    kind: 'list',
    key,
    headingLines: config.headingLines || [],
    entries: [],
    grouped: Boolean(config.groupHeader),
    groupHeader: config.groupHeader || null,
    groupTrailingLines: config.groupTrailingLines || [],
    emptyLines: config.emptyLines || [],
    budgetEmptyLines: config.budgetEmptyLines || null,
    relevanceOmitted: config.relevanceOmitted || 0,
    relevanceNote: config.relevanceNote || null,
    budgetNote: config.budgetNote || null,
    detailNote: config.detailNote || null,
    trailingLines: config.trailingLines || [],
    bodySuppressed: false,
    suppressedNoteLines: config.suppressedNoteLines
      || ['*Section body omitted to fit the size budget.*', '']
  };
}

/**
 * @param variants  Line arrays by detail level; level N above the last variant
 *                  reuses the last one. Index 0 is the fullest rendering.
 */
function addEntry(block, { rank, variants, group = null }) {
  block.entries.push({ rank, variants, group, dropped: false, level: 0 });
}

// Detail level is per ENTRY, not per section, so compaction is applied from
// the least-relevant end and stops the moment the document fits. A
// section-wide switch overshot badly -- at 5x growth it shed 9 KB of budget
// that could have carried real content.
const entryLines = (entry) =>
  entry.variants[Math.min(entry.level, entry.variants.length - 1)];

const entryByteCost = (entry) => linesByteLength(entryLines(entry));

const entryMaxLevel = (entry) => entry.variants.length - 1;

/** Standard "relevant but did not fit" notice. Never merged with the relevance notice. */
const budgetOmissionNote = (noun, pointer) => (dropped, total) => {
  const shown = total - dropped;
  const noun2 = dropped === 1 ? 'entry' : 'entries';
  return [
    `*${dropped} further ${noun2} omitted to fit the size budget — these met the `
    + `relevance bar but did not fit. ${shown} of ${total} ${noun} shown${pointer ? `; full set at ${pointer}` : ''}.*`
  ];
};

/**
 * Standard "everything was cut" notice for a section budgeted down to zero.
 * The section header still renders above it -- a missing section reads as
 * "nothing to report", which is not what happened.
 */
const budgetEmptyNote = (noun, pointer, trailingBlank = true) => (total) => {
  const note = [`*All ${total} ${noun} omitted to fit the size budget${pointer ? `; full set at ${pointer}` : ''}.*`];
  // Blocks that already carry a trailing blank line opt out, so an emptied
  // section does not render two blank lines where a populated one renders one.
  if (trailingBlank) note.push('');
  return note;
};

function renderBlock(block, out) {
  for (const line of block.headingLines) out.push(line);

  if (block.bodySuppressed) {
    for (const line of block.suppressedNoteLines) out.push(line);
    return;
  }

  if (block.kind === 'fixed') {
    for (const line of block.bodyLines) out.push(line);
    return;
  }

  const kept = block.entries.filter(e => !e.dropped);
  const budgetOmitted = block.entries.length - kept.length;

  if (block.entries.length === 0) {
    for (const line of block.emptyLines) out.push(line);
  } else if (kept.length === 0) {
    const emptyLines = block.budgetEmptyLines ? block.budgetEmptyLines(block.entries.length) : [];
    for (const line of emptyLines) out.push(line);
  } else if (block.grouped) {
    // Group totals stay TRUE totals; the budget notice below reconciles them
    // with the shorter list. A group whose every entry was cut disappears --
    // it is an entry label, not a section header.
    const groupTotals = new Map();
    for (const e of block.entries) groupTotals.set(e.group, (groupTotals.get(e.group) || 0) + 1);
    let previousGroup = null;
    for (const e of kept) {
      if (e.group !== previousGroup) {
        if (previousGroup !== null) for (const line of block.groupTrailingLines) out.push(line);
        for (const line of block.groupHeader(e.group, groupTotals.get(e.group))) out.push(line);
        previousGroup = e.group;
      }
      for (const line of entryLines(e)) out.push(line);
    }
    if (previousGroup !== null) for (const line of block.groupTrailingLines) out.push(line);
  } else {
    for (const e of kept) {
      for (const line of entryLines(e)) out.push(line);
    }
  }

  if (kept.length > 0 && block.detailNote) {
    // levelCounts[i] = how many listed entries were compacted to at least
    // level i + 1, so the notice can state exactly what was shed and from how
    // many entries rather than rounding to "some detail was removed".
    const levelCounts = [];
    for (const e of kept) {
      for (let i = 0; i < e.level; i += 1) levelCounts[i] = (levelCounts[i] || 0) + 1;
    }
    if (levelCounts.length > 0) {
      for (const line of block.detailNote(levelCounts, kept.length)) out.push(line);
    }
  }
  if (block.relevanceOmitted > 0 && block.relevanceNote) {
    for (const line of block.relevanceNote(block.relevanceOmitted)) out.push(line);
  }
  // Only when SOME entries survived -- an emptied section already said so via
  // budgetEmptyLines, and printing both read as two separate omissions.
  if (budgetOmitted > 0 && kept.length > 0 && block.budgetNote) {
    for (const line of block.budgetNote(budgetOmitted, block.entries.length)) out.push(line);
  }
  for (const line of block.trailingLines) out.push(line);
}

function renderBlocks(blocks) {
  const out = [];
  for (const block of blocks) renderBlock(block, out);
  return out.join('\n');
}

const leastRelevantFirst = (entries) =>
  entries.slice().sort((a, b) => compareRank(b.rank, a.rank));

/** Drops the least-relevant surviving entries until `neededBytes` is freed. */
function dropLeastRelevant(block, neededBytes) {
  const survivors = block.entries.filter(e => !e.dropped);
  if (survivors.length === 0) return false;

  let freed = 0;
  for (const entry of leastRelevantFirst(survivors)) {
    entry.dropped = true;
    freed += entryByteCost(entry);
    if (freed >= neededBytes) break;
  }
  return true;
}

/**
 * Compacts the least-relevant surviving entries one detail level, up to
 * `toLevel`, until `neededBytes` is freed. Every entry stays listed -- only
 * its depth shrinks, and the most relevant entries keep full detail longest.
 */
function compactLeastRelevant(block, neededBytes, toLevel) {
  const candidates = block.entries.filter(e =>
    !e.dropped && e.level < toLevel && e.level < entryMaxLevel(e));
  if (candidates.length === 0) return false;

  let freed = 0;
  for (const entry of leastRelevantFirst(candidates)) {
    const before = entryByteCost(entry);
    entry.level += 1;
    freed += before - entryByteCost(entry);
    if (freed >= neededBytes) break;
  }
  return true;
}

/**
 * Renders `blocks` and degrades them until the document fits under `maxBytes`.
 *
 * `ladder` is the deliberate order in which sections give way, and `clampOrder`
 * is the last-resort order for suppressing whole section bodies if even an
 * entry-free document would not fit. Termination is structural, not
 * byte-driven: every `drop` strictly reduces a finite survivor set and every
 * `reduce` strictly raises a bounded detail level.
 */
export function renderWithByteBudget(blocks, ladder, clampOrder, maxBytes) {
  const byKey = new Map(blocks.map(b => [b.key, b]));
  let text = renderBlocks(blocks);
  let bytes = utf8ByteLength(text);
  if (bytes < maxBytes) return text;

  let stageIndex = 0;
  while (bytes >= maxBytes && stageIndex < ladder.length) {
    const stage = ladder[stageIndex];
    const block = byKey.get(stage.block);
    if (!block) { stageIndex += 1; continue; }
    // A ladder key does not guarantee a LIST block. Section 1c emits a fixed
    // block on both of its unavailable paths -- there is nothing rankable in a
    // statement that nothing was read -- and `reduce` / `drop` reach for
    // `block.entries`, which a fixed block does not have. Skipping the stage is
    // right rather than merely safe: a section already reduced to one "not
    // read" line has nothing left to shed, and `clampOrder` below is where a
    // fixed body gives way.
    if (block.kind !== 'list') { stageIndex += 1; continue; }

    const needed = (bytes - maxBytes) + BUDGET_SLACK_BYTES;
    let acted = false;
    if (stage.action === 'reduce') {
      acted = compactLeastRelevant(block, needed, stage.toLevel ?? 1);
    } else if (stage.action === 'drop') {
      acted = dropLeastRelevant(block, needed);
    }

    if (!acted) { stageIndex += 1; continue; }
    text = renderBlocks(blocks);
    bytes = utf8ByteLength(text);
  }

  // Last resort: even with every degradable entry gone the fixed content does
  // not fit. Suppress whole fixed-section BODIES, lowest priority first.
  // Section headers still render, each stating that its body was omitted.
  //
  // List blocks are deliberately excluded: the ladder has already emptied them
  // and their "All N omitted" notices carry counts a reader needs, which a
  // generic suppression banner would throw away for one line of savings.
  //
  // What remains after this is irreducible -- the title block, one header per
  // section and one notice per section, roughly 2 KB. A budget below that
  // floor cannot be met; the real ceilings are an order of magnitude above it.
  for (const key of clampOrder) {
    if (bytes < maxBytes) break;
    const block = byKey.get(key);
    if (!block || block.kind !== 'fixed') continue;
    if (block.bodySuppressed || block.bodyLines.length === 0) continue;
    block.bodySuppressed = true;
    text = renderBlocks(blocks);
    bytes = utf8ByteLength(text);
  }

  return text;
}

// ---------------------------------------------------------------------------
// HOSTILE MOVEMENT (PHASE 3)
//
// The whole-board hostile movement summary for /latest-threats.md and
// /latest-war-room.md. Lives between the byte-budget engine and the two
// renderers so both sections can reach it.
//
// The four states from HOSTILE_MOVEMENT_STATE encode the priority of the
// claim, deliberately ordered so the UNRESOLVED branch outranks NONE_TOWARD:
// with one destination the resolver cannot name, "none of this is coming to a
// tracked theater" is not a statement the data supports. The lines render the
// four states four different ways because the difference between
// NO_HOSTILE_MOVEMENT_OBSERVED and HOSTILE_MOVEMENT_NONE_TOWARD_TRACKED_THEATERS
// is the whole feature: the empty twelve-body theater table is the same in
// both, and this is what separates them.
//
// 'absentFromPayload' is true when neither the snapshot nor a re-evaluation
// yielded a summary -- the only path that should produce this is a malformed
// snapshot or an unexpected throw from the projection. The caller prints the
// "measurement was not read" line, never a zero.
// ---------------------------------------------------------------------------

const HOSTILE_MOVEMENT_STATE_LABEL = Object.freeze({
  [HOSTILE_MOVEMENT_STATE.none]: 'NO HOSTILE MOVEMENT OBSERVED',
  [HOSTILE_MOVEMENT_STATE.elsewhere]: 'HOSTILE MOVEMENT — NONE TOWARD TRACKED THEATERS',
  [HOSTILE_MOVEMENT_STATE.partlyUnresolved]: 'HOSTILE MOVEMENT — DESTINATIONS PARTLY UNRESOLVED',
  [HOSTILE_MOVEMENT_STATE.inbound]: 'INBOUND TO TRACKED THEATER'
});

function shipsShort(movement) {
  return movement && movement.observed ? movement.observed.ships : null;
}

function transfersShort(movement) {
  return movement && movement.observed ? movement.observed.transfers : null;
}

function nearestArrivalLabel(movement) {
  if (!movement) return null;
  const days = movement.nearestArrivalDays;
  if (!Number.isFinite(days)) return null;
  return `${Math.round(days)} day${days === 1 ? '' : 's'}`;
}

function readHostileMovement(filteredSnapshot) {
  // Trust the filter pipeline first: the export accepts a hostileMovement
  // already published on the payload. If absent or fails the shape check,
  // re-evaluate against the filtered snapshot -- this is what makes both
  // runtimes (Express and the Cloudflare Worker) agree without the worker
  // needing the filter step to publish the same field.
  const candidate = filteredSnapshot && filteredSnapshot.hostileMovement;
  if (candidate && typeof candidate === 'object' && candidate.state
      && Number.isFinite(candidate.observed?.transfers)) {
    return { movement: candidate, source: 'payload' };
  }

  if (!filteredSnapshot) return { movement: null, source: 'absent' };
  try {
    const observerId = filteredSnapshot.observerFactionId;
    const board = theaterBoardResource(filteredSnapshot, observerId);
    if (board && board.hostileMovement && board.hostileMovement.state) {
      return { movement: board.hostileMovement, source: 'computed' };
    }
    return { movement: null, source: 'absent' };
  } catch (err) {
    return { movement: null, source: 'absent', error: err };
  }
}

/**
 * Lines for an embedded hostile-movement block. Renders FOUR things distinctly:
 *
 *   1. measurement missing -- UNAVAILABLE, never "zero movement".
 *   2. NO_HOSTILE_MOVEMENT_OBSERVED -- one line: observed=0 of 0.
 *   3. HOSTILE_MOVEMENT_NONE_TOWARD_TRACKED_THEATERS -- observed > 0 but
 *      toward = 0; in particular the off-board list ALWAYS renders because
 *      today's case is fourteen fleets in transit and NONE of them toward a
 *      tracked body. Collapsing this into the case (2) line is the bug.
 *   4. HOSTILE_MOVEMENT_DESTINATIONS_PARTLY_UNRESOLVED -- observed > 0 and
 *      unresolved > 0; the line carries an explicit unresolved count and a
 *      short list of which destinations could not be resolved.
 *   5. INBOUND_TO_TRACKED_THEATER -- observed > 0 and toward > 0; the toward
 *      figure is the headline number.
 *
 * Always declares its source (payload | computed).
 */
export function hostileMovementBlock(filteredSnapshot, options = {}) {
  const { headingLevel = '###', header = 'Hostile Movement (Whole-Board)', includeRows = true } = options;
  const { movement, source, error } = readHostileMovement(filteredSnapshot);
  const lines = [];

  // A consumer that already printed a section heading suppresses this one.
  const emitHeading = Boolean(header);
  const headingLine = emitHeading ? `${headingLevel} ${header}` : null;

  if (!movement) {
    if (headingLine) lines.push(headingLine);
    lines.push(``);
    if (error) {
      lines.push(`> UNAVAILABLE — hostile movement read failed: ${error.message || String(error)}`);
    } else {
      lines.push(`> UNAVAILABLE — hostile movement was not read from the payload and could not be computed`);
    }
    lines.push(``);
    return lines;
  }

  if (headingLine) lines.push(headingLine);
  lines.push(``);


  const label = HOSTILE_MOVEMENT_STATE_LABEL[movement.state] || movement.state;
  const observed = transfersShort(movement);
  const observedShips = shipsShort(movement);
  const towardShips = movement.towardTrackedTheaters?.ships;
  const untrackedShips = movement.towardUntrackedBodies?.ships;
  const unresolvedShips = movement.unresolvedDestinations?.ships;
  const nearest = nearestArrivalLabel(movement);

  // Headline line carries the state and the count breakdown. Distinct phrasing
  // for the four states, on purpose -- see the module docblock.
  let headline;
  switch (movement.state) {
    case HOSTILE_MOVEMENT_STATE.none:
      headline = `- **State:** NO HOSTILE MOVEMENT OBSERVED — 0 of 0 hostile fleet transfer(s) in transit.`;
      break;
    case HOSTILE_MOVEMENT_STATE.elsewhere:
      headline = `- **State:** HOSTILE MOVEMENT — NONE TOWARD TRACKED THEATERS — ${observed} hostile transfer(s) (${observedShips} ship(s)) in transit; 0 inbound to a tracked theater.`;
      break;
    case HOSTILE_MOVEMENT_STATE.partlyUnresolved:
      headline = `- **State:** HOSTILE MOVEMENT — DESTINATIONS PARTLY UNRESOLVED — ${observed} hostile transfer(s) (${observedShips} ship(s)) in transit; the resolver could not pin down ${movement.unresolvedDestinations?.transfers || 0} of them, so the claim "none of this is aimed at a tracked theater" is not supportable.`;
      break;
    case HOSTILE_MOVEMENT_STATE.inbound:
      headline = `- **State:** INBOUND TO TRACKED THEATER — ${movement.towardTrackedTheaters?.transfers || 0} of ${observed} hostile transfer(s) (${towardShips} of ${observedShips} ship(s)) are inbound to a tracked theater.`;
      break;
    default:
      headline = `- **State:** ${label}`;
  }
  lines.push(headline);

  // Count breakdown -- always render, even on the none state. Skipping them
  // collapses "nothing moving" with "moving, none headed here" which is the
  // exact collapse this block exists to prevent.
  lines.push(`- **Toward tracked theaters:** ${movement.towardTrackedTheaters?.transfers || 0} transfer(s), ${towardShips ?? 0} ship(s)`);
  lines.push(`- **Toward untracked bodies (off-board):** ${movement.towardUntrackedBodies?.transfers || 0} transfer(s), ${untrackedShips ?? 0} ship(s)`);
  lines.push(`- **Unresolved destinations:** ${movement.unresolvedDestinations?.transfers || 0} transfer(s), ${unresolvedShips ?? 0} ship(s)`);

  if (nearest !== null) {
    lines.push(`- **Nearest arrival (measured):** ${nearest}`);
  } else if (observed > 0) {
    // The movement set has entries but none carries a measured arrival.
    // Render this explicitly -- "soon" or "anywhere" would be a fabrication.
    lines.push(`- **Nearest arrival:** ETA not measured for any of the ${observed} transfer(s)`);
  }

  lines.push(`- **Tracked bodies (12):** ${(movement.trackedBodies || []).join(', ')}`);
  lines.push(`- **Source:** ${source} (` + (source === 'payload'
    ? 'read from filtered snapshot as published'
    : 'computed from /shared/intel/theaters.mjs because the snapshot did not carry it') + `)`);
  lines.push(``);

  if (includeRows && Array.isArray(movement.offBoardDestinations) && movement.offBoardDestinations.length > 0) {
    const cap = 6;
    const rows = movement.offBoardDestinations.slice(0, cap);
    lines.push(`- **Off-board destinations (showing up to ${cap}):**`);
    for (const row of rows) {
      const faction = row.faction || 'Hostile';
      const fleet = row.fleet || row.statedDestination || '—';
      const ship = Number.isFinite(row.shipCount) ? `${row.shipCount} ship(s)` : 'ship count unavailable';
      const dst = row.resolved === false
        ? `unresolved (${row.unresolvedReason || 'reason not read'}; stated: ${row.statedDestination || 'n/a'})`
        : `${row.resolvedBody || row.statedDestination || 'unknown body'}` + (row.trackedTheater ? ' (tracked)' : ' (untracked)');
      const eta = Number.isFinite(row.daysRemaining) ? ` · ETA ${Math.round(row.daysRemaining)} day(s)` : '';
      lines.push(`  - ${faction} · **${fleet}** — ${ship} → ${dst}${eta}`);
    }
    const total = Number.isFinite(movement.offBoardDestinationsTotalCount) ? movement.offBoardDestinationsTotalCount : movement.offBoardDestinations.length;
    const shown = movement.offBoardDestinations.length;
    const omitted = Number.isFinite(movement.offBoardDestinationsOmittedCount)
      ? movement.offBoardDestinationsOmittedCount
      : Math.max(0, total - shown);
    if (omitted > 0) {
      lines.push(`  - *${shown} shown of ${total} off-board destination(s) — ${omitted} further row(s) omitted here, full list at /api/intel/theaters.*`);
    }
    lines.push(``);
  }

  return lines;
}

/**
 * A single-line summary for tight budgets. Three states read differently:
 *   * NO_HOSTILE_MOVEMENT_OBSERVED -- "no hostile movement observed (0/0)".
 *   * HOSTILE_MOVEMENT_NONE_TOWARD_TRACKED_THEATERS -- "X hostile transfer(s)
 *     in transit, none toward a tracked theater".
 *   * INBOUND_TO_TRACKED_THEATER -- "Y hostile transfer(s) inbound to tracked
 *     theaters; Z further off-board transfer(s)".
 *   * PARTLY_UNRESOLVED -- "X hostile transfer(s) in transit; N unresolved
 *     destinations — the 'none coming here' claim is not supported".
 *   * UNREAD -- "hostile-movement measurement was not read".
 */
export function hostileMovementLine(filteredSnapshot) {
  const { movement, source } = readHostileMovement(filteredSnapshot);
  if (!movement) {
    return `**Hostile Movement (Whole-Board):** UNAVAILABLE — hostile movement was not read from the payload`;
  }
  const label = HOSTILE_MOVEMENT_STATE_LABEL[movement.state] || movement.state;
  const observed = transfersShort(movement);
  const observedShips = shipsShort(movement);
  const toward = movement.towardTrackedTheaters?.transfers || 0;
  const untracked = movement.towardUntrackedBodies?.transfers || 0;
  const unresolved = movement.unresolvedDestinations?.transfers || 0;
  const nearest = nearestArrivalLabel(movement);
  let body;
  switch (movement.state) {
    case HOSTILE_MOVEMENT_STATE.none:
      body = `0 of 0 hostile fleet transfer(s) in transit`;
      break;
    case HOSTILE_MOVEMENT_STATE.elsewhere:
      body = `${observed} hostile transfer(s) / ${observedShips ?? 0} ship(s) in transit; 0 inbound to a tracked theater`;
      break;
    case HOSTILE_MOVEMENT_STATE.partlyUnresolved:
      body = `${observed} hostile transfer(s) / ${observedShips ?? 0} ship(s) in transit; the resolver could not pin ${unresolved} destination(s), so "none of this is aimed at a tracked theater" is not supportable`;
      break;
    case HOSTILE_MOVEMENT_STATE.inbound:
      body = `${toward} of ${observed} hostile transfer(s) / ${(movement.towardTrackedTheaters?.ships || 0)} of ${observedShips ?? 0} ship(s) inbound to tracked theaters; ${untracked} further off-board`;
      break;
    default:
      body = label;
  }
  const eta = nearest !== null ? `; nearest arrival ${nearest}` : '';
  return `**Hostile Movement (Whole-Board) — ${label}:** ${body}${eta}`;
}

// ---------------------------------------------------------------------------
// 1. /latest-threats.md  (< 10 KB)
// ---------------------------------------------------------------------------

export function renderThreatsMarkdown(filteredSnapshot, options = {}) {
  const meta = filteredSnapshot.metadata || {};
  const observerId = filteredSnapshot.observerFactionId;
  const observer = resolveObserverFaction(filteredSnapshot.factions, observerId, {
    fallbackToFirst: true
  });
  const observerName = observer?.displayName || INITIATIVE_DISPLAY_NAME;
  const mode = (filteredSnapshot.mode || 'player').toUpperCase();
  const gameDate = meta.gameTimeString ? new Date(meta.gameTimeString) : null;

  const designLookup = buildDesignLookup(filteredSnapshot.shipDesigns);
  const habModulesAgg = buildHabModuleAggregates(filteredSnapshot.habModules);

  const ourHabs = asArray(filteredSnapshot.habs).filter(h => sameId(h.factionId, observerId));
  const ourHabIds = new Set(ourHabs.map(h => Number(h.ID)));
  const ourHabMap = new Map(ourHabs.map(h => [Number(h.ID), h]));
  const ourFleets = asArray(filteredSnapshot.fleets).filter(f => sameId(f.factionId, observerId));

  const ourOrbits = new Set([
    ...ourHabs.map(h => normalizeBody(h.orbitBody)).filter(Boolean),
    ...ourFleets.map(f => normalizeBody(f.orbitBody)).filter(Boolean)
  ]);
  ourOrbits.delete('sol');
  ourOrbits.delete('deep space');

  // Genuinely hostile inbound transfers <= 365 days
  const hostiles = asArray(filteredSnapshot.fleets).filter(f =>
    isGenuinelyHostileFaction(f.factionId, f.factionName, filteredSnapshot)
  );
  const inboundThreats = [];

  for (const f of hostiles) {
    if (!f.arrivalDate && !f.destination) continue;
    const destOrbit = normalizeBody(f.destination);
    const destId = num(f.destinationId);
    const targetsOurHab = destId !== null && ourHabIds.has(destId);
    const targetsOurOrbit = destOrbit && ourOrbits.has(destOrbit);

    if (!targetsOurHab && !targetsOurOrbit) continue;

    let daysRemaining = null;
    if (f.arrivalDate && gameDate && !Number.isNaN(gameDate.getTime())) {
      const arr = new Date(f.arrivalDate);
      if (!Number.isNaN(arr.getTime())) {
        daysRemaining = Math.max(0, Math.round((arr - gameDate) / MS_PER_DAY));
      }
    }

    if (daysRemaining !== null && daysRemaining > 365) continue;

    inboundThreats.push({
      fleet: f,
      daysRemaining: daysRemaining ?? 9999,
      targetHab: targetsOurHab ? ourHabMap.get(destId) : null,
      destBody: destOrbit
    });
  }

  // Sort strictly by time-to-impact (arrival ascending)
  inboundThreats.sort((a, b) => a.daysRemaining - b.daysRemaining);

  // Detection coverage assessment
  const hasVisibleHostiles = hostiles.length > 0;
  const alienStage = filteredSnapshot.alienIntelligenceStage;
  const deepSkywatch = filteredSnapshot.capabilities?.deepSkywatch || alienStage?.operations?.active;
  let detectionLabel = 'Active Deep System Skywatch';
  if (!deepSkywatch && !hasVisibleHostiles) {
    detectionLabel = 'NO DETECTION COVERAGE — Skywatch inactive; unobserved space may contain undetected forces';
  } else if (hasVisibleHostiles) {
    detectionLabel = hostiles[0].visibility || 'Active Deep System Skywatch';
  }

  // The alien total-war gate, as one header line.
  //
  // It is a STRATEGIC clock, and /latest-war-room.md §1 already carries the
  // full derivation, so the case for repeating it in a TACTICAL document is
  // not automatic. What settles it is the horizon: this document reports
  // inbound contacts within 365 days, and on the live save the year gate is
  // 1.09 years -- about 398 days -- away. A reader planning the next year of
  // contacts is planning inside the window in which the gate opens, and the
  // document said nothing about it. One line, no derivation.
  //
  // Read off `alienHateEconomics.totalWar`, the same object the war room and
  // /api/intel/alien-threat publish, so the three cannot disagree on a value.
  // A gate that could not be evaluated renders UNAVAILABLE; it never degrades
  // into "safe", and no missing figure becomes a confident 0.
  const hateEconomics = filteredSnapshot.alienHateEconomics || null;
  const totalWar = hateEconomics && hateEconomics.totalWar ? hateEconomics.totalWar : null;
  let totalWarLine;
  if (hateEconomics && hateEconomics.applicable === false) {
    totalWarLine = `**Alien Total War Gate:** NOT APPLICABLE to ${observerName}`;
  } else if (totalWar) {
    totalWarLine = `**Alien Total War Gate:** ${String(totalWar.state || 'unavailable').toUpperCase()}`
      + ` — ${fixedOr(totalWar.yearsRemaining, 2)} yrs to the year gate`
      + ` (${fixedOr(totalWar.yearsThreshold, 1)} yr gate, ${fixedOr(totalWar.alienProgressionSpeed, 2)}× progression),`
      + ` hate distance ${fixedOr(totalWar.hateRemaining, 1)} — derivation in /latest-war-room.md §1`;
  } else {
    // A snapshot published before the gate was computed genuinely has no
    // verdict to show. It says so; it does not borrow "safe" from the absence.
    totalWarLine = `**Alien Total War Gate:** UNAVAILABLE — this snapshot carries no total-war gate`;
  }

  const blocks = [];

  blocks.push(fixedBlock('title', [
    `# TI Tactical Threat Assessment`,
    ``,
    `**Date:** ${meta.gameTimeString || 'Unknown'}`,
    `**Observer Faction:** ${observerName}`,
    `**Intelligence Mode:** ${mode}`,
    `**Detection Status:** ${detectionLabel}`,
    totalWarLine,
    // Whole-board hostile-movement headline -- printed under every threat
    // assessment because the inbound-to-our-habs list alone collapses two
    // completely different threat pictures. UNREAD renders as "was not read",
    // never "no movement".
    hostileMovementLine(filteredSnapshot),
    ``
  ]));

  const noThreatLines = (!hasVisibleHostiles && !deepSkywatch)
    ? [
      `> **NO DETECTION COVERAGE**`,
      `> No space surveillance capability active. Zero observed hostile transfers does not indicate absence of threats.`,
      ``
    ]
    : [
      `*No hostile transfers inbound to observer assets detected within 365 days under active detection coverage.*`,
      ``
    ];

  const inboundBlock = listBlock('inbound-threats', {
    headingLines: [`## Immediate Inbound Threats (≤ 365 Days)`, ``],
    emptyLines: noThreatLines,
    budgetEmptyLines: budgetEmptyNote('inbound hostile transfers', '/api/intel/fleets'),
    budgetNote: budgetOmissionNote('inbound hostile transfers', '/api/intel/fleets'),
    detailNote: (levelCounts, kept) => [
      `*Weapon-loadout, interception-state and reinforcement lines suppressed to fit the size budget `
      + `for ${levelCounts[0]} of ${kept} listed contacts, least imminent first; see /api/intel/fleets.*`,
      ``
    ]
  });
  blocks.push(inboundBlock);

  for (const item of inboundThreats) {
    const f = item.fleet;
    const days = item.daysRemaining < 9999 ? `${item.daysRemaining} days` : 'ETA Unknown';
    const arrivalFormatted = f.arrivalDate ? f.arrivalDate.split('T')[0] : 'Unknown date';
    const hostileWeapons = extractWeaponAndPdSummary(f);

    // Defending forces stationed at destination
    const defendingFleets = ourFleets.filter(other => normalizeBody(other.orbitBody) === item.destBody);
    const defendingShipCount = defendingFleets.reduce((sum, other) => sum + (Number(other.shipsCount) || 0), 0);
    let defendingPdTotal = 0;
    for (const dFleet of defendingFleets) {
      const dWeapons = extractWeaponAndPdSummary(dFleet);
      defendingPdTotal += dWeapons.pdCount;
    }

    // Construction completing before arrival at destination
    const completingQueues = asArray(filteredSnapshot.shipyardQueues).filter(q => {
      if (!sameId(q.factionId, observerId)) return false;
      if (normalizeBody(q.orbitBody) !== item.destBody) return false;
      if (!q.completionDate || !f.arrivalDate) return true;
      return new Date(q.completionDate) <= new Date(f.arrivalDate);
    });

    const headerLine = `### ⚠️ ${f.displayName} (${f.factionName || 'Hostile'}) — ETA: ${arrivalFormatted} (${days})`;
    const forceLine = `- **Inbound Force:** ${f.shipsCount ?? 'Unknown'} ships | Dominant Weapon: ${hostileWeapons.dominantWeapon || 'Unknown'}`;
    const loadoutLine = `- **Weapon Loadout:** ${hostileWeapons.summary} (${hostileWeapons.pdCount} Point Defense systems)`;
    const trajectoryLine = `- **Trajectory:** ${f.orbitBody || 'Deep Space'} → ${f.destination || 'Observer Asset'} (Target: ${item.targetHab?.displayName || f.destination || 'Station/Orbit'})`;
    const interceptLine = `- **Interception / Pursuit State:** UNAVAILABLE (Game save format does not track interception orders)`;
    const defenceLine = `- **Defending Forces at Destination:** ${defendingShipCount} friendly ships stationed at ${item.destBody || 'destination'} (${defendingPdTotal} Point Defense systems)`;

    let reinforcementLine;
    if (completingQueues.length > 0) {
      const queueDesigns = completingQueues.map(q => {
        const info = designLookup.get(q.design || q.hull);
        return info ? info.displayName : (q.design || q.hull || 'Ship');
      });
      reinforcementLine = `- **Reinforcements Completing Before ETA:** ${completingQueues.length} ship(s) (${queueDesigns.join(', ')})`;
    } else {
      reinforcementLine = `- **Reinforcements Completing Before ETA:** None queued at destination`;
    }

    const full = [headerLine, forceLine, loadoutLine, trajectoryLine, interceptLine, defenceLine, reinforcementLine];

    // Hab defenses at destination if specific hab is targeted
    if (item.targetHab) {
      const habAgg = habModulesAgg.get(Number(item.targetHab.ID));
      if (habAgg) {
        full.push(`- **Target Hab Defense Modules:** ${habAgg.defense} defense array(s) | ${habAgg.shipyards} shipyard(s)`);
      }
    }
    full.push(``);

    addEntry(inboundBlock, {
      // Ordered by time-to-impact, so the latest arrival is the first to give
      // way. A 6-ship fleet arriving in 40 days outranks a 40-ship fleet
      // arriving in 300.
      rank: [
        item.daysRemaining,
        -(num(f.shipsCount) ?? 0),
        num(f.ID) ?? Number.MAX_SAFE_INTEGER,
        String(f.displayName || '')
      ],
      variants: [
        full,
        [headerLine, forceLine, trajectoryLine, defenceLine, ``]
      ]
    });
  }

  // Theaters & Assets at Immediate Risk

  const bodiesAtRisk = new Set(inboundThreats.map(t => t.destBody).filter(Boolean));
  // Add orbits where genuine hostile fleets are currently co-located with friendly assets (excluding sol)
  for (const h of hostiles) {
    const b = normalizeBody(h.orbitBody);
    const ships = num(h.shipsCount) ?? (Array.isArray(h.ships) ? h.ships.length : 0);
    if (b && ourOrbits.has(b) && b !== 'sol' && b !== 'deep space' && ships >= 5) {
      bodiesAtRisk.add(b);
    }
  }

  const theatreBlock = listBlock('risk-theaters', {
    headingLines: [`## Theaters & Assets at Immediate Risk`, ``],
    emptyLines: [`*No observer theater currently has co-located or inbound hostile fleets.*`],
    budgetEmptyLines: budgetEmptyNote('at-risk theaters', '/api/intel/theaters'),
    budgetNote: budgetOmissionNote('at-risk theaters', '/api/intel/theaters'),
    detailNote: (levelCounts, kept) => [
      `*Per-theater hab inventories suppressed to fit the size budget for `
      + `${levelCounts[0]} of ${kept} listed theaters, least pressured first; see /api/intel/habs.*`,
      ``
    ]
  });
  blocks.push(theatreBlock);

  for (const bodyKey of bodiesAtRisk) {
    const bodyHabs = ourHabs.filter(h => normalizeBody(h.orbitBody) === bodyKey);
    const bodyFleets = ourFleets.filter(f => normalizeBody(f.orbitBody) === bodyKey);
    const bodyHostiles = hostiles.filter(h => normalizeBody(h.orbitBody) === bodyKey);
    const bodyInbound = inboundThreats.filter(t => t.destBody === bodyKey);
    const hostileShips = bodyHostiles.reduce((s, f) => s + (Number(f.shipsCount) || 0), 0);

    const capitalizedBody = bodyHabs[0]?.orbitBody || bodyFleets[0]?.orbitBody || bodyKey;
    const summary = [
      `### ${capitalizedBody}`,
      `- **Friendly Assets:** ${bodyHabs.length} hab(s), ${bodyFleets.reduce((s, f) => s + (Number(f.shipsCount) || 0), 0)} ships`,
      `- **Hostile Contacts Present:** ${bodyHostiles.length} fleet(s) (${hostileShips} ships)`,
      `- **Hostile Transfers Inbound:** ${bodyInbound.length} fleet(s)`
    ];
    const full = summary.slice();
    for (const h of bodyHabs) {
      const agg = habModulesAgg.get(Number(h.ID));
      full.push(`  - **${h.displayName}** (Tier ${h.tier || 1} ${h.habType || 'Hab'}): ${agg?.defense || 0} Defenses | ${agg?.shipyards || 0} Shipyards | ${agg?.mines || 0} Mines`);
    }
    full.push(``);

    addEntry(theatreBlock, {
      // A theater with hostiles actually inbound outranks one that merely has
      // a hostile fleet parked in it; then by hostile mass present.
      rank: [
        bodyInbound.length > 0 ? 0 : 1,
        -hostileShips,
        -bodyInbound.length,
        String(bodyKey)
      ],
      variants: [full, [...summary, ``]]
    });
  }

  // Per-fleet battle composition.
  //
  // THIS SECTION USED TO PRINT HULL COUNTS, AND THEY CAME OUT ON 2026-08-28.
  // Every row carried `Hulls needed: 54-58 hulls` and the preamble carried
  // `best design Cimarron rated 19,783`, both denominated in
  // `_unnormalizedCombatValue`. docs/engagement-matchup-spec.md abandons that
  // currency for three separate reasons, any one disqualifying: a scalar cannot
  // express a matchup (2 PD mounts against a 24-missile salvo); `readOwnForce`
  // takes the observer's HIGHEST design value and applies it to every hull
  // present (58 designs spanning 638,067 down to 0, so a Conger at 1,537 was
  // rated as a Kivu); and in player mode the opponent rating rests on an
  // invented x1.5 and over-rates the enemy 9-15x per body. The war room's
  // equivalent came out in d0a671d and was replaced by §1d.
  //
  // WHAT REPLACES IT IS THE SAME COMPOSITION §1d USES, per fleet rather than
  // per board -- `composeBattleSide` and `saturationVerdict` from
  // shared/battleComposition.mjs, called, never reimplemented, so the two
  // documents cannot disagree about a shot count.
  //
  // WHAT SURVIVED THE REMOVAL, AND WHY. Reachability, arrival timing, fleet
  // identity and the ranking are NOT combat-value derived -- they come from the
  // delta-V table, the save's arrival dates and the fleet records -- so they are
  // kept whole, and `buildFleetEngagement` remains the source of all four. Its
  // requirement band, its `fieldable` verdict and its own-force rating are the
  // parts that are, and none of them is read here any more.
  //
  // THE ONE THING THIS INHERITS AND CANNOT FIX HERE: `buildFleetEngagement`
  // refuses whole when the observer has no design carrying a combat value,
  // which now gates readings that do not need one. The block says so in that
  // branch rather than pretending the composition was unavailable.
  const engagement = buildFleetEngagement(filteredSnapshot, {
    observerId,
    mode: filteredSnapshot.mode || 'player',
    limit: 8
  });

  // The same weapon index §1d builds, from the same `componentStats` the
  // snapshot carries in both runtimes. An absent catalogue means the
  // composition was NOT READ -- never that a fleet fields no weapons.
  const threatWeaponTemplates = weaponTemplatesFromComponentStats(filteredSnapshot?.componentStats);
  const threatWeaponIndex = threatWeaponTemplates.length > 0
    ? buildWeaponIndex(threatWeaponTemplates)
    : null;
  const fleetsById = new Map(asArray(filteredSnapshot?.fleets).map(f => [String(f.ID), f]));
  const ourShipsByBody = new Map();
  for (const fleet of ourFleets) {
    const key = normalizeBody(fleet.orbitBody);
    if (!key) continue;
    if (!ourShipsByBody.has(key)) ourShipsByBody.set(key, []);
    ourShipsByBody.get(key).push(...asArray(fleet.ships));
  }
  const ourShipsEverywhere = ourFleets.flatMap(fleet => asArray(fleet.ships));
  const ourSide = threatWeaponIndex && ourShipsEverywhere.length > 0
    ? composeBattleSide(ourShipsEverywhere, { weaponIndex: threatWeaponIndex })
    : null;

  const compositionPreamble = threatWeaponIndex === null
    ? [
      `- **Composition NOT READ** — this snapshot carries no \`componentStats\` weapon catalogue, so no `
      + `weapon name could be joined to a template and no fleet's point defence, throw weight or PD-immune `
      + `count could be composed. This is NOT a report that these fleets are unarmed, and it is NOT a zero: `
      + `re-publish the snapshot after upgrading. Per-fleet weapon tallies remain at /api/intel/fleets.`
    ]
    : [
      ourSide
        ? battleSideLine('YOUR SCREEN', ourSide, '', shipsWithoutLoadout(ourShipsEverywhere))
        : `- **YOUR SCREEN:** no observer ship is carried in this snapshot's fleet list, so no own-side `
          + `composition was formed. That is an absent reading, not a fleet of zero hulls.`
    ];

  const engagementBlock = listBlock('engagement-estimates', {
    headingLines: [
      `## Per-Fleet Battle Composition — READINGS, NOT A COMBAT-VALUE SCORE`,
      ``,
      ...(engagement.available
        ? [
          // MODE-CORRECT, and the distinction matters. Two of the spec's three
          // reasons apply in BOTH modes; the invented x1.5 is a PLAYER-mode
          // defect only -- omniscient reads the aliens' own design values. A
          // preamble that told an omniscient reader his ratings rested on an
          // invented constant would be a different lie in the same place.
          `*No hull count and no combat-value rating is published here. `
          + `docs/engagement-matchup-spec.md abandoned that currency, and two of its reasons hold in EITHER `
          + `mode: a scalar cannot express a matchup (2 PD mounts against a 24-missile salvo), and the `
          + `own-side rating applied the observer's single best design to every hull — 58 designs spanning `
          + `638,067 down to 0.`
          + `${engagement.mode === 'omniscient'
            ? ` In OMNISCIENT mode the alien ratings are at least read from their own designs; treating a `
              + `combat value as the exchange currency is still the assumption the spec rejects.`
            : ` In PLAYER mode the opponent rating additionally rests on an invented ×1.5 no game source `
              + `states, and over-rates the enemy 9–15× per body.`}`
          + ` What is here instead are the game's own weapon and armour fields, composed the way war-room `
          + `§1d composes them. Ordered by threat to observer assets; full ordering basis and every fleet at `
          + `/api/intel/fleet-engagement, per-fleet weapon tallies at /api/intel/fleets.*`,
          ``,
          ...compositionPreamble,
          `- **Hostile fleets tracked:** ${engagement.fleetsTotalCount} `
          + `(${engagement.shipsTotalCount} ships) — reachability `
          + `${Object.entries(engagement.reachabilityTotals).map(([k, v]) => `${v} ${k}`).join(', ') || 'not evaluated'}`,
          `- **Reach gates WHERE, not WHETHER:** a fleet beyond every observer fleet's ΔV is NOT withheld a `
          + `composition — you may not be able to reach it, but it can still reach you. A reachability that `
          + `could not be evaluated is labelled unknown and never read as no threat. Which fleets appear `
          + `below is the ranking's decision, and the count at the end of the section says how many it left `
          + `out.`,
          ...(threatWeaponIndex === null
            ? []
            : [`- *A screen is composed from the observer's ships AT that fleet's engagement point, so `
              + `"NO SCREEN THERE" is an absence of YOUR hulls at that body and never a point defence that `
              + `failed. The rules behind each verdict are not the same kind of claim: `
              + `${INTERCEPTION_ASSUMPTION.claim} is a stated mechanic (${INTERCEPTION_ASSUMPTION.source}, `
              + `${INTERCEPTION_ASSUMPTION.stated}); the ×${PD_OVERWHELM_MULTIPLE} screen multiple is a rule `
              + `of thumb (${PD_OVERWHELM_RULE_ATTRIBUTION.stated}, "probably", "a safe bet"). Neither was `
              + `read from the game files, and ${INTERCEPTION_ASSUMPTION.consequence}. PD-immune weapons are `
              + `reported beside each verdict and never inside it.*`]),
          ``
        ]
        : [
          `*No per-fleet composition: ${engagement.reason} Reachability, arrival timing and the ranking `
          + `come from the same resource, so they are unavailable with it — the weapon and armour readings `
          + `themselves are not, and the whole-board pair is in /latest-war-room.md §1d.*`,
          ``
        ])
    ],
    emptyLines: [],
    budgetEmptyLines: budgetEmptyNote('per-fleet compositions', '/api/intel/fleet-engagement'),
    budgetNote: budgetOmissionNote('per-fleet compositions', '/api/intel/fleet-engagement'),
    detailNote: (levelCounts, kept) => [
      `*Composition and reachability detail suppressed to fit the size budget for `
      + `${levelCounts[0]} of ${kept} listed fleets; see /api/intel/fleets.*`,
      ``
    ]
  });
  blocks.push(engagementBlock);

  for (const row of asArray(engagement.items)) {
    const headerLine = `### ${row.fleetName} — ${row.shipsCount ?? 'unknown'} ships`
      + `${row.distinctHullTypes ? ` / ${row.distinctHullTypes} hull types` : ''}`;
    const forceLine = `- **At:** ${row.orbitBody || 'unknown'}`
      + `${row.destination ? ` → ${row.destination}${row.daysToArrival === null ? '' : ` in ${row.daysToArrival}d` }` : ' (stationary)'}`
      + ` · ${row.dominantWeaponType || 'weapon mix unknown'}`;
    const reachLine = `- **Reach:** ${row.reachability.state.toUpperCase()}`
      + ` (${row.reachability.isEstimate ? 'estimate' : 'measured'})`
      + `${row.engagementPoint.body ? ` at ${row.engagementPoint.body}` : ''}`
      + `${row.reachability.reason ? ` — ${row.reachability.reason}` : ''}`;

    const [compositionLine, saturationRowLine] =
      threatCompositionLines(row, { fleetsById, weaponIndex: threatWeaponIndex, ourShipsByBody });

    const full = [headerLine, forceLine, reachLine, compositionLine, saturationRowLine, ``];

    addEntry(engagementBlock, {
      // Same order the resource ranks in, re-expressed as a tuple: engageable
      // first, asset-threatening next, then urgency inside that group and mass
      // outside it. `buildFleetEngagement` already sorted; this keeps the
      // budget pass shedding from the least relevant end.
      rank: [
        row.reachability.state === FLEET_REACHABILITY_STATES.beyondDeltaV ? 1 : 0,
        row.threatensObserverAsset ? 0 : 1,
        row.threatensObserverAsset ? (row.daysToArrival ?? Number.MAX_SAFE_INTEGER) : -(row.shipsCount ?? 0),
        row.threatensObserverAsset ? -(row.shipsCount ?? 0) : (row.daysToArrival ?? Number.MAX_SAFE_INTEGER),
        String(row.fleetId ?? '')
      ],
      // Level 1 keeps the incoming-salvo verdict and sheds the composition
      // breakdown: which fleet, whether you can get to it, and whether its
      // salvo gets through your screen is the irreducible answer, and the mount
      // breakdown behind it is at /api/intel/fleets.
      variants: [full, [headerLine, reachLine, saturationRowLine, ``]]
    });
  }

  if (engagement.available && engagement.fleetsOmittedCount > 0) {
    engagementBlock.trailingLines = [
      `*${engagement.items.length} of ${engagement.fleetsTotalCount} hostile fleets shown; `
      + `${engagement.fleetsOmittedCount} omitted by the ranking, not by the budget. `
      + `Full set at /api/intel/fleet-engagement.*`,
      ``
    ];
  }

  // Degradation order for /latest-threats.md. The inbound-contact list IS the
  // document -- the theater roll-up is supporting context, so it gives way
  // first, and detail is shed before whole entries are cut. The per-fleet
  // compositions keep their position at the front of the ladder: they are
  // readings now rather than a model, but they are readings about fleets the
  // contact list ALREADY names, so shedding a duplicate before a unique row is
  // still the right order. The block's `*OmittedCount` trailing note survives
  // whatever the ladder does to the rows.
  const ladder = [
    { block: 'engagement-estimates', action: 'reduce', toLevel: 1 },
    { block: 'risk-theaters', action: 'reduce', toLevel: 1 },
    { block: 'inbound-threats', action: 'reduce', toLevel: 1 },
    { block: 'engagement-estimates', action: 'drop' },
    { block: 'risk-theaters', action: 'drop' },
    { block: 'inbound-threats', action: 'drop' }
  ];
  const clampOrder = ['engagement-estimates', 'risk-theaters', 'inbound-threats'];
  const maxBytes = isMeasured(options.maxBytes) ? Number(options.maxBytes) : THREATS_BYTE_BUDGET;

  return renderWithByteBudget(blocks, ladder, clampOrder, maxBytes);
}

/**
 * The war room's headline note on template-name localisation. The catalogue
 * covers drives, weapons, hab modules, hulls, projects and effects: every
 * proper noun this document renders that did not come from a faction or
 * nation name. Two failure modes have to be visible:
 *
 *   1. **Coverage is absent** from the snapshot -- the Cloudflare Worker and
 *      the synthetic test fixture never carry it. Saying "0 localised, 462
 *      fallback" here would be a lie; the measurement was not made.
 *   2. **The localisation directory could not be read** -- different install
 *      path, Steam library on another drive, modded install. `available` is
 *      false, every template name the document prints silently reverts to
 *      the template's internal friendlyName, and every AI consumer reports
 *      "Neutron Flux Lantern" as if it were the drive's name. A reader must
 *      not be able to mistake this for the healthy case.
 *
 * When coverage IS available and healthy, one line is enough -- the per-file
 * block already lives at `/api/intel/localization-coverage` and the per-family
 * detail does not belong in a 30 KB war-room brief.
 *
 * @returns {string[]} markdown lines WITHOUT a trailing blank; caller pads.
 */
function localizationCoverageLines(filteredSnapshot) {
  const coverage = filteredSnapshot.localizationCoverage;
  if (!coverage || typeof coverage !== 'object') {
    // ABSENT. This is the hosted-Worker / synthetic-fixture case. "Was not
    // read" is the honest answer; it must not collapse into "fine" or "zero".
    return [
      '**Template names:** UNAVAILABLE -- localisation coverage was not read for this snapshot. '
        + 'Every template-sourced name in this document (drives, weapons, hab modules, hulls, '
        + 'projects) is the internal friendlyName from the game template, NOT the name the game '
        + 'shows on screen. Do not treat them as player-facing labels.'
    ];
  }

  if (coverage.available !== true) {
    // DIRECTORY UNREADABLE. The measurement ran but the install had no
    // localisable files to read. Every name this document prints for drives,
    // weapons, hab modules, hulls and projects reverts to the template's
    // internal friendlyName -- "Neutron Flux Lantern" not "Poseidon Lantern",
    // "Advanced Orion Drive" not "H-Orion Drive". A reader cannot tell this
    // apart from the healthy case without this line.
    const dir = coverage.directory ? ` (resolved at \`${coverage.directory}\`)` : '';
    return [
      `**Template names:** UNREADABLE -- the game's localisation directory could not be read${dir}. `
        + 'Every template-sourced name in this document (drives, weapons, hab modules, hulls, '
        + 'projects) is the internal friendlyName from the game template, NOT the name the game '
        + 'shows on screen. Treat them as internal identifiers.'
    ];
  }

  // HEALTHY. One line. Per-family detail rides on the snapshot as localizationCoverage.
  const totals = coverage.totals || {};
  const scanned = Number(totals.scanned) || 0;
  const localized = Number(totals.localized) || 0;
  const fallback = Number(totals.fallback) || 0;
  const divergent = Number(totals.divergent) || 0;
  const ambiguous = Number(totals.ambiguous) || 0;
  const unidentified = Number(totals.unidentified) || 0;
  const unreadable = Array.isArray(coverage.unreadableFiles) ? coverage.unreadableFiles.length : 0;
  const lang = coverage.language ? ` (${coverage.language})` : '';
  return [
    `**Template names (localisation${lang}):** ${localized}/${scanned} entries game-localised; `
      + `${divergent} rendered under a different name than the template friendlyName; `
      + `${fallback} carried no entry and reverted to the internal friendlyName; `
      + `${ambiguous} ambiguous (shared label kept as template name); `
      + `${unidentified} unidentifiable; `
      + `${unreadable} template file(s) unreadable.`
  ];
}

// ---------------------------------------------------------------------------
// 2. /latest-war-room.md  (20-30 KB)
// ---------------------------------------------------------------------------

export function renderWarRoomMarkdown(filteredSnapshot, options = {}) {
  const meta = filteredSnapshot.metadata || {};
  const observerId = filteredSnapshot.observerFactionId;
  const observer = resolveObserverFaction(filteredSnapshot.factions, observerId, {
    fallbackToFirst: true
  });
  const observerName = observer?.displayName || INITIATIVE_DISPLAY_NAME;
  const mode = (filteredSnapshot.mode || 'player').toUpperCase();
  const gameDate = meta.gameTimeString ? new Date(meta.gameTimeString) : null;

  const designLookup = buildDesignLookup(filteredSnapshot.shipDesigns);
  const habModulesAgg = buildHabModuleAggregates(filteredSnapshot.habModules);

  const ourHabs = asArray(filteredSnapshot.habs).filter(h => sameId(h.factionId, observerId));
  const ourHabIds = new Set(ourHabs.map(h => Number(h.ID)));
  // Section 4 reads this to name the specific hab a hostile transfer is aimed
  // at. It was referenced but never declared here, so any hostile fleet whose
  // destinationId matched one of ours threw a ReferenceError and took the
  // whole export down. No fleet on the current save triggers it.
  const ourHabMap = new Map(ourHabs.map(h => [Number(h.ID), h]));
  const ourFleets = asArray(filteredSnapshot.fleets).filter(f => sameId(f.factionId, observerId));
  const ourOrbits = new Set([
    ...ourHabs.map(h => normalizeBody(h.orbitBody)).filter(Boolean),
    ...ourFleets.map(f => normalizeBody(f.orbitBody)).filter(Boolean)
  ]);
  ourOrbits.delete('sol');
  ourOrbits.delete('deep space');
  const blocks = [];
  blocks.push(fixedBlock('title', [
    `# TI Strategic War Room Briefing`,
    ``,
    `**Date:** ${meta.gameTimeString || 'Unknown'}`,
    `**Observer Faction:** ${observerName}`,
    `**Intelligence Mode:** ${mode}`,
    // `difficultyLabel` names the customisation when the campaign carries one,
    // so a save running four rates at 200% never exports as plain "Normal".
    // The `|| 'Normal'` that used to close this line invented a difficulty for
    // a save that never stated one; an unread difficulty now says so.
    `**Difficulty:** ${meta.difficultyLabel || meta.difficulty || 'UNAVAILABLE'}`,
    // Localisation coverage for template-sourced proper nouns (drives,
    // weapons, hab modules, hulls, projects). The Cloudflare Worker does not
    // compute this; the absent branch is loud on purpose -- the reader must
    // not mistake "was not read" for "fine".
    ...localizationCoverageLines(filteredSnapshot),
    ``
  ]));

  // -------------------------------------------------------------------------
  // SECTION 1: ALIEN THREAT & HATE ECONOMICS
  // -------------------------------------------------------------------------
  const alienThreatLines = [];

  const economics = filteredSnapshot.alienHateEconomics;
  if (!economics || !economics.applicable) {
    alienThreatLines.push(`- Alien hate economics not applicable to ${observerName}.`);
  } else {
    const actualHate = isMeasured(economics.actualAlienHate)
      ? Number(economics.actualAlienHate).toFixed(2)
      : (economics.visibleHateEstimate || 'UNAVAILABLE');
    const actualLabel = isMeasured(economics.actualAlienHate)
      ? 'Raw-save actual hate'
      : (economics.visibleHateEstimate ? 'Game-visible hate estimate' : 'Actual hate');

    alienThreatLines.push(`- **${actualLabel}:** ${actualHate}`);
    alienThreatLines.push(`- **Minimum Alien Hate Floor:** ${fixedOr(economics.minimumAlienHate, 2)}`);
    alienThreatLines.push(`- **Hate Above Floor:** ${fixedOr(economics.hateAboveFloor, 2)}`);
    alienThreatLines.push(`- **War Threshold:** ${fixedOr(economics.warThreshold, 2)} (crossing triggers retaliation / war footing)`);
    alienThreatLines.push(`- **Headroom to 50-Hate War Floor:** ${fixedOr(economics.minimumHateHeadroom, 2)}`);
    alienThreatLines.push(`- **Mission Control Used:** ${fixedOr(economics.usedMissionControl, 0)} / ${fixedOr(economics.missionControlCapacity, 0)} capacity`);
    alienThreatLines.push(`- **MC Threshold for 50-Hate Floor:** ${fixedOr(economics.mcWarFloor, 1)} used MC`);
    alienThreatLines.push(`- **Current War Footing:** ${economics.currentWarStatus || 'UNAVAILABLE'}`);
    alienThreatLines.push(`- **Hate Formula:** \`${economics.formula?.text || 'UNAVAILABLE'}\``);

    // Venting and Total War
    if (economics.totalWar) {
      const tw = economics.totalWar;
      alienThreatLines.push(`- **Total War Proximity:** State: ${tw.state?.toUpperCase() || 'SAFE'} | Hate Distance: ${fixedOr(tw.hateRemaining, 1)} | Year Distance: ${fixedOr(tw.yearsRemaining, 1)} yrs`);
      // Both halves of the gate, with their provenance. Until 2026-08-21 the
      // year distance above was the whole story on this surface and it was
      // wrong by six years: the gate was published at the unscaled 20 and the
      // campaign age at an assumed 13. Each input now says where it came from,
      // because "7 years" and "1.1 years" look equally confident on their own.
      alienThreatLines.push(
        `- **Total War Year Gate:** ${fixedOr(tw.yearsThreshold, 1)} yrs required | `
        + `${fixedOr(tw.yearsElapsed, 2)} elapsed | Alien Progression Speed `
        + `${fixedOr(tw.alienProgressionSpeed, 2)}× (${tw.progressionSpeedAssumed ? 'ASSUMED — not read from this save' : 'measured from save'})`
      );
      alienThreatLines.push(
        `- **Campaign Age Source:** ${economics.yearsElapsedSource || 'UNAVAILABLE'}`
      );
      alienThreatLines.push(
        `- **Maximum Alien Hate:** ${fixedOr(tw.maximumAlienHate, 0)} (ceiling; the yearly increase is multiplied by Alien Progression Speed)`
      );
    }
    if (economics.venting) {
      alienThreatLines.push(`- **Hate Venting Eligibility:** ${economics.venting.status?.toUpperCase() || 'UNAVAILABLE'} (Guaranteed: ${economics.venting.guaranteed ? 'YES' : 'NO'})`);
      if (Array.isArray(economics.venting.conditions)) {
        // The only unbounded list inside an otherwise fixed section. Capped so
        // the non-degradable residue of the document is bounded by
        // construction; the cap announces itself.
        for (const cond of economics.venting.conditions.slice(0, MAX_VENTING_CONDITIONS)) {
          alienThreatLines.push(`  - Condition: ${cond}`);
        }
        const ventingOmitted = economics.venting.conditions.length - MAX_VENTING_CONDITIONS;
        if (ventingOmitted > 0) {
          alienThreatLines.push(`  - *...and ${ventingOmitted} further venting condition(s) omitted to fit the size budget.*`);
        }
      }
    }
  }
  alienThreatLines.push(``);
  blocks.push(fixedBlock('alien-threat', [`## 1. Alien Threat Posture & Hate Economics`, ``], alienThreatLines));

  // -------------------------------------------------------------------------
  // SECTION 1b: HOSTILE MOVEMENT (WHOLE-BOARD)
  //
  // The theater table is twelve rows; today's hostile fleets are aimed at
  // seven bodies the table does not track. A reader reading the war room
  // expecting the threat picture would otherwise conclude "nothing is
  // moving" -- this section is what stops that collapse. It does not
  // participate in the byte-budget ladder: hostile movement is the reason
  // the rest of the document exists, not a shedding target. The single-line
  // headline also prints at the top of /latest-threats.md; here the embedded
  // block carries the count breakdown + a short off-board destination list.
  blocks.push(fixedBlock('hostile-movement', [`## 1b. Hostile Movement (Whole-Board)`, ``], hostileMovementBlock(filteredSnapshot, { headingLevel: '-', header: '', includeRows: true })));

  // -------------------------------------------------------------------------
  // SECTION 1c: THEATER DEFENCE
  //
  // Section 1b says what is moving. This one says what to DO about it at each
  // body -- build, reinforce, withdraw, hold, or an explicit refusal where the
  // reading a verdict rests on is absent. It sits here, immediately after the
  // movement picture it answers, because the two are one thought.
  //
  // It is ENGINE output, not snapshot data, so this module cannot compute it:
  // `server/engine/theaterDefence.js` is Node CommonJS and this file also runs
  // in the Cloudflare Worker. The serving runtime hands it in, exactly as it
  // hands in the cycle plan for section 10 -- see `pushTheaterDefenceBlock`.
  // -------------------------------------------------------------------------
  pushTheaterDefenceBlock(blocks, filteredSnapshot, observerId, options);

  // -------------------------------------------------------------------------
  // SECTION 1d: BATTLE COMPOSITION & SATURATION
  //
  // 1b says what is moving, 1c says what to do about it, and this says whether
  // the force can fight -- in composition rather than in combat value, which
  // docs/engagement-matchup-spec.md abandoned. Unlike its two neighbours it
  // needs no hand-in from the serving runtime; see the block above
  // `pushBattleCompositionBlock` for why, and for the four properties that
  // would each have made this section lie.
  // -------------------------------------------------------------------------
  pushBattleCompositionBlock(blocks, filteredSnapshot, observerId);

  // -------------------------------------------------------------------------
  // SECTION 2: FRIENDLY FLEETS
  // -------------------------------------------------------------------------
  const friendlyBlock = listBlock('friendly-fleets', {
    headingLines: [
      `## 2. Friendly Fleets (${ourFleets.length} fleets, ${ourFleets.reduce((s, f) => s + (Number(f.shipsCount) || 0), 0)} ships)`,
      ``,
      `*Note: Fleet interception and pursuit state is UNAVAILABLE in the save format.*`,
      ``
    ],
    emptyLines: [`*No friendly warships currently in service.*`, ``],
    budgetEmptyLines: budgetEmptyNote('friendly fleets', '/api/intel/fleets'),
    budgetNote: budgetOmissionNote('friendly fleets', '/api/intel/fleets'),
    detailNote: (levelCounts, kept) => {
      const shed = ['weapon and point-defense', 'propulsion', 'ship manifest and design rollup'];
      const clauses = levelCounts.map((count, i) => `${shed[i]} line for ${count}`);
      return [
        `*Per-fleet detail reduced to fit the size budget, least operationally significant `
        + `fleets first — suppressed ${clauses.join('; ')} of ${kept} listed fleets. `
        + `Full detail at /api/intel/fleets and /api/intel/ship-designs.*`,
        ``
      ];
    }
  });
  blocks.push(friendlyBlock);

  for (const f of ourFleets) {
    const weapons = extractWeaponAndPdSummary(f);
    const missionDesc = f.destination
      ? `Transfer to ${f.destination} (ETA: ${f.arrivalDate ? f.arrivalDate.split('T')[0] : 'Unknown'})`
      : (f.mission || 'Stationary / Patrol');

    const headerLine = `### ${f.displayName} (${f.shipsCount ?? 0} ships | ${f.orbitBody || 'Deep Space'} | ${missionDesc})`;
    const propulsionLine = `- **Propulsion:** Lowest ΔV: ${fixedOr(f.lowestDeltaVKps, 1, 'UNAVAILABLE')} kps | Combat Accel: ${fixedOr(f.lowestCombatAccelerationMps2, 3, 'UNAVAILABLE')} m/s² | Interception State: UNAVAILABLE`;
    const weaponLine = `- **Weapons & Defense:** ${weapons.summary} (${weapons.pdCount} Point Defense systems)`;
    const manifestLines = [`- **Ship Manifest & Design Rollup:**`, ...formatFleetDesignRollup(f, designLookup)];

    const ships = num(f.shipsCount) ?? (Array.isArray(f.ships) ? f.ships.length : 0);
    addEntry(friendlyBlock, {
      // Friendly fleets are the observer's own operational picture, so they
      // shed detail long before they shed entries. When entries must go, a
      // fleet in contact is never cut before a quiet one, then mass decides,
      // then a committed transfer outranks a stationary patrol.
      rank: [
        f.inCombat ? 0 : 1,
        -ships,
        f.destination ? 0 : 1,
        num(f.ID) ?? Number.MAX_SAFE_INTEGER,
        String(f.displayName || '')
      ],
      variants: [
        [headerLine, propulsionLine, weaponLine, ...manifestLines, ``],
        [headerLine, propulsionLine, ...manifestLines, ``],
        [headerLine, ...manifestLines, ``],
        [headerLine, ``]
      ]
    });
  }

  // -------------------------------------------------------------------------
  // SECTION 3: HOSTILE RELEVANT FLEETS
  // -------------------------------------------------------------------------
  const allHostiles = asArray(filteredSnapshot.fleets).filter(f =>
    isGenuinelyHostileFaction(f.factionId, f.factionName, filteredSnapshot)
  );
  const relevantHostiles = [];
  let omittedCount = 0;

  for (const f of allHostiles) {
    const rel = evaluateHostileRelevance(f, ourHabIds, ourOrbits, gameDate);
    if (rel.isRelevant) {
      relevantHostiles.push({ fleet: f, rel });
    } else {
      omittedCount += 1;
    }
  }

  const noRelevantHostileLines = allHostiles.length === 0
    ? [
      `> **No hostile fleets detected.**`,
      `> (Detection coverage: ${filteredSnapshot.capabilities?.deepSkywatch ? 'Deep System Skywatch active' : 'No surveillance coverage active — unobserved space is not empty'}).`,
      ``
    ]
    : [
      `*All ${allHostiles.length} observed hostile fleets are below the relevance threshold (< 5 ships, not targeting observer assets, not sharing theater, arrival > 365 days).*`,
      ``
    ];

  const hostileBlock = listBlock('hostile-fleets', {
    headingLines: [`## 3. Hostile Relevant Fleets`, ``],
    emptyLines: noRelevantHostileLines,
    budgetEmptyLines: budgetEmptyNote('relevant hostile fleets', '/api/intel/fleets'),
    // Two different reasons, two different notices, never merged: the one
    // above says "did not qualify", this one says "qualified but did not fit".
    relevanceOmitted: omittedCount,
    relevanceNote: (n) => [
      `*${n} hostile fleets omitted (below relevance threshold: < 5 ships, not targeting observer assets, not sharing theater, arrival > 365 days).*`,
      ``
    ],
    budgetNote: budgetOmissionNote('relevant hostile fleets', '/api/intel/fleets'),
    detailNote: (levelCounts, kept) => [
      `*Weapon, armour and propulsion detail suppressed to fit the size budget for `
      + `${levelCounts[0]} of ${kept} listed hostile fleets, least relevant first; see /api/intel/fleets.*`,
      ``
    ]
  });
  blocks.push(hostileBlock);

  for (const item of relevantHostiles) {
    const f = item.fleet;
    const weapons = extractWeaponAndPdSummary(f);
    const missionDesc = f.destination
      ? `Transfer to ${f.destination} (ETA: ${f.arrivalDate ? f.arrivalDate.split('T')[0] : 'Unknown'})`
      : (f.mission || 'Stationary / Patrol');

    const headLine = `- **${f.displayName}** (${f.shipsCount ?? 0} ships | ${f.factionName || 'Hostile'} | ${f.orbitBody || 'Deep Space'}) — ${missionDesc} [${item.rel.reasons.join('; ')}]`;
    const detailLine = `  - Weapons: ${weapons.dominantWeapon || 'Unknown'} (${weapons.summary} | ${weapons.pdCount} PD) | Armor: ${fixedOr(f.armorMedian, 1, 'UNAVAILABLE')} cm | ΔV: ${fixedOr(f.lowestDeltaVKps, 1, 'UNAVAILABLE')} kps, Accel: ${fixedOr(f.lowestCombatAccelerationMps2, 2, 'UNAVAILABLE')} m/s²`;

    // Ranked by the same criteria the relevance evaluator already applies, so
    // budget pressure removes the least relevant contact, not the last one.
    addEntry(hostileBlock, { rank: item.rel.rank, variants: [[headLine, detailLine], [headLine]] });
  }

  // -------------------------------------------------------------------------
  // SECTION 4: INCOMING THREATS & TRANSFERS
  // -------------------------------------------------------------------------
  const inboundList = [];
  for (const f of allHostiles) {
    if (!f.arrivalDate && !f.destination) continue;
    const destOrbit = normalizeBody(f.destination);
    const destId = num(f.destinationId);
    const targetsOurHab = destId !== null && ourHabIds.has(destId);
    const targetsOurOrbit = destOrbit && ourOrbits.has(destOrbit);

    if (targetsOurHab || targetsOurOrbit) {
      let daysRemaining = null;
      if (f.arrivalDate && gameDate && !Number.isNaN(gameDate.getTime())) {
        const arr = new Date(f.arrivalDate);
        if (!Number.isNaN(arr.getTime())) {
          daysRemaining = Math.max(0, Math.round((arr - gameDate) / MS_PER_DAY));
        }
      }
      if (daysRemaining === null || daysRemaining <= 365) {
        inboundList.push({
          fleet: f,
          daysRemaining: daysRemaining ?? 9999,
          targetsOurHab: targetsOurHab ? ourHabMap.get(destId) : null,
          destBody: destOrbit
        });
      }
    }
  }

  inboundList.sort((a, b) => a.daysRemaining - b.daysRemaining);

  const incomingBlock = listBlock('incoming-threats', {
    headingLines: [`## 4. Incoming Threats & Transfers`, ``],
    emptyLines: [`*No hostile transfers currently inbound to observer assets.*`],
    // No trailing blank here -- trailingLines already supplies one.
    budgetEmptyLines: (total) => [
      `*All ${total} inbound hostile transfers omitted to fit the size budget; full set at /api/intel/fleets.*`
    ],
    budgetNote: budgetOmissionNote('inbound hostile transfers', '/api/intel/fleets'),
    trailingLines: [``]
  });
  blocks.push(incomingBlock);

  for (const item of inboundList) {
    const f = item.fleet;
    const days = item.daysRemaining < 9999 ? `${item.daysRemaining} days` : 'ETA Unknown';
    const arrivalDate = f.arrivalDate ? f.arrivalDate.split('T')[0] : 'Unknown date';
    const weapons = extractWeaponAndPdSummary(f);
    const targetLabel = item.targetsOurHab?.displayName || f.destination || 'Observer Asset';

    addEntry(incomingBlock, {
      // Sorted and ranked by time-to-impact: the latest arrival is the first
      // to give way, so what remains is always the most imminent.
      rank: [
        item.daysRemaining,
        -(num(f.shipsCount) ?? 0),
        num(f.ID) ?? Number.MAX_SAFE_INTEGER,
        String(f.displayName || '')
      ],
      variants: [[
        `- **${f.displayName}** (${f.shipsCount ?? 0} ships) → Target: **${targetLabel}** | ETA: ${arrivalDate} (${days}) | Force: ${weapons.summary}`
      ]]
    });
  }

  // -------------------------------------------------------------------------
  // SECTION 5: SHIPYARDS & FLEET CONSTRUCTION
  // -------------------------------------------------------------------------
  blocks.push(fixedBlock('construction-heading', [`## 5. Shipyards & Fleet Construction`, ``]));

  const friendlyStations = asArray(filteredSnapshot.shipyardStations).filter(s => sameId(s.factionId, observerId));
  const friendlyQueues = asArray(filteredSnapshot.shipyardQueues).filter(q => sameId(q.factionId, observerId));
  const friendlyModules = asArray(filteredSnapshot.habModules).filter(m =>
    sameId(m.factionId, observerId) && !m.constructionCompleted && !m.destroyed
  );

  const stationBlock = listBlock('construction-stations', {
    headingLines: [`### Active Shipyard Stations (${friendlyStations.length} stations)`],
    emptyLines: [`*No active shipyard stations owned by ${observerName}.*`],
    budgetEmptyLines: budgetEmptyNote('shipyard stations', '/api/intel/shipyards', false),
    budgetNote: budgetOmissionNote('shipyard stations', '/api/intel/shipyards'),
    trailingLines: [``]
  });
  blocks.push(stationBlock);
  for (const s of friendlyStations) {
    const yards = num(s.shipyardModulesCount) ?? num(s.shipyardsCount) ?? 1;
    addEntry(stationBlock, {
      // Most build capacity first; a station with active builds outranks an idle one.
      rank: [-yards, -asArray(s.queue).length, String(s.name || s.displayName || '')],
      variants: [[
        `- **${s.name || s.displayName}** (${s.orbitBody || 'Orbit'} | Tier ${s.tier || 1}): ${s.shipyardModulesCount ?? s.shipyardsCount ?? 1} Yard(s) | Active Builds: ${asArray(s.queue).length}`
      ]]
    });
  }

  const queueBlock = listBlock('construction-queues', {
    headingLines: [`### Ship Construction Queues (${friendlyQueues.length} ship(s) building)`],
    emptyLines: [`*No warships currently under construction.*`],
    budgetEmptyLines: budgetEmptyNote('ship construction queues', '/api/intel/shipyard-queues', false),
    budgetNote: budgetOmissionNote('ship construction queues', '/api/intel/shipyard-queues'),
    trailingLines: [``]
  });
  blocks.push(queueBlock);
  for (const q of friendlyQueues) {
    const designInfo = designLookup.get(q.design || q.hull);
    const designName = designInfo ? `${designInfo.displayName} (${designInfo.hullClass})` : (q.design || q.hull || 'Warship');
    const compDate = q.completionDate ? q.completionDate.split('T')[0] : 'Unknown date';
    const readyAt = q.completionDate ? Date.parse(q.completionDate) : NaN;
    addEntry(queueBlock, {
      // The soonest reinforcement is the one that changes a decision, so a
      // distant completion is cut before an imminent one.
      rank: [Number.isFinite(readyAt) ? readyAt : Number.MAX_SAFE_INTEGER, String(designName)],
      variants: [[
        `- **${designName}** at ${q.orbitBody || 'Station'} — Ready: ${compDate} (Queue ID: ${q.id || 'N/A'})`
      ]]
    });
  }

  if (friendlyModules.length > 0) {
    const moduleBlock = listBlock('construction-modules', {
      headingLines: [`### Hab Modules Under Construction (${friendlyModules.length} module(s))`],
      // Pre-existing hard cap at 10, announced. Distinct from a budget cut.
      relevanceOmitted: Math.max(0, friendlyModules.length - 10),
      relevanceNote: (n) => [`- *...and ${n} additional modules building.*`],
      budgetEmptyLines: budgetEmptyNote('hab modules under construction', '/api/intel/construction', false),
      budgetNote: budgetOmissionNote('hab modules under construction', '/api/intel/construction'),
      trailingLines: [``]
    });
    blocks.push(moduleBlock);
    for (const m of friendlyModules.slice(0, 10)) {
      const compDate = m.completionDate ? m.completionDate.split('T')[0] : 'In progress';
      const readyAt = m.completionDate ? Date.parse(m.completionDate) : NaN;
      addEntry(moduleBlock, {
        rank: [Number.isFinite(readyAt) ? readyAt : Number.MAX_SAFE_INTEGER, String(m.templateName || m.name || '')],
        variants: [[
          `- **${m.templateName || m.name}** at ${m.habName || m.orbitBody || 'Hab'} — Ready: ${compDate}`
        ]]
      });
    }
  }

  // -------------------------------------------------------------------------
  // SECTION 6: KEY HABS & INFRASTRUCTURE
  // -------------------------------------------------------------------------
  const habBlock = listBlock('habs', {
    headingLines: [`## 6. Key Habs & Space Infrastructure (${ourHabs.length} habs)`, ``],
    // Group totals stay true totals; the budget notice reconciles them.
    groupHeader: (bodyName, total) => [`### ${bodyName} (${total} habs)`],
    groupTrailingLines: [``],
    emptyLines: [`*No habs or surface bases owned by ${observerName}.*`],
    budgetEmptyLines: budgetEmptyNote('habs', '/api/intel/habs'),
    budgetNote: budgetOmissionNote('habs', '/api/intel/habs')
  });
  blocks.push(habBlock);

  {
    const habsByBody = new Map();
    for (const h of ourHabs) {
      const b = h.orbitBody || 'Deep Space';
      if (!habsByBody.has(b)) habsByBody.set(b, []);
      habsByBody.get(b).push(h);
    }

    for (const [bodyName, habList] of habsByBody.entries()) {
      for (const h of habList) {
        const agg = habModulesAgg.get(Number(h.ID)) || {
          mines: 0,
          shipyards: 0,
          construction: 0,
          defense: 0,
          research: 0
        };
        const statusFlags = [];
        if (h.inCombat) statusFlags.push('IN COMBAT');
        if (h.underAssault) statusFlags.push('UNDER ASSAULT');
        if (h.underBombardment) statusFlags.push('UNDER BOMBARDMENT');
        const flagText = statusFlags.length ? ` **[${statusFlags.join(', ')}]**` : '';

        // A hab in contact is never dropped ahead of a quiet one; otherwise
        // capability weight decides, so the industrial and defensive centres
        // outlive the empty outposts.
        const contested = statusFlags.length > 0 ? 0 : 1;
        const capability = (agg.shipyards * 4) + (agg.defense * 3) + (agg.construction * 2)
          + agg.mines + agg.research;
        addEntry(habBlock, {
          group: bodyName,
          rank: [contested, -capability, -(num(h.tier) ?? 0), String(h.displayName || '')],
          variants: [[
            `- **${h.displayName}** (Tier ${h.tier || 1} ${h.habType || 'Hab'})${flagText}: ${agg.mines} Mine(s) | ${agg.shipyards} Shipyard(s) | ${agg.construction} Construction | ${agg.defense} Defense(s) | ${agg.research} Lab(s)`
          ]]
        });
      }
    }
  }

  // -------------------------------------------------------------------------
  // SECTION 7: LOGISTICS & WAR ECONOMY
  // -------------------------------------------------------------------------
  const logisticsLines = [];

  const res = observer?.resources || {};
  const net = observer?.monthlyNet || {};

  const resourceEntries = [
    ['Water', res.Water, net.Water, 'tons'],
    ['Volatiles', res.Volatiles, net.Volatiles, 'tons'],
    ['Metals', res.Metals, net.Metals, 'tons'],
    ['Noble Metals', res.NobleMetals, net.NobleMetals, 'tons'],
    ['Fissiles', res.Fissiles, net.Fissiles, 'tons'],
    ['Antimatter', res.Antimatter, net.Antimatter, 'mg'],
    ['Exotics', res.Exotics, net.Exotics, 'tons'],
    ['Money', res.Money, net.Money, '$'],
    ['Boost', res.Boost, net.Boost, 'boost/mo'],
    ['Research', res.Research, net.Research, 'RP/mo']
  ];

  logisticsLines.push(`| Resource | Stockpile | Monthly Net | Runway / Burn |`);
  logisticsLines.push(`| :--- | :--- | :--- | :--- |`);

  for (const [name, stockVal, netVal] of resourceEntries) {
    const stockStr = isMeasured(stockVal) ? Number(stockVal).toLocaleString(undefined, { maximumFractionDigits: 1 }) : 'UNAVAILABLE';
    const netNum = Number(netVal);
    const netStr = isMeasured(netVal) ? `${netNum >= 0 ? '+' : ''}${netNum.toFixed(1)}/mo` : 'UNAVAILABLE';

    let runway = 'Stable / Growing';
    if (isMeasured(stockVal) && isMeasured(netVal) && netNum < 0) {
      const months = Math.max(0, Math.floor(Number(stockVal) / Math.abs(netNum)));
      runway = `⚠️ Deficit: ${months} mo runway`;
    } else if (!isMeasured(stockVal) || !isMeasured(netVal)) {
      runway = 'UNKNOWN';
    }

    logisticsLines.push(`| **${name}** | ${stockStr} | ${netStr} | ${runway} |`);
  }
  logisticsLines.push(``);
  // The mine-output multipliers belong to the war economy, and they sit INSIDE
  // this block rather than beside it so the last-resort clamp can suppress them
  // with the rest of section 7's body. A fixed block that never degrades is
  // fixed overhead in the byte budget, and this document already renders within
  // a few hundred bytes of its ceiling under 20x fleet growth.
  for (const line of miningTechBonusLines(observer, observerId)) logisticsLines.push(line);
  // The control-point cap sits in the war economy for the same reason the mine
  // multipliers do: over cap costs Influence per year and hands every hostile
  // Crackdown / Purge / Enthrall / Dominate a bonus. It rides INSIDE section 7
  // so the last-resort clamp can shed it with the rest of the body.
  for (const line of controlPointCapLines(filteredSnapshot, observerId)) logisticsLines.push(line);
  blocks.push(fixedBlock('logistics', [`## 7. Logistics & War Economy`, ``], logisticsLines));

  // -------------------------------------------------------------------------
  // SECTION 8: ACTIVE RESEARCH & PROJECTS
  // -------------------------------------------------------------------------
  blocks.push(fixedBlock('research-heading', [`## 8. Active Research & Technology Projects`, ``]));

  // Unlocked-technology census.
  //
  // The RECORDS panel added 2026-08-21 lists all 165 of these by name and is
  // searchable; the export carries the COUNT and the route, not the list. The
  // war room runs to a byte budget and 165 project names would crowd out live
  // fleet and threat data for a figure an agent can fetch when it needs it.
  // Both numbers come straight off the filtered snapshot in either mode, so
  // this is not gated on omniscient data.
  //
  // Absent stays absent: a snapshot that does not carry these arrays says so
  // rather than reporting zero unlocked, which would read as a faction that has
  // researched nothing.
  const completedProjectList = Array.isArray(observer?.completedProjects)
    ? observer.completedProjects
    : null;
  const finishedTechList = Array.isArray(filteredSnapshot?.techTree?.finishedTechsNames)
    ? filteredSnapshot.techTree.finishedTechsNames
    : null;

  const censusLines = (completedProjectList === null && finishedTechList === null)
    ? [`*Unlocked-technology census unavailable in this snapshot.*`, ``]
    : [
      `**Unlocked technology:** ${
        completedProjectList === null ? 'projects unavailable' : `${completedProjectList.length} faction projects completed`
      }; ${
        finishedTechList === null ? 'techs unavailable' : `${finishedTechList.length} global techs finished`
      }.`,
      `Searchable by project, unlocked item or effect at \`/api/intel/tech-search?observer=${observerId}&q=<term>\`; full graph at \`/api/intel/tech-tree\`.`,
      ``
    ];

  blocks.push(fixedBlock('unlocked-technology-census', censusLines));

  // The cost basis goes in the HEADING, not in a trailing line: a budget pass
  // that empties this block still renders its heading, and a reader who sees
  // the RP figures must always see what basis they are on.
  const costBasis = researchCostBasisLine(filteredSnapshot);
  const slotBlock = listBlock('research-slots', {
    headingLines: costBasis
      ? [`### Global Research Slots`, ``, costBasis]
      : [`### Global Research Slots`],
    emptyLines: [`*No global research slots tracked.*`],
    budgetEmptyLines: budgetEmptyNote('global research slots', '/api/intel/research', false),
    budgetNote: budgetOmissionNote('global research slots', '/api/intel/research'),
    trailingLines: [``]
  });
  blocks.push(slotBlock);

  const globalSlots = asArray(filteredSnapshot.globalResearch?.activeSlots);
  for (const slot of globalSlots) {
    const pct = isMeasured(slot.percent) ? `${slot.percent}%` : 'UNKNOWN%';
    addEntry(slotBlock, {
      // Nearest to completion is the most decision-relevant, so the least
      // advanced slot is the first to give way. An unmeasured percentage is
      // ranked last rather than treated as zero progress.
      rank: [
        isMeasured(slot.percent) ? -Number(slot.percent) : Number.MAX_SAFE_INTEGER,
        num(slot.slotNumber) ?? Number.MAX_SAFE_INTEGER,
        String(slot.displayName || slot.techId || '')
      ],
      variants: [[
        `- **Slot ${slot.slotNumber ?? '•'}: ${slot.displayName || slot.techId}** — ${pct} (${localeOr(slot.accumulatedResearch)} / ${localeOr(slot.totalCost)} RP) | Leading: ${slot.leadFactionName || 'Unknown'} (${localeOr(slot.leadContribution)})`
      ]]
    });
  }

  const projectBlock = listBlock('research-projects', {
    headingLines: [`### Observer Projects (${observerName})`],
    emptyLines: [`*No faction engineering projects currently active.*`],
    budgetEmptyLines: budgetEmptyNote('observer projects', '/api/intel/research', false),
    budgetNote: budgetOmissionNote('observer projects', '/api/intel/research'),
    trailingLines: [``]
  });
  blocks.push(projectBlock);

  const currentProjects = asArray(observer?.currentProjects);
  for (const cp of currentProjects) {
    const pct = isMeasured(cp.percent) ? `${cp.percent}%` : 'UNKNOWN%';
    const cost = isMeasured(cp.totalCost) ? localeOr(cp.totalCost) : 'UNKNOWN';
    addEntry(projectBlock, {
      rank: [
        isMeasured(cp.percent) ? -Number(cp.percent) : Number.MAX_SAFE_INTEGER,
        String(cp.displayName || cp.projectId || '')
      ],
      variants: [[
        `- **${cp.displayName || cp.projectId}** — ${pct} (${localeOr(cp.accumulatedResearch)} / ${cost} RP)`
      ]]
    });
  }

  // Per-category research bonuses. An agent reading this file otherwise has no
  // way to know a Xenology project runs at +44% while a Materials one runs at
  // +2%, and the largest single contributor -- alien-activity investigations --
  // is in no template at all, so it cannot be reconstructed downstream either.
  const bonusModel = buildResearchCategoryBonuses(filteredSnapshot, { observerId: observer?.ID });
  const bonusBlock = listBlock('research-category-bonuses', {
    headingLines: [`### Research Category Bonuses (${observerName})`],
    emptyLines: [bonusModel.available === true
      ? `*No research category carries a bonus for this observer.*`
      : `*Per-category research bonuses unavailable: ${bonusModel.reason}*`],
    budgetEmptyLines: budgetEmptyNote('research category bonuses', '/api/intel/research-ranking', false),
    budgetNote: budgetOmissionNote('research category bonuses', '/api/intel/research-ranking'),
    trailingLines: [``]
  });
  blocks.push(bonusBlock);

  if (bonusModel.available === true) {
    for (const category of asArray(bonusModel.boostedCategories)) {
      const row = bonusModel.categories[category];
      if (!row) continue;
      const pctOf = (value) => (isMeasured(value) ? `${(Number(value) * 100).toFixed(1)}%` : 'UNKNOWN');
      // The per-type split, so a reader can see which source carries the
      // figure and whether the diminishing-returns curve bit.
      const split = asArray(row.bySourceType)
        .map(group => `${group.sourceType} ${pctOf(group.effectiveBonus)}`
          + (group.diminished ? ` (diminished from ${pctOf(group.summedBonus)})` : ''))
        .join(', ');
      addEntry(bonusBlock, {
        rank: [-(num(row.effectiveBonus) ?? 0), String(category)],
        variants: [[
          `- **${category}**: +${pctOf(row.effectiveBonus)} effective`
            + (split ? ` — ${split}` : '')
            + (row.isLowerBound === true ? ' — LOWER BOUND, a named source could not be read' : '')
        ]]
      });
    }
    // Stated once, not per row: what the figures do and do not do.
    const investigations = num(bonusModel.alienInvestigations);
    bonusBlock.trailingLines = [
      investigations === null
        ? `*Alien-activity investigations: UNAVAILABLE — the Xenology figure omits them rather than counting them as zero.*`
        : `*Includes ${investigations} alien-activity investigation(s) at +1% Xenology each (wiki, Aliens rev 2026-04-05), exempt from diminishing returns.*`,
      `*Durations elsewhere in this brief are FLAT-RATE and do NOT apply these bonuses. The flat rate divides by the whole faction's nominal research income, but a project runs in ONE slot, and on this campaign the four slots measured 0.4658x, 0.2928x, 1.0602x and 0.2928x of that income — they sum to 2.11x, which is a faction-wide throughput and NOT a per-duration correction. A stated duration is therefore too SHORT wherever a slot draws under its even share (three of the four here, by 2.15x to 3.42x) and too long only where it draws over. Treat one as an order-of-magnitude figure, not as a bound in either direction.*`,
      ``
    ];
  }

  // Multi-step research chains, and the reachability gate they had to pass.
  //
  // These two facts existed only in the browser and on
  // /api/intel/research-ranking: a chain PROMOTED into an actionable group is
  // not filed under the project it eventually delivers -- it is filed under the
  // step the player would start now -- and a chain REFUSED by the reachability
  // gate has been removed from the top of a ranking it would otherwise have
  // won. Both are the kind of reordering an agent reading this file cannot
  // reconstruct and would otherwise never learn about, and the refusal in
  // particular is a truncation, so it announces itself here as it does there.
  blocks.push(...researchChainPromotionBlocks(filteredSnapshot, observerId, observerName));

  // -------------------------------------------------------------------------
  // SECTION 9: DRIVE EXPLORER
  //
  // The two halves are rendered in different registers here for the same reason
  // the page does it: delta-V and acceleration are MEASURED against this hull's
  // own mass, while destination reachability is a labelled heuristic estimate.
  // The estimate line says so in its own words rather than relying on the
  // reader to know which is which, and it states that only nine destinations
  // are modelled.
  // -------------------------------------------------------------------------
  // A LIST BLOCK WITH ONE ENTRY, and that is the whole point of the shape.
  //
  // Until 2026-08-28 this was a fixed block with no ladder position, so the
  // ONLY mechanism that could shed it was `clampOrder` -- which runs after the
  // entire ladder is exhausted. In practice that never happens, so a refit
  // what-if for ONE design printed in full while the document shed measured
  // threat readings around it: on the committed fixtures the ladder had already
  // emptied every research entry in section 8 and stripped the weapon, armour
  // and propulsion line from 11 of 21 hostile contacts in section 3, and it was
  // still 406 bytes from the ceiling. This block's own `clampOrder` comment
  // already ranked it "the last thing anyone needs in a war-room brief cut to
  // the bone"; only the mechanism to act on that was missing.
  //
  // ONE entry rather than one per line: half a refit study is not a useful
  // half. It gives way whole, and `budgetEmptyLines` names the endpoint that
  // carries all 541 drives -- the same relationship section 10 has to
  // /api/v2/briefing.
  const driveExplorerBlock = listBlock('drive-explorer', {
    headingLines: [`## 9. Drive Explorer (refit options for one design)`, ``],
    // Deliberately NOT the words `clampOrder` uses ("Section body omitted"):
    // this is a LADDER drop, which happens routinely and early, and the
    // last-resort clamp is a different event a reader must be able to tell it
    // from.
    budgetEmptyLines: () => [
      `*Refit study omitted to fit the size budget — a what-if for one design, carried whole at `
      + `/api/intel/drive-explorer?observer=${observerId}&detail=full&limit=1000.*`,
      ``
    ]
  });
  blocks.push(driveExplorerBlock);
  addEntry(driveExplorerBlock, { rank: [0], variants: [driveExplorerLines(filteredSnapshot, observerId)] });

  // -------------------------------------------------------------------------
  // SECTION 10: COUNCIL CYCLE PLAN -- THE RISK FLOOR AND THE BENCH
  // -------------------------------------------------------------------------
  blocks.push(fixedBlock(
    'council-cycle-plan',
    [`## 10. Council Cycle Plan (risk floor & bench)`, ``],
    councilCyclePlanLines(filteredSnapshot, observerId, options)
  ));

  // -------------------------------------------------------------------------
  // SECTION 11: STRATEGIC COMMENTARY -- THE ENGINE'S READ OF SECTIONS 1-5
  //
  // Everything above this line is measured. Everything in this section is
  // MODELLED off it, and the heading says so before a reader reaches a number.
  //
  // The hull-threshold table and the best-design combat rating it was
  // denominated in came OUT on 2026-08-28: they are the combat-value currency
  // docs/engagement-matchup-spec.md abandons, and printing them three sections
  // below §1d is the "second opinion" that document's own failure list names.
  // See `strategicCommentaryLines` for the full reasoning, what survives, and
  // why the section still says the sweep exists rather than reporting it
  // unavailable.
  // -------------------------------------------------------------------------
  blocks.push(fixedBlock(
    'strategic-commentary',
    [`## 11. Strategic Commentary (MODELLED, not measured)`, ``],
    strategicCommentaryLines(filteredSnapshot, observerId, options)
  ));

  // -------------------------------------------------------------------------
  // DEGRADATION ORDER -- deliberate, and the reason for each position.
  //
  // A war-room brief exists to answer "what can hurt me, and what do I have to
  // answer with". So compaction that keeps every entry listed comes first,
  // then the reference material, and the threat-bearing content survives
  // longest. Each step is applied only as far as the overflow requires, and
  // within a step the least relevant entries always give way first.
  //
  //   1-3.  Research (§8) entries      -- background; nothing here changes
  //                                       what a commander does this turn. The
  //                                       chain-promotion rows go first of all:
  //                                       they describe plans not yet started,
  //                                       and their horizon and refusal counts
  //                                       survive in the block's trailing note.
  //   4.    Drive explorer (§9)        -- the last of the reference material and
  //                                       the first thing above the measured
  //                                       half: a refit what-if for ONE design,
  //                                       carried whole at
  //                                       /api/intel/drive-explorer. It had NO
  //                                       ladder position until 2026-08-28 and
  //                                       so printed in full while §3 lost the
  //                                       weapon and armour line from half its
  //                                       contacts; see its block for the
  //                                       measurement.
  //   5.    Theater defence (§1c) → L1 -- shed the citation line only. The
  //                                       posture, the threat and the build
  //                                       race all stay, and the block still
  //                                       names where the full citation list
  //                                       lives.
  //   6.    Friendly fleets (§2) → L1  -- shed the weapon/PD line. Cheap, and
  //                                       every fleet stays listed.
  //   7.    Hostile fleets (§3) → L1   -- shed the second detail line, same
  //                                       reasoning; every contact stays named.
  //   8-9.  Construction (§5) modules, then stations.
  //   10.   Theater defence (§1c) → L2 -- shed the friendly-holdings line; the
  //                                       posture, the race and every refusal
  //                                       survive.
  //   11.   Friendly fleets (§2) → L2  -- shed the propulsion line.
  //   12.   Key habs (§6)              -- a static inventory the JSON
  //                                       endpoints carry in full.
  //   13.   Construction (§5) queues   -- last of §5: the only part that says
  //                                       when reinforcements actually arrive.
  //   14.   Theater defence (§1c) → L3 -- posture header only. This is the
  //                                       first step that costs a REFUSAL its
  //                                       reason, which is why it sits this
  //                                       late and below every cheaper cut.
  //   15.   Friendly fleets (§2) → L3  -- shed the design rollup; header only.
  //   16.   Battle composition (§1d) → L1 -- per-body contact rows compact to a
  //                                       body, a hull count a side and one
  //                                       verdict; the mount breakdown behind
  //                                       them is at /api/intel/fleets.
  //   17.   Hostile fleets (§3) entries -- ranked by the relevance evaluator's
  //                                       own criteria, least relevant first.
  //   18.   Friendly fleets (§2) entries -- the observer's own picture is the
  //                                       last thing cut before threats.
  //   19.   Battle composition (§1d) entries -- a contact row is a body where
  //                                       the shooting can start this turn, so
  //                                       the rows outlive both fleet
  //                                       inventories. The whole-board
  //                                       composition and both saturation
  //                                       verdicts are in the block's HEADING
  //                                       and never degrade at all.
  //   20.   Theater defence (§1c) entries -- least urgent first, by the
  //                                       engine's own emitted order.
  //   21.   Incoming threats (§4)      -- cut only when nothing else remains,
  //                                       latest ETA first. §4 is the raw
  //                                       arrival measurement §1c reasons over,
  //                                       so the measurement outlives the
  //                                       derived posture.
  //
  // §1 (alien threat posture), §7 (logistics), §10 (council cycle plan) and §11
  // (strategic commentary) are fixed-size by construction and never degrade
  // through the ladder; §10 is bounded at five lines whatever the plan's size,
  // because every list inside it is reported as a COUNT rather than reproduced,
  // and §11 is bounded because the commentary engine defines exactly five beats
  // and every other line in it is one line whatever the save holds, so it does
  // not grow with the save. Neither has a ladder entry: they give way whole,
  // through `clampOrder` below, and §11 goes FIRST of everything for the reason
  // recorded there.
  // -------------------------------------------------------------------------
  const ladder = [
    // The most speculative research material of all gives way first: a promoted
    // chain is by definition something the player has NOT started, priced over
    // steps that are months out. Its horizon and its refusal counts live in the
    // block's trailing note, so emptying the list keeps what a reader cannot
    // recover elsewhere and sheds only the per-chain rows.
    { block: 'research-chain-promotion', action: 'drop' },
    // Background before the active picture: what a bonus is worth matters less
    // this turn than what is being researched with it.
    { block: 'research-category-bonuses', action: 'drop' },
    { block: 'research-projects', action: 'drop' },
    { block: 'research-slots', action: 'drop' },
    // §9 -- the LAST reference material, and the first operational-half saving.
    // It is a refit what-if for ONE design, reproduced whole at
    // /api/intel/drive-explorer, and it had no ladder position at all until
    // 2026-08-28: the only thing that could shed it was `clampOrder`, which the
    // ladder never reaches, so it printed in full while §3 lost the weapon and
    // armour line from half its contacts. It gives way as one entry, above every
    // measured threat reading and below only the research background.
    { block: 'drive-explorer', action: 'drop' },
    // The cheapest cut in the operational half of the document: §1c keeps every
    // posture, threat count and build race and sheds only the per-row citation
    // list, whose full contents the block's own pointer still names.
    { block: 'theater-defence', action: 'reduce', toLevel: 1 },
    { block: 'friendly-fleets', action: 'reduce', toLevel: 1 },
    { block: 'hostile-fleets', action: 'reduce', toLevel: 1 },
    { block: 'construction-modules', action: 'drop' },
    { block: 'construction-stations', action: 'drop' },
    { block: 'theater-defence', action: 'reduce', toLevel: 2 },
    { block: 'friendly-fleets', action: 'reduce', toLevel: 2 },
    { block: 'habs', action: 'drop' },
    { block: 'construction-queues', action: 'drop' },
    // L3 is the first §1c step that costs a CANNOT_ADVISE row the REASON it
    // could not advise, so it sits below every cheaper cut in the document.
    { block: 'theater-defence', action: 'reduce', toLevel: 3 },
    { block: 'friendly-fleets', action: 'reduce', toLevel: 3 },
    // §1d's per-body contact rows compact to a one-line verdict before any of
    // them is dropped: which body is in contact and whether the screen holds
    // there is the irreducible part, and the mount breakdown behind it is
    // recoverable from /api/intel/fleets.
    { block: 'battle-composition', action: 'reduce', toLevel: 1 },
    { block: 'hostile-fleets', action: 'drop' },
    { block: 'friendly-fleets', action: 'drop' },
    // Dropped only below the two fleet inventories, and never before them: a
    // contact row is a body where the shooting can start this turn. The
    // whole-board composition and both saturation verdicts are in this block's
    // heading and never degrade at all -- they are the section's point.
    { block: 'battle-composition', action: 'drop' },
    // §1c before §4 deliberately: section 4 is the raw arrival measurement this
    // block reasons over, and a measurement outlives the verdict derived from it.
    { block: 'theater-defence', action: 'drop' },
    { block: 'incoming-threats', action: 'drop' }
  ];

  // Last resort if even an entry-free document will not fit: suppress whole
  // section BODIES in the same priority order. Section headers always survive.
  const clampOrder = [
    // FIRST, and deliberately so. Section 11 is the only body in the document
    // with no measured content of its own: every input it reasons over --
    // hate, fleets, hulls, build queues -- is already printed as a measurement
    // in sections 1 to 5, and its own output is derived from them. It degrades
    // as a UNIT rather than row by row, so the reader never gets a beat or a
    // throughput figure with the "modelled, not measured" heading cut away from
    // it. The whole body goes before anything measured is touched, and the
    // surviving header still names /api/v2/briefing.
    'strategic-commentary',
    // §9 (drive explorer) used to sit here, and it no longer needs to: it is a
    // LIST block now with a ladder position of its own, so the ladder sheds it
    // long before any clamp is reached, and `clampOrder` skips list blocks. It
    // is named here only so a reader looking for it is not left wondering --
    // see the ladder entry above, which carries the reason it moved.
    //
    // A summary of a plan that lives in full at /api/v2/briefing, in the same
    // relationship to that endpoint as section 9 is to the drive explorer.
    'council-cycle-plan',
    // Then the research family, most speculative first: a chain nobody has
    // started, then the bonuses that explain why a duration is labelled (the
    // duration itself survives without them), then the live projects and slots.
    'research-chain-promotion',
    'research-category-bonuses',
    'research-projects', 'research-slots', 'research-heading',
    'habs',
    'construction-modules', 'construction-stations', 'construction-queues', 'construction-heading',
    'logistics',
    'friendly-fleets',
    'hostile-fleets',
    'incoming-threats',
    'alien-threat'
  ];

  const maxBytes = isMeasured(options.maxBytes) ? Number(options.maxBytes) : WAR_ROOM_BYTE_BUDGET;
  return renderWithByteBudget(blocks, ladder, clampOrder, maxBytes);
}

/**
 * Section 7's mine-output multipliers: which are in force, which project grants
 * each, and what the adjusted figures still leave out.
 *
 * WHY THIS IS IN THE EXPORT AT ALL
 *
 * `a615018` measured that `TIHabSiteState.<resource>_day` is the DEPOSIT's rate
 * and carries no faction's tech bonus, and applied the observer's per-resource
 * multipliers to three derived surfaces. None of the three is a markdown
 * export, so until now an agent reading only the .md files saw neither the
 * multiplier nor the project granting it, and had no way to tell an adjusted
 * mining figure from a raw one. Per CLAUDE.md that made half this project's
 * consumers blind to the correction.
 *
 * WHAT IT DELIBERATELY DOES NOT SAY
 *
 * It publishes no mining RATE of its own. Section 7's table is the save's own
 * 30-day transaction ledger, which is realised income and already reflects
 * every bonus; a second, differently-derived per-site figure printed beside it
 * would invite exactly the double-counting this block warns against. The
 * adjusted per-site figures live on `/api/intel/mining` and
 * `/api/intel/mining-expansion`, and the block names them so the label binds to
 * the numbers it describes.
 *
 * ABSENT STAYS NULL
 *
 * An observer whose completed-project list cannot be read has an UNKNOWN
 * multiplier, never x1.0 -- and `resolveObserverFaction` can fall back to the
 * FIRST faction in the payload when the requested observer is missing, whose
 * list player mode truncates to five entries. `projectListComplete` is
 * therefore true only when the faction actually resolved is the one the payload
 * was filtered for. Nothing here reads a rival's list, so no other faction's
 * mine bonuses can leak into a player-mode export.
 */
function miningTechBonusLines(observer, observerId) {
  const isRequestedObserver = observer?.ID !== undefined && observer?.ID !== null
    && sameId(observer.ID, observerId);
  const bonuses = buildMiningTechBonuses(observer, { projectListComplete: isRequestedObserver });

  const pointer = '`/api/intel/mining` and `/api/intel/mining-expansion`';
  const moduleFactor = asArray(UNMODELLED_FACTORS)
    .find(entry => entry.factor === 'mine-module miningModifier') || null;
  // The range is read from the record that declares the factor unmodelled
  // rather than retyped here, so the two can never disagree.
  const moduleRange = moduleFactor ? moduleFactor.range : 'UNAVAILABLE';

  if (bonuses.available !== true) {
    return [
      `- **Mine output multipliers:** UNKNOWN — ${bonuses.unavailableReason}. `
        + `The per-site figures on ${pointer} are RAW deposit rates and are a lower bound, `
        + `NOT a measured "no bonus".`,
      ``
    ];
  }

  // Registry order, not "boosted first": MINING_BONUS_RULES is the one place
  // the five resources are ordered, and reordering them here would silently
  // reshuffle a list a reader compares against the mining board.
  const entries = asArray(MINING_BONUS_RULES)
    .map(rule => bonuses.byResource?.[rule.key])
    .filter(entry => entry && entry.state !== MINING_BONUS_STATES.unknown);
  const boosted = entries.filter(entry => entry.state === MINING_BONUS_STATES.boosted);
  const unboosted = entries.filter(entry => entry.state === MINING_BONUS_STATES.measuredNone);

  // The grant is NAMED, never reduced to a bare number: "x1.15" alone gives a
  // reader no way to check the claim or to tell which project earned it.
  const boostedText = boosted.length > 0
    ? boosted.map(entry => `${entry.label} ×${entry.multiplier} from ${entry.grants.join(' + ')}`).join('; ')
    : null;
  const unboostedText = unboosted.length > 0
    ? `${unboosted.map(entry => entry.label).join(', ')} ×1 (list read, no completed grant)`
    : null;

  const headline = boostedText === null
    ? `- **Mine output multipliers:** none in force — ${unboostedText}.`
    : `- **Mine output multipliers:** ${boostedText}.`
      + (unboostedText === null ? '' : ` ${unboostedText[0].toUpperCase()}${unboostedText.slice(1)}.`);

  return [
    headline,
    `  Stacking is ${MINING_BONUS_STACKING.mode} at ×${MINING_BONUS_STACKING.perGrant} per grant `
      + `(measured ${bonuses.measuredOn}).`,
    `- These multiply the DEPOSIT rate the save stores per hab site, which is what ${pointer} report. `
      + `The Monthly Net column above is the save's own 30-day transaction ledger — realised income, `
      + `already carrying every bonus — so it must NOT be adjusted again.`,
    `- Every adjusted figure is still a **LOWER BOUND**: it excludes the mine module's own miningModifier, `
      + `which is larger than the tech bonus and deliberately unmodelled — ${moduleRange}.`,
    ``
  ];
}

/**
 * The control-point cap block inside section 7.
 *
 * WHY IT IS HERE AT ALL. `4f2f5b1` shipped the whole cap model, both endpoints
 * and the verdict, and put NONE of it in the exports -- it said so itself, and
 * `docs/README.md` carries the gap. Every LLM reading `/latest-war-room.md`
 * therefore had no idea the observer had 238 points of control-point room, nor
 * that a rival was 34 over and paying for it. Two facts here are directly
 * actionable and derivable from nothing else in this document:
 *
 *   * the observer's OWN headroom, which prices every further control point
 *     the council could take this cycle;
 *   * an over-cap RIVAL, which is a standing +bonus on every hostile Crackdown,
 *     Purge, Enthrall Elites and Dominate Nation aimed at them. That is a
 *     targeting fact, not a curiosity.
 *
 * BOTH MODES, AND THE LINE BETWEEN THEM. Since the owner's 2026-08-22
 * intel-model decision (header of `shared/controlPointCap.mjs`) the `recorded`
 * basis is published in player mode too, so the over-cap rival appears in both.
 * A rival the game records at ZERO does not: that zero is the floor of
 * `max(0, cost - cap)`, so it bounds without locating, and this block says
 * "position unknown" rather than printing a reassuring blank.
 *
 * The whole model lives in `shared/`, so the Cloudflare Worker computes this
 * exactly as the local server does -- unlike the engine-derived sections, which
 * the serving runtime has to hand in.
 */
function controlPointCapLines(filteredSnapshot, observerId) {
  const mode = filteredSnapshot?.mode || 'player';
  const pointer = '`/api/intel/control-point-cap`';
  const factions = asArray(filteredSnapshot?.factions);
  if (factions.length === 0) {
    return [`- **Control-point cap:** UNAVAILABLE — this snapshot carries no faction rows.`, ``];
  }

  const reports = factions.map(f => buildControlPointCapReport(filteredSnapshot, { factionId: f?.ID, mode }));
  const own = reports.find(r => sameId(r.factionId, observerId)) || null;

  const lines = [];

  // The observer's own position. `UNAVAILABLE` when it refuses -- never a 0,
  // and never a silent omission of the line.
  if (own === null) {
    lines.push(`- **Our control-point cap:** UNAVAILABLE — the observer faction is not in this snapshot.`);
  } else if (own.headroom.available !== true) {
    lines.push(`- **Our control-point cap:** position UNKNOWN — ${own.headroom.reason}`);
  } else {
    const capText = own.capacity.cap === null ? 'UNAVAILABLE' : localeOr(own.capacity.cap);
    lines.push(`- **Our control-point cap:** ${fixedOr(own.headroom.value, 2)} points of room `
      + `(${fixedOr(own.maintenance.cost, 2)} maintenance against a cap of ${capText}, basis \`${own.headroom.basis}\`). `
      + `Over cap costs **overage² Influence a year** and adds the 32-day mean of overage/3 to every hostile `
      + `${OVER_CAP_EXPOSED_MISSIONS.join(', ')} aimed at us.`);
    if (own.headroom.basis === 'composed') {
      lines.push(`  The composed cap was measured running ~1 point HIGH against the cap the game's own record `
        + `implies, so this room is slightly optimistic (${CONTROL_POINT_CAP_ACCURACY.measuredOn}).`);
    }
  }

  // Rivals the game itself records over cap. This needs no composed cap and no
  // masked term, so it is stated in either mode.
  const overCap = reports.filter(r => !sameId(r.factionId, observerId) && r.headroom.overCap === true);
  if (overCap.length > 0) {
    for (const r of overCap) {
      lines.push(`- **${r.factionName} is ${fixedOr(r.recorded.overage, 2)} OVER their control-point cap** — `
        + `costing them ${localeOr(r.penalties.influencePerYearFromRecorded)} Influence a year, and giving our `
        + `${OVER_CAP_EXPOSED_MISSIONS.join(' / ')} against them **+${fixedOr(r.penalties.missionExposureApplied, 2)}** `
        + `(the 32-day mean the game applies, not today's ${fixedOr(r.penalties.missionExposureToday, 2)}). `
        + `Read from the save's own record, so it holds in ${mode} mode.`);
    }
  }

  // Everyone else. A recorded zero is a FLOOR: announce that the position is
  // unknown rather than letting an absent line read as "everyone else is fine".
  const boundOnly = reports.filter(r =>
    !sameId(r.factionId, observerId)
    && r.recorded.establishes === RECORDED_POSITION.boundOnly
    && r.headroom.available !== true);
  if (boundOnly.length > 0) {
    lines.push(`- ${boundOnly.length} other faction(s) record **no** cap penalty. That is the FLOOR of `
      + `max(0, cost − cap), so it bounds them at or under cap WITHOUT locating them — their room is `
      + `**UNKNOWN**, not large. Locating it needs their councilor attributes, hab modules and cap projects, `
      + `which this mode masks. Full rows at ${pointer}.`);
  } else if (overCap.length === 0) {
    lines.push(`- No other faction is recorded over their control-point cap. Per-faction rows at ${pointer}.`);
  }

  lines.push(``);
  return lines;
}

/**
 * Section 8 of the war room: which multi-step research chains were promoted
 * into an actionable group, which the reachability gate refused, and how wide
 * the horizon it was measured against is.
 *
 * WHY THIS IS IN THE EXPORT AT ALL
 *
 * Both halves change what the reader is looking at, and neither is derivable
 * from the rest of this file:
 *
 *   * A PROMOTED chain is listed under the step the player would start now, not
 *     under the project it eventually delivers. Without the block, an agent
 *     reading "Exotics, researchable now" has no way to know it is there
 *     because it is step one of a two-step chain to Exotic Heat Sinks, priced
 *     over both steps.
 *   * A DECLINED chain has been removed from the top of a ranking it would
 *     otherwise have won -- on the live save the Pion Torch chain wins the
 *     payoff ratio outright and is refused at 413.5 months against a
 *     106.9-month horizon. That is a truncation, and truncation announces
 *     itself.
 *
 * The endpoint's own group limit is carried through rather than re-capped
 * here: `promotedOmittedCount` / `declinedOmittedCount` are the counts
 * /api/intel/research-ranking already publishes, and inventing a second, larger
 * cap in this file would put two different truncation rules on one figure.
 *
 * Returns an array so the caller can push it as one unit; there is one block.
 */
function researchChainPromotionBlocks(filteredSnapshot, observerId, observerName) {
  const endpoint = `/api/intel/research-ranking?observer=${observerId}&detail=full`;
  const block = listBlock('research-chain-promotion', {
    headingLines: [`### Research Chain Promotion & Reachability (${observerName})`],
    // Deliberately not "there are none": the gate may not have been evaluable
    // at all, and the horizon note below says which of the two happened.
    emptyLines: [`*No multi-step research chain was promoted or declined for this observer — the horizon `
      + `note below says whether the reachability gate could be evaluated at all.*`],
    budgetEmptyLines: budgetEmptyNote('research chains', endpoint, false),
    budgetNote: budgetOmissionNote('research chains', endpoint),
    trailingLines: [``]
  });

  let ranking;
  try {
    ranking = researchRankingResource(filteredSnapshot, {
      observerId,
      // `mode` is what the local filtered snapshot carries; `intelMode` /
      // `visibility` are what the published rows label themselves with.
      mode: filteredSnapshot.mode || filteredSnapshot.intelMode || filteredSnapshot.visibility || 'player'
    });
  } catch (err) {
    block.emptyLines = [`*Research chain promotion unavailable: ${err.message}*`];
    return [block];
  }

  const promotion = ranking?.military?.chainPromotion || null;
  if (!promotion) {
    block.emptyLines = [
      `*Research chain promotion unavailable: this snapshot produced no chain-promotion census `
      + `(${ranking?.sources?.militaryValue?.reason || 'no reason reported'}).*`
    ];
    return [block];
  }

  // Emission order is the endpoint's order, preserved. `rank` exists only so
  // the byte budget cuts from the END of each list rather than reshuffling it:
  // declined rows give way before promoted ones, because a promoted chain is
  // something the reader can act on this cycle and a declined one is a refusal
  // whose COUNT and reason survive in the trailing note either way.
  const promoted = asArray(promotion.promoted);
  const declined = asArray(promotion.declined);

  // `mo@full` rather than a bare `mo`, because the figure changed meaning on
  // 2026-08-22: it is now the chain priced at FULL CONCENTRATION -- every pip
  // on the step being worked -- which is a lower bound, where the old number
  // was cost over the whole faction's income and was neither bound. Four
  // characters is cheap insurance against an agent carrying the old reading
  // forward; the byte budget is 30 KB and this block is a handful of rows.
  const chainFacts = (row) => {
    const steps = num(row.stepsCount);
    const parts = [
      steps === null ? 'UNKNOWN steps' : `${steps} step(s)`,
      `${localeOr(row.totalRemainingCost)} RP`,
      isMeasured(row.monthsAtFullConcentration)
        ? `${fixedOr(row.monthsAtFullConcentration, 1)} mo@full`
        : 'UNKNOWN months'
    ];
    return parts.join(', ');
  };
  const axisGain = (row) => (row.axisLabel
    ? `${row.axisLabel} ${isMeasured(row.improvementMultiple) ? `×${fixedOr(row.improvementMultiple, 2)}` : '×UNKNOWN'}`
    : 'axis UNAVAILABLE');

  promoted.forEach((row, index) => {
    const next = row.immediateNextStep;
    addEntry(block, {
      rank: [0, index],
      variants: [[
        `- **${row.displayName || row.id}** — ${axisGain(row)} over ${chainFacts(row)} — `
        + `start **${next?.displayName || 'UNAVAILABLE'}**`
        + `${next?.availabilityState ? ` (${next.availabilityState})` : ''} — `
        + `${String(row.reachabilityState || 'reachability UNKNOWN').toUpperCase()}`
      ]]
    });
  });

  declined.forEach((row, index) => {
    addEntry(block, {
      rank: [1, index],
      variants: [[
        `- **DECLINED — ${row.displayName || row.id}** — ${axisGain(row)} over ${chainFacts(row)} — `
        + `${String(row.reachabilityState || 'reachability UNKNOWN').toUpperCase()}: `
        + `${row.reason || 'no reason reported'}`
      ]]
    });
  });

  // The horizon and the counts live in trailingLines, not in entries, so that a
  // budget pass that empties the list still leaves the reader the two facts
  // that cannot be recovered from anywhere else in this document: how wide the
  // horizon is, and how many chains were refused by it.
  const horizon = promotion.horizon || null;
  const horizonLine = horizon?.available === true
    ? `*Planning horizon: ${fixedOr(horizon.months, 1)} months / ${localeOr(horizon.points)} RP at `
      + `${localeOr(horizon.monthlyResearchIncome)} RP/mo — campaign age `
      + `${horizon.horizonAssumed === true ? 'ASSUMED' : 'MEASURED'}`
      + `${horizon.campaignAgeSource ? ` (${horizon.campaignAgeSource})` : ''}. A plan longer than the `
      + `campaign already played is past it; that is our inference, not a figure the game publishes.*`
    : `*Planning horizon UNAVAILABLE, so no chain was promoted on reachability grounds: `
      + `${horizon?.reason || 'no reason reported'}.*`;

  // Deliberately "carried", not "shown": the byte budget may drop entries AFTER
  // this line is composed, and the block's own budget note is what reports that.
  // Two different counts both claiming to be "shown" would contradict each
  // other the first time the budget bit.
  const countLine = `*${localeOr(promotion.promotedCount)} chain(s) promoted `
    + `(${promoted.length} carried here, ${localeOr(promotion.promotedOmittedCount)} omitted by the endpoint's group limit); `
    + `${localeOr(promotion.declinedCount)} declined `
    + `(${declined.length} carried, ${localeOr(promotion.declinedOmittedCount)} omitted). Full set at \`${endpoint}\`.*`;

  block.trailingLines = [
    horizonLine,
    countLine,
    `*A promoted chain is ordered under the step you would START, not the project it delivers, and its `
    + `cost and duration are priced over ALL remaining steps.*`,
    ``
  ];
  return [block];
}

/**
 * Section 10 of the war room: the configured risk floor, what it held back, and
 * how much of the candidate bench this brief is actually showing.
 *
 * WHERE THE PLAN COMES FROM, AND WHY IT ARRIVES TWO WAYS
 *
 * The cycle plan is built by `server/engine/assignment.js`, which is Node
 * CommonJS and reads configuration -- neither of which this module may touch,
 * because it also runs in the Cloudflare Worker. So the plan is handed IN
 * rather than computed here, and each runtime supplies it the way it already
 * has it:
 *
 *   * Express (`/latest-war-room.md`) passes `options.cyclePlan`; the route has
 *     the raw snapshot and the briefing generator to hand.
 *   * The hosted worker passes nothing: published rows carry
 *     `snapshot.missionControlBriefing` (see scripts/publish/rows.js), so the
 *     fallback below finds it with no worker change at all.
 *
 * A runtime that has neither says so. It does NOT print a floor of zero and an
 * empty bench, which is what `Number(null) === 0` would produce and which reads
 * as a measured "nothing was held back".
 *
 * WHAT THE BENCH COUNTS ACTUALLY MEAN
 *
 * `benched` is a SLICE, and THREE questions have to be answered about it, so
 * the line answers all three.
 *
 *   WHICH ENTRIES SURVIVE. One row per (mission, coarse target) sibling group,
 *   groups ranked by their best-scoring member, ties broken by
 *   candidate-generation index. Not the best eight INDIVIDUALS: measured
 *   2026-08-22 on frozen `ExitSave.gz`, that carried 2 distinct mission shapes
 *   across 8 omniscient rows -- five siblings of the primary recommendation
 *   itself -- so the bench read "five more of the thing you were already told
 *   to do". Grouping gives 8 distinct shapes over the same 8 rows.
 *
 *   HOW MUCH OF THE BENCH THE ROWS ACCOUNT FOR. Each row stands for its whole
 *   group, so eight rows account for 33 of 427 rather than 8 of 427.
 *   `benchedRepresentedCount` is a THIRD figure beside the existing two, not a
 *   redefinition of either: `benchedOmittedCount` still counts rows not
 *   carried, and `benched.length + benchedOmittedCount === benchedTotalCount`
 *   still holds.
 *
 *   IN WHAT ORDER THEY ARE EMITTED. Generation order, because registry emission
 *   order is load-bearing for how explanations are built while the display cap
 *   is a separate concern -- so the sequence is NOT a ranking.
 *
 * A reader told "8 of 427" without those would get it wrong in one of three
 * ways: before 2026-08-22 they would assume the eight were the best eight when
 * the slice was arbitrary; then that the sequence is a ranking when it is not;
 * and now that eight rows means eight options when it means eight groups. All
 * three counts and the ordering rule therefore travel together.
 */
/**
 * The two lines of section 10 that stop eight bench rows reading as eight
 * independently available options.
 *
 * WHY THIS IS IN THE EXPORT AT ALL
 *
 * The bench lists alternatives and says nothing about what they COST. On the
 * frozen save's omniscient plan all eight rows draw on one cycle hate budget:
 * each charges 4.57 hate against 3.16 left of a 7.90 cap, so the honest answer
 * to "how many of these can I take?" is NONE — and until now no surface said
 * so. The dashboard's owner raised exactly this scenario unprompted ("if they
 * suggest purging and that puts me over the hate cap … then that's a problem").
 *
 * WHAT EACH LINE CARRIES, AND WHY BOTH ARE NEEDED
 *
 *   BUDGET. The pool's own state — used, cap, and what the cap RESTS ON. Player
 *   mode redacts the true alien hate, so its cap is derived from the Mission
 *   Control floor and is an UPPER BOUND on the real budget, not a measurement.
 *   `capMeasured` alone said only that a number came out; `currentHateBasis`
 *   says whether it was measured or floored, and the line prints the caveat
 *   rather than letting an optimistic cap read as a measured one.
 *
 *   JOINT AFFORDABILITY. How many of the SHOWN rows fit what remains. It is a
 *   count over rows whose charge the allocator actually measured; a row it
 *   never priced is named as unpriced and is never counted as fitting. Where no
 *   row was priced at all — player mode on this save, where no bench row was
 *   refused by a budget — the line says the question was not computed rather
 *   than implying the answer is "all of them".
 *
 * ABSENT STAYS NULL throughout: an unavailable summary prints one line saying
 * the plan carries no bench-budget record, never a cap of 0 with 0 rows fitting
 * it, which reads as a measured "you can afford nothing".
 */
function benchBudgetLines(plan) {
  const summary = plan?.benchBudget ?? null;
  const hate = plan?.budgets?.alienHate ?? null;
  const lines = [];

  // The pool the cycle actually gates on, stated whether or not it refused a
  // bench row -- a reader planning purges needs the number before anything is
  // refused, not only afterwards.
  if (hate === null) {
    lines.push(`- **Cycle hate budget:** UNAVAILABLE — this plan carries no alien-hate pool record. `
      + `That is not a budget of zero: nothing was read.`);
  } else if (hate.capMeasured !== true) {
    lines.push(`- **Cycle hate budget:** NOT MEASURED — the snapshot carries no readable alien-hate `
      + `figure, so no cap could be derived and every hate charge this cycle went UNCHECKED rather `
      + `than being cleared.`);
  } else {
    const basis = hate.currentHateBasis === 'floor'
      ? ` — derived from the Mission Control hate FLOOR (${fixedOr(hate.currentHate, 2)}), not from a hate `
        + `reading, so the true budget can only be this size or SMALLER`
      : ` (measured hate ${fixedOr(hate.currentHate, 2)})`;
    // Absent stays null on BOTH inputs: one unreadable half makes the remainder
    // unreadable, never the other half printed as though it were the answer.
    const cap = num(hate.cap);
    const used = num(hate.used);
    const left = (cap === null || used === null) ? null : cap - used;
    lines.push(`- **Cycle hate budget:** ${fixedOr(hate.used, 2)} of ${fixedOr(hate.cap, 2)} used, `
      + `${fixedOr(left, 2)} left${basis}`);
  }

  if (summary === null) {
    lines.push(`- **Bench affordability:** UNAVAILABLE — this plan carries no bench-budget record, so `
      + `how many of the rows above could be taken together was not computed. It is not zero.`);
    return lines;
  }

  const fits = num(summary.jointlyAffordableCount);
  if (fits === null) {
    lines.push(`- **Bench affordability:** NOT COMPUTED — ${summary.reason || 'no reason was recorded'}`);
    return lines;
  }

  lines.push(`- **Bench affordability:** ${fits} of the ${localeOr(summary.rowCount)} row(s) above fit the `
    + `${fixedOr(summary.remaining, 2)} ${summary.unit || summary.pool} left in the ${summary.pool} budget `
    + `(${fixedOr(summary.used, 2)} of ${fixedOr(summary.cap, 2)} already committed) — cheapest first, which `
    + `is the LARGEST number that fits, and an upper bound because only the pool that refused them was priced`
    + (num(summary.unpricedRowCount) ? `; ${summary.unpricedRowCount} row(s) carry no measured charge and are `
      + `counted neither as fitting nor as refused` : '')
    + `. The rows are ALTERNATIVES sharing one pool, not independent options.`);
  return lines;
}

function councilCyclePlanLines(filteredSnapshot, observerId, options = {}) {
  const mode = filteredSnapshot.mode || filteredSnapshot.intelMode || filteredSnapshot.visibility || 'player';
  const endpoint = `/api/v2/briefing?observer=${observerId}&mode=${mode}`;
  const engineDirectives = filteredSnapshot?.missionControlBriefing?.engineDirectives;
  const plan = options.cyclePlan
    ?? engineDirectives?.cyclePlan
    ?? null;
  // The PRIMARY recommendation, read the same two ways for the same reason.
  // It is a sibling of `cyclePlan` on `engineDirectives`, so the worker's
  // fallback finds it with no worker change, and Express hands it over beside
  // the plan. See the block below for why it is here at all.
  const primary = options.primary
    ?? engineDirectives?.primary
    ?? null;

  if (!plan) {
    return [
      `- **Cycle plan UNAVAILABLE in this runtime** — the councilor cycle plan is produced by the `
      + `directive engine, not by the snapshot, so it reaches this brief only when the serving runtime `
      + `hands it over. This is NOT a plan with no risk floor and an empty bench: nothing was read. `
      + `Fetch it directly at \`${endpoint}\`.`,
      ``
    ];
  }

  // An ABSENT array is not an array of length zero. `asArray(undefined).length`
  // is 0, and printing that as "0 councilors assigned" is a measurement of
  // something nobody read -- the exact `Number(null) === 0` failure this file's
  // fourth design principle exists to stop.
  const countOr = (value) => (Array.isArray(value) ? String(value.length) : 'UNAVAILABLE');

  const lines = [];
  const floor = plan.riskFloor || null;
  const floorPercent = isMeasured(floor?.percent) ? `${Number(floor.percent)}%` : 'UNAVAILABLE';
  // Three states, never collapsed. "Configured at 0" is the player choosing no
  // floor; "not configured" is the absence of a choice. Both hold nothing back
  // and they are reported differently, because a floor of zero that rejected
  // everything is the failure mode the rule was written against.
  let floorText;
  if (!floor) {
    floorText = `UNAVAILABLE — this plan carries no risk-floor record`;
  } else if (floor.configured !== true) {
    floorText = `NOT CONFIGURED — no success-odds floor was set, so nothing was held back on odds`;
  } else if (floor.inForce === true) {
    floorText = `${floorPercent} — IN FORCE; an action is vetoed when the LOW end of its odds band is below it`;
  } else {
    floorText = `${floorPercent} — CONFIGURED but NOT IN FORCE (a floor of 0 is the player choosing no `
      + `floor, which is not the same as no floor being configured)`;
  }
  lines.push(`- **Risk floor:** ${floorText}`);

  lines.push(`- **Held back by the floor:** ${localeOr(plan.riskFloorVetoedTotalCount)} action(s) vetoed `
    + `(${countOr(plan.riskFloorVetoed)} listed, ${localeOr(plan.riskFloorVetoedOmittedCount)} omitted); `
    + `${localeOr(plan.riskFloorUnverifiedTotalCount)} could not be checked against it `
    + `(${countOr(plan.riskFloorUnverified)} listed, ${localeOr(plan.riskFloorUnverifiedOmittedCount)} omitted) `
    + `— odds that could not be computed are never counted as clearing the floor`);

  lines.push(`- **Bench:** ${countOr(plan.benched)} of ${localeOr(plan.benchedTotalCount)} candidate `
    + `action(s) carried, ${localeOr(plan.benchedOmittedCount)} omitted for transport — but those rows ACCOUNT FOR `
    + `${localeOr(plan.benchedRepresentedCount)} of ${localeOr(plan.benchedTotalCount)}, because each row stands for `
    + `its whole sibling group. The listed entries are ONE ROW PER (mission, target) GROUP — the HIGHEST-SCORING few `
    + `groups, each ranked by its best-scoring member, ties broken by candidate-generation order — and the carried `
    + `array is then ordered by generation rather than by score, so the sequence is NOT a ranking and the row count `
    + `counts GROUPS rather than options. A row's \`groupCount\` is how many candidates it stands for and `
    + `\`groupNote\` names them; \`groupScoreLow\` / \`groupScoreHigh\` are the group's own score range, null when no `
    + `member could be scored`);

  lines.push(...benchBudgetLines(plan));

  lines.push(`- **Assigned this cycle:** ${countOr(plan.assignments)} councilor(s); `
    + `${countOr(plan.unassigned)} unassigned, ${countOr(plan.committed)} already committed`);

  // THE ONE THING THE ENGINE ACTUALLY RECOMMENDS.
  //
  // Until 2026-08-22 this section printed only COUNTS -- risk floor, bench
  // slice, "5 councilor(s) assigned" -- and none of them move when the
  // recommendation does. `b5ca8dd` corrected `value/gdp-per-cp-cost` and
  // recalibrated `VALUE_POINTS`, which changed the omniscient primary from
  // "Advise Government: USA" to "Purge the Protectorate hold on
  // ExtractiveSector in China" and took `totalExpectedValue` from 21.41 to
  // 66.13 -- and all three markdown exports rendered BYTE-IDENTICAL across
  // that change, in both modes, because the title, the score and the totals
  // reached no export at all. The largest user-visible change the engine has
  // produced was invisible to every LLM reading these files.
  //
  // It is a summary line rather than a section: the bullet below already names
  // `/api/v2/briefing` for the rules, odds and per-action breakdown.
  //
  // ABSENT STAYS NULL, in three separate places. The line sits inside the
  // plan-available branch, so a runtime that read nothing says so once above
  // rather than printing a blank primary. A plan that carries no primary says
  // that instead of naming one. And the score, the expected value and the
  // total are each `fixedOr`, so an unmeasured one renders UNAVAILABLE and
  // never 0.00 -- an expected value of zero is a real and different verdict.
  //
  // The EV comes from `primary.assignment.expectedValue`, not from `primary`:
  // the candidate carries the score, and the expected value only exists once
  // the action has been PAIRED with a councilor whose odds can be computed. A
  // primary with no assignment therefore has a score and no EV, which is
  // reported as exactly that.
  if (!primary) {
    lines.push(`- **Primary recommendation:** UNAVAILABLE — this plan carries no primary action. `
      + `That is not "no action is worth taking": nothing was read.`);
  } else {
    const title = typeof primary.title === 'string' && primary.title.trim() !== ''
      ? primary.title.trim()
      : 'UNAVAILABLE (the primary action carries no title)';
    lines.push(`- **Primary:** ${title} — score ${fixedOr(primary.score, 2)}, `
      + `EV ${fixedOr(primary.assignment?.expectedValue, 2)} `
      + `| whole-cycle totalExpectedValue ${fixedOr(plan.totalExpectedValue, 2)}`);
  }

  lines.push(`- Full plan, with each action's rules, odds and expected value: \`${endpoint}\``);
  lines.push(``);
  return lines;
}

// ---------------------------------------------------------------------------
// SECTION 1c: THEATER DEFENCE
//
// WHY IT IS IN THE EXPORT AT ALL
//
// `server/engine/theaterDefence.js` answers the one operational question the
// rest of this document only sets up: a hostile force is inbound to Mercury in
// 57 days, the observer holds twelve yards there, and the fastest hull those
// yards can lay down lands 48 days before contact -- so BUILD. That verdict
// existed on `/api/v2/briefing` and nowhere else, which under this repo's own
// rule means it was invisible to every LLM reading the .md exports, and half
// the point of these files is that agents read them.
//
// ENGINE OUTPUT IS HANDED IN, NEVER COMPUTED HERE
//
// This module also runs in the Cloudflare Worker, which is not Node, has no
// CommonJS and cannot run the engine. So the block is resolved exactly the way
// the cycle plan in section 10 is: `options.theaterDefence` from the serving
// runtime first, then `snapshot.missionControlBriefing.engineDirectives
// .theaterDefence` -- which the published rows already carry, so the hosted
// worker needs no change -- and an explicit NOT READ if neither yielded one. A
// runtime that could not supply it says so; it never renders an empty board.
//
// WHAT IT REFUSES TO COLLAPSE
//
//   * `threat.arrivalTimingKnown` is NULL, not false, when nothing is inbound:
//     there is no timing to know. "Nothing inbound" and "arrival time unknown"
//     are different claims and are rendered differently here.
//   * A finding with no build race and no yards is a MEASURED absence of build
//     capacity. A finding with yards and no measured build time is an ABSENT
//     reading. The engine already separates them into distinct refusals; this
//     renderer prints the refusal rather than flattening both to "no race".
//   * Refusals are printed as content, not hidden as an empty state. A
//     CANNOT_ADVISE row with its reason shown is the feature working.
//   * Every count is `localeOr`, so an unread count renders UNAVAILABLE and
//     never 0 -- `Number(null) === 0` is the failure this whole block guards.
// ---------------------------------------------------------------------------

/**
 * One citation as two named halves, with neither allowed to become the string
 * "undefined" -- an unresolvable identity is said out loud, never interpolated.
 */
const normalizeCitation = (citation) => ({
  source: citation?.source ?? 'unrecorded source',
  field: citation?.field ?? 'unrecorded field'
});

/**
 * Identity of a citation, for set membership. Built from the halves and never
 * parsed back, and SERIALISED rather than joined on a separator: a separator
 * has to be a character no field name contains, which is an assumption about
 * data this module does not own.
 */
const citationKey = (citation) => JSON.stringify([citation.source, citation.field]);

/**
 * Citations grouped by source and rendered as `source`: field, field.
 * Keeps the audit trail readable at a fraction of one-line-per-citation.
 */
function citationGroupText(citations) {
  const bySource = new Map();
  for (const citation of citations) {
    if (!bySource.has(citation.source)) bySource.set(citation.source, []);
    bySource.get(citation.source).push(citation.field);
  }
  return [...bySource.entries()]
    .map(([source, fields]) => `\`${source}\`: ${fields.join(', ')}`)
    .join('; ');
}

/**
 * The citation set every finding shares.
 *
 * Printed ONCE for the section rather than repeated on all eight rows: on the
 * live save that is nine identical readings per row, and reproducing them
 * eight times would spend most of the section's budget restating one list. The
 * per-row line then carries the row's own total and only what it cites BEYOND
 * the shared set, so no citation goes unstated and the two always reconcile.
 *
 * A genuine intersection, not an assumed prefix: a row that does not cite one
 * of these keeps it off the shared list for everybody, so the shared line can
 * never claim a citation some row lacks.
 */
function sharedCitations(findings) {
  if (findings.length === 0) return [];
  let shared = null;
  for (const finding of findings) {
    const keys = new Set(asArray(finding?.citations).map(c => citationKey(normalizeCitation(c))));
    if (shared === null) {
      // First row's own citations, deduplicated, keeping its declared order.
      const seen = new Set();
      shared = [];
      for (const citation of asArray(finding?.citations).map(normalizeCitation)) {
        const key = citationKey(citation);
        if (seen.has(key)) continue;
        seen.add(key);
        shared.push(citation);
      }
      continue;
    }
    shared = shared.filter(citation => keys.has(citationKey(citation)));
  }
  return shared ?? [];
}

/**
 * The inbound clause. Three outcomes, never merged:
 *   * count not on record -> UNAVAILABLE, said as such;
 *   * count is zero -> "nothing inbound", which is what a null
 *     `arrivalTimingKnown` means and is NOT "arrival time unknown";
 *   * count above zero -> the counts, then the arrival clock or an explicit
 *     statement that the clock is not on record.
 */
function theaterThreatClause(threat) {
  const fleets = num(threat?.hostileFleets);
  const ships = num(threat?.hostileShips);
  if (fleets === null) {
    return `inbound UNAVAILABLE — the inbound hostile fleet count is not on record (an unreadable count is not a zero)`;
  }
  if (fleets === 0) return `nothing inbound`;

  const days = num(threat?.nearestArrivalDays);
  const date = typeof threat?.nearestArrivalDate === 'string' && threat.nearestArrivalDate.includes('T')
    ? threat.nearestArrivalDate.split('T')[0]
    : null;
  const arrival = days === null
    ? `arrival NOT ON RECORD (an unknown arrival is not a distant one)`
    : `nearest arrival ${localeOr(days)} day(s)${date ? ` (${date})` : ''}`;
  return `inbound ${localeOr(fleets)} fleet(s) / ${localeOr(ships)} ship(s), ${arrival}`;
}

/** The force already in the theater, as opposed to the force under way to it. */
function theaterPresentClause(threat) {
  const fleets = num(threat?.presentHostileFleets);
  const ships = num(threat?.presentHostileShips);
  if (fleets === 0 && ships === 0) return `none present`;
  return `present ${localeOr(fleets)} fleet(s) / ${localeOr(ships)} ship(s)`;
}

/**
 * What the observer holds at the body, plus what lands before contact.
 *
 * The completion clause is omitted entirely where nothing is inbound. There is
 * no contact to complete before, so "0 completing before contact" would be a
 * measurement of a race that was never run -- and the headline has already said
 * nothing is inbound. Where a force IS inbound the clause always renders, and
 * an unread count says NOT MEASURED rather than 0.
 */
function theaterFriendlyLine(friendly, inboundKnownPositive) {
  const completing = num(friendly?.shipsCompletingBeforeThreatArrival);
  const basis = typeof friendly?.completionBasis === 'string' && friendly.completionBasis.trim() !== ''
    ? friendly.completionBasis.trim()
    : null;
  const completion = !inboundKnownPositive
    ? ''
    : (completing === null
      ? `; completions before contact NOT MEASURED (${basis ?? 'no basis recorded'})`
      : `; ${localeOr(completing)} completing before contact (${basis ?? 'no basis recorded'})`);
  return `  - Ours here: ${localeOr(friendly?.ships)} ship(s), ${localeOr(friendly?.shipyards)} yard(s), `
    + `${localeOr(friendly?.habs)} hab(s), ${localeOr(friendly?.mines)} mine(s)${completion}`;
}

/**
 * The production race, or nothing.
 *
 * Absent on a body with nothing inbound is not a gap -- no arrival clock means
 * no race to run, and the headline already says nothing is inbound. Where a
 * race WAS attempted and failed, the engine records a refusal carrying the
 * reason, and that prints on its own line below.
 */
function theaterBuildRaceLine(race) {
  if (!race) return null;
  if (race.available !== true) {
    return `  - **Build race NOT RUN** — ${race.reason ?? 'no reason recorded'}`
      + (race.hullName ? ` (fastest hull considered: ${race.hullName})` : '');
  }
  const yard = race.shipyardId === null || race.shipyardId === undefined ? '' : ` at yard ${race.shipyardId}`;
  return `  - **Build race: ${race.verdict ?? 'UNAVAILABLE (no verdict recorded)'}** — fastest hull `
    + `${race.hullName ?? 'UNAVAILABLE'}${yard}, ${localeOr(race.buildDays)} build-day(s) vs `
    + `${localeOr(race.daysUntilArrival)} day(s) to contact, margin ${localeOr(race.marginDays)} day(s)`;
}

/**
 * Builds section 1c and appends it to `blocks`.
 *
 * Emitted as a LIST block so the byte-budget engine can thin it like any other
 * ranked section; the two unavailable paths are fixed blocks because there is
 * nothing rankable in a statement that nothing was read.
 */
function pushTheaterDefenceBlock(blocks, filteredSnapshot, observerId, options = {}) {
  const heading = [`## 1c. Theater Defence (build / reinforce / withdraw)`, ``];
  const mode = filteredSnapshot?.mode || filteredSnapshot?.intelMode || filteredSnapshot?.visibility || 'player';
  const endpoint = `/api/v2/briefing?observer=${observerId}&mode=${mode}`;
  const engineDirectives = filteredSnapshot?.missionControlBriefing?.engineDirectives;
  const defence = options.theaterDefence
    ?? engineDirectives?.theaterDefence
    ?? null;

  if (!defence) {
    blocks.push(fixedBlock('theater-defence', heading, [
      `- **Theater defence UNAVAILABLE in this runtime** — the posture at each threatened body is `
      + `produced by the directive engine, not by the snapshot, so it reaches this brief only when the `
      + `serving runtime hands it over. This is NOT an empty board and NOT a quiet one: nothing was `
      + `read. Fetch it directly at \`${endpoint}\`.`,
      ``
    ]));
    return;
  }

  // The notes are the engine's own caveats, carried verbatim rather than
  // paraphrased so the export cannot drift from the block it describes. They
  // are why a reader must not read a posture as a force-strength verdict, so
  // they render on the unavailable path too -- and they never degrade.
  const noteLines = asArray(defence.notes).map(note => `- *${note}*`);

  if (defence.available !== true) {
    blocks.push(fixedBlock('theater-defence', heading, [
      `- **UNAVAILABLE** — ${defence.unavailableReason ?? 'no reason was recorded'}. No posture is `
      + `advised at any body; that is an unread board, not a safe one.`,
      ...noteLines,
      ``
    ]));
    return;
  }

  const findings = asArray(defence.findings);
  const shared = sharedCitations(findings);
  const sharedKeys = new Set(shared.map(citationKey));

  // The block's `state` IS `hostileMovement.state`, so it is spelled the way
  // section 1b spells it rather than as a raw enum -- the two sit four lines
  // apart and a reader must be able to see they are the same reading.
  const stateLabel = defence.state
    ? (HOSTILE_MOVEMENT_STATE_LABEL[defence.state] || defence.state)
    : 'UNAVAILABLE (the block carries no hostile-movement state)';
  const headingLines = [
    ...heading,
    `- **Board state:** ${stateLabel} — ${localeOr(findings.length)} of `
      + `${localeOr(defence.findingsTotalCount)} threatened theater(s) carried, `
      + `${localeOr(defence.findingsOmittedCount)} omitted by the block's own cap. A body absent from `
      + `this list has no hostile force inbound and none present; it is not an unchecked one.`
  ];
  if (defence.offBoardNote) {
    headingLines.push(`- **Off the board:** ${defence.offBoardNote}`);
  }
  if (shared.length > 0) {
    headingLines.push(`- **Citation basis — cited by every row below (${shared.length}):** `
      + `${citationGroupText(shared)}`);
  }

  const block = listBlock('theater-defence', {
    headingLines,
    // Two different empty boards, never merged. `findingsTotalCount === 0` is
    // the measured quiet one; a positive total with nothing carried means the
    // block's own cap took every row, and calling that "no theater is at issue"
    // would report an omission as an all-clear.
    emptyLines: [
      num(defence.findingsTotalCount) === 0
        ? `- No theater is at issue: every tracked body reports no hostile force inbound and none present.`
        : `- **No findings carried** — all ${localeOr(defence.findingsTotalCount)} threatened theater(s) `
          + `were omitted by the block's own cap. That is an omission, not an all-clear; the full set is `
          + `at \`${endpoint}\`.`
    ],
    budgetEmptyLines: budgetEmptyNote('theater-defence findings', endpoint),
    budgetNote: budgetOmissionNote('theater-defence findings', endpoint),
    detailNote: (levelCounts, kept) => {
      const shed = [];
      if (levelCounts[0]) shed.push(`the citation line from ${levelCounts[0]} of ${kept} row(s)`);
      if (levelCounts[1]) shed.push(`the friendly-holdings line from ${levelCounts[1]}`);
      if (levelCounts[2]) shed.push(`the build race and every refusal reason from ${levelCounts[2]}`);
      return [`*Detail suppressed to fit the size budget, least urgent row first: ${shed.join('; ')}. `
        + `Full findings at ${endpoint}.*`];
    },
    trailingLines: [
      ``,
      ...noteLines,
      `- Full findings, with every citation and refusal in full: \`${endpoint}\``,
      ``
    ]
  });
  blocks.push(block);

  findings.forEach((finding, index) => {
    const body = finding?.body ?? 'UNAVAILABLE (the finding carries no body name)';
    const status = finding?.theaterStatus ?? 'status UNAVAILABLE';
    const cites = asArray(finding?.citations);
    const extra = cites.map(normalizeCitation).filter(c => !sharedKeys.has(citationKey(c)));
    const inboundFleets = num(finding?.threat?.hostileFleets);

    // The citation COUNT rides on the posture line, which never degrades below
    // level 3, so budget pressure can shed WHICH readings a row cited but never
    // the fact that it cited them -- a row whose audit trail silently became
    // invisible would read as an asserted verdict.
    const headLine = `- **${body} — ${finding?.posture ?? 'POSTURE UNAVAILABLE'}** · ${status} · `
      + `${theaterThreatClause(finding?.threat)} · ${theaterPresentClause(finding?.threat)} · `
      + `${localeOr(cites.length)} citation(s)`;
    const friendlyLine = theaterFriendlyLine(finding?.friendly, inboundFleets !== null && inboundFleets > 0);
    const raceLine = theaterBuildRaceLine(finding?.buildRace);
    const refusalLines = asArray(finding?.refusals).map(refusal =>
      `  - **Refused — ${refusal?.check ?? 'unnamed check'}:** ${refusal?.reason ?? 'no reason recorded'}`);
    const citationLine = extra.length > 0
      ? `  - Cites, beyond the ${shared.length} shared above: ${citationGroupText(extra)}`
      : `  - Cites the ${shared.length} shared readings above and nothing further.`;

    const core = [headLine, friendlyLine, ...(raceLine ? [raceLine] : []), ...refusalLines];
    addEntry(block, {
      // The engine emits findings in its own urgency order (status rank, then
      // soonest measured arrival, nulls last), so position IS the ranking and
      // budget pressure takes the least urgent row first. Re-sorting here would
      // second-guess a comparator that is deliberately null-aware.
      rank: [index],
      variants: [
        [...core, citationLine],
        core,
        [headLine, ...(raceLine ? [raceLine] : []), ...refusalLines],
        [headLine]
      ]
    });
  });
}

// ---------------------------------------------------------------------------
// SECTION 1d: BATTLE COMPOSITION & SATURATION
//
// Section 1c says what to DO at each threatened body. This one says whether the
// force there can fight, and it is deliberately NOT a combat-value score:
// `docs/engagement-matchup-spec.md` abandoned that currency for three separate
// reasons, any one disqualifying, and the hull count derived from it was
// removed from 1c in d0a671d rather than captioned. What replaces it is
// composition -- can one side's salvo get through the other's point defence --
// answered from readings the observer legitimately holds in BOTH modes.
//
// FOUR THINGS HERE ARE LOAD-BEARING, and each one is a way this section could
// have lied:
//
//   * PD-IMMUNE WEAPONS ARE THEIR OWN FIGURE. Beams bypass point defence
//     entirely. Measured on the committed omniscient fixture the hostile side
//     fields 661 of them against the observer's 21, and no quantity of screen
//     answers any of them. Folding that into a saturation ratio would average
//     away exactly the number that decides the fight, so it is reported beside
//     the two verdicts and never inside them -- which is also what
//     `saturationVerdict` itself enforces via `pdImmuneExcludedFromSaturation`.
//   * KINETICS SATURATE LIKE MISSILES. The game marks all 57 missiles AND all
//     70 magnetic guns `isPointDefenseTargetable`, so a throw-weight figure
//     counting missiles alone understates it by about a third. Mounts the game
//     marks NOT targetable (the observer's 40mm Autocannon, an unguided slug)
//     are excluded from the shot count and reported apart rather than dropped.
//   * THE INTERCEPTION RULES ARE STATED, NOT MEASURED, AND THE TWO ARE NOT
//     EQUALLY EVIDENCED. One mount neutralising roughly one weapon is the
//     player's stated mechanic (2026-08-28); 2x the mounts overwhelming the
//     screen is the rule of thumb he offered as "probably" and "a safe bet"
//     (2026-08-27). Neither was read from the game --
//     `TISpaceCombatTemplate.json` is a single RedBlueSpaceCombat test scenario
//     with `active: false` -- so the caveat line labels them separately rather
//     than collapsing both into "assumption". The attributions travel from
//     `shared/battleComposition.mjs` rather than being restated here, so the
//     constant and the caveat cannot drift apart.
//   * A WHOLE-BOARD TOTAL IS NOT ONE ENGAGEMENT. Max battle size is 40 ships a
//     side, so 534 hostile hulls do not arrive at once. Printing a board-wide
//     shot count without that sentence would invite a reader to treat a
//     campaign aggregate as a single exchange.
//
// AND IT NEEDS NO HAND-IN. Unlike sections 1c, 10 and 11 -- all engine output
// this module may not compute -- both inputs travel on the filtered snapshot:
// `componentStats` (baked by `server/snapshot/templates.js`, written onto every
// published row by `scripts/publish/rows.js`) and each ship's `weaponLoadout`.
// So the Cloudflare worker composes the same numbers the local server does.
// A snapshot carrying neither says the composition was NOT READ; it never
// prints a zero, because a side whose weapons were not read is not a side
// without weapons.
//
// PLAYER MODE IS NOT BLIND HERE, and that is the finding that makes the section
// possible: `weaponLoadout` is carried on every observed hostile ship in player
// mode as well as omniscient (measured 2026-08-27, docs/engagement-matchup-spec
// .md: 497 of 497 alien ships in both). The two modes therefore render the same
// readings -- which is the opposite of the combat-value ratings elsewhere in
// this brief, where player mode over-rates the opponent 9-15x per body.
// ---------------------------------------------------------------------------

/** A mount or shot count. Proportional attribution can make it fractional. */
const battleCount = (value) => localeOr(round(value, 1));

/** `join` as a percentage, or a statement that the side fields no systems. */
function joinClause(side) {
  const rate = num(side?.join?.rate);
  const unresolved = num(side?.join?.unresolved);
  if (rate === null) return 'no weapon system carried by this side';
  return `weapon join ${(rate * 100).toFixed(1)}% (${localeOr(unresolved)} unresolved)`;
}

/**
 * One side's composition, as one line.
 *
 * `scopeClause` names what the ship count covers. §1d composes whole boards, so
 * it keeps the default; /latest-threats.md composes ONE fleet at a time and
 * passes `''`, because calling a 24-ship fleet a whole board would be a lie
 * about what was counted.
 */
function battleSideLine(label, side, factionClause, noLoadoutShips, scopeClause = 'whole board, ') {
  const missile = round(side.missileShots, 1);
  const kinetic = round(Math.max(0, side.kineticMounts - side.notPdTargetableMounts), 1);
  // NOT coerced. `composeBattleSide` initialises this to 0 and only ever adds to
  // it, so on a composed side it is a measured count -- but a null would mean
  // the composition's shape changed, and `null > 0` correctly declines to print
  // a clause about a reading that does not exist rather than printing "0".
  const notTargetable = num(side.notPdTargetableMounts);
  return `- **${label} — ${scopeClause}${battleCount(side.ships)} ship(s)${factionClause}:** `
    + `${battleCount(side.pointDefenceMounts)} PD mount(s) · `
    + `${battleCount(side.pdTargetableShots)} PD-targetable shot(s) `
    + `(${battleCount(missile)} missile + ${battleCount(kinetic)} kinetic`
    + `${notTargetable !== null && notTargetable > 0 ? `; ${battleCount(notTargetable)} mount(s) the game marks NOT interceptable, excluded` : ''}) · `
    + `${battleCount(side.pdImmuneWeapons)} PD-immune weapon(s) · `
    + `median armour ${side.armorMedian === null ? 'NOT MEASURED' : `${fixedOr(side.armorMedian, 1)} cm`} · `
    + `${joinClause(side)}`
    + `${noLoadoutShips > 0 ? ` · ${localeOr(noLoadoutShips)} ship(s) carry NO weapon loadout in this snapshot and contribute nothing above — an unread loadout is not an unarmed hull` : ''}`;
}

/**
 * One saturation direction, as one line.
 *
 * A refused verdict prints its reasons and NO numbers: an incomplete weapon
 * join means the shot count under-states the salvo, and averaging over it is
 * the defect `shared/battleComposition.mjs` exists to prevent.
 *
 * `whereClause` names the body the exchange is located at. §1d's whole-board
 * pair has no single body and passes nothing; /latest-threats.md composes each
 * hostile fleet against the screen at its OWN engagement point, so the body has
 * to be on the line or the verdict reads as a board-wide claim.
 */
function saturationLine(verdict, attackerLabel, defenderLabel, whereClause = '') {
  const heading = `${attackerLabel} salvo vs ${defenderLabel} screen${whereClause}`;
  if (!verdict) {
    return `- **${heading}: NOT EVALUATED** — one of the two sides `
      + `fields no ships in this reading, so there is no exchange to compose. That is not a verdict that the `
      + `screen holds.`;
  }
  if (verdict.refused) {
    return `- **${heading}: REFUSED** — `
      + `${asArray(verdict.refusalReasons).join('; ') || 'no reason was recorded'}. No shot count is `
      + `substituted for an incomplete join.`;
  }
  const shots = battleCount(verdict.attackerPdTargetableShots);
  const mounts = battleCount(verdict.defenderPdMounts);
  const capacity = battleCount(verdict.interceptionCapacity);
  const diff = num(verdict.difference);
  if (verdict.ratioUnavailableReason) {
    return `- **${heading}: EVERY SHOT ARRIVES** — ${shots} targetable `
      + `shot(s) against no screen at all (${verdict.ratioUnavailableReason})`;
  }
  const tail = diff === null
    ? ''
    : (verdict.saturated ? `; surplus ${battleCount(diff)}` : `; shortfall ${battleCount(Math.abs(diff))}`);
  return `- **${heading}: ${verdict.saturated ? 'SATURATED' : 'SCREEN HOLDS'}** — `
    + `${shots} targetable shot(s) vs ${capacity} interception(s) `
    + `(${mounts} mount(s) × ${localeOr(verdict.pdShotsPerMount)}/mount)${tail}`;
}

/**
 * The two composition lines /latest-threats.md prints for ONE hostile fleet:
 * what it fields, and whether its targetable salvo gets through the screen it
 * would actually meet.
 *
 * The screen is the observer's ships AT THE ENGAGEMENT POINT, not the whole
 * board — the tactical question is what is there when that fleet arrives, and
 * the whole-board pair is already in war-room §1d. Three absences are told
 * apart rather than collapsed, because they mean completely different things:
 *
 *   * NO WEAPON CATALOGUE — nothing could be joined, so nothing was composed.
 *     Not a fleet without weapons.
 *   * NO ENGAGEMENT BODY — the fleet is in heliocentric space or bound for a
 *     station this snapshot does not carry, so there is no place to locate a
 *     screen. Not a screen that held.
 *   * NO OBSERVER SHIP AT THAT BODY — the salvo meets nothing. That is the
 *     dangerous case and it is stated as an absence of YOUR hulls, never as a
 *     fleet with zero point defence, which `composeBattleSide([])` would
 *     otherwise render identically.
 */
function threatCompositionLines(row, { fleetsById, weaponIndex, ourShipsByBody }) {
  if (weaponIndex === null) {
    return [
      `- **Their composition:** NOT READ — no weapon catalogue in this snapshot to join the loadout against.`,
      `- **Their salvo vs your screen: NOT EVALUATED** — no shot count is invented for an unread catalogue.`
    ];
  }

  const ships = asArray(fleetsById.get(String(row.fleetId))?.ships);
  if (ships.length === 0) {
    return [
      `- **Their composition:** NOT READ — this snapshot carries no per-ship record for this fleet, so its `
      + `point defence, throw weight and PD-immune count could not be composed. An unread loadout is not an `
      + `unarmed fleet.`,
      `- **Their salvo vs your screen: NOT EVALUATED** — there is no composed salvo to test.`
    ];
  }

  const theirs = composeBattleSide(ships, { weaponIndex });
  const compositionLine = battleSideLine('Their composition', theirs, '', shipsWithoutLoadout(ships), '');

  const body = row.engagementPoint?.body ?? null;
  const key = normalizeBody(body);
  if (!key) {
    return [compositionLine, `- **Their salvo vs your screen: NOT LOCATED** — `
      + `${row.engagementPoint?.reason || 'this fleet has no body an engagement can be located at'}, so there `
      + `is no screen to compose it against. That is not a verdict that the screen holds.`];
  }

  const where = ` at ${body}`;
  const defenders = asArray(ourShipsByBody.get(key));
  if (defenders.length === 0) {
    // Deliberately short: the reading a reader must not miss is that YOUR
    // absence is what leaves the salvo unopposed, and the section's heading
    // says that once rather than repeating it on every row that hits this
    // branch -- on the live board seven of eight rows do.
    return [compositionLine, `- **Their salvo vs your screen${where}: NO SCREEN THERE** — you hold no ship at `
      + `${body}, so ${battleCount(theirs.pdTargetableShots)} targetable shot(s) meet nothing.`];
  }

  const ours = composeBattleSide(defenders, { weaponIndex });
  return [
    compositionLine,
    saturationLine(saturationVerdict({ attacker: theirs, defender: ours }), 'Their', 'your', where)
  ];
}

/** Ships in a fleet list whose weapon loadout is absent or empty. */
function shipsWithoutLoadout(ships) {
  let count = 0;
  for (const ship of ships) {
    if (!Array.isArray(ship?.weaponLoadout) || ship.weaponLoadout.length === 0) count += 1;
  }
  return count;
}

/**
 * Builds section 1d and appends it to `blocks`.
 *
 * A LIST block: the whole-board reading lives in `headingLines` because it is
 * fixed-size by construction and it is the point of the section, while the
 * per-body contact rows grow with the save and are what the budget ladder may
 * thin. The two unavailable paths are fixed blocks -- there is nothing rankable
 * in a statement that nothing was read.
 */
function pushBattleCompositionBlock(blocks, filteredSnapshot, observerId) {
  const heading = [`## 1d. Battle Composition & Saturation (readings, not a combat-value score)`, ``];
  const pointer = `/api/intel/fleets`;

  const templates = weaponTemplatesFromComponentStats(filteredSnapshot?.componentStats);
  if (templates.length === 0) {
    blocks.push(fixedBlock('battle-composition', heading, [
      `- **Composition NOT READ** — this snapshot carries no \`componentStats\` weapon catalogue, so no `
      + `weapon name could be joined to a template and neither side's point defence, throw weight or `
      + `PD-immune count could be composed. This is NOT a report that neither side fields weapons, and it `
      + `is NOT a zero: re-publish the snapshot after upgrading. Per-fleet weapon tallies remain at `
      + `\`${pointer}\`.`,
      ``
    ]));
    return;
  }
  const weaponIndex = buildWeaponIndex(templates);

  // The same hostility rule sections 3 and 4 use, so a fleet counted as a
  // threat there is counted as one here. Human rivals are not folded in: this
  // section answers the alien matchup the spec was written for.
  const ourShips = [];
  const theirShips = [];
  const hostileFactions = new Set();
  const byBody = new Map();
  for (const fleet of asArray(filteredSnapshot?.fleets)) {
    const mine = sameId(fleet.factionId, observerId);
    const hostile = !mine && isGenuinelyHostileFaction(fleet.factionId, fleet.factionName, filteredSnapshot);
    if (!mine && !hostile) continue;
    const ships = asArray(fleet.ships);
    if (mine) ourShips.push(...ships); else { theirShips.push(...ships); hostileFactions.add(fleet.factionName || 'unnamed hostile faction'); }

    const key = normalizeBody(fleet.orbitBody);
    if (!key || key === 'sol' || key === 'deep space') continue;
    if (!byBody.has(key)) byBody.set(key, { body: fleet.orbitBody, ours: [], theirs: [] });
    const entry = byBody.get(key);
    (mine ? entry.ours : entry.theirs).push(...ships);
  }

  const ours = ourShips.length > 0 ? composeBattleSide(ourShips, { weaponIndex }) : null;
  const theirs = theirShips.length > 0 ? composeBattleSide(theirShips, { weaponIndex }) : null;
  const theirsVsOurs = ours && theirs ? saturationVerdict({ attacker: theirs, defender: ours }) : null;
  const oursVsTheirs = ours && theirs ? saturationVerdict({ attacker: ours, defender: theirs }) : null;

  const factionClause = hostileFactions.size > 0 ? `, ${[...hostileFactions].sort().join(' + ')}` : '';
  const headingLines = [...heading];
  headingLines.push(ours
    ? battleSideLine('YOURS', ours, '', shipsWithoutLoadout(ourShips))
    : `- **YOURS:** no observer ship is carried in this snapshot's fleet list, so no own-side composition `
      + `was formed. That is an absent reading, not a fleet of zero hulls.`);
  headingLines.push(theirs
    ? battleSideLine('THEIRS', theirs, factionClause, shipsWithoutLoadout(theirShips))
    : `- **THEIRS:** no genuinely hostile fleet is carried in this snapshot, so no opposing composition was `
      + `formed. Unobserved space is not empty.`);
  headingLines.push(saturationLine(theirsVsOurs, 'Their', 'your'));
  headingLines.push(saturationLine(oursVsTheirs, 'Your', 'their'));

  // THE FIGURE NO SCREEN ANSWERS, on its own line and never inside a ratio.
  headingLines.push(`- **PD-immune weapons — the figure no screen answers: theirs `
    + `${theirs ? battleCount(theirs.pdImmuneWeapons) : 'NOT READ'}, yours `
    + `${ours ? battleCount(ours.pdImmuneWeapons) : 'NOT READ'}.** Beams the game marks non-interceptable, `
    + `deliberately NOT folded into either verdict: averaging them in would hide the case that decides the `
    + `fight.`);

  headingLines.push(`- *Kinetics saturate like missiles — every missile and every magnetic gun is `
    + `\`isPointDefenseTargetable\`, so a missile-only count understates throw weight by about a third.*`);
  // TWO RULES, TWO KINDS OF CLAIM, and the line keeps them apart because they
  // are not equally well evidenced. The 1:1 interception RATIO is the player's
  // stated mechanic (2026-08-28) and is attributed to him with the date; the 2x
  // OVERWHELM MULTIPLE is the rule of thumb he offered as "probably" and "a safe
  // bet". Both attributions travel from the constants in
  // shared/battleComposition.mjs rather than being restated here, so a number
  // and its caveat cannot drift apart. Neither is in the templates, and the line
  // says that once rather than twice.
  headingLines.push(`- *NOT READ FROM THE GAME FILES, and the two rules behind these verdicts are not the same `
    + `kind of claim. THE RATIO IS A STATED MECHANIC: ${INTERCEPTION_ASSUMPTION.claim} — `
    + `${INTERCEPTION_ASSUMPTION.source}, ${INTERCEPTION_ASSUMPTION.stated}. THE MULTIPLE IS A RULE OF THUMB: `
    + `${PD_OVERWHELM_RULE_ATTRIBUTION.claim} — ${PD_OVERWHELM_RULE_ATTRIBUTION.source}, `
    + `${PD_OVERWHELM_RULE_ATTRIBUTION.stated}, offered as "probably" and "a safe bet". `
    // Sentence-initial here, and the constant is written lower-case so it can be
    // used mid-sentence elsewhere. Capitalised at the seam rather than stored
    // capitalised, so the constant stays usable in both positions.
    + `${INTERCEPTION_ASSUMPTION.consequence.charAt(0).toUpperCase()}`
    + `${INTERCEPTION_ASSUMPTION.consequence.slice(1)}.*`);
  headingLines.push(`- *A whole-board total is NOT one engagement: ${MAX_BATTLE_SIDE_SHIPS} ships a side is the `
    + `battle cap (${MAX_BATTLE_SIDE_SHIPS_ATTRIBUTION.source}, ${MAX_BATTLE_SIDE_SHIPS_ATTRIBUTION.stated}; `
    + `not in the templates), so a larger contact resolves in waves.*`);
  // The one line that stops a reader holding two answers and believing
  // whichever agrees with them -- the failure docs/engagement-matchup-spec.md
  // names under "what would make this wrong". The hull thresholds that used to
  // sit in §11 are gone from this document for exactly that reason; they are
  // still computed and still published at /api/v2/briefing, and the line says
  // where, so a reader who wants the abandoned currency has to go and ask for
  // it rather than find it printed beside these readings.
  headingLines.push(`- *This is the force comparison §1c declines to make, and it is the ONLY one in this `
    + `document: the hull counts that used to answer it in §11 are denominated in the combat value `
    + `docs/engagement-matchup-spec.md abandons and are no longer reproduced here. These readings come from `
    + `the game's own fields; that sweep does not. It is still at /api/v2/briefing.*`);

  // Interpretations applied to the counts, printed only where they were used.
  //
  // Summed WITHOUT coercion: a side that was never composed is SKIPPED (it
  // fields no mounts, so it took no default), while a composed side whose count
  // is unreadable makes the total unknown and says so rather than being read as
  // a zero. `SALVO_SHOTS_WHEN_ABSENT` is the one place an absent template field
  // is read as a game default, so how many mounts took it must be visible.
  let assumedSalvo = 0;
  let assumedSalvoUnread = false;
  for (const side of [ours, theirs]) {
    if (!side) continue;
    const mounts = num(side.salvoShotsAssumedMounts);
    if (mounts === null) assumedSalvoUnread = true;
    else assumedSalvo += mounts;
  }
  if (assumedSalvoUnread) {
    headingLines.push(`- *An unknown number of missile mount(s) state no \`salvo_shots\`; the count that took the `
      + `assumed ${SALVO_SHOTS_WHEN_ABSENT} shot each was not read, so the shot totals above rest on an `
      + `interpretation of unmeasured size.*`);
  } else if (assumedSalvo > 0) {
    headingLines.push(`- *${battleCount(assumedSalvo)} missile mount(s) state no \`salvo_shots\` and were counted `
      + `at ${SALVO_SHOTS_WHEN_ABSENT} shot each — the one field the game means as a default when absent.*`);
  }
  if (ours?.proportionalAttribution || theirs?.proportionalAttribution) {
    headingLines.push(`- *Loadout groups naming several systems are split evenly across them.*`);
  }
  if (ours?.tableFallbackUsed || theirs?.tableFallbackUsed) {
    headingLines.push(`- *A system did not resolve to a template and was classified by family instead of by the `
      + `game's own \`isPointDefenseTargetable\` field.*`);
  }

  const contact = [...byBody.values()].filter(e => e.ours.length > 0 && e.theirs.length > 0);
  const block = listBlock('battle-composition', {
    headingLines: [
      ...headingLines,
      ``,
      `### Bodies where both sides have ships present (${localeOr(contact.length)} of `
        + `${localeOr(byBody.size)} occupied)`,
      // ALWAYS printed, not only when the list is empty. On the live board the
      // most threatened body -- Ganymede, 28 hostile hulls present and 45 more
      // arriving -- has no row here because the observer holds nothing there,
      // and a reader scanning a populated list would otherwise read its absence
      // as safety. An unopposed body is the dangerous kind, not the quiet one.
      `*Listed only where BOTH sides have hulls. A body with hostiles present or inbound and NONE of yours `
        + `is in §1c — its absence here is an absence of YOUR ships, not of theirs.*`
    ],
    emptyLines: [
      `- No body carries ships from both sides, so no contact can begin this turn.`,
      ``
    ],
    budgetEmptyLines: budgetEmptyNote('contact bodies', pointer),
    budgetNote: budgetOmissionNote('contact bodies', pointer),
    trailingLines: [``]
  });
  blocks.push(block);

  for (const entry of contact) {
    const l = composeBattleSide(entry.ours, { weaponIndex });
    const r = composeBattleSide(entry.theirs, { weaponIndex });
    const theirsHere = saturationVerdict({ attacker: r, defender: l });
    const oursHere = saturationVerdict({ attacker: l, defender: r });
    const verdictClause = (v, who) => (v.refused
      ? `${who} REFUSED (join incomplete)`
      : `${who} ${v.saturated ? 'SATURATES' : 'held'} (${battleCount(v.attackerPdTargetableShots)} vs `
        + `${battleCount(v.interceptionCapacity)})`);
    addEntry(block, {
      // Most hostile hulls first: the body where the largest opposing force is
      // already in contact is the one a reader must not lose to the budget.
      rank: [-r.ships, -l.ships, String(entry.body || '')],
      variants: [
        [`- **${entry.body || 'UNAVAILABLE'}** — yours ${battleCount(l.ships)} ship(s) / `
          + `${battleCount(l.pointDefenceMounts)} PD / ${battleCount(l.pdTargetableShots)} shot(s) / `
          + `${battleCount(l.pdImmuneWeapons)} immune · theirs ${battleCount(r.ships)} / `
          + `${battleCount(r.pointDefenceMounts)} PD / ${battleCount(r.pdTargetableShots)} shot(s) / `
          + `${battleCount(r.pdImmuneWeapons)} immune · ${verdictClause(theirsHere, 'theirs')} · `
          + `${verdictClause(oursHere, 'yours')}`],
        [`- **${entry.body || 'UNAVAILABLE'}** — yours ${battleCount(l.ships)} ship(s), theirs `
          + `${battleCount(r.ships)} · ${verdictClause(theirsHere, 'theirs')}`]
      ]
    });
  }
}

/**
 * Section 11 of the war room: the strategic commentary engine's read of the
 * measured picture above it.
 *
 * WHY THIS SECTION EXISTS
 *
 * `server/commentary/` has produced a four-layer assessment -- facts, beats,
 * a seeded Monte Carlo hull-threshold sweep, and generated prose -- since it
 * shipped, and until 2026-08-22 every byte of it reached exactly two places:
 * the COMMAND view of the v2 dashboard, and `/api/v2/briefing`. None of the
 * three markdown exports carried any of it, so the entire combat-threshold
 * model was invisible to every LLM reading these files -- which is the failure
 * mode CLAUDE.md's AI-surfaces section exists to catch.
 *
 * THE HULL-THRESHOLD TABLE CAME OUT ON 2026-08-28, AND THAT IS THE POINT OF
 * THE SECTION'S CURRENT SHAPE
 *
 * The five "N hulls" tiers, the `Own best combatant ... combat rating N` line
 * they were denominated in, and the calibration paragraph qualifying both are
 * gone. All three are combat-value figures, and
 * docs/engagement-matchup-spec.md abandons that currency for three separate
 * reasons, any one disqualifying: a scalar cannot express a matchup (2 PD
 * mounts against a 24-missile salvo); the own-side rating applies the
 * observer's single best design to every hull (measured: 58 designs spanning
 * 638,067 down to 0); and in player mode the opponent rating is built on an
 * invented x1.5 and over-rates the enemy 9-15x per body.
 *
 * The decisive argument is not any of those, though -- it is the spec's "what
 * would make this wrong" list, which names KEEPING THE HULL COUNT ALONGSIDE as
 * a defect in its own right: two answers where one is known to be wrong is
 * worse than one answer, because the reader believes whichever agrees with
 * them. Section 1d answers the same question from the game's own weapon and
 * armour fields, in both modes, so the table was the half that had to go. The
 * same reasoning removed the hull count from section 1c in d0a671d.
 *
 * It is NOT suppressed and the section says so on its own line. The sweep still
 * runs, still reaches the COMMAND view, and is whole at `/api/v2/briefing`;
 * this document simply declines to reprint it three sections below §1d.
 *
 * The `advice` line goes the same way ONLY when it is itself a hull count --
 * one of `grammar.js`'s three branches embeds the sweep's own band label
 * ("...on the order of 7 hulls Cimarron"). See `adviceLine` for how that is
 * decided from the data rather than by pattern-matching digits.
 *
 * WHAT IS CARRIED, WHAT IS DROPPED, AND WHY THE DROPPED PART IS RECOVERABLE
 *
 * What survives is what is NOT denominated in combat value: the engine's stance
 * (when it carries no count), the narrative beats -- whose axes are delta-V,
 * armour and hull COUNT, none of them a rating -- the hate-vent horizon, and
 * the production pipeline and throughput, which are queue readings. Three
 * things were already deliberately left behind before the table was:
 *
 *   * `headline` -- one of three interchangeable strings picked by a seeded
 *     PRNG from the same beat set. It carries no information the beats below
 *     do not, and two saves with identical beats can print different
 *     headlines, so an agent diffing them would read noise as signal.
 *   * `prose` (~630 bytes) -- a narrative restatement of the beats, the two
 *     named tiers and the advice. It re-prints the same numbers in a less
 *     parseable register.
 *   * the per-tier `uncertainty` records (~1.8 KB EACH, ~9 KB for five) --
 *     identical across tiers by construction, because one sweep supplies one
 *     `opponentRatingBasis` and the seed/trial/sweep constants are module
 *     constants. They qualified the table, and they left with it.
 *
 * All of them are at `/api/v2/briefing`, and the last line of the section says
 * so by name, in the same relationship sections 9 and 10 have to the endpoints
 * that carry them whole.
 *
 * The section still degrades as a UNIT: it is a fixed block, so the ladder
 * cannot thin it row by row, and it is FIRST in `clampOrder`, so if the budget
 * binds this whole body is the first thing in the document to go, header and
 * pointer surviving. Losing all of it costs a reader nothing they cannot fetch.
 *
 * It is also fixed-size by construction, which is why it needs no ladder entry:
 * `BEAT_DEFINITIONS` holds five beats, and every other line here is one line
 * whatever the save contains, so this block cannot grow with the size of the
 * save the way sections 2, 3 and 6 do.
 *
 * WHERE THE COMMENTARY COMES FROM
 *
 * Exactly where the cycle plan comes from, and for the same reason: it is
 * built by Node CommonJS this module may not touch, so it is handed IN.
 * Express passes `options.strategicCommentary`; the hosted worker passes
 * nothing and the fallback finds it on `snapshot.missionControlBriefing`,
 * which `scripts/publish/rows.js` already writes onto every published row. A
 * runtime with neither says the assessment was not read, rather than printing
 * an empty beat list and a missing table as though the engine had found
 * nothing to say.
 */
function strategicCommentaryLines(filteredSnapshot, observerId, options = {}) {
  const mode = filteredSnapshot.mode || filteredSnapshot.intelMode || filteredSnapshot.visibility || 'player';
  const endpoint = `/api/v2/briefing?observer=${observerId}&mode=${mode}`;
  const commentary = options.strategicCommentary
    ?? filteredSnapshot?.missionControlBriefing?.strategicCommentary
    ?? null;

  if (!commentary) {
    return [
      `- **Strategic commentary UNAVAILABLE in this runtime** — the assessment is produced by the `
      + `commentary engine, not by the snapshot, so it reaches this brief only when the serving runtime `
      + `hands it over. This is NOT a report that no beats fired and no engagement is winnable: nothing `
      + `was read. Fetch it directly at \`${endpoint}\`.`,
      ``
    ];
  }

  const lines = [];
  const sim = commentary.simulation || {};

  // The engine's own recommendation, named. Section 10 learned this the hard
  // way: a section of counts renders byte-identical across a change that moves
  // the recommendation, so the recommendation itself has to be printed --
  // EXCEPT where the recommendation is itself a hull count, which is what
  // `adviceLine` decides.
  lines.push(adviceLine(commentary, sim));

  // An ABSENT beat list is not a list of length zero. "Every beat was evaluated
  // and none fired" is a real finding about a quiet campaign; "the beats were
  // never evaluated" is not a finding at all, and `asArray(undefined).length`
  // would print them the same way.
  if (!Array.isArray(commentary.beats)) {
    lines.push(`- **Narrative beats:** UNAVAILABLE — no beat list was carried, which is not the same as no beat firing.`);
  } else if (commentary.beats.length === 0) {
    lines.push(`- **Narrative beats:** none fired — the beats WERE evaluated and none of their preconditions held.`);
  } else {
    lines.push(`- **Narrative beats (${commentary.beats.length} fired):**`);
    for (const beat of commentary.beats) {
      lines.push(`  - **${beat.name || beat.id || 'UNNAMED'}** (${beat.severity || 'unknown severity'}`
        + `${beat.stance ? `, ${beat.stance}` : ''}, \`${beat.id || 'no-id'}\`) — ${beat.summary || 'UNAVAILABLE'}`);
    }
  }

  // WHERE THE HULL-THRESHOLD TABLE USED TO BE.
  //
  // It printed five "N hulls" tiers, the observer's best design and its combat
  // rating, and a calibration paragraph qualifying all three. Every one of those
  // figures is denominated in `_unnormalizedCombatValue`, which
  // docs/engagement-matchup-spec.md abandons for three separate reasons, and the
  // same document's "what would make this wrong" list names keeping it beside a
  // composition reading as a defect in its own right: two answers where one is
  // known to be wrong is worse than one answer, because the reader believes
  // whichever agrees with them. §1d is the answer that rests on readings, so
  // this is the one that goes.
  //
  // IT IS NOT SUPPRESSED, AND THIS LINE SAYS SO. The sweep still runs, still
  // reaches the COMMAND view and is still whole at /api/v2/briefing; what
  // changed is that this document no longer reprints it beside §1d. A reader
  // who wants it has to go and ask, which is the point.
  //
  // AND "WE DECLINED TO PRINT IT" IS NOT "IT DID NOT RUN". A sweep that failed
  // reports its own reason instead, because claiming a live computation exists
  // when it does not would be a lie in the reassuring direction -- and the
  // reason itself carries no hull count, so printing it costs nothing.
  if (sim.available === true) {
    lines.push(`- **Hull thresholds and own-force combat rating: DELIBERATELY NOT REPRODUCED** — the sweep's `
      + `"N hulls" tiers and the best-design rating they are denominated in are combat-value figures, and `
      + `docs/engagement-matchup-spec.md abandons that currency: a scalar cannot express a matchup, and the `
      + `own-side rating applies the observer's single best design to every hull. §1d answers the same `
      + `question from the game's own weapon and armour fields instead. The sweep still ran and is carried `
      + `whole at \`${endpoint}\` — this is a decision not to print it here, NOT a report that it failed.`);
  } else {
    lines.push(`- **Hull thresholds:** NOT SIMULATED — ${sim.reason || 'no reason was carried with the unavailable sweep'}. `
      + `This document would not have reprinted the tiers in any case — they are the combat-value figures §1d `
      + `replaces — but a sweep that did not run is a different fact and says so here.`);
  }

  const projections = sim.projections || {};
  lines.push(...hateVentLine(projections.hateVent));
  lines.push(...rebuildClockLine(projections.rebuildClock));

  lines.push(`- Headline, full prose, the hull-threshold tiers and their per-tier uncertainty record: \`${endpoint}\``);
  lines.push(``);
  return lines;
}

/**
 * The engine's advice sentence, or the reason it is not reproduced.
 *
 * `server/commentary/grammar.js` builds ONE of its three advice branches around
 * `formatSimulatedThreshold`, which denominates the sentence in the sweep's own
 * hull counts -- "...until you have on the order of 7 hulls Cimarron". That is
 * the currency docs/engagement-matchup-spec.md abandons, and reprinting it here
 * would put a hull count back in this document by the back door, three lines
 * above the statement that there is no longer one in it.
 *
 * The other two branches carry no count at all and are perfectly good advice, so
 * the line is NOT dropped wholesale. It is dropped only when the advice actually
 * contains one of the sweep's own `bandLabel` strings -- a test against the data
 * the sentence was built from, not a regex hunting for digits, so it cannot fire
 * on an advice line that merely mentions a number for some other reason.
 *
 * An absent advice line and a withheld one are different states and read
 * differently: one is a gap in the payload, the other is this document's choice.
 */
function adviceLine(commentary, sim) {
  const advice = typeof commentary?.advice === 'string' && commentary.advice.trim() !== ''
    ? commentary.advice.trim()
    : null;
  if (advice === null) {
    return `- **Recommended stance:** UNAVAILABLE — this assessment carries no advice line`;
  }

  const bandLabels = asArray(sim?.tiers)
    .map(tier => (typeof tier?.bandLabel === 'string' ? tier.bandLabel.trim() : ''))
    .filter(label => label !== '');
  const denominatedInHulls = bandLabels.some(label => advice.includes(label));
  if (!denominatedInHulls) return `- **Recommended stance:** ${advice}`;

  return `- **Recommended stance: NOT REPRODUCED** — this branch of the engine's stance sentence IS a hull `
    + `count ("…on the order of N hulls <design>"), in the currency the line below explains. It is whole at `
    + `the endpoint named at the end of this section, not withheld, and the engine did recommend something.`;
}

/**
 * The hate-vent horizon, or the reason there is none.
 *
 * Four distinct states used to reach consumers as one bare `null`, and one of
 * them is player mode's redaction of the true hate value -- under which this
 * projection can NEVER be produced. Printing nothing there would report an
 * unreadable input as the absence of a venting story.
 */
function hateVentLine(hateVent) {
  if (!hateVent) {
    return [`- **Hate vent horizon:** UNAVAILABLE — no projection record was carried. This is not a report that `
      + `hostility is stable.`];
  }
  if (hateVent.available === true) {
    return [`- **Hate vent horizon (SIMULATED):** ${hateVent.bandLabel || 'UNAVAILABLE'} to fall below the war `
      + `threshold, from ${fixedOr(hateVent.currentHate, 2)} hate at ${fixedOr(hateVent.ventRatePerDay, 4)} hate/day`];
  }
  return [`- **Hate vent horizon:** UNAVAILABLE — ${hateVent.reason || 'no reason was carried'}`];
}

/**
 * Production throughput: what is measured, and what is a bound.
 *
 * The rate used to be `30 / (baseConstructionDays / queuedShips)`, with the
 * parallelism STATED as an assumption. It is now measured, so this prints the
 * rule instead of the caveat. Settled 2026-08-22 against four MD5-verified
 * frozen saves and all eight factions: a shipyard builds ONE hull at a time
 * and yards run concurrently, so the divisor is the number of hulls in
 * progress, never the queue length.
 *
 * Two things print here and they are not the same kind of number.
 *
 * The DELIVERY horizons come from the save's own per-hull `daysToCompletion`,
 * which decrements by exactly the elapsed campaign days and therefore already
 * contains yard tier, station modules and faction tech. They rest on nothing.
 *
 * The RATE divides a build time into that concurrency. When the build time is
 * the hull template's base it is a FLOOR and says so, because the template base
 * ignores every modifier above and each one only shortens the build -- measured
 * ratios of stated duration to template base run 0.30-0.86 across five factions
 * on ExitSave.gz. When the observer's own queue states a duration for that
 * hull, the rate is measured instead and the wording changes with it.
 */
function rebuildClockLine(clock) {
  if (!clock) {
    return [`- **Production throughput:** UNAVAILABLE — no projection record was carried. This is not a report of `
      + `zero throughput.`];
  }
  if (clock.available !== true) {
    return [`- **Production throughput:** UNAVAILABLE — ${clock.reason || 'no reason was carried'}`];
  }

  const lines = [];
  const building = num(clock.concurrentBuilds);
  const waiting = num(clock.waitingBehindCount);
  const yards = num(clock.shipyardCount);
  const idle = num(clock.idleShipyardCount);
  const next = num(clock.nextCompletionDays);
  const last = num(clock.lastCommittedCompletionDays);
  const within30 = num(clock.deliveriesWithin30Days);
  const unreadableHorizons = num(clock.completionHorizonsUnreadableCount);

  // MEASURED: the pipeline. A zero here is a reading -- the queue WAS read --
  // and is phrased as a finding rather than as an absence.
  const yardPart = yards === null
    ? 'the shipyard module count could not be read'
    : `${localeOr(building)} of ${localeOr(yards)} shipyard(s) working, ${localeOr(idle)} idle`;
  const horizonPart = next === null
    ? (building === 0 ? 'nothing is under construction' : 'no completion horizon was readable')
    : `next in ${localeOr(next)} days, all ${localeOr(building)} inside ${localeOr(last)} days`;
  const within30Part = within30 === null
    ? (unreadableHorizons !== null && unreadableHorizons > 0
      ? `; deliveries inside 30 days NOT counted — ${localeOr(unreadableHorizons)} countdown(s) unreadable`
      : '')
    : `; ${localeOr(within30)} due inside 30 days`;
  lines.push(`- **Production pipeline (MEASURED from the save's own countdowns):** `
    + `${localeOr(building)} hull(s) building, ${localeOr(waiting)} waiting behind them — ${yardPart}. `
    + `${horizonPart}${within30Part}. A yard builds ONE hull at a time and yards run in PARALLEL, `
    + `measured; a hull waiting behind another does not advance at all.`);

  const rate = num(clock.monthlyThroughputEst);
  const days = num(clock.daysPerHullEst);
  if (rate === null) {
    lines.push(`- **Production throughput:** UNAVAILABLE — `
      + `${clock.throughputUnavailableReason || 'no build time was readable'}. No default build time is `
      + `substituted, so this is not a report of zero throughput.`);
    return lines;
  }
  if (rate === 0) {
    lines.push(`- **Production throughput (SIMULATED):** 0 hulls/mo — NOTHING IS BUILDING. `
      + `${localeOr(waiting)} hull(s) sit queued but unstarted, and a queued hull that has not started does not `
      + `advance, so the delivery rate is a measured zero.`);
    return lines;
  }
  const reciprocal = days !== null ? `, i.e. one every ${localeOr(days)} days` : '';
  const belowOne = rate < 1 ? ' — UNDER ONE HULL A MONTH: this hull cannot be replaced inside a month' : '';
  const bound = clock.throughputBound === 'lower'
    ? `AT LEAST ${localeOr(rate)}`
    : localeOr(rate);
  const basis = clock.buildTimeBasis === 'measured-queue-entry'
    ? `Basis: ${localeOr(clock.buildDays)}-day build MEASURED from this observer's own queue, `
      + `${localeOr(building)} building concurrently.`
    : `Basis: the hull template's ${localeOr(clock.buildDays)}-day base, ${localeOr(building)} building `
      + `concurrently. That base is a CEILING on time, so this rate is a FLOOR: yard tier `
      + `(Shipyard ×0.8, Spaceworks ×0.6), station modules (Nanofactory ×0.75) and faction tech `
      + `(Effect_ShipConstructionTimeReduction ×0.8) all shorten it, and the observer holds some of them.`;
  lines.push(`- **Production throughput (SIMULATED):** ${bound} × ${clock.targetHull || 'UNAVAILABLE'} per `
    + `month${reciprocal}${belowOne}. ${basis}`);
  return lines;
}

/**
 * Section 9 of the war room: what every drive would do to one of our designs.
 *
 * Deliberately small -- the point of the block is that the surface EXISTS and
 * carries its three headline answers plus the honest census, not that it
 * reproduces 541 rows. `/api/intel/drive-explorer` carries the rest, and the
 * block names it.
 *
 * The three answers are three RANKINGS -- most delta-V, most burst
 * acceleration, most sustained acceleration -- not one ranking with three
 * columns. See the comment beside `bestCruise` for what was measured before the
 * third was added.
 *
 * The estimate line is a separate bullet in its own words. Folding destination
 * reachability into a bullet beside a delta-V figure would present a heuristic
 * as a measurement, which is precisely what this feature exists not to do.
 */
function driveExplorerLines(filteredSnapshot, observerId) {
  const endpoint = `/api/intel/drive-explorer?observer=${observerId}&detail=full&limit=1000`;
  let explorer;
  try {
    explorer = driveExplorerResource(filteredSnapshot, {
      observerId,
      // `mode` first: it is what the LOCAL filtered snapshot carries, while
      // `intelMode` / `visibility` are what a published row labels itself with.
      // Without it an omniscient local snapshot rated its drives as 'player'.
      // Measured 2026-08-22: on the current save that changed nothing this
      // block renders -- the two calls differ only in the `intelMode` label the
      // resource echoes back, which section 9 does not print -- so this closes
      // a latent divergence rather than a live one.
      mode: filteredSnapshot.mode || filteredSnapshot.intelMode || filteredSnapshot.visibility || 'player',
      status: DRIVE_AVAILABILITY.fittable,
      limit: 1000
    });
  } catch (err) {
    return [`*Drive Explorer unavailable: ${err.message}*`, ``];
  }

  if (!explorer.driveCatalogue.available || !explorer.selectedDesign) {
    // An honest unavailable state, naming which half is missing. Never a
    // fabricated placeholder row.
    return [`*Drive Explorer unavailable: ${explorer.driveCatalogue.reason || explorer.reason || 'no drive catalogue or observer design in this snapshot'}.*`, ``];
  }

  const design = explorer.selectedDesign;
  const census = explorer.availabilityCensus;
  const fitted = design.fittedDrivePerformance;
  const lines = [];

  lines.push(`- **Design:** ${design.displayName}${design.hullName ? ` (${design.hullName})` : ''} | `
    + `${localeOr(design.shipsInService)} hull(s) in service | `
    + `Reactor: ${design.reactor.powerPlantClass || 'UNAVAILABLE'}`
    + `${isMeasured(design.reactor.maxOutputGW) ? ` (${fixedOr(design.reactor.maxOutputGW, 1)} GW)` : ''}`);
  lines.push(`- **Fitted drive (MEASURED):** ${design.fittedDrive.displayName || 'UNAVAILABLE'} — `
    + `${fixedOr(fitted.deltaVKps, 2)} km/s ΔV, ${accelOr(fitted.combatAccelerationMps2)} m/s² combat accel, `
    + `${accelOr(fitted.cruiseAccelerationMps2)} m/s² cruise accel`
    + `${fitted.computable ? '' : ` (not computable: ${fitted.reason || design.baselineUnmeasuredReason || 'unmeasured'})`}`);
  lines.push(`- **Catalogue:** ${localeOr(explorer.driveCatalogue.total)} drives — `
    + `${localeOr(census[DRIVE_AVAILABILITY.fittable])} fittable today, `
    + `${localeOr(census[DRIVE_AVAILABILITY.researchable])} researchable, `
    + `${localeOr(census[DRIVE_AVAILABILITY.never])} never researchable, `
    + `${localeOr(census[DRIVE_AVAILABILITY.unresolved])} unresolved`);
  lines.push(`- **Reactor gate:** ${localeOr(explorer.reactorCompatibilityCensus.compatible)} of `
    + `${localeOr(explorer.driveCatalogue.rated)} drives can be powered by this design's reactor; `
    + `${localeOr(explorer.reactorCompatibilityCensus.incompatible)} need a different reactor class and are shown marked rather than hidden`);

  // The two headline answers, both restricted to what is fittable today and to
  // what the reactor can actually power. A drive the reactor cannot power is
  // never presented as an option.
  const options = asArray(explorer.items)
    .filter(row => !row.isFittedDrive && row.reactor.compatible === true && row.measured.computable);
  const bestBy = (read) => options.reduce((best, row) => {
    const value = num(read(row));
    if (value === null) return best;
    const bestValue = best === null ? null : num(read(best));
    return bestValue === null || value > bestValue ? row : best;
  }, null);
  const bestDeltaV = bestBy(row => row.measured.deltaVKps);
  const bestAccel = bestBy(row => row.measured.combatAccelerationMps2);
  // A THIRD ranking, not a third column on the second one. `combat = cruise x
  // thrustCap` and thrustCap runs 1 to 160, so the two orderings genuinely come
  // apart: over the whole rated catalogue against this design they share 0 of
  // their top 10 (best by combat: Pion Torch x6 at 606 m/s2 burst / 10.1
  // sustained; best by cruise: Neutron Liquid Rocket x6 at 20.6 / 20.6).
  //
  // Measured 2026-08-22 on the live save: inside the population this section
  // actually ranks -- fittable TODAY, reactor-compatible, computable -- the two
  // winners are the SAME drive on all 10 of the observer's 24 designs that have
  // any computable option, in both modes, because everything fittable today
  // caps at thrustCap 1. The line is here anyway: a reader cannot tell "the two
  // rankings agree" from "only one ranking was run" unless both are printed,
  // and the agreement is itself the answer to "is my best burst drive also my
  // best transit drive".
  const bestCruise = bestBy(row => row.measured.cruiseAccelerationMps2);

  const optionLine = (label, row) => {
    if (!row) {
      return `- **${label}:** none — no drive that is both fittable today and compatible with this design's `
        + `reactor has a computable figure in this snapshot`;
    }
    return `- **${label} (MEASURED):** ${row.displayName} — ${fixedOr(row.measured.deltaVKps, 2)} km/s ΔV `
      + `(${fixedOr(row.measured.deltaVMultipleVsFitted, 2)}× fitted), `
      + `${accelOr(row.measured.combatAccelerationMps2)} m/s² combat accel `
      + `(${fixedOr(row.measured.combatAccelerationMultipleVsFitted, 2)}× fitted), `
      + `${accelOr(row.measured.cruiseAccelerationMps2)} m/s² cruise accel `
      + `(${fixedOr(row.measured.cruiseAccelerationMultipleVsFitted, 2)}× fitted)`
      + `${row.measured.dryMassCaveat ? ` — CAVEAT: ${row.measured.dryMassCaveat}` : ''}`;
  };
  lines.push(optionLine('Best fittable today by ΔV', bestDeltaV));
  lines.push(optionLine('Best fittable today by combat acceleration', bestAccel));
  // The cruise ranking is always REPORTED; only its rendering is compacted when
  // it lands on the drive the line above already spelled out in full. Saying
  // "the same drive" is a statement of the ranking's result -- it is not the
  // line being dropped, which is what would make the two rankings
  // indistinguishable from one ranking having been run.
  lines.push(bestCruise && bestCruise === bestAccel
    ? `- **Best fittable today by cruise acceleration (MEASURED):** the same drive — `
      + `${bestCruise.displayName}, in full on the line above. The burst and sustained rankings agree for `
      + `this design's fittable set.`
    : optionLine('Best fittable today by cruise acceleration', bestCruise));
  lines.push(`- *Combat accel is the BURST figure; cruise accel is the sustained one. combat / cruise is `
    + `that drive's own thrust cap, so wherever the two differ the combat figure OVERSTATES transit acceleration.*`);

  // The estimate, in its own register and its own words.
  //
  // `destinationsModelled` is deliberately NOT defaulted to 0. An unreadable
  // destination table means no destination was evaluated, which is a different
  // statement from "zero destinations are modelled" -- and the second one reads
  // as a measurement of nothing rather than an absence of measurement.
  const model = explorer.destinationModel;
  if (model && model.available) {
    const modelled = model.destinationsModelled;
    lines.push(`- *ESTIMATE, not a measurement — destination reachability comes from a fixed heuristic ΔV table. `
      + `Only ${localeOr(modelled)} destination(s) are modelled; a body absent from that list is not an unreachable one.*`);
    const opened = bestDeltaV ? asArray(bestDeltaV.estimatedDestinations.opensUp) : [];
    lines.push(`- *Estimated destinations opened by the best fittable ΔV option: `
      + `${opened.length > 0 ? opened.join(', ') : 'none beyond what the fitted drive already reaches'} `
      + `(${localeOr(bestDeltaV ? bestDeltaV.estimatedDestinations.reachableCount : null)} of ${localeOr(modelled)} modelled reachable).*`);
  } else {
    lines.push(`- *ESTIMATE, not a measurement — destination reachability comes from a fixed heuristic ΔV table, `
      + `and a body absent from that table is not an unreachable one.*`);
    lines.push(`- *Estimated destinations NOT EVALUATED (which is not the same as none being reachable): `
      + `${model?.reason || 'no destination table could be read for this design'}.*`);
  }

  lines.push(`- Full listing (${localeOr(explorer.driveCatalogue.total)} drives, sortable and filterable): \`${endpoint}\` `
    + `— add \`&sort=cruise-acceleration\` to rank the whole catalogue by sustained acceleration rather than burst`);
  lines.push(``);
  return lines;
}

// ---------------------------------------------------------------------------
// 3. /latest-snapshot.md  (~14 KB, Macro State - Byte-Identical with exportGenerator)
// ---------------------------------------------------------------------------

export function renderCompactSnapshotMarkdown(filteredData) {
  const meta = filteredData.metadata;
  const observer = resolveObserverFaction(filteredData.factions, filteredData.observerFactionId, {
    fallbackToFirst: true
  });
  const isPlayer = filteredData.mode === 'player';

  const lines = [];
  lines.push(`# TI Strategic Snapshot`);
  lines.push(``);
  lines.push(`**Date:** ${meta.gameTimeString || 'Unknown'}`);
  lines.push(`**Observer Faction:** ${observer?.displayName || INITIATIVE_DISPLAY_NAME}`);
  lines.push(`**Intelligence Mode:** ${filteredData.mode.toUpperCase()}`);

  const hateInfo = observer?.alienHate;
  if (hateInfo) {
    if (hateInfo.visibility === 'unavailable') {
      lines.push(`**Assessed Alien Threat:** UNAVAILABLE (Requires Alien Operations research)`);
    } else if (hateInfo.visibility === 'estimated') {
      lines.push(`**Assessed Alien Threat:** ${hateInfo.visibleEstimate} (Game-visible estimate)`);
    } else {
      // `!== null` alone let an *undefined* actual through to .toFixed and
      // threw. Probe for a finite number, and fall back to whatever visible
      // estimate exists rather than crashing the whole export.
      lines.push(`**Alien Hate (Raw Save):** ${isMeasured(hateInfo.actual)
        ? Number(hateInfo.actual).toFixed(2)
        : (hateInfo.visibleEstimate || 'UNAVAILABLE')}`);
    }
  }
  lines.push(``);

  const economics = filteredData.alienHateEconomics;
  if (economics) {
    lines.push(`## Alien Hate Economics`);
    if (!economics.applicable) {
      lines.push(`- **Minimum-hate floor:** NOT APPLICABLE to ${observer?.displayName || 'this faction'}.`);
    } else {
      const actualHate = isMeasured(economics.actualAlienHate)
        ? Number(economics.actualAlienHate).toFixed(2)
        : economics.visibleHateEstimate || 'UNAVAILABLE';
      const actualLabel = isMeasured(economics.actualAlienHate)
        ? 'Raw-save actual hate'
        : economics.visibleHateEstimate
          ? 'Game-visible hate estimate'
          : 'Actual hate';
      lines.push(`- **${actualLabel}:** ${actualHate}`);
      lines.push(`- **Minimum hate floor:** ${fixedOr(economics.minimumAlienHate, 2)}`);
      lines.push(`- **Hate above floor:** ${fixedOr(economics.hateAboveFloor, 2)}`);
      lines.push(`- **War threshold:** ${fixedOr(economics.warThreshold, 2)}`);
      lines.push(`- **Minimum-hate headroom:** ${fixedOr(economics.minimumHateHeadroom, 2)}`);
      lines.push(`- **Mission Control used:** ${fixedOr(economics.usedMissionControl, 0)}`);
      lines.push(`- **Mission Control capacity:** ${fixedOr(economics.missionControlCapacity, 0)} (context only; capacity does not affect hate)`);
      lines.push(`- **MC threshold for a 50-hate floor:** ${fixedOr(economics.mcWarFloor, 1)} used MC`);
      lines.push(`- **Minimum floor status:** ${economics.minimumFloorStatus}`);
      lines.push(`- **Current hate status:** ${economics.currentWarStatus}`);
      lines.push(`- **Calculation:** \`${economics.formula?.text || 'UNAVAILABLE'}\``);
      for (const project of economics.reductionProjects || []) {
        if (!project.applicable) continue;
        lines.push(`- **${project.label}:** ${project.completed ? 'COMPLETED (×0.80)' : 'NOT COMPLETED'}`);
      }
    }
    lines.push(``);
  }

  // 1. Faction Balance
  lines.push(`## Faction Balance`);
  lines.push(``);
  for (const f of filteredData.factions) {
    // GDP gets the same treatment as research on the next line: an
    // unmeasured economy printed "$0.0T", which reads as a collapsed state
    // rather than an unknown one.
    const gdpT = isMeasured(f.totalGdp)
      ? `$${(Number(f.totalGdp) / ONE_TRILLION).toFixed(1)}T GDP`
      : 'UNAVAILABLE GDP';
    // Research output can legitimately be unmeasured. Printing "0.0k" for a
    // null reads as a faction with no research programme at all.
    const research = typeof f.totalResearch === 'number' && Number.isFinite(f.totalResearch)
      ? `${(f.totalResearch / 1e3).toFixed(1)}k Research/mo`
      : 'UNAVAILABLE Research/mo';
    const score = isMeasured(f.powerScore?.overall) ? `${f.powerScore.overall}/100` : 'UNKNOWN';
    const fleetPower = f.combatPowerAvailable ? f.combatPower : 'UNAVAILABLE';
    lines.push(`- **${f.displayName}**: ${f.controlPointsCount} CPs | ${gdpT} | ${f.habsCount ?? 'UNKNOWN'} Habs | ${f.shipsCount ?? 'UNKNOWN'} Ships (${fleetPower} Fleet Power) | ${research} | Dashboard Power Estimate: ${score}`);
  }
  lines.push(``);

  // 2. Strategic Servant / Hostile Holdings
  const priorityFactionName = filteredData.priorityTargetFaction?.name || SERVANTS_DISPLAY_NAME;
  lines.push(`## Strategic Enemy Holdings (Priority Targets: ${priorityFactionName})`);
  lines.push(``);
  const priorityTargetsDisplayCap = 8;
  const allServantTargets = Array.isArray(filteredData.servantTargets)
    ? filteredData.servantTargets
    : null;
  const topTargets = allServantTargets ? allServantTargets.slice(0, priorityTargetsDisplayCap) : [];
  if (topTargets.length > 0) {
    for (const t of topTargets) {
      const targetCPs = t.targetCPCount ?? t.servantCPCount ?? 0;
      const targetGdp = isMeasured(t.gdpTrillion) ? `$${t.gdpTrillion}T GDP` : 'GDP UNAVAILABLE';
      lines.push(`- **${t.nationName}** (Target Score: ${t.score}/100) — ${targetGdp}, ${targetCPs}/${t.totalCPCount} ${t.targetFactionName || priorityFactionName} CPs${t.nukes > 0 ? `, ${t.nukes} Nukes` : ''} [${t.reasons.join('; ')}]`);
    }
    const omittedCount = allServantTargets.length - topTargets.length;
    if (omittedCount > 0) {
      lines.push(`*${topTargets.length} of ${allServantTargets.length} priority targets shown; ${omittedCount} omitted by the ${priorityTargetsDisplayCap}-entry display cap.*`);
    }
  } else {
    lines.push(`- No major hostile holdings currently identified.`);
  }
  lines.push(``);

  // 3. Technology
  lines.push(`## Technology`);
  lines.push(``);
  lines.push(`### Global Research Slots:`);
  // What basis every RP figure in this section is on. See researchCostBasisLine.
  const technologyCostBasis = researchCostBasisLine(filteredData);
  if (technologyCostBasis) {
    lines.push(``);
    lines.push(technologyCostBasis);
    lines.push(``);
  }
  for (const slot of filteredData.globalResearch.activeSlots) {
    // An unresolved tech template leaves totalCost -- and therefore percent
    // -- genuinely unknown. Say so instead of printing "null%" or throwing
    // on .toLocaleString().
    const pct = isMeasured(slot.percent) ? `${slot.percent}%` : 'UNKNOWN%';
    lines.push(`- **Slot ${slot.slotNumber}: ${slot.displayName}** — ${pct} (${localeOr(slot.accumulatedResearch)} / ${localeOr(slot.totalCost)}) | Leading: ${slot.leadFactionName} (${localeOr(slot.leadContribution)})`);
  }
  lines.push(``);

  lines.push(`### Observer Projects (${observer?.displayName}):`);
  if (observer?.currentProjects?.length > 0) {
    for (const cp of observer.currentProjects) {
      const pct = isMeasured(cp.percent) ? `${cp.percent}%` : 'UNKNOWN%';
      const cost = isMeasured(cp.totalCost) ? cp.totalCost : 'UNKNOWN';
      lines.push(`- Researching: **${cp.displayName}** (${pct} - ${cp.accumulatedResearch}/${cost})`);
    }
  } else {
    lines.push(`- No active faction project research tracked.`);
  }
  lines.push(``);

  // 4. Alien Intelligence
  lines.push(`## Alien Intelligence`);
  lines.push(``);
  const alienStage = filteredData.alienIntelligenceStage;
  if (alienStage) {
    lines.push(`- **Abductions Detection:** ${alienStage.abductions.status}`);
    lines.push(`- **Alien Contacts Detection:** ${alienStage.contacts.status}`);
    lines.push(`- **Alien Operations Tracking:** ${alienStage.operations.status}`);
    const detected = alienStage.operatives.active ? (alienStage.operatives.detectedCount ?? 0) : 'UNAVAILABLE';
    lines.push(`- **Direct Operative Detection (Alien Movements):** ${alienStage.operatives.status} (${detected} detected)`);
  }

  const alienCouncilors = filteredData.councilors.filter(c => c.isAlien);
  if (alienCouncilors.length > 0) {
    lines.push(`\n**Detected Alien Operatives:**`);
    for (const ac of alienCouncilors) {
      lines.push(`- **${ac.displayName}** | Location: ${ac.locationName} | Status: ${ac.status}`);
    }
  } else {
    lines.push(`\n*No alien councilors currently detected.*`);
  }
  lines.push(``);

  // 5. Space Balance & Fleets
  lines.push(`## Space Balance & Fleets`);
  lines.push(``);
  const bodyFleets = new Map();
  for (const fl of filteredData.fleets) {
    const b = fl.orbitBody || 'Deep Space';
    if (!bodyFleets.has(b)) bodyFleets.set(b, []);
    bodyFleets.get(b).push(fl);
  }

  for (const [body, flList] of bodyFleets.entries()) {
    const summary = [];
    const fMap = new Map();
    for (const fl of flList) {
      if (!fMap.has(fl.factionName)) {
        fMap.set(fl.factionName, { ships: 0, shipsUnknown: false, power: 0, powerKnown: false, powerUnknown: false });
      }
      const obj = fMap.get(fl.factionName);
      // A fleet whose ship count or combat power the save omits is counted
      // as unknown rather than silently added as zero, so a partial total is
      // never presented as a complete one.
      if (Number.isFinite(fl.shipsCount)) obj.ships += fl.shipsCount; else obj.shipsUnknown = true;
      if (Number.isFinite(fl.combatPower)) { obj.power += fl.combatPower; obj.powerKnown = true; } else obj.powerUnknown = true;
    }
    for (const [fname, st] of fMap.entries()) {
      const loadouts = flList.filter(fl => fl.factionName === fname && fl.weaponSummary).map(fl => fl.weaponSummary);
      // A measured zero is reported as 0; only a genuinely absent reading is
      // called unavailable, and a partly-measured total says so.
      const powerLabel = st.powerKnown
        ? (st.powerUnknown ? `${st.power}+ (partial)` : st.power)
        : 'unavailable';
      const shipLabel = st.shipsUnknown ? `${st.ships}+ (partial)` : st.ships;
      summary.push(`${fname}: ${shipLabel} ships (${powerLabel} power${loadouts.length ? `; ${loadouts.join(', ')}` : ''})`);
    }
    lines.push(`- **${body}**: ${summary.join(' | ')}`);
  }

  return lines.join('\n');
}

export function renderFullMarkdownReport(filteredData) {
  const compact = renderCompactSnapshotMarkdown(filteredData);
  const lines = [compact, ''];

  lines.push(`---`);
  lines.push(`## Full Tech Matrix Snapshot`);
  lines.push(``);
  lines.push(`| Project | ${filteredData.factions.map(f => f.displayName.replace('the ', '')).join(' | ')} |`);
  lines.push(`| :--- | ${filteredData.factions.map(() => ':---:').join(' | ')} |`);

  for (const row of filteredData.techMatrix) {
    const cols = [row.displayName];
    for (const f of filteredData.factions) {
      const st = row.factions[f.ID]?.status || 'unknown';
      let badge = '—';
      if (st === 'completed') badge = '✓';
      else if (st === 'researching') badge = '◐';
      else if (st === 'available') badge = '○';
      else if (st === 'unknown') badge = '?';
      cols.push(badge);
    }
    lines.push(`| ${cols.join(' | ')} |`);
  }

  return lines.join('\n');
}

export default {
  renderThreatsMarkdown,
  renderWarRoomMarkdown,
  renderCompactSnapshotMarkdown,
  renderFullMarkdownReport,
  buildDesignLookup,
  buildHabModuleAggregates,
  evaluateHostileRelevance,
  extractWeaponAndPdSummary,
  formatFleetDesignRollup,
  renderWithByteBudget,
  utf8ByteLength,
  WAR_ROOM_BYTE_BUDGET,
  THREATS_BYTE_BUDGET
};
