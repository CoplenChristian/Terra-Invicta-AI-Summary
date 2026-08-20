const { test } = require('node:test');
const assert = require('node:assert');

const briefingGenerator = require('../server/briefingGenerator');
const snapshotBuilder = require('../server/snapshotBuilder');
const intelligenceFilter = require('../server/intelligenceFilter');
const { makeSaveData } = require('./fixtures/syntheticSave');
const {
  classifyProxy,
  expectedAlienHate,
  assessCampaignPosture,
  pickPrimaryDirective,
  findHumanNonProxyTarget
} = require('../server/directiveAdvisor');

// Shares come from the official wiki, Diplomacy § "Pro-Alien Hate Sharing"
// (rev 2026-08-11, post-1.0). The rule is conditional, not a flat fraction:
// the Servants pass 1/4 when they can contact the aliens and 1/8 when they
// cannot; the Protectorate passes 1/10, and only while it has contact.
test('classifies Servants and Protectorate with contact-conditional shares', () => {
  const servants = classifyProxy({ templateName: 'SubmitCouncil' });
  assert.strictEqual(servants.kind, 'servants');
  assert.strictEqual(servants.shareMin, 0.125);
  assert.strictEqual(servants.shareMax, 0.25);

  const protectorate = classifyProxy({ templateName: 'AppeaseCouncil' });
  assert.strictEqual(protectorate.shareMin, 0, 'no contact means the aliens get nothing');
  assert.strictEqual(protectorate.shareMax, 0.1);

  assert.strictEqual(classifyProxy({ displayName: 'the Servants' }).kind, 'servants');
  assert.strictEqual(classifyProxy({ displayName: 'the Academy' }).shareMax, 0);
});

test('a proven Hydra Diplomacy collapses the share band to a point', () => {
  const known = classifyProxy({
    templateName: 'SubmitCouncil',
    completedProjects: ['Project_HydraDiplomacy']
  });
  assert.strictEqual(known.alienContact, true);
  assert.strictEqual(known.shareMin, 0.25);
  assert.strictEqual(known.shareMax, 0.25);
  assert.strictEqual(known.shareKnown, true);
});

test('an unseen contact project means unknown, not absent', () => {
  // Enemy project lists are intelligence-limited, so a miss proves nothing.
  // Reading it as "no contact" would halve every proxy hate estimate.
  const enemy = classifyProxy({ templateName: 'SubmitCouncil', completedProjects: ['Project_Farm'] });
  assert.strictEqual(enemy.alienContact, null);
  assert.strictEqual(enemy.shareMin, 0.125);
  assert.strictEqual(enemy.shareMax, 0.25);

  // Our own faction is the exception: we see every project we finished.
  const own = classifyProxy({
    templateName: 'SubmitCouncil',
    completedProjects: ['Project_Farm'],
    hasFullProjectVisibility: true
  });
  assert.strictEqual(own.alienContact, false);
  assert.strictEqual(own.shareMax, 0.125);
});

test('the hate band carries both share uncertainty and the ±20% roll', () => {
  const servants = classifyProxy({ templateName: 'SubmitCouncil' });

  // Crackdown success hate is 2 (TIMissionTemplate slot 4).
  // Low  = 2 × 1/8 × 0.8 = 0.2   High = 2 × 1/4 × 1.2 = 0.6
  const crackdown = expectedAlienHate('Crackdown', servants);
  assert.ok(Math.abs(crackdown.expectedLow - 0.2) < 1e-9, String(crackdown.expectedLow));
  assert.ok(Math.abs(crackdown.expectedHigh - 0.6) < 1e-9, String(crackdown.expectedHigh));
  assert.ok(crackdown.label.includes('±20%'));

  // Purge success hate is 5.
  const purge = expectedAlienHate('Purge', servants);
  assert.ok(Math.abs(purge.expectedLow - 0.5) < 1e-9, String(purge.expectedLow));
  assert.ok(Math.abs(purge.expectedHigh - 1.5) < 1e-9, String(purge.expectedHigh));

  // The Protectorate floor is a real zero: with no contact nothing is shared.
  const protectorate = expectedAlienHate('Purge', classifyProxy({ templateName: 'AppeaseCouncil' }));
  assert.strictEqual(protectorate.expectedLow, 0);
  assert.ok(Math.abs(protectorate.expectedHigh - 0.6) < 1e-9, String(protectorate.expectedHigh));

  const defend = expectedAlienHate('Defend Interests', servants);
  assert.strictEqual(defend.feedsProxyHate, false);
  assert.strictEqual(defend.expectedMid, 0);
});

