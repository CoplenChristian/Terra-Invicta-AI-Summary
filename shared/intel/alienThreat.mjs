// shared/intel/alienThreat.mjs
//
// Purpose: the alien-threat projection — hate math, floor and retaliation —
//   with its own deliberate mode re-check.
//
// The hate math endpoint. Kept in its own module because its mode re-check is
// a deliberate second line of defence over `server/intelligenceFilter.js` --
// see the long comment inside -- and burying that beside unrelated projections
// is how it came to be trusted rather than enforced in the first place.

import { DEFAULT_OBSERVER_FACTION_ID } from '../constants.mjs';
import { toFiniteNumber as toFinite, resolveObserverFaction } from '../util.mjs';
import { buildAlienHateEconomics, ALIEN_HATE_WAR_THRESHOLD } from '../alienHateEconomics.mjs';

/**
 * 7. Alien Threat: Precise hate math, minimum-hate floor, and retaliation mechanics.
 */
export const alienThreatResource = (snapshot, observerId = DEFAULT_OBSERVER_FACTION_ID, { mode = null } = {}) => {
  const observer = resolveObserverFaction(snapshot.factions, observerId) || {};
  // `|| 'Normal'` here was not cosmetic: difficulty selects the hate floor
  // multiplier (0.05/0.30/0.60/1.00), so defaulting it publishes a wrong
  // minimum-hate figure as if it were measured. Absent stays null, and
  // buildAlienHateEconomics then reports the floor as UNAVAILABLE.
  const rawDifficulty = snapshot.metadata?.difficulty;
  const difficulty = typeof rawDifficulty === 'string' && rawDifficulty.trim() !== ''
    ? rawDifficulty
    : null;

  // ---------------------------------------------------------------------
  // Defence in depth on the raw alien hate.
  //
  // This used to read `observer.assessedAlienHateOfMe` through
  // buildAlienHateEconomics with a hard-coded `mode: 'omniscient'`, on the
  // stated assumption that callers hand in an already intel-filtered
  // snapshot. The assumption was false: intelligenceFilter stripped that raw
  // field from every faction EXCEPT the observer's own, so /api/intel/alien-
  // threat published the exact save value (49.6) in Player Intel mode -- the
  // documented, hosted, default-player endpoint -- while
  // `alienHateEconomics.actualAlienHate` from the same snapshot was null.
  //
  // So the mode rule is re-applied here rather than trusted:
  //   1. an explicitly requested player mode redacts, whatever the snapshot
  //      happens to carry;
  //   2. otherwise the filter's own structured `alienHate` object wins, since
  //      that is the mode-aware representation (`actual` is null when
  //      redacted) and it cannot disagree with itself;
  //   3. only a snapshot with neither signal -- a hand-built fixture, never a
  //      filtered one -- falls back to the raw field.
  // A value that is withheld is reported as null with a stated reason. It is
  // never replaced with an estimate, a floor, or a zero.
  //
  // This duplicates the filter's rule ON PURPOSE. Both halves stay.
  // ---------------------------------------------------------------------
  const requestedMode = typeof mode === 'string' && mode.trim() !== '' ? mode.trim().toLowerCase() : null;
  const snapshotMode = typeof snapshot.mode === 'string' && snapshot.mode.trim() !== ''
    ? snapshot.mode.trim().toLowerCase()
    : (snapshot.isOmniscient === true ? 'omniscient' : null);
  const redactsRawHate = requestedMode === 'player' || snapshotMode === 'player';
  const structuredHate = observer.alienHate && typeof observer.alienHate === 'object'
    ? observer.alienHate
    : null;

  let actualHateStatus;
  let actualHateSource;
  let resolvedHate = null;
  if (redactsRawHate) {
    actualHateStatus = 'redacted';
    actualHateSource = 'redacted: Player Intel mode does not expose the save\'s raw alien hate; '
      + 'the player-legitimate reading is the visible estimate meter';
  } else if (structuredHate) {
    resolvedHate = toFinite(structuredHate.actual);
    actualHateStatus = resolvedHate === null ? 'unavailable' : 'available';
    actualHateSource = resolvedHate === null
      ? `unavailable: filtered snapshot reports alienHate.visibility='${structuredHate.visibility || 'unknown'}'`
      : `measured: filtered snapshot alienHate.actual (visibility='${structuredHate.visibility || 'unknown'}')`;
  } else {
    resolvedHate = toFinite(observer.assessedAlienHateOfMe);
    actualHateStatus = resolvedHate === null ? 'unavailable' : 'available';
    actualHateSource = resolvedHate === null
      ? 'unavailable: assessedAlienHateOfMe not present in this snapshot'
      : 'measured: raw save assessedAlienHateOfMe (unfiltered snapshot)';
  }

  // Do NOT reimplement the hate floor here. buildAlienHateEconomics is the
  // single source of truth and is what the dashboard card renders: difficulty
  // multipliers are 0.05/0.30/0.60/1.00, and each completed concealment
  // project multiplies the floor by 0.8 (they compound, they do not add).
  // It is handed the resolved hate rather than the observer object, so a raw
  // field that survives filtering cannot reach the derived figures either.
  const economics = buildAlienHateEconomics({
    observer: { ...observer, assessedAlienHateOfMe: resolvedHate },
    difficulty,
    mode: 'omniscient'
  });

  const round1 = (value) => (value === null ? null : Number(Number(value).toFixed(1)));
  const projectKey = (id) => {
    const bare = String(id).replace(/^Project_/, '');
    return bare.charAt(0).toLowerCase() + bare.slice(1);
  };

  const projects = { applicable: [], completed: [] };
  for (const project of economics.reductionProjects) {
    projects[projectKey(project.id)] = project.completed;
    if (project.applicable) projects.applicable.push(project.id);
    if (project.completed) projects.completed.push(project.id);
  }
  // Reduction is multiplicative: n projects leave 0.8^n of the floor standing.
  projects.concealmentMultiplier = economics.concealmentMultiplier;
  projects.totalReductionPercent = Math.round((1 - economics.concealmentMultiplier) * 100);

  const actualHate = economics.actualAlienHate;
  const atWar = actualHate === null ? null : actualHate >= ALIEN_HATE_WAR_THRESHOLD;

  // Fields the save parser does not currently produce. Emit null (unknown)
  // rather than 0, which would read as a verified "this never happened".
  const unknownIfAbsent = (value) => (value === undefined || value === null ? null : value);
  const investigations = observer.alienInvestigations;
  const alienInvestigationCount = Array.isArray(investigations)
    ? investigations.length
    : Number.isFinite(Number(investigations)) ? Number(investigations) : null;

  // What the player legitimately knows about alien hate is the in-game 5-pip
  // estimate meter, which the intelligence filter already builds on
  // `faction.alienHate`. Surfacing it here means redacting the float leaves the
  // endpoint with the real reading rather than a hole -- and it is a label, not
  // a number, so it cannot be mistaken for the value it replaces.
  const rawVisibleEstimate = structuredHate ? structuredHate.visibleEstimate : null;
  const visibleEstimate = typeof rawVisibleEstimate === 'string' &&
    rawVisibleEstimate.trim() !== '' &&
    rawVisibleEstimate !== 'UNKNOWN' &&
    rawVisibleEstimate !== 'UNAVAILABLE'
    ? rawVisibleEstimate
    : null;

  return {
    actualHate: round1(actualHate),
    // 'available' | 'redacted' | 'unavailable'. A withheld value is null with a
    // stated reason -- never a fabricated stand-in, and never a confident 0.
    actualHateStatus,
    actualHateSource,
    visibleEstimate,
    visibleEstimatePips: structuredHate ? toFinite(structuredHate.pips) : null,
    visibleEstimateMaxPips: structuredHate ? toFinite(structuredHate.maxPips) : null,
    usedMC: economics.usedMissionControl,
    difficulty,
    difficultyMeasured: difficulty !== null && economics.difficultyMultiplier !== null,
    difficultyMultiplier: economics.difficultyMultiplier,
    projects,
    minimumHate: round1(economics.minimumAlienHate),
    ventableHate: round1(economics.hateAboveFloor),
    warThreshold: ALIEN_HATE_WAR_THRESHOLD,
    minimumHateMCThreshold: economics.mcWarFloor === null ? null : Math.floor(economics.mcWarFloor),
    calculation: economics.formula.text,
    // Hate above the floor is not automatically recoverable. The aliens only
    // vent hate when they destroy an asset AND all of the following hold.
    venting: {
      ventableHate: round1(economics.hateAboveFloor),
      guaranteed: false,
      conditions: [
        'Not at Total War with the aliens',
        'Asset not Trespassing (at/beyond Jupiter, or anywhere the aliens hold a hab, except Earth)',
        'Asset was actually targeted by the aliens (self-defence kills do not vent)'
      ],
      shipVentValue: 'hull Construction Tier',
      habModuleVentValue: 'ModuleTier^2 (+Tier if Mining Complex, +Tier if Construction Module), divided by 2/3/4/5 for Cinematic/Normal/Veteran/Brutal'
    },
    // Every hate modifier the game applies is scaled by a random 0.8-1.2,
    // so any delta derived from these values carries at least +/-20% error.
    hateModifierVariance: { min: 0.8, max: 1.2 },
    retaliation: {
      // Null, never false. A threshold check that cannot be evaluated is
      // unknown; reporting it as "no retaliation" is the reassuring direction
      // to be wrong in and is exactly how the Total War veto went inert.
      retaliationActive: atWar,
      retaliationReason: atWar === null
        ? (actualHateStatus === 'redacted'
          ? 'UNKNOWN — alien hate is redacted in Player Intel mode, so the war threshold cannot be evaluated'
          : 'UNAVAILABLE — alien hate not exposed in this snapshot')
        : atWar
          ? `Alien hate crossed the war threshold (${ALIEN_HATE_WAR_THRESHOLD})`
          : 'None',
      // Killing an alien councilor marks up to 3 space assets for death for
      // 5 years, independent of current hate. Assassinate triggers this only
      // on a normal success; Detain never triggers it.
      alienInvestigationCount,
      aliensRemoved: unknownIfAbsent(observer.aliensRemoved),
      factionAssassinations: unknownIfAbsent(observer.factionAssassinations),
      lastDateOfFixedAlienHate: unknownIfAbsent(observer.lastDateOfFixedAlienHate),
      unavailableFields: ['aliensRemoved', 'factionAssassinations', 'lastDateOfFixedAlienHate']
        .filter(field => observer[field] === undefined || observer[field] === null)
    }
  };
};
