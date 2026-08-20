(function () {
  'use strict';

  const {
    escapeHtml, numberValue, formatNumber, formatGdp, formatDelta, bodyKey, bodyLabel, factionLogoImgHtml
  } = window.MissionControlShared || {};

  function factionById(snapshot, id) {
    return (Array.isArray(snapshot?.factions) ? snapshot.factions : [])
      .find(faction => String(faction.ID) === String(id)) || null;
  }

  function factionName(snapshot, id) {
    return factionById(snapshot, id)?.displayName || 'Unknown faction';
  }

  function factionDelta(snapshot, id, metric) {
    const faction = (snapshot?.changesSincePrevious?.factions || [])
      .find(entry => String(entry.factionId) === String(id));
    return faction?.changes?.find(change => String(change.metric).toLowerCase() === String(metric).toLowerCase()) || null;
  }

  function maxFactionId(factions, key, filter) {
    return factions
      .filter(filter || (() => true))
      .slice()
      .sort((a, b) => (numberValue(b[key]) || 0) - (numberValue(a[key]) || 0))[0]?.ID;
  }

  function factionStatus(faction, factions) {
    if (String(faction.displayName).toLowerCase().includes('alien')) return 'ALIEN SPACE MILITARY';
    if (String(faction.ID) === String(maxFactionId(factions, 'totalGdp'))) return 'EARTH ECONOMIC POWER';
    if (String(faction.ID) === String(maxFactionId(factions, 'shipsCount'))) return 'SPACE MILITARY';
    if ((numberValue(faction.controlPointsCount) || 0) >= 50) return 'POLITICAL NETWORK';
    if ((numberValue(faction.habsCount) || 0) >= 15) return 'ORBITAL BUILDUP';
    return 'SCATTERED';
  }

  function tableShell(headers, rows, emptyMessage, tableClass) {
    if (!rows) return `<div class="mc-board-empty">${escapeHtml(emptyMessage || 'No records are available in this view.')}</div>`;
    const className = tableClass ? ` mc-board-table--${escapeHtml(tableClass)}` : '';
    return `<div class="mc-board-table-wrap"><table class="mc-board-table${className}"><thead><tr>${headers.map(header => `<th scope="col">${escapeHtml(header)}</th>`).join('')}</tr></thead><tbody>${rows || `<tr><td colspan="${headers.length}">${escapeHtml(emptyMessage || 'No records are available in this view.')}</td></tr>`}</tbody></table></div><div class="mc-board-scroll-hint">SWIPE HORIZONTALLY TO VIEW ALL COLUMNS</div>`;
  }

  function renderFactionLedger(container, snapshot) {
    if (!container) return;
    const factions = Array.isArray(snapshot?.factions) ? snapshot.factions.slice() : [];
    factions.sort((a, b) => {
      const aObserver = String(a.ID) === String(snapshot.observerFactionId) ? 1 : 0;
      const bObserver = String(b.ID) === String(snapshot.observerFactionId) ? 1 : 0;
      return bObserver - aObserver || (numberValue(b.totalGdp) || 0) - (numberValue(a.totalGdp) || 0);
    });
    const rows = factions.map(faction => {
      const shipDelta = factionDelta(snapshot, faction.ID, 'Ships');
      const gdpDelta = factionDelta(snapshot, faction.ID, 'GDP');
      const hate = faction.alienHate?.visibleEstimate ?? faction.assessedAlienHateOfMe;
      const observerClass = String(faction.ID) === String(snapshot.observerFactionId) ? ' class="is-observer"' : '';
      const hateLabel = hate === undefined || hate === null ? 'UNAVAILABLE' : formatNumber(hate, 1);
      const shipDeltaClass = shipDelta?.delta > 0 ? 'is-positive' : shipDelta?.delta < 0 ? 'is-negative' : '';
      const logoHtml = factionLogoImgHtml
        ? factionLogoImgHtml(faction, { className: 'faction-logo faction-logo--ledger' })
        : '';
      return `<tr${observerClass} data-board-faction-id="${escapeHtml(faction.ID)}"><th scope="row"><span class="mc-board-faction-head">${logoHtml}<span>${escapeHtml(faction.displayName)}<small class="mc-board-secondary">R&amp;D ${escapeHtml(formatNumber(faction.totalResearch))} · HATE ${escapeHtml(hateLabel)}</small></span></span></th><td>${formatNumber(faction.controlPointsCount)}</td><td>${formatGdp(faction.totalGdp)}<small class="mc-board-secondary">GDP Δ ${escapeHtml(formatDelta(gdpDelta))}</small></td><td>${formatNumber(faction.habsCount)} / ${formatNumber(faction.shipsCount)}<small class="mc-board-secondary ${shipDeltaClass}">Δ ships ${escapeHtml(formatDelta(shipDelta))}</small></td><td><span class="mc-status-chip">${escapeHtml(factionStatus(faction, factions))}</span></td></tr>`;
    }).join('');
    container.innerHTML = `<div class="mc-board-note"><strong>LEDGER / CURRENT STATE</strong><span>R&amp;D, alien hate, and save-to-save deltas sit beneath the primary control and asset signals. Ship count is an asset count, not a combat estimate.</span></div>${tableShell(['Faction', 'CP', 'GDP', 'Habs / Ships', 'Strategic status'], rows, 'No faction records are available.', 'ledger')}`;
  }

  function renderLogisticsBoard(container, snapshot, strategic) {
    if (!container) return;
    const position = strategic?.resourcePosition;
    const resources = position?.resources ? Object.values(position.resources) : [];
    const rows = resources.map(resource => {
      const queue = resource.underConstruction || [];
      const queueText = queue.length
        ? `${queue.length} queued · ${queue.slice(0, 2).map(item => `${item.body || item.site || 'site'}${numberValue(item.daysRemaining) === null ? '' : ` / ${formatNumber(item.daysRemaining, 1)}d`}`).join(', ')}`
        : 'No visible queue';
      const source = resource.topProducers?.[0]
        ? `${resource.topProducers[0].site || 'site'} · +${formatNumber(resource.topProducers[0].monthly, 1)}`
        : 'No active producer';
      return `<tr><th scope="row">${escapeHtml(resource.label)}</th><td>${escapeHtml(formatNumber(resource.stock, 0))}</td><td>+${escapeHtml(formatNumber(resource.grossPerMonth, 1))}</td><td>${escapeHtml(resource.spendPerMonth === null ? 'UNAVAILABLE' : formatNumber(resource.spendPerMonth, 1))}</td><td>${escapeHtml(queueText)}</td><td>${escapeHtml(resource.runwayDays === null ? 'UNAVAILABLE' : `${formatNumber(resource.runwayDays, 1)}d`)}</td><td>${escapeHtml(source)}</td></tr>`;
    }).join('');
    container.innerHTML = `<div class="mc-board-note"><strong>LOGISTICS / STOCKPILE + OUTPUT</strong><span>Gross production is save-derived. Burn, committed spend, and runway remain UNAVAILABLE until those values are present in the save.</span></div>${tableShell(['Resource', 'Stockpile', 'Gross/mo', 'Spent / committed', 'Queued / next', 'Runway', 'Incoming production'], rows, 'Resource production is unavailable in this snapshot.')}`;
  }

  function rankLabel(factions, faction, key, filter) {
    const ranked = factions.filter(filter || (() => true)).slice().sort((a, b) => (numberValue(b[key]) || 0) - (numberValue(a[key]) || 0));
    const index = ranked.findIndex(item => String(item.ID) === String(faction?.ID));
    return index < 0 ? 'UNAVAILABLE' : `#${index + 1} / ${ranked.length}`;
  }

  function ownWeaponMix(snapshot, observerId) {
    const fleets = (snapshot?.fleets || []).filter(fleet => String(fleet.factionId) === String(observerId));
    const totals = {};
    fleets.forEach(fleet => (fleet.weaponBreakdown || []).forEach(entry => {
      const role = entry.role || entry.category || 'Unknown';
      totals[role] = (totals[role] || 0) + (numberValue(entry.count) || 0);
    }));
    return Object.entries(totals).sort((a, b) => b[1] - a[1]);
  }

  function completedProjectSignal(faction, expression, labels) {
    const projects = (faction?.completedProjects || []).map(String);
    const match = projects.find(project => expression.test(project));
    if (!match) return 'UNAVAILABLE';
    const known = labels.find(item => item.test.test(match));
    return known?.label || match.replace(/^Project_/, '').replace(/([a-z])([A-Z])/g, '$1 $2');
  }

  function renderCapabilityMatrix(container, snapshot, briefing) {
    if (!container) return;
    const factions = Array.isArray(snapshot?.factions) ? snapshot.factions : [];
    const observer = factionById(snapshot, snapshot.observerFactionId) || {};
    const humans = factions.filter(faction => !String(faction.displayName).toLowerCase().includes('alien'));
    const mix = ownWeaponMix(snapshot, snapshot.observerFactionId);
    const capabilities = snapshot.capabilities || {};
    const completed = completedProjectSignal(observer, /Drive|Rockets|Propulsion/i, [
      { test: /NervaDrive/i, label: 'Nerva Drive' },
      { test: /BurnerDrive/i, label: 'Burner Drive' },
      { test: /NuclearFreighters/i, label: 'Nuclear Freighters' }
    ]);
    const kinetic = completedProjectSignal(observer, /Rail|Autocannon|Railgun/i, [
      { test: /RailCannonMk3/i, label: 'Rail Cannon Mk3' },
      { test: /RailgunBatteryMk3/i, label: 'Railgun Battery Mk3' },
      { test: /RailCannonMk2/i, label: 'Rail Cannon Mk2' }
    ]);
    const missile = completedProjectSignal(observer, /Missile/i, [
      { test: /CopperheadMissileBay/i, label: 'Copperhead Missile Bay' },
      { test: /AnacondaMissileBay/i, label: 'Anaconda Missile Bay' }
    ]);
    const pd = completedProjectSignal(observer, /PointDefense/i, [
      { test: /PointDefenseArray/i, label: 'Point Defense Array' },
      { test: /PointDefenseLaserTurret/i, label: 'Point Defense Laser Turret' }
    ]);
    const intelDetails = capabilities.details || {};
    const intelActive = ['detectAlienAbductions', 'detectAlienHumanContacts', 'detectAlienOperations', 'detectAlienCouncilors']
      .map(key => intelDetails[key])
      .filter(Boolean)
      .map(detail => `${detail.requiredDisplayName}: ${detail.active ? 'ONLINE' : 'LOCKED'}`)
      .join(' · ') || 'UNAVAILABLE';
    const rows = [
      ['Earth GDP rank', rankLabel(factions, observer, 'totalGdp'), formatGdp(observer.totalGdp)],
      ['Research output rank', rankLabel(factions, observer, 'totalResearch'), `${formatNumber(observer.totalResearch, 0)} / month`],
      ['Human ship rank', rankLabel(humans, observer, 'shipsCount'), `${formatNumber(observer.shipsCount)} ships`],
      ['Space hab rank', rankLabel(factions, observer, 'habsCount'), `${formatNumber(observer.habsCount)} habs`],
      ['Dominant loadout', mix[0] ? `${mix[0][0]} × ${formatNumber(mix[0][1])}` : 'UNAVAILABLE', mix.length ? mix.map(entry => `${entry[0]} ${entry[1]}`).join(' · ') : 'No fleet loadout visible'],
      ['Best drive signal', completed, 'Derived from completed ship / propulsion projects'],
      ['Best kinetic signal', kinetic, 'Derived from completed weapon projects'],
      ['Best missile signal', missile, 'Derived from completed weapon projects'],
      ['Point defense signal', pd, 'Derived from completed weapon projects'],
      ['Alien intelligence', capabilities.canDetectAlienOperations ? 'OPERATIONS ONLINE' : 'OPERATIONS LOCKED', intelActive]
    ];
    container.innerHTML = `<div class="mc-board-note"><strong>CAPABILITY / DISCRETE SIGNALS</strong><span>Ranks compare current save values. Weapon and technology labels are evidence from the parsed save, not a combat-power estimate.</span></div>${tableShell(['Capability', 'Current signal', 'Evidence / consequence'], rows.map(row => `<tr><th scope="row">${escapeHtml(row[0])}</th><td>${escapeHtml(row[1])}</td><td>${escapeHtml(row[2])}</td></tr>`).join(''), 'No capability records are available.')}`;
  }

  function weaponCount(fleet, role) {
    return (fleet?.weaponBreakdown || [])
      .filter(entry => String(entry.role || entry.category).toLowerCase().includes(role))
      .reduce((total, entry) => total + (numberValue(entry.count) || 0), 0);
  }

  function shipLoadoutText(ship) {
    const loadout = Array.isArray(ship?.weaponLoadout) ? ship.weaponLoadout : [];
    if (!loadout.length) return 'Loadout unavailable';
    return loadout.map(entry => {
      const count = numberValue(entry.count);
      const systems = Array.isArray(entry.systems) && entry.systems.length
        ? entry.systems.join(', ')
        : entry.role || entry.category || 'Unknown system';
      return `${count === null ? '' : `${formatNumber(count)} × `}${systems}`;
    }).join(' · ');
  }

  function shipCountLabel(value) {
    const count = numberValue(value);
    return count === null ? 'UNAVAILABLE' : `${formatNumber(count)} ship${count === 1 ? '' : 's'}`;
  }

  function fleetRosterDetails(fleet) {
    const ships = Array.isArray(fleet?.ships) ? fleet.ships : [];
    if (!ships.length) return '<div class="mc-board-empty">Ship-level loadouts are unavailable for this fleet.</div>';
    return ships.map(ship => `<div class="mc-fleet-ship-row"><strong>${escapeHtml(ship.displayName || 'Unnamed ship')}</strong><span>${escapeHtml(shipLoadoutText(ship))}</span></div>`).join('');
  }

  function renderOwnFleetBreakdown(snapshot, fleets) {
    const observerId = snapshot?.observerFactionId;
    const ownFleets = fleets
      .filter(fleet => String(fleet.factionId) === String(observerId))
      .slice()
      .sort((a, b) => String(a.orbitBody || '').localeCompare(String(b.orbitBody || '')) || String(a.displayName || '').localeCompare(String(b.displayName || '')));
    if (!ownFleets.length) return '<div class="mc-board-empty">No fleet composition is visible for the selected faction.</div>';

    const rows = ownFleets.map(fleet => `<tr><th scope="row">${escapeHtml(fleet.displayName || 'Unnamed fleet')}</th><td>${escapeHtml(bodyLabel(fleet.orbitBody))}</td><td>${formatNumber(fleet.shipsCount)}</td><td><span class="mc-status-chip">${escapeHtml(fleet.dominantWeaponType || 'UNAVAILABLE')}</span></td><td>${escapeHtml(fleet.weaponSummary || 'Loadout unavailable')}</td></tr>`).join('');
    const details = ownFleets.map(fleet => `<details class="mc-fleet-roster-item"><summary><strong>${escapeHtml(fleet.displayName || 'Unnamed fleet')}</strong><span>${escapeHtml(shipCountLabel(fleet.shipsCount))} · ${escapeHtml(bodyLabel(fleet.orbitBody))} · ${escapeHtml(fleet.dominantWeaponType || 'loadout unavailable')} · ${escapeHtml(fleet.mission || 'mission unavailable')}</span></summary><div class="mc-fleet-ship-list">${fleetRosterDetails(fleet)}</div></details>`).join('');
    return `<div class="mc-fleet-breakdown"><div class="mc-board-subheading"><strong>${escapeHtml((factionName(snapshot, observerId) || 'SELECTED FACTION').toUpperCase())} FLEET BREAKDOWN</strong><span>Dominant role + equipped weapons</span></div>${tableShell(['Fleet', 'Orbit body', 'Ships', 'Dominant', 'Weapon composition'], rows, 'No fleet records are available.', 'fleet') }<div class="mc-fleet-roster-list">${details}</div></div>`;
  }

  function alienForceSummary(aliens) {
    const solFleets = aliens.filter(fleet => bodyKey(fleet.orbitBody, fleet.spaceTheaterKey) === 'sol');
    const totalShips = aliens.reduce((sum, fleet) => sum + (numberValue(fleet.shipsCount) || 0), 0);
    const solShips = solFleets.reduce((sum, fleet) => sum + (numberValue(fleet.shipsCount) || 0), 0);
    const averageSolFleet = solFleets.length ? solShips / solFleets.length : null;
    const fragmentation = averageSolFleet === null
      ? 'UNAVAILABLE'
      : averageSolFleet <= 2 ? 'HIGH' : averageSolFleet <= 4 ? 'MODERATE' : 'LOW';
    const bodyGroups = new Map();
    aliens.forEach(fleet => {
      const body = bodyLabel(fleet.orbitBody);
      const group = bodyGroups.get(body) || { fleets: 0, ships: 0 };
      group.fleets += 1;
      group.ships += numberValue(fleet.shipsCount) || 0;
      bodyGroups.set(body, group);
    });
    const bodies = [...bodyGroups.entries()]
      .sort((a, b) => b[1].ships - a[1].ships || b[1].fleets - a[1].fleets)
      .slice(0, 6);
    return {
      totalShips,
      totalFleets: aliens.length,
      solShips,
      solFleets: solFleets.length,
      averageSolFleet,
      fragmentation,
      bodies
    };
  }

  function renderTheaterBoard(container, snapshot, strategic) {
    if (!container) return;
    const theaters = (strategic?.spaceTheaters || []).filter(theater => theater.key !== 'unassigned' || theater.fleets || theater.habs || theater.miningSites);
    const posture = strategic?.spacePosture;
    const fleets = Array.isArray(snapshot?.fleets) ? snapshot.fleets : [];
    const aliens = fleets.filter(fleet => String(fleet.factionName || '').toLowerCase().includes('alien') || String(fleet.factionId) === '4717');
    const force = alienForceSummary(aliens);
    const rows = theaters.map(theater => {
    const hostile = aliens.filter(fleet => bodyKey(fleet.orbitBody, fleet.spaceTheaterKey) === theater.key);
      const largest = hostile.slice().sort((a, b) => (numberValue(b.shipsCount) || 0) - (numberValue(a.shipsCount) || 0))[0];
      const inbound = hostile.filter(fleet => fleet.arrivalDate || String(fleet.destination || '') !== String(fleet.orbitBody || '')).length;
      const status = hostile.length ? (theater.ownShips ? 'CONTESTED' : 'HOSTILE PRESENCE') : (theater.ownShips ? 'OWN HOLDINGS' : 'NO VISIBLE CONTACT');
      return `<tr data-board-theater="${escapeHtml(theater.key)}"><th scope="row"><button class="mc-board-row-link" type="button" data-board-theater-link="${escapeHtml(theater.key)}">${escapeHtml(theater.name)}</button></th><td>${formatNumber(theater.ownShips)} / ${formatNumber(theater.ownFleets)}</td><td>${formatNumber(theater.alienShips)} / ${formatNumber(theater.alienFleets)}</td><td>${formatNumber(theater.ownHabs ?? theater.habs)}</td><td>${formatNumber(theater.ownMiningSites ?? theater.miningSites)}</td><td>${largest ? `${escapeHtml(largest.displayName)} · ${formatNumber(largest.shipsCount)} ships` : '—'}</td><td>${inbound ? formatNumber(inbound) : '—'}</td><td><span class="mc-status-chip ${hostile.length ? 'is-danger' : ''}">${escapeHtml(status)}</span></td></tr>`;
    }).join('');
    const contacts = aliens.slice().sort((a, b) => (numberValue(b.shipsCount) || 0) - (numberValue(a.shipsCount) || 0)).slice(0, 8).map(fleet => `<tr><th scope="row">${escapeHtml(fleet.displayName)}</th><td>${formatNumber(fleet.shipsCount)}</td><td>${escapeHtml(bodyLabel(fleet.orbitBody))}</td><td>${formatNumber(weaponCount(fleet, 'point defense'))}</td><td>${formatNumber(weaponCount(fleet, 'missile'))}</td><td>${formatNumber(weaponCount(fleet, 'laser'))}</td><td>${formatNumber(weaponCount(fleet, 'kinetic'))}</td><td>${escapeHtml(fleet.mission || 'UNAVAILABLE')}</td><td>${escapeHtml(bodyLabel(fleet.destination || fleet.orbitBody))}</td><td>${escapeHtml(fleet.arrivalDate || '—')}</td></tr>`).join('');
    const scopeSummary = posture ? `<div class="mc-space-scope"><span><strong>${escapeHtml(posture.scope?.totalLabel || 'ALL TRACKED BODIES')}</strong><b>${formatNumber(posture.total?.fleets)} fleets / ${formatNumber(posture.total?.ships)} ships</b></span><span><strong>${escapeHtml(posture.scope?.solLabel || 'ORBIT BODY: SOL')}</strong><b>${formatNumber(posture.sol?.fleets)} fleets / ${formatNumber(posture.sol?.ships)} ships</b></span></div><div class="mc-board-scope-note">${escapeHtml(posture.scope?.note || 'Sol is a specific orbit-body value, not the whole system.')}</div>` : '';
    const forceSummary = `<div class="mc-space-force-summary"><div><strong>${formatNumber(force.totalShips)}</strong><span>ALIEN SHIPS / ALL TRACKED BODIES</span></div><div><strong>${formatNumber(force.totalFleets)}</strong><span>ALIEN FLEETS</span></div><div><strong>${formatNumber(force.solShips)} / ${formatNumber(force.solFleets)}</strong><span>SOL SHIPS / FLEETS</span></div><div><strong>${force.averageSolFleet === null ? 'UNAVAILABLE' : formatNumber(force.averageSolFleet, 1)}</strong><span>AVERAGE SOL FLEET</span></div><div><strong>${escapeHtml(force.fragmentation)}</strong><span>SOL FRAGMENTATION</span></div></div><div class="mc-space-body-list"><div class="mc-board-subheading"><strong>ALIEN FORCE BY ORBIT BODY</strong><span>Largest concentrations first</span></div>${force.bodies.length ? force.bodies.map(([body, group]) => `<div class="mc-space-body-row"><strong>${escapeHtml(body)}</strong><span>${formatNumber(group.ships)} ships / ${formatNumber(group.fleets)} fleets</span></div>`).join('') : '<div class="mc-board-empty">Alien force posture is unavailable in this intelligence mode.</div>'}</div>`;
    const ownFleetBreakdown = renderOwnFleetBreakdown(snapshot, fleets);
    container.innerHTML = `<div class="mc-board-note"><strong>SPACE / LOCATION FIRST</strong><span>Sol is one orbit-body, not a synonym for the whole solar system. Fragmentation is derived from visible Sol fleet size; contact loadouts are summarized from equipped ship weapons.</span></div>${scopeSummary}${forceSummary}${ownFleetBreakdown}${tableShell(['Theater', 'Our ships / fleets', 'Hostile ships / fleets', 'Our habs', 'Mines', 'Largest hostile fleet', 'Inbound', 'Status'], rows, 'No theater posture is available.')}${contacts ? `<div class="mc-board-subheading"><strong>HOSTILE CONTACT BOARD</strong><span>Largest visible contacts by ship count</span></div>${tableShell(['Fleet', 'Ships', 'Body', 'PD', 'Missiles', 'Lasers', 'Kinetics', 'Mission', 'Destination', 'ETA'], contacts, 'No hostile contacts are visible.')}` : ''}`;
  }

  // The save stores BASE attributes; the game adds equipped-org bonuses at
  // resolution time. Reading councilor.attributes shows a number the player
  // never sees in game, and it can be badly off -- a councilor reading 2 SCI
  // may actually operate at 11.
  //
  // Masked records are left alone: for a councilor whose stats are estimated
  // we do not know their orgs either, and adding exact org data to a masked
  // estimate would invent precision.
  function skillDetail(councilor, skill) {
    // Own and turned-mole records carry maskedAttributes too, but theirs hold
    // true values -- so resolved (org-inclusive) data wins for them. Only a
    // genuinely observed councilor falls back to the masked estimate, where we
    // do not know their orgs and must not imply we do.
    const resolved = councilor?.resolvedAttributes;
    const trusted = resolved && (councilor?.isOwnCouncilor || councilor?.isTurnedMole
      || councilor?.visibility === 'confirmed' || councilor?.visibility === 'raw_save_only');

    if (!trusted) {
      const masked = councilor?.maskedAttributes?.[skill];
      if (masked && typeof masked === 'object') {
        return { value: numberValue(masked.visible), base: numberValue(masked.visible), orgBonus: 0, masked: true };
      }
    }

    if (resolved?.effective && Object.hasOwn(resolved.effective, skill)) {
      const orgBonus = numberValue(resolved.orgBonuses?.[skill]) || 0;
      const traitBonus = numberValue(resolved.traitBonuses?.[skill]) || 0;
      return {
        value: numberValue(resolved.effective[skill]),
        base: numberValue(resolved.base?.[skill]),
        orgBonus,
        traitBonus,
        bonus: orgBonus + traitBonus,
        masked: false,
        orgsInactive: resolved.orgsActive === false
      };
    }

    const base = numberValue(councilor?.attributes?.[skill]);
    return { value: base, base, orgBonus: 0, masked: false };
  }

  function visibleSkill(councilor, skill) {
    return skillDetail(councilor, skill).value;
  }

  function skillCell(councilor, skill) {
    const detail = skillDetail(councilor, skill);
    if (detail.value === null) return '<td>—</td>';
    const total = detail.bonus || 0;
    const parts = [`${detail.base} base`];
    if (detail.orgBonus) parts.push(`${detail.orgBonus > 0 ? '+' : ''}${detail.orgBonus} orgs`);
    if (detail.traitBonus) parts.push(`${detail.traitBonus > 0 ? '+' : ''}${detail.traitBonus} traits`);
    const bonus = total !== 0
      ? `<span class="mc-skill-org${total < 0 ? ' is-negative' : ''}" title="${escapeHtml(parts.join(', '))}">${total > 0 ? '+' : ''}${escapeHtml(String(total))}</span>`
      : '';
    return `<td class="mc-skill-cell">${escapeHtml(formatNumber(detail.value))}${bonus}</td>`;
  }

  // Specialty must come from effective values. On base stats alone a councilor
  // can be labelled with the wrong role entirely once their orgs are counted.
  function operativeRole(councilor) {
    const skills = ['Persuasion', 'Investigation', 'Espionage', 'Command', 'Administration', 'Science', 'Security'];
    return skills.map(skill => ({ skill, value: visibleSkill(councilor, skill) }))
      .filter(entry => entry.value !== null)
      .sort((a, b) => b.value - a.value)[0]?.skill || 'UNAVAILABLE';
  }

  function renderOperationsBoard(container, snapshot, strategic) {
    if (!container) return;
    const councilors = (snapshot?.councilors || []).filter(councilor => String(councilor.factionId) === String(snapshot.observerFactionId) && councilor.isActiveCouncilor !== false && councilor.isIndependent !== true && String(councilor.status || 'Active').toLowerCase() === 'active');
    const skills = ['Persuasion', 'Investigation', 'Espionage', 'Command', 'Administration', 'Science', 'Security'];
    const rows = councilors.map(councilor => `<tr><th scope="row">${escapeHtml(councilor.displayName)}</th><td>${escapeHtml(councilor.locationName || 'Unknown')}</td><td>${escapeHtml(councilor.activeMissionName || 'No active mission')}</td>${skills.map(skill => skillCell(councilor, skill)).join('')}<td><span class="mc-status-chip">${escapeHtml(operativeRole(councilor))}</span></td></tr>`).join('');
    const roles = strategic?.councilCapabilities?.missionRoles || [];
    const coverage = roles.map(role => `<div class="mc-coverage-row"><span>${escapeHtml(role.mission)}</span><strong>${escapeHtml(role.best?.name || 'UNAVAILABLE')}</strong><em>${role.best?.value === null || role.best?.value === undefined ? '—' : `${escapeHtml(formatNumber(role.best.value))} ${escapeHtml(role.skill.slice(0, 3).toUpperCase())}`}</em></div>`).join('');
    container.innerHTML = `<div class="mc-board-note"><strong>OPERATIONS / ACTIVE COUNCILORS</strong><span>Skill values are <strong>effective</strong>: base attributes plus equipped-org bonuses, which is what missions actually resolve against. A <em>+n</em> marks the org contribution. Trait modifiers are not included — many are conditional on nation state. Independent and inactive records are excluded.</span></div>${tableShell(['Operative', 'Location', 'Current mission', 'PER', 'INV', 'ESP', 'CMD', 'ADM', 'SCI', 'SEC', 'Role'], rows, 'No active councilors are available.')}${coverage ? `<div class="mc-board-subheading"><strong>MISSION COVERAGE</strong><span>Best available operative by role</span></div><div class="mc-coverage-grid">${coverage}</div>` : ''}`;
  }

  function nationPosture(nation, observerId, priorityFactionId) {
    const executiveId = nation.executiveFactionId;
    const unrest = numberValue(nation.unrest) || 0;
    if (String(executiveId) === String(observerId)) return unrest >= 2 ? 'DEFEND' : 'CONSOLIDATE';
    if (String(executiveId) === String(priorityFactionId)) return 'CRACKDOWN';
    if (executiveId) return 'CONTEST';
    return 'WATCH';
  }

  function renderNationQueue(container, snapshot, briefing) {
    if (!container) return;
    const observerId = snapshot.observerFactionId;
    const priorityId = briefing?.priorityTargetFaction?.id;
    const nations = (snapshot?.nations || []).filter(nation => nation.executiveFactionId || nation.controlPoints?.length).slice().sort((a, b) => {
      const aPriority = String(a.executiveFactionId) === String(priorityId) || String(a.executiveFactionId) === String(observerId) ? 1 : 0;
      const bPriority = String(b.executiveFactionId) === String(priorityId) || String(b.executiveFactionId) === String(observerId) ? 1 : 0;
      return bPriority - aPriority || (numberValue(b.GDP) || 0) - (numberValue(a.GDP) || 0);
    }).slice(0, 12);
    const rows = nations.map(nation => {
      const cp = (nation.controlPoints || []).reduce((counts, point) => {
        const key = point.factionName || factionName(snapshot, point.factionId);
        counts[key] = (counts[key] || 0) + 1;
        return counts;
      }, {});
      const cpText = Object.entries(cp).map(([name, count]) => `${name.replace(/^the /i, '')} ${count}`).join(' · ') || 'No CP detail';
      const risk = (numberValue(nation.unrest) || 0) >= 2 ? ' · unrest watch' : '';
      return `<tr><th scope="row">${escapeHtml(nation.displayName)}</th><td>${escapeHtml(nation.executiveFactionName || 'Independent')}</td><td>${escapeHtml(cpText)}</td><td>${escapeHtml(formatGdp(nation.GDP))}</td><td>${escapeHtml(formatNumber(nation.research, 0))}</td><td>${escapeHtml(formatNumber(nation.cohesion, 1))}</td><td>${escapeHtml(formatNumber(nation.unrest, 1))}</td><td>${escapeHtml(formatNumber(nation.armies))}</td><td><span class="mc-status-chip">${escapeHtml(nationPosture(nation, observerId, priorityId))}</span><small class="mc-board-secondary">${escapeHtml(`${formatNumber(nation.nukes)} nukes${risk}`)}</small></td></tr>`;
    }).join('');
    container.innerHTML = `<div class="mc-board-note"><strong>EARTH / ACTION QUEUE</strong><span>Postures are triage labels derived from executive control, unrest, and the selected priority faction. They are not completed operations.</span></div>${tableShell(['Nation', 'Executive', 'CP composition', 'GDP', 'Research', 'Cohesion', 'Unrest', 'Armies', 'Recommended posture'], rows, 'No nation holdings are available.')}`;
  }

  // Project availability is a monthly RNG roll, not a queue position: a project
  // whose maxUnlockChance is below 100 can never be scheduled, only waited on.
  // Over half the projects in the game are capped this way, so a plan that
  // treats them as orderable steps will desync from the real project list.
  function availabilityChip(node) {
    const availability = node && node.availability;
    if (!availability || !availability.known) {
      return '<span class="mc-status-chip">UNKNOWN</span>';
    }
    const wait = availability.expectedMonths === null || availability.expectedMonths === undefined
      ? ''
      : ' · ~' + availability.expectedMonths + ' mo';
    if (availability.schedulable) {
      return '<span class="mc-status-chip is-safe">GUARANTEED' + escapeHtml(wait) + '</span>';
    }
    return '<span class="mc-status-chip is-warning">RNG ' + escapeHtml(String(availability.maxPercent))
      + '% CAP' + escapeHtml(wait) + '</span>';
  }

  function availabilityByProjectId(snapshot) {
    const nodes = (snapshot.techTree && snapshot.techTree.nodes) || [];
    const map = new Map();
    for (const node of nodes) {
      if (node && node.availability) map.set(node.id, node);
    }
    return map;
  }

  function renderResearchWatchlist(container, snapshot) {
    if (!container) return;
    const observer = factionById(snapshot, snapshot.observerFactionId) || {};
    const observerLabel = observer.displayName || snapshot.observerFactionName || 'SELECTED FACTION';
    const slots = snapshot.globalResearch?.activeSlots || [];
    const globalRows = slots.map(slot => `<tr><th scope="row">${escapeHtml(slot.displayName || slot.techId)}</th><td>${escapeHtml(formatNumber(slot.percent, 1))}%</td><td>${escapeHtml(slot.leadFactionName || 'UNAVAILABLE')}</td><td>${escapeHtml(formatNumber(slot.leadContribution, 0))}</td></tr>`).join('');
    const availability = availabilityByProjectId(snapshot);
    const projectRows = (observer.currentProjects || []).slice().sort((a, b) => (numberValue(b.percent) || 0) - (numberValue(a.percent) || 0)).map(project => `<tr><th scope="row">${escapeHtml(project.displayName || project.projectId)}</th><td>${escapeHtml(formatNumber(project.percent, 1))}%</td><td>${escapeHtml(formatNumber(project.accumulatedResearch, 0))} / ${escapeHtml(formatNumber(project.totalCost, 0))}</td><td>${availabilityChip(availability.get(project.projectId))}</td></tr>`).join('');
    const gaps = Object.values(snapshot.capabilities?.details || {}).filter(detail => detail.active === false).slice(0, 6).map(detail => `<tr><th scope="row">${escapeHtml(detail.name)}</th><td><span class="mc-status-chip is-danger">LOCKED</span></td><td>${escapeHtml(detail.requiredDisplayName || detail.requiredProject || 'Requirement unavailable')}</td></tr>`).join('');
    container.innerHTML = `<div class="mc-watch-grid"><section><div class="mc-board-subheading"><strong>GLOBAL RESEARCH</strong><span>Active slots</span></div>${tableShell(['Project', 'Progress', 'Current lead', 'Lead output'], globalRows, 'No global research slots are available.')}</section><section><div class="mc-board-subheading"><strong>${escapeHtml(observerLabel.toUpperCase())} PROJECTS</strong><span>Active projects</span></div>${tableShell(['Project', 'Progress', 'Accumulated / cost', 'Availability'], projectRows, 'No active faction projects are available.')}</section><section><div class="mc-board-subheading"><strong>INTELLIGENCE GAPS</strong><span>Capability unlocks</span></div>${tableShell(['Capability', 'Status', 'Unlock / consequence'], gaps, 'No locked capability records are available.')}</section></div>`;
  }

  window.MissionControlBoards = {
    renderFactionLedger,
    renderLogisticsBoard,
    renderCapabilityMatrix,
    renderTheaterBoard,
    renderOperationsBoard,
    renderNationQueue,
    renderResearchWatchlist
  };
})();
