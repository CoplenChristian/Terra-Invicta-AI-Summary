// shared/intel/construction.mjs
//
// Shipyards, their queues, and the consolidated build board that merges ship
// queues, hab modules, and hab sites into one schedule.

import { asArray } from '../util.mjs';
import { bodyMatches, factionMatches, normalizeCostObject } from './common.mjs';

export const shipyardResourceRow = (queue) => ({
  id: queue.id,
  factionId: queue.factionId,
  factionName: queue.factionName,
  shipyardId: queue.shipyardId,
  shipyardName: queue.shipyardName,
  habId: queue.habId,
  habName: queue.habName,
  orbitBody: queue.orbitBody,
  spaceTheaterKey: queue.spaceTheaterKey,
  spaceTheaterName: queue.spaceTheaterName,
  queuePosition: queue.queuePosition,
  design: queue.design,
  hull: queue.hull,
  isRefit: queue.isRefit,
  costPaid: queue.costPaid,
  constructionStatus: queue.constructionStatus,
  startDate: queue.startDate,
  completionDate: queue.completionDate,
  daysToCompletion: queue.daysToCompletion,
  resourcesCost: queue.resourcesCost || [],
  resourcesRefund: queue.resourcesRefund || [],
  aiGoalId: queue.aiGoalId,
  aiGoalType: queue.aiGoalType
});

export const shipyardStationResourceRow = (station) => ({
  id: station.id,
  name: station.name,
  templateName: station.templateName,
  factionId: station.factionId,
  factionName: station.factionName,
  habId: station.habId,
  habName: station.habName,
  habTier: station.habTier,
  orbitBody: station.orbitBody,
  spaceTheaterKey: station.spaceTheaterKey,
  spaceTheaterName: station.spaceTheaterName,
  constructionStatus: station.constructionStatus,
  powered: station.powered,
  queueCount: station.queueCount ?? 0,
  currentConstruction: station.currentConstruction ? shipyardResourceRow(station.currentConstruction) : null,
  queue: asArray(station.queue).map(shipyardResourceRow)
});

/**
 * 2. Construction: Consolidates all ship, hab, and module build queues.
 */
export const constructionResource = (snapshot, factionId = null, body = null) => {
  const items = [];

  // Ships in shipyard queues
  asArray(snapshot.shipyardQueues).forEach(q => {
    if (!factionMatches(q, factionId) || !bodyMatches(q, body)) return;
    items.push({
      type: 'ship',
      faction: q.factionName,
      factionId: q.factionId,
      body: q.orbitBody,
      location: q.habName || q.shipyardName,
      design: q.design,
      module: null,
      startDate: q.startDate,
      completionDate: q.completionDate,
      daysRemaining: q.daysToCompletion,
      cost: normalizeCostObject(q.resourcesCost),
      mcCost: 1,
      shipyardTier: 2,
      constructionStatus: q.constructionStatus
    });
  });

  // Hab modules under construction
  asArray(snapshot.habModules).forEach(m => {
    if (!factionMatches(m, factionId) || !bodyMatches(m, body)) return;
    if (m.constructionStatus !== 'building') return;
    items.push({
      type: 'module',
      faction: m.factionName,
      factionId: m.factionId,
      body: m.orbitBody,
      location: m.habName,
      design: null,
      module: m.name || m.templateName,
      startDate: m.startBuildDate,
      completionDate: m.completionDate,
      daysRemaining: m.daysRemaining,
      cost: normalizeCostObject(m.buildCost),
      mcCost: 0,
      shipyardTier: m.habTier,
      constructionStatus: m.constructionStatus
    });
  });

  // Hab sites pending/building
  asArray(snapshot.habSites).forEach(s => {
    if (!factionMatches(s, factionId) || !bodyMatches(s, body)) return;
    if (s.constructionStatus !== 'building' && !s.pendingHab) return;
    items.push({
      type: 'hab',
      faction: s.factionName,
      factionId: s.factionId,
      body: s.parentBodyName,
      location: s.displayName,
      design: null,
      module: s.mineModuleName || 'Hab Base',
      startDate: s.startBuildDate,
      completionDate: s.completionDate,
      daysRemaining: s.daysRemaining,
      cost: s.buildCost ? normalizeCostObject(s.buildCost) : { water: 50, volatiles: 20, metals: 60, nobles: 10, fissiles: 0, money: 100, boost: 5 },
      isEstimatedCost: !s.buildCost,
      mcCost: 1,
      shipyardTier: s.habTier || 1,
      constructionStatus: s.constructionStatus
    });
  });

  items.sort((a, b) => (a.daysRemaining ?? 9999) - (b.daysRemaining ?? 9999));
  return items;
};
