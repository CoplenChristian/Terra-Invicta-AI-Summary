// server/engine/rules/legality.js
//
// The three "is this move even allowed" vetoes: the executive-last ordering
// constraint, the no-territory filter that separates a takeable control point
// from a ghost, and the alien-Detain story gate.
//
// All three return 'unknown' rather than 'pass' when the field they read is
// absent. A legality check that cannot be evaluated must say so; falling
// through to "allowed" is how an illegal move gets recommended.

const { toFiniteNumber } = require('../../../shared/util.mjs');
const { ALIEN_DETAIN_STORY_GATE } = require('../candidates/intelligence');

const executiveLast = {
  id: 'legality/executive-last',
  kind: 'veto',
  // Scoped to Control Nation, not to the whole expansion family. The rule is
  // a constraint on TAKING the executive seat -- every other control point in
  // the nation must be ours first. Purge removes a rival from a control point
  // and is not governed by it, so applying it there parked every
  // executive-seat Purge in `uncertain` for a reason that does not apply.
  appliesTo: (candidate) => candidate.missionType === 'Control Nation' && candidate.target?.isExecutive === true,
  evaluate(world, candidate) {
    const cpCount = toFiniteNumber(candidate.value?.cpCountInNation);
    if (cpCount === null) return 'unknown';
    if (cpCount === 1) return 'pass';
    const allOtherCpsOwnedByObserver = candidate.value?.allOtherCpsOwnedByObserver;
    if (allOtherCpsOwnedByObserver === null || allOtherCpsOwnedByObserver === undefined) return 'unknown';
    return allOtherCpsOwnedByObserver ? 'pass' : 'veto';
  },
  because(world, candidate) {
    const nation = candidate.target?.nation;
    const cpCount = candidate.value?.cpCountInNation;
    if (cpCount === 1) return `${nation} has only one control point, so executive-last is trivially satisfied.`;
    const owned = candidate.value?.allOtherCpsOwnedByObserver;
    if (owned === null || owned === undefined) {
      return `Cannot confirm whether every other control point in ${nation} is ours -- ownership of the `
        + 'other CPs is unmeasurable from this snapshot.';
    }
    return owned
      ? `Every other control point in ${nation} is already ours, so the executive seat can be taken last.`
      : `${nation} has ${cpCount} control points and at least one non-executive CP is not ours yet -- `
        + 'executive-last blocks taking the executive seat first.';
  },
  source: 'Notion 09 -- executive control points can only be taken last, after every other CP in the nation is held.',
  estimateClass: 'exact'
};

const noTerritory = {
  id: 'legality/no-territory',
  kind: 'veto',
  appliesTo: (candidate) => candidate.family === 'expansion',
  evaluate(world, candidate) {
    const regionsCount = candidate.value?.regionsCount;
    if (regionsCount === null || regionsCount === undefined) return 'unknown';
    return regionsCount > 0 ? 'pass' : 'veto';
  },
  because(world, candidate) {
    const nation = candidate.target?.nation;
    const cls = candidate.value?.territoryClass;
    if (cls === 'unformed') {
      return `${nation} has 0 regions and 0 population -- the nation has not formed yet; this is a future `
        + 'opportunity tied to a formation project, not a takeable CP.';
    }
    if (cls === 'absorbed') {
      return `${nation} has 0 regions despite population on record -- its territory has been absorbed into `
        + 'a bloc; the control point is a ghost.';
    }
    return `${nation} reports 0 regions in this snapshot.`;
  },
  source: 'Live-save analysis (docs/archive/directive-rule-engine-plan.md §4a): unclaimed CPs split into unformed '
    + 'placeholder nations, nations absorbed into blocs, and real territory. regionsCount > 0 is the decisive filter.',
  estimateClass: 'exact'
};

const storyGate = {
  id: 'legality/story-gate',
  kind: 'veto',
  appliesTo: (candidate) => candidate.missionType === 'Detain' && candidate.target?.kind === 'alienCouncilor',
  evaluate(world, candidate) {
    const canDetain = world.capabilities?.canDetainAlienCouncilors;
    if (canDetain === true) return 'pass';
    if (canDetain === false) return 'veto';
    return 'unknown';
  },
  because(world, candidate) {
    const canDetain = world.capabilities?.canDetainAlienCouncilors;
    if (canDetain === true) return `${ALIEN_DETAIN_STORY_GATE} is available, so Detain against alien councilors is unlocked.`;
    if (canDetain === false) return `${ALIEN_DETAIN_STORY_GATE} is not available -- Detain mission against aliens is story-locked.`;
    return `${ALIEN_DETAIN_STORY_GATE} status is not observable in this snapshot -- cannot verify whether Detain on aliens is unlocked.`;
  },
  source: `Game story gates (${ALIEN_DETAIN_STORY_GATE} required for alien councilor detention).`,
  estimateClass: 'exact'
};

module.exports = { executiveLast, noTerritory, storyGate };
