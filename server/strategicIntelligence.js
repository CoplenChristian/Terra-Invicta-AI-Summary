function asArray(value) {
  return Array.isArray(value) ? value : [];
}

const spaceTheater = require('./spaceTheater');
const { ALIEN_FACTION_ID, ALIEN_FACTION_DISPLAY_NAME } = require('../shared/constants.mjs');

function numeric(value) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function sameId(left, right) {
  return left !== undefined && left !== null && right !== undefined && right !== null && String(left) === String(right);
}

function factionFor(snapshot, factionId) {
  return asArray(snapshot?.factions).find(faction => sameId(faction.ID, factionId)) || null;
}

function rateMultiplier(site) {
  return String(site?.resourceRateUnit || '').toLowerCase().includes('month') ? 1 : 30;
}

function resourcePosition(snapshot, observerId) {
  const faction = factionFor(snapshot, observerId) || {};
  const stock = faction.resources || {};
  const sites = asArray(snapshot?.habSites).filter(site => sameId(site.factionId, observerId));
  const resourceFields = [
    ['Water', 'water', 'Water'],
    ['Volatiles', 'volatiles', 'Volatiles'],
    ['Metals', 'metals', 'Metals'],
    ['NobleMetals', 'nobleMetals', 'Noble metals'],
    ['Fissiles', 'fissiles', 'Fissiles']
  ];
  const resources = {};

  for (const [key, siteKey, label] of resourceFields) {
    const producers = sites
      .filter(site => numeric(site[siteKey]) !== null && numeric(site[siteKey]) > 0 && site.mineModuleName)
      .map(site => ({
        site: site.displayName,
        body: site.parentBodyName,
        daily: Number(site[siteKey]),
        monthly: Number((Number(site[siteKey]) * rateMultiplier(site)).toFixed(2))
      }))
      .sort((a, b) => b.monthly - a.monthly);
    const grossPerMonth = Number(producers.reduce((total, producer) => total + producer.monthly, 0).toFixed(2));
    const underConstruction = sites
      .filter(site => site.constructionStatus && String(site.constructionStatus).toLowerCase() !== 'operational' || site.constructionCompleted === false || (numeric(site.daysRemaining) !== null && numeric(site.daysRemaining) > 0))
      .map(site => ({
        site: site.displayName,
        body: site.parentBodyName,
        status: site.constructionStatus,
        daysRemaining: site.daysRemaining,
        projectedMonthly: numeric(site[siteKey]) === null ? null : Number((Number(site[siteKey]) * rateMultiplier(site)).toFixed(2))
      }))
      .filter(item => item.projectedMonthly === null || item.projectedMonthly > 0);
    resources[key] = {
      key,
      label,
      stock: numeric(stock[key]),
      grossPerMonth,
      producerCount: producers.length,
      topProducers: producers.slice(0, 5),
      underConstruction: underConstruction.slice(0, 5),
      committed: null,
      spendPerMonth: null,
      runwayDays: null,
      runwayStatus: 'UNAVAILABLE — save does not expose burn rate'
    };
  }

  return {
    factionId: observerId,
    factionName: faction.displayName || null,
    resources,
    source: 'save stockpiles + installed mining yields',
    burnRateAvailable: false
  };
}

function weaponTotals(fleets) {
  const totals = {};
  asArray(fleets).forEach(fleet => asArray(fleet.weaponBreakdown).forEach(entry => {
    const role = entry.role || entry.category || 'Unknown';
    totals[role] = (totals[role] || 0) + (numeric(entry.count) || 0);
  }));
  return Object.entries(totals).map(([role, count]) => ({ role, count })).sort((a, b) => b.count - a.count);
}