test('the note records that only action-gained hate is shared', () => {
  const note = expectedAlienHate('Purge', classifyProxy({ templateName: 'SubmitCouncil' })).note;
  assert.match(note, /passive drift/i);
  assert.match(note, /never shared/i);
});

test('holds proxy offensives when hate is hot and the fleet is fragile', () => {
  const hot = assessCampaignPosture({
    alienHateEconomics: {
      actualAlienHate: 71.6,
      currentWarStatus: 'WAR THRESHOLD EXCEEDED',
      warThreshold: 50
    },
    observer: { ID: 4712, displayName: 'the Initiative', shipsCount: 23, fleetsCount: 2 },
    factions: [
      { ID: 4712, displayName: 'the Initiative', shipsCount: 23 },
      { ID: 4717, displayName: 'the Aliens', templateName: 'AlienCouncil', shipsCount: 161 }
    ]
  });
  assert.strictEqual(hot.escalateLate, true);
  assert.strictEqual(hot.spaceFragile, true);
  assert.strictEqual(hot.hateHot, true);

  const safe = assessCampaignPosture({
    alienHateEconomics: {
      actualAlienHate: 18,
      currentWarStatus: 'BELOW WAR THRESHOLD',
      warThreshold: 50
    },
    observer: { ID: 4712, shipsCount: 80, fleetsCount: 6 },
    factions: [{ ID: 4717, displayName: 'the Aliens', shipsCount: 40 }]
  });
  assert.strictEqual(safe.escalateLate, false);
});

test('uses game-visible pips in player mode instead of raw save hate', () => {
  const posture = assessCampaignPosture({
    alienHateEconomics: {
      actualAlienHate: null,
      visibleHateEstimate: '■■■■■',
      currentWarStatus: 'GAME-VISIBLE ESTIMATE'
    },
    observer: { ID: 4712, shipsCount: 23 },
    observerHate: { pips: 5, visibleEstimate: '■■■■■' },
    factions: [{ ID: 4717, displayName: 'the Aliens', shipsCount: 161 }]
  });
  assert.strictEqual(posture.actualAlienHate, null);
  assert.strictEqual(posture.pips, 5);
  assert.strictEqual(posture.escalateLate, true);
});

test('holds proxy offensives near Total War even with a strong fleet', () => {
  // The original gate needed hate AND a fragile fleet. But crossing 200 is
  // the one hate transition that cannot be undone -- past it venting is
  // voided -- so a big fleet does not make it safe to feed proxy hate.
  const posture = assessCampaignPosture({
    alienHateEconomics: { actualAlienHate: 168, currentWarStatus: 'WAR THRESHOLD EXCEEDED' },
    observer: { ID: 4712, shipsCount: 240, fleetsCount: 18 },
    factions: [{ ID: 4717, displayName: 'the Aliens', templateName: 'AlienCouncil', shipsCount: 90 }]
  });

  assert.strictEqual(posture.spaceFragile, false, 'fleet is strong');
  assert.strictEqual(posture.nearTotalWar, true);
  assert.strictEqual(posture.escalateLate, true, 'still holds — Total War is irreversible');
  assert.ok(Math.abs(posture.totalWarHeadroom - 32) < 1e-9, String(posture.totalWarHeadroom));
  assert.ok(posture.holds.some((h) => /irreversible/i.test(h)), JSON.stringify(posture.holds));
});

// Player mode redacts the save's true hate, leaving only the 5-diamond meter,
// which saturates at ">= 50". At five diamonds the real figure could be 51 or
// 199 and the meter reads identically -- so distance to Total War is genuinely
// unobservable. Reporting that as "clear" would render an absent measurement
// as a confident safe, which is the failure mode this codebase forbids.
test('reports Total War proximity as unknown when the meter is saturated', () => {
  const posture = assessCampaignPosture({
    alienHateEconomics: { actualAlienHate: null, currentWarStatus: 'GAME-VISIBLE ESTIMATE' },
    observer: { ID: 4712, shipsCount: 240, fleetsCount: 18 },
    observerHate: { pips: 5 },
    factions: [{ ID: 4717, displayName: 'the Aliens', templateName: 'AlienCouncil', shipsCount: 90 }]
  });

  assert.strictEqual(posture.spaceFragile, false, 'fleet is strong');
  assert.strictEqual(posture.totalWarProximity, 'unknown');
  assert.strictEqual(posture.hateObservable, false);
  assert.strictEqual(posture.escalateLate, true, 'blind above the war threshold still holds');
  assert.ok(
    posture.holds.some((h) => /not observable/i.test(h)),
    JSON.stringify(posture.holds)
  );
});

