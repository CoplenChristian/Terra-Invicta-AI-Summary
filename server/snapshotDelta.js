const spaceTheater = require('./spaceTheater');
const { ALIEN_FACTION_ID, ALIEN_FACTION_DISPLAY_NAME } = require('../shared/constants.mjs');

const RESOURCE_FIELDS = [
  ['Money', 'Money'],
  ['Influence', 'Influence'],
  ['Operations', 'Operations'],
  ['Boost', 'Boost'],
  ['Water', 'Water'],
  ['Volatiles', 'Volatiles'],
  ['Metals', 'Metals'],
  ['NobleMetals', 'Noble metals'],
  ['Fissiles', 'Fissiles'],
  ['Exotics', 'Exotics']
];

function asArray(value) {
  return Array.isArray(value) ? value : [];
}

function sameId(left, right) {
  return left !== undefined && left !== null && right !== undefined && right !== null && String(left) === String(right);
}

function numeric(value) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function signedDelta(value) {
  const parsed = numeric(value);
  if (parsed === null || parsed === 0) return '0';
  const sign = parsed > 0 ? '+' : '';
  const absolute = Math.abs(parsed);
  if (absolute >= 1e12) return `${sign}${(parsed / 1e12).toFixed(1)}T`;
  if (absolute >= 1e9) return `${sign}${(parsed / 1e9).toFixed(1)}B`;
  if (absolute >= 1e6) return `${sign}${(parsed / 1e6).toFixed(1)}M`;
  if (absolute >= 1e3) return `${sign}${(parsed / 1e3).toFixed(1)}K`;
  return `${sign}${Number(parsed.toFixed(2))}`;
}

function compactNumber(value) {
  const parsed = numeric(value);
  if (parsed === null) return null;
  return Number.isInteger(parsed) ? parsed : Number(parsed.toFixed(2));
}

function change(metric, from, to, unit = null) {
  const previous = compactNumber(from);
  const current = compactNumber(to);
  if (previous === null || current === null || previous === current) return null;
  return {
    metric,
    from: previous,
    to: current,
    delta: current - previous,
    deltaLabel: signedDelta(current - previous),
    unit
  };
}

function dangerChange(metric, from, to, unit = null) {
  const result = change(metric, from, to, unit);
  return result ? { ...result, polarity: 'danger' } : null;
}

function byId(items) {
  return new Map(asArray(items).map(item => [String(item.ID ?? item.id), item]));
}

function findFaction(snapshot, factionId) {
  return asArray(snapshot?.factions).find(faction => sameId(faction.ID, factionId)) || null;
}

function gameDate(snapshot) {
  const value = snapshot?.metadata?.gameTimeString;
  const parsed = value ? new Date(value) : null;
  return parsed && !Number.isNaN(parsed.getTime()) ? parsed : null;
}

function buildResourceChanges(previousFaction, currentFaction) {
  const previousResources = previousFaction?.resources || {};
  const currentResources = currentFaction?.resources || {};
  return RESOURCE_FIELDS.map(([key, label]) => {
    const result = change(label, previousResources[key], currentResources[key]);
    return result ? { ...result, key } : null;
  }).filter(Boolean);
}

function buildFactionChanges(previous, current) {
  const previousFactions = byId(previous?.factions);
  return asArray(current?.factions).map(faction => {
    const older = previousFactions.get(String(faction.ID));
    if (!older) return null;
    const changes = [
      change('Ships', older.shipsCount, faction.shipsCount),
      change('Fleets', older.fleetsCount, faction.fleetsCount),
      change('Habs', older.habsCount, faction.habsCount),
      change('Control points', older.controlPointsCount, faction.controlPointsCount),
      change('Councilors', older.councilorsCount, faction.councilorsCount),
      change('GDP', older.totalGdp, faction.totalGdp)
    ].filter(Boolean);
    const hateChange = dangerChange('Assessed alien hate', older.assessedAlienHateOfMe, faction.assessedAlienHateOfMe);
    if (hateChange) changes.push(hateChange);
    return changes.length ? {
      factionId: faction.ID,
      factionName: faction.displayName,
      changes
    } : null;
  }).filter(Boolean);
}

function buildPoliticalChanges(previous, current) {
  const previousNations = byId(previous?.nations);
  return asArray(current?.nations).map(nation => {
    const older = previousNations.get(String(nation.ID));
    if (!older || String(older.executiveFactionId ?? '') === String(nation.executiveFactionId ?? '')) return null;
    return {
      nationId: nation.ID,
      nationName: nation.displayName,
      fromFactionId: older.executiveFactionId,
      fromFactionName: older.executiveFactionName || 'Independent',
      toFactionId: nation.executiveFactionId,
      toFactionName: nation.executiveFactionName || 'Independent'
    };
  }).filter(Boolean);
}