function spaceTheaters(snapshot, observerId) {
  const allFleets = asArray(snapshot?.fleets);
  const allHabs = asArray(snapshot?.habs);
  const allSites = asArray(snapshot?.habSites);
  const groups = spaceTheater.THEATERS;

  return groups.map(group => {
    const fleets = allFleets.filter(fleet => spaceTheater.classifyBody(fleet.orbitBody) === group.key);
    const habs = allHabs.filter(hab => spaceTheater.classifyBody(hab.orbitBody) === group.key);
    const sites = allSites.filter(site => spaceTheater.classifyBody(site.parentBodyName) === group.key);
    const ownFleets = fleets.filter(fleet => sameId(fleet.factionId, observerId));
    const ownHabs = habs.filter(hab => sameId(hab.factionId, observerId));
    const ownSites = sites.filter(site => sameId(site.factionId, observerId));
    const alienFleets = fleets.filter(fleet => factionFor(snapshot, fleet.factionId)?.displayName === 'the Aliens');
    return {
      key: group.key,
      name: group.name,
      fleets: fleets.length,
      ships: fleets.reduce((total, fleet) => total + (numeric(fleet.shipsCount) || 0), 0),
      habs: habs.length,
      miningSites: sites.length,
      ownFleets: ownFleets.length,
      ownShips: ownFleets.reduce((total, fleet) => total + (numeric(fleet.shipsCount) || 0), 0),
      alienFleets: alienFleets.length,
      alienShips: alienFleets.reduce((total, fleet) => total + (numeric(fleet.shipsCount) || 0), 0),
      weaponMix: weaponTotals(alienFleets),
      status: alienFleets.length ? (alienFleets.some(fleet => fleet.inCombat) ? 'COMBAT' : 'HOSTILE PRESENCE') : (ownFleets.length ? 'OWN HOLDINGS' : 'NO VISIBLE FLEETS'),
      ownHabs: ownHabs.length,
      ownMiningSites: ownSites.length,
      visibleHabs: habs.length,
      visibleMiningSites: sites.length
    };
  });
}

function spacePosture(snapshot, observerId) {
  const alienFaction = asArray(snapshot?.factions).find(faction => faction.displayName === ALIEN_FACTION_DISPLAY_NAME || faction.ID === ALIEN_FACTION_ID);
  const alienFactionId = alienFaction?.ID;
  const alienFleets = asArray(snapshot?.fleets).filter(fleet => sameId(fleet.factionId, alienFactionId));
  const solFleets = alienFleets.filter(fleet => spaceTheater.normalizeBodyName(fleet.orbitBody) === 'sol');
  const shipsIn = fleets => fleets.reduce((total, fleet) => total + (numeric(fleet.shipsCount) || 0), 0);
  const largest = alienFleets.slice().sort((a, b) => (numeric(b.shipsCount) || 0) - (numeric(a.shipsCount) || 0))[0] || null;
  const inbound = alienFleets.filter(fleet => fleet.arrivalDate || (fleet.destination && String(fleet.destination) !== String(fleet.orbitBody)));
  const solShips = shipsIn(solFleets);
  const fragmentation = solFleets.length === 0 ? 'NONE' : (solShips / solFleets.length <= 2 ? 'HIGH' : (solShips / solFleets.length <= 4 ? 'MEDIUM' : 'LOW'));

  return {
    scope: {
      totalLabel: 'ALIEN CONTACTS / ALL TRACKED BODIES',
      solLabel: 'ALIEN CONTACTS / ORBIT BODY: SOL',
      note: 'These are alien contacts only. All tracked bodies is the total across every saved orbit-body value; Sol is one value, not the whole system.'
    },
    alienFactionId,
    alienFactionName: alienFaction?.displayName || 'the Aliens',
    total: { fleets: alienFleets.length, ships: shipsIn(alienFleets), weaponMix: weaponTotals(alienFleets) },
    sol: { fleets: solFleets.length, ships: solShips, weaponMix: weaponTotals(solFleets), fragmentation },
    largestHostileFleet: largest ? {
      id: largest.ID,
      name: largest.displayName,
      ships: largest.shipsCount,
      orbitBody: largest.orbitBody,
      mission: largest.mission,
      destination: largest.destination,
      arrivalDate: largest.arrivalDate,
      weaponSummary: largest.weaponSummary,
      weaponBreakdown: largest.weaponBreakdown,
      inCombat: largest.inCombat
    } : null,
    inboundHostileFleets: inbound.length,
    combatPowerAvailable: alienFleets.some(fleet => fleet.combatPowerAvailable === true),
    confidence: alienFleets.length ? 'SAVE-DERIVED FLEET COUNTS / LOADOUTS' : 'NO VISIBLE ALIEN FLEETS'
  };
}