test('below five diamonds is genuinely clear of Total War', () => {
  // Under five diamonds hate is below 50, which is comfortably clear of 150.
  // That much IS knowable from the meter, so it must not report unknown.
  const posture = assessCampaignPosture({
    alienHateEconomics: { actualAlienHate: null },
    observer: { ID: 4712, shipsCount: 240, fleetsCount: 18 },
    observerHate: { pips: 3 },
    factions: [{ ID: 4717, displayName: 'the Aliens', templateName: 'AlienCouncil', shipsCount: 90 }]
  });
  assert.strictEqual(posture.totalWarProximity, 'clear');
  assert.strictEqual(posture.escalateLate, false);
});

test('an unreadable alien fleet is not counted as zero ships', () => {
  // A fleet whose size we cannot scout must not make the alien force look
  // weak; that would invert the fragility check.
  const posture = assessCampaignPosture({
    alienHateEconomics: { actualAlienHate: 30 },
    observer: { ID: 4712, shipsCount: 40, fleetsCount: 3 },
    factions: [{ ID: 4717, displayName: 'the Aliens', templateName: 'AlienCouncil' }],
    fleets: [
      { factionId: 4717, shipsCount: null },
      { factionId: 4717, shipsCount: undefined }
    ]
  });
  assert.strictEqual(posture.alienShips, null, 'unknown, not 0');
});

test('a strong fleet at low hate is free to escalate', () => {
  const posture = assessCampaignPosture({
    alienHateEconomics: { actualAlienHate: 22, currentWarStatus: 'BELOW WAR THRESHOLD' },
    observer: { ID: 4712, shipsCount: 240, fleetsCount: 18 },
    factions: [{ ID: 4717, displayName: 'the Aliens', templateName: 'AlienCouncil', shipsCount: 90 }]
  });
  assert.strictEqual(posture.escalateLate, false);
  assert.deepStrictEqual(posture.holds, []);
  assert.ok(Math.abs(posture.warHeadroom - 28) < 1e-9, 'reports room to the war threshold');
});

test('classifies the alien faction by template even when named Hydras', () => {
  // TIFactionTemplate friendlyName for AlienCouncil is "Hydras"; the save
  // spells it "the Aliens". Neither spelling may drop the alien fleet out of
  // the comparison, or spaceFragile silently loses its denominator.
  assert.strictEqual(classifyProxy({ templateName: 'AlienCouncil' }).kind, 'aliens');
  assert.strictEqual(classifyProxy({ displayName: 'Hydras' }).kind, 'aliens');
  assert.strictEqual(classifyProxy({ displayName: 'the Aliens' }).kind, 'aliens');
});

test('does not treat unknown hate as high hate', () => {
  const posture = assessCampaignPosture({
    alienHateEconomics: { actualAlienHate: null },
    observer: { ID: 4712, shipsCount: 23, assessedAlienHateOfMe: 71.6 },
    factions: [{ ID: 4717, displayName: 'the Aliens', shipsCount: 161 }]
  });
  assert.strictEqual(posture.escalateLate, false);
});

test('picks a non-proxy human executive over Servants when scoring alternatives', () => {
  const alt = findHumanNonProxyTarget([
    { displayName: 'Japan', GDP: 5e12, executiveFactionId: 10, executiveFactionName: 'the Servants' },
    { displayName: 'China', GDP: 20e12, executiveFactionId: 20, executiveFactionName: 'the Academy' }
  ], [
    { ID: 10, displayName: 'the Servants', templateName: 'SubmitCouncil' },
    { ID: 20, displayName: 'the Academy', templateName: 'CooperateCouncil' }
  ], 4712);
  assert.strictEqual(alt.nationName, 'China');
  assert.strictEqual(alt.executiveFactionName, 'the Academy');
});

