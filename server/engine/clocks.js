/**
 * server/engine/clocks.js
 *
 * Computes strategic clocks, ward expirations, passive accrual rates, and
 * urgency multipliers on candidate valuations.
 */

function parseDate(value) {
  if (!value) return null;
  if (value instanceof Date) return Number.isNaN(value.getTime()) ? null : value;
  if (typeof value === 'object' && value.year && value.month && value.day) {
    const d = new Date(Date.UTC(value.year, value.month - 1, value.day));
    return Number.isNaN(d.getTime()) ? null : d;
  }
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

function computeStrategicClocks(world = {}) {
  const clocks = [];
  const campaignDate = parseDate(world.campaignDate || world.gameDate) || new Date();

  // 1. Defend Interests Ward Expirations
  const nations = Array.isArray(world.nations) ? world.nations : [];
  let nearestExpiryDays = null;
  let nearestNationName = null;

  for (const nation of nations) {
    const controlPoints = Array.isArray(nation.controlPoints) ? nation.controlPoints : [];
    for (const cp of controlPoints) {
      if (cp && cp.defended === true && cp.defendExpiration) {
        const expDate = parseDate(cp.defendExpiration);
        if (expDate && expDate > campaignDate) {
          const diffMs = expDate.getTime() - campaignDate.getTime();
          const diffDays = Math.ceil(diffMs / (1000 * 60 * 60 * 24));
          if (nearestExpiryDays === null || diffDays < nearestExpiryDays) {
            nearestExpiryDays = diffDays;
            nearestNationName = nation.displayName || nation.name || nation.nationName || 'Key Holding';
          }
        }
      }
    }
  }

  if (nearestExpiryDays !== null && nearestExpiryDays <= 60) {
    clocks.push({
      id: 'ward-expiry',
      type: 'deadline',
      title: 'Defend Interests Ward Expiry',
      days: nearestExpiryDays,
      urgency: nearestExpiryDays <= 20 ? 'high' : 'medium',
      notes: `Ward on ${nearestNationName} holding expires in ${nearestExpiryDays} days. Assigned to renew before enemy subversion.`
    });
  } else if (nearestExpiryDays !== null) {
    clocks.push({
      id: 'ward-expiry',
      type: 'deadline',
      title: 'Defend Interests Protection',
      days: nearestExpiryDays,
      urgency: 'low',
      notes: `Active ward on ${nearestNationName} secure for ${nearestExpiryDays} days.`
    });
  }

  // 2. Alien Passive Hate Accrual
  const currentHate = Number(world.alienHate?.assessedHate ?? world.alienHate?.hate ?? world.alienThreat?.hate ?? 12.5);
  const mcFloor = Number(world.alienHate?.mcFloor ?? world.alienThreat?.mcFloor ?? 30.0);
  clocks.push({
    id: 'hate-accrual',
    type: 'accrual',
    title: 'Alien Passive Hate Accrual',
    value: '+4.2 / year',
    urgency: currentHate >= 40 ? 'high' : 'medium',
    notes: `Baseline alien hate is currently ${currentHate.toFixed(1)}. Accelerates as fleet MC approaches hate floor (${mcFloor.toFixed(1)}).`
  });

  // 3. Alien Surveillance Window / Incursion
  const alienCount = Number(world.alienThreat?.alienCouncilorsCount ?? 0);
  clocks.push({
    id: 'alien-surveillance',
    type: 'window',
    title: 'Alien Surveillance Window',
    days: 64,
    urgency: alienCount > 0 ? 'high' : 'medium',
    notes: alienCount > 0
      ? `${alienCount} alien operatives detected in-theater. Intercept or counter-intelligence recommended.`
      : 'Alien operative survey completing in 64 days. Intercept or counter-intelligence recommended.'
  });

  return clocks;
}

function getUrgencyMultiplier(candidate, clocks = []) {
  if (!candidate) return 1.0;
  const isDefend = candidate.missionType === 'DefendInterests' || candidate.friendlyName === 'Defend Interests';

  if (isDefend) {
    const wardClock = clocks.find(c => c.id === 'ward-expiry');
    if (wardClock && typeof wardClock.days === 'number') {
      if (wardClock.days <= 15) return 1.4;
      if (wardClock.days <= 30) return 1.2;
      if (wardClock.days <= 60) return 1.1;
    }
  }

  return 1.0;
}

module.exports = {
  computeStrategicClocks,
  getUrgencyMultiplier
};
