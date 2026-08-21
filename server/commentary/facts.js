/**
 * server/commentary/facts.js
 *
 * Layer 1 — Fact extraction and null-honest metrics for strategic commentary.
 *
 * Strictly consumes existing measured data from:
 * - snapshot & rawSnapshot
 * - campaignPosture & summarizeFleetCapability
 * - holdGround
 * - strategicDelta & changesSincePrevious
 *
 * Rules:
 * - Null-honest: absent fields stay null. Never invent 0 or fall through to safe.
 * - Never leak player-mode redacted fields (actualAlienHate is null in player mode).
 * - Construction tier comes from shipHullStats[hull].constructionTier, not names.
 */

'use strict';

const { toFiniteNumber, sameId } = require('../../shared/util.mjs');
const { ALIEN_HATE_WAR_THRESHOLD } = require('../alienHateEconomics');

/**
 * Calculates median of an array of numbers. Returns null if empty.
 */
function medianOf(values) {
  if (!Array.isArray(values) || values.length === 0) return null;
  const filtered = values
    .map(toFiniteNumber)
    .filter(v => v !== null)
    .sort((a, b) => a - b);
  if (filtered.length === 0) return null;
  const mid = Math.floor(filtered.length / 2);
  return filtered.length % 2 === 1
    ? filtered[mid]
    : (filtered[mid - 1] + filtered[mid]) / 2;
}

/**
 * Maps a ship design name to its hullName and constructionTier.
 */
function resolveHullTier(designName, shipDesigns = [], shipHullStats = {}) {
  if (!designName) return null;
  const design = (Array.isArray(shipDesigns) ? shipDesigns : []).find(
    d => d.displayName === designName || d._displayName === designName || d.dataName === designName
  );
  const hullName = design?.hullName || designName;
  const stat = shipHullStats[hullName];
  return toFiniteNumber(stat?.constructionTier) ?? null;
}

/**
 * Extracts Layer 1 facts from the snapshot and existing advisory modules.
 */
function extractFacts({
  snapshot = {},
  rawSnapshot = null,
  campaignPosture = {},
  holdGround = {},
  changesSincePrevious = null,
  snapshotId = null
} = {}) {
  const mode = snapshot.mode || (snapshot.isOmniscient ? 'omniscient' : 'player');
  const observerId = snapshot.observerFactionId ?? 4712;
  const observerName = snapshot.observerFactionName || 'the Initiative';
  const shipHullStats = snapshot.shipHullStats || rawSnapshot?.shipHullStats || {};
  const shipDesigns = snapshot.shipDesigns || rawSnapshot?.shipDesigns || [];
  const fleets = Array.isArray(snapshot.fleets) ? snapshot.fleets : [];
  const factions = Array.isArray(snapshot.factions) ? snapshot.factions : [];

  // 1. Alien Hate & War Posture (Null-Honest)
  const actualAlienHate = toFiniteNumber(campaignPosture.actualAlienHate);
  const pips = toFiniteNumber(campaignPosture.pips);
  const warPressure = campaignPosture.warPressure || 'unknown';
  const warHeadroom = toFiniteNumber(campaignPosture.warHeadroom);
  const totalWarProximity = campaignPosture.totalWarProximity || 'unknown';
  const isHoldGroundActive = holdGround?.fires === true;
  const canContest = campaignPosture.fleetCapability?.canContest ?? 'unknown';
  const dominantDeficit = campaignPosture.fleetCapability?.dominantDeficit || null;

  // 2. Military & Ship Losses
  const delta = changesSincePrevious || {};
  const deltaHate = toFiniteNumber(delta.hate?.actual?.delta ?? delta.hate?.delta);
  const crossedWarThreshold = delta.hate?.crossedWarThreshold || null;

  let warStateChange = 'none';
  if (crossedWarThreshold === 'down' || (deltaHate !== null && deltaHate < 0 && actualAlienHate !== null && actualAlienHate < ALIEN_HATE_WAR_THRESHOLD)) {
    warStateChange = 'exited';
  } else if (crossedWarThreshold === 'up' || (actualAlienHate !== null && actualAlienHate >= ALIEN_HATE_WAR_THRESHOLD)) {
    warStateChange = 'entered';
  }

  // Ship losses by design
  const shipLossesList = Array.isArray(delta.shipLosses) ? delta.shipLosses : [];
  const totalShipsLost = shipLossesList.reduce((sum, item) => sum + (toFiniteNumber(item.count) || 0), 0);

  const lostHullTiers = [];
  for (const loss of shipLossesList) {
    const tier = resolveHullTier(loss.design, shipDesigns, shipHullStats);
    if (tier !== null) {
      const count = toFiniteNumber(loss.count) || 1;
      for (let i = 0; i < count; i++) {
        lostHullTiers.push(tier);
      }
    }
  }

  // Surviving friendly ships
  const ownFleets = fleets.filter(f => sameId(f.factionId, observerId));
  const survivingHullTiers = [];
  for (const fleet of ownFleets) {
    for (const ship of (Array.isArray(fleet.ships) ? fleet.ships : [])) {
      const tier = resolveHullTier(ship.hullName || ship.displayName, shipDesigns, shipHullStats);
      if (tier !== null) survivingHullTiers.push(tier);
    }
  }

  const medianLostHullTier = medianOf(lostHullTiers);
  const medianSurvivingHullTier = medianOf(survivingHullTiers);

  // Observable Alien Force Telemetry (Player & Omniscient)
  const alienFleets = fleets.filter(f => f.factionName === 'the Aliens' || sameId(f.factionId, 4717) || f.isAlien);
  const alienFleetsCount = alienFleets.length;
  const alienShipsCount = alienFleets.reduce((sum, f) => sum + (toFiniteNumber(f.shipsCount) || 0), 0);

  // Shipyard Queues & Production
  const shipyardQueues = Array.isArray(snapshot.shipyardQueues) ? snapshot.shipyardQueues : [];
  const ownQueuedShips = shipyardQueues.filter(q => sameId(q.factionId, observerId) || sameId(q.factionID, observerId));

  // Hate Trend & Venting Rate
  let elapsedDays = toFiniteNumber(delta.period?.days);
  let hateVentRatePerDay = null;
  if (deltaHate !== null && elapsedDays !== null && elapsedDays > 0) {
    hateVentRatePerDay = deltaHate / elapsedDays;
  }

  return {
    mode,
    snapshotId: snapshotId || snapshot.snapshotId || snapshot.saveFilename || 'default-save',
    observerId,
    observerName,
    actualAlienHate,
    pips,
    warPressure,
    warHeadroom,
    totalWarProximity,
    isHoldGroundActive,
    holdGroundAction: holdGround?.action || null,
    canContest,
    dominantDeficit,
    hateDelta: deltaHate,
    warStateChange,
    shipsLost: totalShipsLost,
    lostHullTiers,
    survivingHullTiers,
    medianLostHullTier,
    medianSurvivingHullTier,
    alienFleetsCount,
    alienShipsCount,
    alienFleets,
    ownFleets,
    ownQueuedShips,
    elapsedDays,
    hateVentRatePerDay,
    shipHullStats,
    shipDesigns
  };
}

module.exports = {
  extractFacts,
  medianOf,
  resolveHullTier
};