test('briefing primary directive holds a Servant crackdown when hate is hot and ships are low', () => {
  const briefing = briefingGenerator.generateMissionControlBriefing({
    metadata: { gameTimeString: '7/16/2031' },
    observerFactionId: 4712,
    mode: 'omniscient',
    alienHateEconomics: {
      actualAlienHate: 71.6,
      currentWarStatus: 'WAR THRESHOLD EXCEEDED',
      warThreshold: 50
    },
    factions: [
      {
        ID: 4712,
        displayName: 'the Initiative',
        templateName: 'CooperateCouncil',
        shipsCount: 23,
        fleetsCount: 2,
        alienHate: { actual: 71.6 }
      },
      { ID: 10, displayName: 'the Servants', templateName: 'SubmitCouncil' },
      { ID: 4717, displayName: 'the Aliens', templateName: 'AlienCouncil', shipsCount: 161 }
    ],
    servantTargets: [{
      nationName: 'Japan',
      gdpTrillion: 5.4,
      targetCPCount: 3,
      isExecutiveTarget: true,
      unrest: 2
    }],
    priorityTargetFaction: { id: 10, name: 'the Servants' },
    councilors: [{
      ID: 1,
      factionId: 4712,
      isOwnCouncilor: true,
      displayName: 'Operative K',
      typeTemplateName: 'Spy',
      attributes: { Espionage: 16, Persuasion: 4 },
      activeMissionName: 'Idle'
    }],
    nations: [],
    fleets: [],
    habs: [],
    habSites: []
  });

  assert.strictEqual(briefing.campaignPosture.escalateLate, true);
  assert.ok(briefing.primaryDirective, 'primary directive exists');
  assert.notEqual(briefing.primaryDirective.id, 'geo-1');
  assert.ok(!/crackdown/i.test(briefing.primaryDirective.title), briefing.primaryDirective.title);
  assert.ok(!/severance/i.test(briefing.primaryDirective.title), briefing.primaryDirective.title);
  assert.equal(briefing.primaryDirective.missionType, 'Defend Interests');
  assert.ok(/protect core holdings/i.test(briefing.primaryDirective.title));
  assert.ok(briefing.directives.geopolitical.some((d) => d.id === 'geo-1' && d.severity === 'WATCH'));
  assert.match(briefing.directives.council[0].action, /Defend Interests/i);
});

test('briefing still recommends Crackdown when hate is low and the fleet is not fragile', () => {
  const briefing = briefingGenerator.generateMissionControlBriefing({
    metadata: { gameTimeString: '1/1/2026' },
    observerFactionId: 4712,
    mode: 'omniscient',
    alienHateEconomics: {
      actualAlienHate: 12,
      currentWarStatus: 'BELOW WAR THRESHOLD',
      warThreshold: 50
    },
    factions: [
      { ID: 4712, displayName: 'the Initiative', shipsCount: 80, fleetsCount: 6 },
      { ID: 10, displayName: 'the Servants', templateName: 'SubmitCouncil' },
      { ID: 4717, displayName: 'the Aliens', templateName: 'AlienCouncil', shipsCount: 20 }
    ],
    servantTargets: [{
      nationName: 'Japan',
      gdpTrillion: 5.4,
      targetCPCount: 3,
      isExecutiveTarget: true
    }],
    priorityTargetFaction: { id: 10, name: 'the Servants' },
    councilors: [],
    nations: [],
    fleets: [],
    habs: [],
    habSites: []
  });

  assert.strictEqual(briefing.campaignPosture.escalateLate, false);
  assert.equal(briefing.primaryDirective.id, 'geo-1');
  assert.match(briefing.primaryDirective.title, /Severance/);
  assert.ok(briefing.primaryDirective.expectedAlienHate.includes('±20%'));
});

test('pickPrimaryDirective ranks HOLD above a deferred crackdown', () => {
  const primary = pickPrimaryDirective({
    geopolitical: [
      { id: 'geo-hold', policyRank: 100, severity: 'CRITICAL', title: 'Hold' },
      { id: 'geo-1', policyRank: 25, severity: 'WATCH', title: 'Watch Japan' }
    ],
    council: [{ id: 'c-idle', policyRank: 50, severity: 'HIGH', title: 'Assign' }]
  });
  assert.equal(primary.id, 'geo-hold');
});

test('briefing engine does not recommend a future-dated ward as a new defensive action', () => {
  const raw = snapshotBuilder.buildRawSnapshot(makeSaveData({ gameTimeString: '2025-01-01T00:00:00Z' }));
  const ownNation = raw.nations.find(n => n.ID === 1);
  for (const controlPoint of ownNation.controlPoints) {
    controlPoint.defended = true;
    controlPoint.defendExpiration = { year: 2025, month: 12, day: 31, hour: 23, minute: 59 };
  }
  const filtered = intelligenceFilter.applyFilter(raw, 'player', 4712);
  const briefing = briefingGenerator.generateMissionControlBriefing(filtered);

  assert.notEqual(briefing.engineDirectives.primary.id, 'defend-interests:United States');
  assert.equal(briefing.engineDirectives.primary.value?.unprotectedControlPointCount, undefined);
});