function buildUnrestChanges(previous, current) {
  const previousNations = byId(previous?.nations);
  return asArray(current?.nations).map(nation => {
    const older = previousNations.get(String(nation.ID));
    if (!older) return null;
    const changeValue = dangerChange('Unrest', older.unrest, nation.unrest);
    return changeValue ? {
      nationId: nation.ID,
      nationName: nation.displayName,
      change: changeValue
    } : null;
  }).filter(Boolean);
}

function buildResearchChanges(previous, current, observerId) {
  const previousSlots = new Map(asArray(previous?.globalResearch?.activeSlots).map(slot => [String(slot.slotNumber), slot]));
  const currentSlots = asArray(current?.globalResearch?.activeSlots);
  const changes = [];
  for (const slot of currentSlots) {
    const older = previousSlots.get(String(slot.slotNumber));
    if (!older) continue;
    if (older.projectId !== slot.projectId || Number(older.percent) !== Number(slot.percent)) {
      changes.push({
        type: 'global',
        slotNumber: slot.slotNumber,
        projectId: slot.projectId,
        projectName: slot.displayName,
        fromProjectName: older.displayName,
        fromPercent: compactNumber(older.percent),
        toPercent: compactNumber(slot.percent),
        deltaPercent: numeric(slot.percent) !== null && numeric(older.percent) !== null
          ? Number((numeric(slot.percent) - numeric(older.percent)).toFixed(2))
          : null
      });
    }
  }

  const currentFaction = findFaction(current, observerId);
  const previousFaction = findFaction(previous, observerId);
  const previousProjects = new Map(asArray(previousFaction?.currentProjects).map(project => [String(project.projectId || project.ID), project]));
  for (const project of asArray(currentFaction?.currentProjects)) {
    const projectId = String(project.projectId || project.ID);
    const older = previousProjects.get(projectId);
    if (!older || Number(older.percent) !== Number(project.percent)) {
      changes.push({
        type: 'faction',
        factionId: observerId,
        factionName: currentFaction?.displayName || 'Observer',
        projectId,
        projectName: project.displayName,
        fromPercent: compactNumber(older?.percent),
        toPercent: compactNumber(project.percent),
        deltaPercent: older && numeric(project.percent) !== null && numeric(older.percent) !== null
          ? Number((numeric(project.percent) - numeric(older.percent)).toFixed(2))
          : null
      });
    }
  }
  return changes;
}

function buildThreatChange(previous, current) {
  const previousAlien = findFaction(previous, ALIEN_FACTION_ID) || asArray(previous?.factions).find(faction => faction.displayName === ALIEN_FACTION_DISPLAY_NAME);
  const currentAlien = findFaction(current, ALIEN_FACTION_ID) || asArray(current?.factions).find(faction => faction.displayName === ALIEN_FACTION_DISPLAY_NAME);
  const previousFleets = asArray(previous?.fleets).filter(fleet => sameId(fleet.factionId, previousAlien?.ID));
  const currentFleets = asArray(current?.fleets).filter(fleet => sameId(fleet.factionId, currentAlien?.ID));
  const previousSol = previousFleets.filter(fleet => spaceTheater.normalizeBodyName(fleet.orbitBody) === 'sol');
  const currentSol = currentFleets.filter(fleet => spaceTheater.normalizeBodyName(fleet.orbitBody) === 'sol');
  const totalShips = fleets => fleets.reduce((total, fleet) => total + (numeric(fleet.shipsCount) || 0), 0);
  return {
    totalAlienFleets: dangerChange('Alien fleets / all tracked bodies', previousFleets.length, currentFleets.length),
    totalAlienShips: dangerChange('Alien ships / all tracked bodies', totalShips(previousFleets), totalShips(currentFleets)),
    solFleets: dangerChange('Alien fleets / orbit body: Sol', previousSol.length, currentSol.length),
    solShips: dangerChange('Alien ships / orbit body: Sol', totalShips(previousSol), totalShips(currentSol))
  };
}

function build(previous, current, observerId) {
  if (!previous) {
    return {
      available: false,
      message: 'No immediately previous save is available for comparison.'
    };
  }

  const previousDate = gameDate(previous);
  const currentDate = gameDate(current);
  const elapsedGameDays = previousDate && currentDate
    ? Number(((currentDate.getTime() - previousDate.getTime()) / 86400000).toFixed(1))
    : null;
  const previousObserver = findFaction(previous, observerId);
  const currentObserver = findFaction(current, observerId);

  return {
    available: true,
    previousSnapshotId: previous.snapshotId || previous.snapshotIdentity?.snapshotId || null,
    previousSaveModifiedAt: previous.saveModifiedAt || previous.metadata?.lastModified || null,
    previousCampaignDate: previous.metadata?.gameTimeString || null,
    currentCampaignDate: current?.metadata?.gameTimeString || null,
    elapsedGameDays,
    factions: buildFactionChanges(previous, current),
    resources: buildResourceChanges(previousObserver, currentObserver),
    politics: buildPoliticalChanges(previous, current),
    unrest: buildUnrestChanges(previous, current),
    research: buildResearchChanges(previous, current, observerId),
    threat: buildThreatChange(previous, current)
  };
}

module.exports = { build };
