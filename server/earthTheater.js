// server/earthTheater.js
//
// The EARTH theater partition: six regional groupings of nations, and the
// per-theater contested/secured status the briefing renders.
//
// Deliberately a PEER of server/spaceTheater.js, not part of it. The 2026-08-20
// review said "theater mapping belongs in server/spaceTheater.js", and the
// intent -- theater mapping does not belong buried inside the briefing
// generator -- is right. But the two partitions are of different worlds:
// spaceTheater.js maps solar-system BODIES (Ceres, Titan, Triton) into eight
// orbital theaters, while this maps Earth NATIONS into six geopolitical ones.
// They share no key space and never resolve the same input, so merging them
// would put an Earth nation table inside a module every space reducer imports
// and make `theaterForBody('France')` look answerable. Same shape, same
// naming, separate file.

const { asArray, sameId, ONE_TRILLION } = require('../shared/util.mjs');

const EARTH_THEATERS = Object.freeze([
  { id: 'nam', name: 'North America', nations: ['United States', 'Canada', 'Mexico'] },
  { id: 'eur', name: 'Europe & Mediterranean', nations: ['France', 'Germany', 'United Kingdom', 'Italy', 'Spain', 'Poland', 'Ukraine'] },
  { id: 'eap', name: 'East Asia & Pacific', nations: ['China', 'Japan', 'South Korea', 'Taiwan', 'Australia', 'Indonesia'] },
  { id: 'sam', name: 'South America', nations: ['Brazil', 'Argentina', 'Colombia', 'Chile', 'Peru'] },
  { id: 'mea', name: 'Eurasia & Middle East', nations: ['Russia', 'India', 'Pakistan', 'Saudi Arabia', 'Iran', 'Turkey'] },
  { id: 'afr', name: 'African Continent', nations: ['Nigeria', 'Egypt', 'South Africa', 'Ethiopia', 'Kenya'] }
]);

/**
 * Per-theater status rows.
 *
 * `xenoformingAvailable === false` yields null xenoforming fields rather than
 * `false`/`0`: player mode can hide the telemetry entirely, and "no sites
 * detected" is a different claim from "we cannot see".
 */
function buildTheaterStatus(
  nations,
  xenoforming,
  targetFactionName,
  observerId,
  observerName = null,
  xenoformingAvailable = true,
  targetFactionId = null
) {
  const theaters = EARTH_THEATERS;

  const visibleNations = asArray(nations);
  const visibleXenoforming = asArray(xenoforming);
  const selectedFactionLabel = observerName || 'the selected faction';
  const hasTarget = targetFactionName || targetFactionId !== null && targetFactionId !== undefined;

  return theaters.map(t => {
    const matchedNations = visibleNations.filter(n => t.nations.includes(n.displayName));
    const totalGdp = matchedNations.reduce((sum, n) => sum + (n.GDP || 0), 0);
    const totalGdpTrillion = (totalGdp / ONE_TRILLION).toFixed(1);

    const hostileCount = hasTarget
      ? matchedNations.filter(n => targetFactionId !== null && targetFactionId !== undefined
        ? sameId(n.executiveFactionId, targetFactionId)
        : n.executiveFactionName === targetFactionName).length
      : 0;
    const ownCount = matchedNations.filter(n => sameId(n.executiveFactionId, observerId)).length;

    let statusTone = 'STABLE';
    let statusColor = '#10b981';
    if (!hasTarget) {
      statusTone = 'NO PRIORITY TARGET DATA';
      statusColor = '#64748b';
    } else if (hostileCount > 0) {
      statusTone = `CONTESTED (${hostileCount} Hostile ${targetFactionName} Executives)`;
      statusColor = '#ef4444';
    } else if (ownCount > 0) {
      statusTone = `SECURED (${ownCount} ${selectedFactionLabel} Executives)`;
      statusColor = '#00e5ff';
    }

    // Xenoforming check
    const sectorXeno = visibleXenoforming.filter(x => matchedNations.some(n => n.displayName.includes(x.regionName) || x.regionName.includes(n.displayName)));

    return {
      id: t.id,
      name: t.name,
      gdpTrillion: totalGdpTrillion,
      statusTone,
      statusColor,
      hostileCount,
      ownCount,
      nationsCount: matchedNations.length,
      xenoformingActive: xenoformingAvailable === false ? null : sectorXeno.length > 0,
      xenoCount: xenoformingAvailable === false ? null : sectorXeno.length,
      targetFactionName: targetFactionName || null,
      keyNations: matchedNations.slice(0, 4).map(n => ({
        name: n.displayName,
        executive: n.executiveFactionName || 'UNAVAILABLE',
        gdpTrillion: ((n.GDP || 0) / ONE_TRILLION).toFixed(1),
        nukes: n.nukes || 0,
        unrest: (n.unrest || 0).toFixed(1)
      }))
    };
  });
}

module.exports = { EARTH_THEATERS, buildTheaterStatus };