// Prefer the resolved (org- and trait-inclusive, cap-applied) value. Reading
// base attributes here made mission coverage recommend a different councilor
// than the operations table showed as strongest on the same board, because
// org bonuses change who is actually best at a skill.
//
// Observed enemies have no resolved block -- the server strips it -- so they
// still fall through to the masked estimate.
function visibleSkill(councilor, skill) {
  const effective = councilor?.resolvedAttributes?.effective;
  if (effective && effective[skill] !== undefined) return numeric(effective[skill]);

  const masked = councilor?.maskedAttributes?.[skill];
  if (masked && typeof masked === 'object') return numeric(masked.visible);
  return numeric(councilor?.attributes?.[skill]);
}

function councilCapabilities(snapshot, observerId) {
  const councilors = asArray(snapshot?.councilors).filter(councilor => sameId(councilor.factionId, observerId));
  const skillNames = ['Persuasion', 'Investigation', 'Espionage', 'Command', 'Administration', 'Science', 'Security'];
  const bestBySkill = {};
  skillNames.forEach(skill => {
    // The 0-25 cap produces genuine ties (three councilors can all sit at 25
    // Administration), so break them on the base attribute the way
    // rankByAttribute does. Without a shared tie-break the same board can name
    // one councilor as strongest and recommend another.
    const candidates = councilors.map(councilor => ({
      name: councilor.displayName,
      value: visibleSkill(councilor, skill),
      base: numeric(councilor?.resolvedAttributes?.base?.[skill]) ?? null,
      location: councilor.locationName
    })).filter(candidate => candidate.value !== null)
      .sort((a, b) => b.value - a.value || (b.base ?? -1) - (a.base ?? -1));
    bestBySkill[skill] = candidates[0] || null;
  });
  const missionRoles = [
    ['Public Campaign', 'Persuasion'],
    ['Crackdown', 'Investigation'],
    ['Purge / Assassinate', 'Espionage'],
    ['Control Nation', 'Command'],
    ['Administration / Advise', 'Administration'],
    ['Research', 'Science'],
    ['Defend Councilor', 'Security']
  ].map(([mission, skill]) => ({ mission, skill, best: bestBySkill[skill] }));
  const gaps = [
    ['Science', 8, 'No strong science advisor'],
    ['Command', 8, 'No high-command specialist'],
    ['Security', 8, 'Council defense coverage is limited']
  ].filter(([skill, threshold]) => !bestBySkill[skill] || bestBySkill[skill].value < threshold)
    .map(([, , message]) => message);
  return { councilorCount: councilors.length, bestBySkill, missionRoles, gaps };
}

function normalizedScore(value, maximum) {
  const parsed = numeric(value);
  const max = numeric(maximum);
  if (parsed === null || max === null || max <= 0) return null;
  return Math.round(Math.max(0, Math.min(100, (parsed / max) * 100)));
}

function powerProfiles(snapshot) {
  const factions = asArray(snapshot?.factions);
  const max = key => Math.max(...factions.map(faction => numeric(faction[key]) || 0), 0);
  const maxGdp = max('totalGdp');
  const maxResearch = max('totalResearch');
  const maxHabs = max('habsCount');
  const maxShips = max('shipsCount');
  const maxCps = max('controlPointsCount');
  return factions.map(faction => ({
    factionId: faction.ID,
    factionName: faction.displayName,
    economic: normalizedScore(faction.totalGdp, maxGdp),
    research: normalizedScore(faction.totalResearch, maxResearch),
    industry: normalizedScore(faction.habsCount, maxHabs),
    fleetAssets: normalizedScore(faction.shipsCount, maxShips),
    political: normalizedScore(faction.controlPointsCount, maxCps),
    combatPowerAvailable: faction.combatPowerAvailable === true,
    compositePower: faction.combatPowerAvailable === true ? faction.powerScore?.overall ?? faction.powerScore ?? null : null
  }));
}

function build(snapshot, observerId) {
  return {
    resourcePosition: resourcePosition(snapshot, observerId),
    spacePosture: spacePosture(snapshot, observerId),
    spaceTheaters: spaceTheaters(snapshot, observerId),
    councilCapabilities: councilCapabilities(snapshot, observerId),
    powerProfiles: powerProfiles(snapshot)
  };
}

module.exports = { build };
