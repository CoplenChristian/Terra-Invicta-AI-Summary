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
import {
  ENGAGEMENT_VERDICTS,
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

  // Per-fleet engagement estimates.
  //
  // The one figure on this page that is NOT a reading of the save, so the
  // heading, the preamble and every row say so. What it answers that nothing
  // else here does: the archetype tiers in the strategic commentary top out at
  // three ships while 26 of 57 alien fleets on the measured save are larger, so
  // "a heavy capital costs 7 hulls" is not an answer about a 34-ship fleet.
  const engagement = buildFleetEngagement(filteredSnapshot, {
    observerId,
    mode: filteredSnapshot.mode || 'player',
    limit: 8
  });

  const engagementBlock = listBlock('engagement-estimates', {
    headingLines: [
      `## Per-Fleet Engagement Estimates — MODELLED, NOT MEASURED`,
      ``,
      ...(engagement.available
        ? [
          `*Each band is Monte Carlo spread of a model across seeded runs and NOTHING else — it excludes `
          + `the error in the opponent rating, which is an assumption in ${engagement.mode.toUpperCase()} `
          + `mode. Rating is composed over each fleet's OWN ships, never N copies of a representative one. `
          + `Ordered by threat to observer assets; full ordering basis and all rows at `
          + `/api/intel/fleet-engagement.*`,
          ``,
          `- **Own force:** ${engagement.ownForce.totalHulls ?? 'UNAVAILABLE'} hull(s) in `
          + `${engagement.ownForce.fleetCount} fleet(s); best design `
          + `${engagement.ownForce.bestDesignName || 'UNAVAILABLE'} rated `
          + `${engagement.ownForce.rating === null ? 'UNAVAILABLE' : Math.round(engagement.ownForce.rating).toLocaleString()}`,
          `- **Hostile fleets tracked:** ${engagement.fleetsTotalCount} `
          + `(${engagement.shipsTotalCount} ships) — reachability `
          + `${Object.entries(engagement.reachabilityTotals).map(([k, v]) => `${v} ${k}`).join(', ') || 'not evaluated'}`,
          `- **Gate:** a fleet beyond every observer fleet's ΔV gets NO hull count. One whose reachability `
          + `could not be evaluated still gets one, labelled unknown — withholding it would make an `
          + `unevaluated threat read as no threat.`,
          ``
        ]
        : [
          `*No engagement estimate: ${engagement.reason}*`,
          ``
        ])
    ],
    emptyLines: [],
    budgetEmptyLines: budgetEmptyNote('engagement estimates', '/api/intel/fleet-engagement'),
    budgetNote: budgetOmissionNote('engagement estimates', '/api/intel/fleet-engagement'),
    detailNote: (levelCounts, kept) => [
      `*Composition and reachability detail suppressed to fit the size budget for `
      + `${levelCounts[0]} of ${kept} listed estimates; see /api/intel/fleet-engagement.*`,
      ``
    ]
  });
  blocks.push(engagementBlock);

  for (const row of asArray(engagement.items)) {
    const composed = row.composition.ratedShips + row.composition.unratedShips;
    const requirementText = row.requirement.bandLabel !== null
      ? `${row.requirement.bandLabel} — MODELLED, composed over ${row.composition.ratedShips} of `
        + `${composed} ship(s)`
      : `NONE — ${row.requirement.verdict.toUpperCase()}: ${row.requirement.reason}`;
    const fieldableText = row.fieldable.verdict === 'unknown'
      ? `UNKNOWN — ${row.fieldable.reason}`
      : `${row.fieldable.verdict.toUpperCase()} — ${row.fieldable.hullsAtEngagementPoint} reachable hull(s) `
        + `vs ${row.fieldable.hullsNeeded} needed`;

    const headerLine = `### ${row.fleetName} — ${row.shipsCount ?? 'unknown'} ships`
      + `${row.distinctHullTypes ? ` / ${row.distinctHullTypes} hull types` : ''}`;
    const forceLine = `- **At:** ${row.orbitBody || 'unknown'}`
      + `${row.destination ? ` → ${row.destination}${row.daysToArrival === null ? '' : ` in ${row.daysToArrival}d` }` : ' (stationary)'}`
      + ` · ${row.dominantWeaponType || 'weapon mix unknown'}`;
    const reachLine = `- **Reach:** ${row.reachability.state.toUpperCase()}`
      + ` (${row.reachability.isEstimate ? 'estimate' : 'measured'})`
      + `${row.engagementPoint.body ? ` at ${row.engagementPoint.body}` : ''}`
      + `${row.reachability.reason ? ` — ${row.reachability.reason}` : ''}`;
    const needLine = `- **Hulls needed:** ${requirementText}`;
    const fieldLine = `- **Observer can field:** ${fieldableText}`;

    const full = [headerLine, forceLine, reachLine, needLine, fieldLine, ``];

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
      variants: [full, [headerLine, reachLine, needLine, ``]]
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
  // first, and detail is shed before whole entries are cut. The engagement
  // estimates are the newest section and the only modelled one, so they shed
  // detail before either measured section does and are dropped before the
  // measured contact list.
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
  blocks.push(fixedBlock(
    'drive-explorer',
    [`## 9. Drive Explorer (refit options for one design)`, ``],
    driveExplorerLines(filteredSnapshot, observerId)
  ));

  // -------------------------------------------------------------------------
  // SECTION 10: COUNCIL CYCLE PLAN -- THE RISK FLOOR AND THE BENCH
  // -------------------------------------------------------------------------
  blocks.push(fixedBlock(
    'council-cycle-plan',
    [`## 10. Council Cycle Plan (risk floor & bench)`, ``],
    councilCyclePlanLines(filteredSnapshot, observerId, options)
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
  //   4.    Friendly fleets (§2) → L1  -- shed the weapon/PD line. Cheap, and
  //                                       every fleet stays listed.
  //   5.    Hostile fleets (§3) → L1   -- shed the second detail line, same
  //                                       reasoning; every contact stays named.
  //   6-7.  Construction (§5) modules, then stations.
  //   8.    Friendly fleets (§2) → L2  -- shed the propulsion line.
  //   9.    Key habs (§6)              -- a static inventory the JSON
  //                                       endpoints carry in full.
  //   10.   Construction (§5) queues   -- last of §5: the only part that says
  //                                       when reinforcements actually arrive.
  //   11.   Friendly fleets (§2) → L3  -- shed the design rollup; header only.
  //   12.   Hostile fleets (§3) entries -- ranked by the relevance evaluator's
  //                                       own criteria, least relevant first.
  //   13.   Friendly fleets (§2) entries -- the observer's own picture is the
  //                                       last thing cut before threats.
  //   14.   Incoming threats (§4)      -- cut only when nothing else remains,
  //                                       latest ETA first.
  //
  // §1 (alien threat posture), §7 (logistics) and §10 (council cycle plan) are
  // fixed-size by construction and never degrade through the ladder; §10 is
  // bounded at five lines whatever the plan's size, because every list inside
  // it is reported as a COUNT rather than reproduced.
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
    { block: 'friendly-fleets', action: 'reduce', toLevel: 1 },
    { block: 'hostile-fleets', action: 'reduce', toLevel: 1 },
    { block: 'construction-modules', action: 'drop' },
    { block: 'construction-stations', action: 'drop' },
    { block: 'friendly-fleets', action: 'reduce', toLevel: 2 },
    { block: 'habs', action: 'drop' },
    { block: 'construction-queues', action: 'drop' },
    { block: 'friendly-fleets', action: 'reduce', toLevel: 3 },
    { block: 'hostile-fleets', action: 'drop' },
    { block: 'friendly-fleets', action: 'drop' },
    { block: 'incoming-threats', action: 'drop' }
  ];

  // Last resort if even an entry-free document will not fit: suppress whole
  // section BODIES in the same priority order. Section headers always survive.
  const clampOrder = [
    // Reference material and a what-if, so it is the first body to give way and
    // the last thing anyone needs in a war-room brief cut to the bone.
    'drive-explorer',
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
 * `benched` is a SLICE, and it is deliberately not re-sorted: the engine emits
 * candidates in registry order and that order is load-bearing for every
 * explanation a reader sees, so re-ranking the slice would silently change
 * which entries appear. The line therefore states both the counts AND the
 * ordering rule -- a reader told "8 of 46" without it would reasonably assume
 * the eight are the best eight.
 */
function councilCyclePlanLines(filteredSnapshot, observerId, options = {}) {
  const mode = filteredSnapshot.mode || filteredSnapshot.intelMode || filteredSnapshot.visibility || 'player';
  const endpoint = `/api/v2/briefing?observer=${observerId}&mode=${mode}`;
  const plan = options.cyclePlan
    ?? filteredSnapshot?.missionControlBriefing?.engineDirectives?.cyclePlan
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
    + `action(s) carried, ${localeOr(plan.benchedOmittedCount)} omitted for transport. The listed entries are `
    + `the FIRST few in candidate-generation order, NOT the highest-value few — emission order is `
    + `load-bearing for every explanation, so the slice is deliberately not re-ranked`);

  lines.push(`- **Assigned this cycle:** ${countOr(plan.assignments)} councilor(s); `
    + `${countOr(plan.unassigned)} unassigned, ${countOr(plan.committed)} already committed`);

  lines.push(`- Full plan, with each action's rules, odds and expected value: \`${endpoint}\``);
  lines.push(``);
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
  const topTargets = (filteredData.servantTargets || []).slice(0, 8);
  if (topTargets.length > 0) {
    for (const t of topTargets) {
      const targetCPs = t.targetCPCount ?? t.servantCPCount ?? 0;
      const targetGdp = isMeasured(t.gdpTrillion) ? `$${t.gdpTrillion}T GDP` : 'GDP UNAVAILABLE';
      lines.push(`- **${t.nationName}** (Target Score: ${t.score}/100) — ${targetGdp}, ${targetCPs}/${t.totalCPCount} ${t.targetFactionName || priorityFactionName} CPs${t.nukes > 0 ? `, ${t.nukes} Nukes` : ''} [${t.reasons.join('; ')}]`);
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
