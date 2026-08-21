// server/engine/candidates/intelligence.js
//
// Purpose: the intelligence candidate generator — capability without a
//   sighting.
//
// (c) Intelligence: capability without sighting.
//
// capabilities.canDirectlyDetectAlienCouncilors (Project_TheirMovements) can
// be true while zero alien councilors are visible -- councilors[].isAlien
// true but seenByFactionIds never contains the observer's own faction ID.
// That is a real state, not a bug: on the 2026-08-20 live save, 6 alien
// councilors exist and all 6 have an empty seenByFactionIds. Reporting
// "detectedCount: 0" next to an unlocked capability reads as "nothing out
// there" when the truth is "we aren't looking" -- this candidate exists to
// say that explicitly.
//
// If an alien councilor IS visible, a Detain candidate is emitted instead.
// Detain against an alien is special-cased in the wiki (Diplomacy §
// "Actions that affect hatred"): 10 hate on normal success, 0 on critical --
// the TIMissionTemplate [0,1,1,0,2,3] Detain row is the human-target case
// and does not apply here. Budget-gated by hate/total-war-budget and
// story-gated by legality/story-gate.

const { toFiniteNumber, sameId } = require('../../../shared/util.mjs');

const ALIEN_DETAIN_STORY_GATE = 'CaptureAHydra objective (Unlocked/Completed) / AccessLiveHydra milestone';

function generateIntelligenceCandidates(world) {
  const candidates = [];
  const councilors = Array.isArray(world.councilors) ? world.councilors : [];
  const alienCouncilors = councilors.filter((c) => c && c.isAlien === true);
  const canDetect = world.capabilities?.canDirectlyDetectAlienCouncilors === true;
  const visibleAliens = alienCouncilors.filter((c) => Array.isArray(c.seenByFactionIds)
    && c.seenByFactionIds.some((id) => sameId(id, world.observerId)));

  // Player mode strips unsighted alien councilors from the list entirely, so
  // `alienCouncilors` is empty there even when aliens exist and we hold the
  // tracking capability -- which is exactly the state this candidate is for.
  // alienIntelligenceStage.operatives survives filtering and carries the same
  // fact as an explicit count, so prefer it and fall back to the raw list.
  const operatives = world.alienIntelligenceStage?.operatives || null;
  const detectedCount = toFiniteNumber(operatives?.detectedCount);
  const capabilityUnused = operatives?.active === true && detectedCount === 0;
  const unusedFromRawList = canDetect && alienCouncilors.length > 0 && visibleAliens.length === 0;

  if (capabilityUnused || unusedFromRawList) {
    candidates.push({
      id: 'intel:capability-unlocked-unused',
      family: 'intelligence',
      missionType: 'Investigate Alien Activity',
      title: 'Convert alien-detection capability into sightings -- Investigate Alien Activity / Surveil Location',
      target: { kind: 'capability', nation: null, faction: 'the Aliens', controlPointType: null, isExecutive: null },
      hate: null,
      cost: null,
      // Known alien count is omniscient-only; in player mode we know the
      // capability is on and the sighting count is zero, but not how many
      // operatives are out there. Null, not 0 -- "none sighted" and "none
      // exist" are opposite conclusions.
      value: {
        alienCouncilorCount: alienCouncilors.length > 0 ? alienCouncilors.length : null,
        sightedCount: 0,
        capabilityUnlockedUnused: true
      },
      score: null,
      provenance: {
        source: 'capabilities.canDirectlyDetectAlienCouncilors (Project_TheirMovements) + councilors[].seenByFactionIds',
        estimateClass: 'exact'
      },
      unmetPreconditions: []
    });
  }

  const canDetain = world.capabilities?.canDetainAlienCouncilors;
  for (const alien of visibleAliens) {
    const storyGateKnown = canDetain !== undefined && canDetain !== null;
    const storyGatePassed = canDetain === true;
    const unmet = [];
    if (!storyGateKnown) {
      unmet.push(`${ALIEN_DETAIN_STORY_GATE} cannot be confirmed from this snapshot.`);
    } else if (!storyGatePassed) {
      unmet.push(`${ALIEN_DETAIN_STORY_GATE} is not available -- Detain mission against aliens is story-locked.`);
    }

    candidates.push({
      id: `detain-alien:${alien.ID}`,
      family: 'intelligence',
      missionType: 'Detain',
      title: storyGatePassed
        ? `Detain ${alien.displayName} -- alien operative sighted`
        : `Detain ${alien.displayName} -- pending ${ALIEN_DETAIN_STORY_GATE}`,
      target: {
        kind: 'alienCouncilor',
        nation: null,
        faction: 'the Aliens',
        controlPointType: null,
        isExecutive: null,
        councilorId: alien.ID,
        councilorName: alien.displayName
      },
      hate: {
        toAliens: { low: 0, high: 10 },
        note: 'Detain vs an alien councilor is special-cased: 10 hate on normal success, 0 on critical '
          + 'success, no retaliation (wiki Diplomacy § "Actions that affect hatred"). The TIMissionTemplate '
          + '[0,1,1,0,2,3] Detain row is the human-target case and does not apply to an alien target.'
      },
      // Consumed by generateCandidates: this candidate has already said
      // in its own hate note why the Detain TIMissionTemplate row does not
      // describe it, so the row must not be attached back onto it by the
      // generic spec lookup.
      templateApplies: false,
      cost: { resource: 'Operations', amount: null, kind: 'bonus' },
      value: { alienCouncilorId: alien.ID, storyGatePassed, storyGateKnown },
      score: null,
      provenance: {
        source: `wiki Diplomacy § "Actions that affect hatred" (post-1.0); ${ALIEN_DETAIN_STORY_GATE} story gate`,
        estimateClass: 'exact'
      },
      unmetPreconditions: unmet
    });
  }

  return candidates;
}

module.exports = { ALIEN_DETAIN_STORY_GATE, generateIntelligenceCandidates };
