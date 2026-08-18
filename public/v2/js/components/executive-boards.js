(function () {
  'use strict';

  function escapeHtml(value) {
    return String(value === null || value === undefined ? '' : value)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  function numberValue(value) {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : null;
  }

  function formatNumber(value, decimals) {
    const parsed = numberValue(value);
    if (parsed === null) return 'UNAVAILABLE';
    return parsed.toLocaleString(undefined, {
      maximumFractionDigits: decimals === undefined ? 0 : decimals,
      minimumFractionDigits: decimals || 0
    });
  }

  function formatGdp(value) {
    const parsed = numberValue(value);
    return parsed === null ? 'UNAVAILABLE' : `$${(parsed / 1e12).toFixed(1)}T`;
  }

  function formatDelta(change) {
    if (!change) return '—';
    const delta = numberValue(change.delta);
    if (delta === null) return '—';
    if (Math.abs(delta) >= 1e9) return `${delta > 0 ? '+' : ''}${(delta / 1e9).toFixed(1)}B`;
    if (Math.abs(delta) >= 1e6) return `${delta > 0 ? '+' : ''}${(delta / 1e6).toFixed(1)}M`;
    return `${delta > 0 ? '+' : ''}${formatNumber(delta, Math.abs(delta) < 10 && !Number.isInteger(delta) ? 1 : 0)}`;
  }

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

  function tableShell(headers, rows, emptyMessage) {
    if (!rows) return `<div class="mc-board-empty">${escapeHtml(emptyMessage || 'No records are available in this view.')}</div>`;
    return `<div class="mc-board-table-wrap"><table class="mc-board-table"><thead><tr>${headers.map(header => `<th scope="col">${escapeHtml(header)}</th>`).join('')}</tr></thead><tbody>${rows || `<tr><td colspan="${headers.length}">${escapeHtml(emptyMessage || 'No records are available in this view.')}</td></tr>`}</tbody></table></div><div class="mc-board-scroll-hint">SWIPE HORIZONTALLY TO VIEW ALL COLUMNS</div>`;
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
      return `<tr${observerClass} data-board-faction-id="${escapeHtml(faction.ID)}"><th scope="row">${escapeHtml(faction.displayName)}</th><td>${formatNumber(faction.controlPointsCount)}</td><td>${formatGdp(faction.totalGdp)}</td><td>${formatNumber(faction.totalResearch)}</td><td>${formatNumber(faction.habsCount)}</td><td>${formatNumber(faction.shipsCount)}</td><td>${hate === undefined || hate === null ? 'UNAVAILABLE' : formatNumber(hate, 1)}</td><td class="${shipDelta?.delta > 0 ? 'is-positive' : shipDelta?.delta < 0 ? 'is-negative' : ''}">${escapeHtml(formatDelta(shipDelta))}</td><td><span class="mc-status-chip">${escapeHtml(factionStatus(faction, factions))}</span><small class="mc-board-secondary">GDP Δ ${escapeHtml(formatDelta(gdpDelta))}</small></td></tr>`;
    }).join('');
    container.innerHTML = `<div class="mc-board-note"><strong>LEDGER / CURRENT STATE</strong><span>Composite combat power is omitted when the save does not expose it. Ship count is an asset count, not a combat estimate.</span></div>${tableShell(['Faction', 'CP', 'GDP', 'R&D', 'Habs', 'Ships', 'Alien hate', 'Δ ships', 'Strategic status'], rows, 'No faction records are available.')}`;
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

  function bodyKey(body, explicitKey) {
    if (explicitKey) return explicitKey;
    const value = String(body || '').trim().replace(/^\d+\s+/, '').replace(/\s+/g, ' ').toLowerCase();
    const bodyMap = {
      sol: 'sol', earth: 'sol', luna: 'sol', mars: 'mars', mercury: 'inner', venus: 'inner',
      ceres: 'belt', psyche: 'belt', klotho: 'belt', pallas: 'belt', vesta: 'belt', bienor: 'belt',
      jupiter: 'jupiter', io: 'jupiter', europa: 'jupiter', ganymede: 'jupiter', callisto: 'jupiter', leda: 'jupiter',
      saturn: 'saturn', titan: 'saturn', rhea: 'saturn', dione: 'saturn', tethys: 'saturn', mimas: 'saturn', enceladus: 'saturn', iapetus: 'saturn',
      uranus: 'outer', miranda: 'outer', neptune: 'outer', triton: 'outer', pluto: 'outer', charon: 'outer', quaoar: 'outer', sedna: 'outer', eris: 'outer', makemake: 'outer', haumea: 'outer'
    };
    return bodyMap[value] || 'unassigned';
  }

  function bodyLabel(body) {
    const value = String(body || '').trim();
    return value.replace(/^\d+\s+/, '') || 'Unknown body';
  }

  function weaponCount(fleet, role) {
    return (fleet?.weaponBreakdown || [])
      .filter(entry => String(entry.role || entry.category).toLowerCase().includes(role))
      .reduce((total, entry) => total + (numberValue(entry.count) || 0), 0);
  }

  function renderTheaterBoard(container, snapshot, strategic) {
    if (!container) return;
    const theaters = (strategic?.spaceTheaters || []).filter(theater => theater.key !== 'unassigned' || theater.fleets || theater.habs || theater.miningSites);
    const posture = strategic?.spacePosture;
    const fleets = Array.isArray(snapshot?.fleets) ? snapshot.fleets : [];
    const aliens = fleets.filter(fleet => String(fleet.factionName || '').toLowerCase().includes('alien') || String(fleet.factionId) === '4717');
    const rows = theaters.map(theater => {
    const hostile = aliens.filter(fleet => bodyKey(fleet.orbitBody, fleet.spaceTheaterKey) === theater.key);
      const largest = hostile.slice().sort((a, b) => (numberValue(b.shipsCount) || 0) - (numberValue(a.shipsCount) || 0))[0];
      const inbound = hostile.filter(fleet => fleet.arrivalDate || String(fleet.destination || '') !== String(fleet.orbitBody || '')).length;
      const status = hostile.length ? (theater.ownShips ? 'CONTESTED' : 'HOSTILE PRESENCE') : (theater.ownShips ? 'OWN HOLDINGS' : 'NO VISIBLE CONTACT');
      return `<tr data-board-theater="${escapeHtml(theater.key)}"><th scope="row"><button class="mc-board-row-link" type="button" data-board-theater-link="${escapeHtml(theater.key)}">${escapeHtml(theater.name)}</button></th><td>${formatNumber(theater.ownShips)} / ${formatNumber(theater.ownFleets)}</td><td>${formatNumber(theater.alienShips)} / ${formatNumber(theater.alienFleets)}</td><td>${formatNumber(theater.ownHabs ?? theater.habs)}</td><td>${formatNumber(theater.ownMiningSites ?? theater.miningSites)}</td><td>${largest ? `${escapeHtml(largest.displayName)} · ${formatNumber(largest.shipsCount)} ships` : '—'}</td><td>${inbound ? formatNumber(inbound) : '—'}</td><td><span class="mc-status-chip ${hostile.length ? 'is-danger' : ''}">${escapeHtml(status)}</span></td></tr>`;
    }).join('');
    const contacts = aliens.slice().sort((a, b) => (numberValue(b.shipsCount) || 0) - (numberValue(a.shipsCount) || 0)).slice(0, 8).map(fleet => `<tr><th scope="row">${escapeHtml(fleet.displayName)}</th><td>${formatNumber(fleet.shipsCount)}</td><td>${escapeHtml(bodyLabel(fleet.orbitBody))}</td><td>${formatNumber(weaponCount(fleet, 'point defense'))}</td><td>${formatNumber(weaponCount(fleet, 'missile'))}</td><td>${formatNumber(weaponCount(fleet, 'laser'))}</td><td>${formatNumber(weaponCount(fleet, 'kinetic'))}</td><td>${escapeHtml(fleet.mission || 'UNAVAILABLE')}</td><td>${escapeHtml(bodyLabel(fleet.destination || fleet.orbitBody))}</td><td>${escapeHtml(fleet.arrivalDate || '—')}</td></tr>`).join('');
    const scopeSummary = posture ? `<div class="mc-space-scope"><span><strong>${escapeHtml(posture.scope?.totalLabel || 'ALL TRACKED BODIES')}</strong><b>${formatNumber(posture.total?.fleets)} fleets / ${formatNumber(posture.total?.ships)} ships</b></span><span><strong>${escapeHtml(posture.scope?.solLabel || 'ORBIT BODY: SOL')}</strong><b>${formatNumber(posture.sol?.fleets)} fleets / ${formatNumber(posture.sol?.ships)} ships</b></span></div><div class="mc-board-scope-note">${escapeHtml(posture.scope?.note || 'Sol is a specific orbit-body value, not the whole system.')}</div>` : '';
    container.innerHTML = `<div class="mc-board-note"><strong>SPACE / LOCATION FIRST</strong><span>Counts are visible in the selected intelligence mode. Contact loadouts are summarized from equipped ship weapons; arrival dates are shown only when present.</span></div>${scopeSummary}${tableShell(['Theater', 'Our ships / fleets', 'Hostile ships / fleets', 'Our habs', 'Mines', 'Largest hostile fleet', 'Inbound', 'Status'], rows, 'No theater posture is available.')}${contacts ? `<div class="mc-board-subheading"><strong>HOSTILE CONTACT BOARD</strong><span>Largest visible contacts by ship count</span></div>${tableShell(['Fleet', 'Ships', 'Body', 'PD', 'Missiles', 'Lasers', 'Kinetics', 'Mission', 'Destination', 'ETA'], contacts, 'No hostile contacts are visible.')}` : ''}`;
  }

  function visibleSkill(councilor, skill) {
    const field = councilor?.maskedAttributes?.[skill];
    return numberValue(field && typeof field === 'object' ? field.visible : councilor?.attributes?.[skill]);
  }

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
    const rows = councilors.map(councilor => `<tr><th scope="row">${escapeHtml(councilor.displayName)}</th><td>${escapeHtml(councilor.locationName || 'Unknown')}</td><td>${escapeHtml(councilor.activeMissionName || 'No active mission')}</td>${skills.map(skill => `<td>${escapeHtml(visibleSkill(councilor, skill) === null ? '—' : formatNumber(visibleSkill(councilor, skill)))}</td>`).join('')}<td><span class="mc-status-chip">${escapeHtml(operativeRole(councilor))}</span></td></tr>`).join('');
    const roles = strategic?.councilCapabilities?.missionRoles || [];
    const coverage = roles.map(role => `<div class="mc-coverage-row"><span>${escapeHtml(role.mission)}</span><strong>${escapeHtml(role.best?.name || 'UNAVAILABLE')}</strong><em>${role.best?.value === null || role.best?.value === undefined ? '—' : `${escapeHtml(formatNumber(role.best.value))} ${escapeHtml(role.skill.slice(0, 3).toUpperCase())}`}</em></div>`).join('');
    container.innerHTML = `<div class="mc-board-note"><strong>OPERATIONS / ACTIVE COUNCILORS</strong><span>Skill values use the visible or masked value for the selected mode. Independent and inactive records are excluded.</span></div>${tableShell(['Operative', 'Location', 'Current mission', 'PER', 'INV', 'ESP', 'CMD', 'ADM', 'SCI', 'SEC', 'Role'], rows, 'No active councilors are available.')}${coverage ? `<div class="mc-board-subheading"><strong>MISSION COVERAGE</strong><span>Best available operative by role</span></div><div class="mc-coverage-grid">${coverage}</div>` : ''}`;
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

  function renderResearchWatchlist(container, snapshot) {
    if (!container) return;
    const observer = factionById(snapshot, snapshot.observerFactionId) || {};
    const observerLabel = observer.displayName || snapshot.observerFactionName || 'SELECTED FACTION';
    const slots = snapshot.globalResearch?.activeSlots || [];
    const globalRows = slots.map(slot => `<tr><th scope="row">${escapeHtml(slot.displayName || slot.techId)}</th><td>${escapeHtml(formatNumber(slot.percent, 1))}%</td><td>${escapeHtml(slot.leadFactionName || 'UNAVAILABLE')}</td><td>${escapeHtml(formatNumber(slot.leadContribution, 0))}</td></tr>`).join('');
    const projectRows = (observer.currentProjects || []).slice().sort((a, b) => (numberValue(b.percent) || 0) - (numberValue(a.percent) || 0)).map(project => `<tr><th scope="row">${escapeHtml(project.displayName || project.projectId)}</th><td>${escapeHtml(formatNumber(project.percent, 1))}%</td><td>${escapeHtml(formatNumber(project.accumulatedResearch, 0))} / ${escapeHtml(formatNumber(project.totalCost, 0))}</td></tr>`).join('');
    const gaps = Object.values(snapshot.capabilities?.details || {}).filter(detail => detail.active === false).slice(0, 6).map(detail => `<tr><th scope="row">${escapeHtml(detail.name)}</th><td><span class="mc-status-chip is-danger">LOCKED</span></td><td>${escapeHtml(detail.requiredDisplayName || detail.requiredProject || 'Requirement unavailable')}</td></tr>`).join('');
    container.innerHTML = `<div class="mc-watch-grid"><section><div class="mc-board-subheading"><strong>GLOBAL RESEARCH</strong><span>Active slots</span></div>${tableShell(['Project', 'Progress', 'Current lead', 'Lead output'], globalRows, 'No global research slots are available.')}</section><section><div class="mc-board-subheading"><strong>${escapeHtml(observerLabel.toUpperCase())} PROJECTS</strong><span>Active projects</span></div>${tableShell(['Project', 'Progress', 'Accumulated / cost'], projectRows, 'No active faction projects are available.')}</section><section><div class="mc-board-subheading"><strong>INTELLIGENCE GAPS</strong><span>Capability unlocks</span></div>${tableShell(['Capability', 'Status', 'Unlock / consequence'], gaps, 'No locked capability records are available.')}</section></div>`;
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
