(function exposeIntelligenceLibrary(global) {
  'use strict';

  const {
    escapeHtml, numberValue, number, money, matchesSpaceTheater, factionLogoImgHtml
  } = global.MissionControlShared || {};

  function display(value, fallback) {
    if (value === null || value === undefined || value === '') return fallback || '—';
    return escapeHtml(value);
  }

  function factionMap(snapshot) {
    var map = {};
    (snapshot.factions || []).forEach(function mapFaction(faction) {
      map[String(faction.ID)] = faction;
    });
    return map;
  }

  function factionNameById(id, factions) {
    if (id === null || id === undefined || id === '') return '—';
    var faction = factions[String(id)];
    return faction ? faction.displayName : 'Unknown faction';
  }

  function factionColorById(id, factions) {
    var faction = factions[String(id)];
    return faction && faction.color ? faction.color : 'var(--accent)';
  }

  function factionLabelHtml(factionOrId, factions, displayText) {
    var faction = factionOrId && typeof factionOrId === 'object' ? factionOrId : factions[String(factionOrId)];
    var logoHtml = faction && factionLogoImgHtml
      ? factionLogoImgHtml(faction, { className: 'faction-logo faction-logo--table' })
      : '';
    var color = faction && faction.color ? faction.color : factionColorById(factionOrId, factions);
    var name = displayText || (faction ? faction.displayName : factionNameById(factionOrId, factions));
    var fallback = logoHtml ? '' : '<i style="background:' + escapeHtml(color) + '"></i>';
    return '<span class="intel-library-faction-name' + (logoHtml ? ' has-faction-logo' : '') + '">' + (logoHtml || fallback) + display(name) + '</span>';
  }

  function activeCouncilors(snapshot) {
    return (snapshot && Array.isArray(snapshot.councilors) ? snapshot.councilors : [])
      .filter(function activeCouncilor(councilor) {
        if (!councilor || councilor.isActiveCouncilor === false || councilor.isIndependent === true) return false;
        if (councilor.factionId === null || councilor.factionId === undefined || councilor.factionId === '') return false;
        return String(councilor.status || 'Active').toLowerCase() === 'active';
      });
  }

  function visibleAttribute(councilor, key) {
    var field = councilor && councilor.maskedAttributes && councilor.maskedAttributes[key];
    if (!field || field.visibility === 'unknown' || field.visibility === 'unavailable') return '—';
    return field.visible === null || field.visible === undefined ? '—' : field.visible;
  }

  function topSkill(councilor) {
    var keys = ['Administration', 'Persuasion', 'Investigation', 'Espionage', 'Command', 'Science', 'Security', 'Loyalty'];
    var best = null;
    keys.forEach(function findSkill(key) {
      var value = numberValue(visibleAttribute(councilor, key));
      if (value !== null && (!best || value > best.value)) best = { key: key, value: value };
    });
    return best ? best.key.slice(0, 3).toUpperCase() + ' ' + best.value : 'UNAVAILABLE';
  }

  function table(headers, rows, emptyMessage) {
    if (!rows.length) {
      return '<div class="intel-library-empty">' + escapeHtml(emptyMessage || 'No records are available in this intelligence view.') + '</div>';
    }
    return '<div class="intel-library-table-wrap"><div class="intel-library-table-scroll-hint" role="note">Swipe horizontally to inspect all columns</div><table class="intel-library-table"><caption class="intel-library-table-caption">Filtered intelligence records</caption><thead><tr>' +
      headers.map(function headerCell(header) { return '<th scope="col">' + escapeHtml(header) + '</th>'; }).join('') +
      '</tr></thead><tbody>' + rows.join('') + '</tbody></table></div>';
  }

  function row(cells, className) {
    return '<tr' + (className ? ' class="' + escapeHtml(className) + '"' : '') + '>' +
      cells.map(function rowCell(cell, index) { return index === 0 ? '<th scope="row">' + cell + '</th>' : '<td>' + cell + '</td>'; }).join('') + '</tr>';
  }

  function countLabel(value, noun) {
    var parsed = numberValue(value);
    if (parsed === null) return 'UNAVAILABLE';
    var plural = noun === 'capability' ? 'capabilities' : noun === 'facility' ? 'facilities' : noun + 's';
    return number(parsed, 0) + ' ' + (parsed === 1 ? noun : plural);
  }

  function visibility(snapshot) {
    if (snapshot.mode === 'omniscient') return 'OMNISCIENT / FULL SAVE STATE';
    if (snapshot.mode === 'enhanced') return 'ENHANCED INTELLIGENCE';
    return 'PLAYER INTEL / FILTERED';
  }

  function statusChip(value, tone) {
    return '<span class="intel-library-chip intel-library-chip--' + escapeHtml(tone || 'neutral') + '">' + display(value) + '</span>';
  }

  function relationFor(factionId, observerId, relationships) {
    var towardObserver = relationships.find(function findRelation(relation) {
      return String(relation.sourceFactionId) === String(factionId) && String(relation.targetFactionId) === String(observerId);
    });
    var fromObserver = relationships.find(function findObserverRelation(relation) {
      return String(relation.sourceFactionId) === String(observerId) && String(relation.targetFactionId) === String(factionId);
    });
    return {
      hateOfUs: towardObserver ? number(towardObserver.hate, 2) : 'UNAVAILABLE',
      ourHate: fromObserver ? number(fromObserver.hate, 2) : 'UNAVAILABLE'
    };
  }

  function renderOverview(snapshot, briefing, observerId, factions) {
    var metadata = snapshot.metadata || {};
    var councilors = activeCouncilors(snapshot);
    var observer = (snapshot.factions || []).find(function findObserver(faction) {
      return String(faction.ID) === String(observerId);
    }) || {};
    var stats = [
      ['FACTIONS', countLabel((snapshot.factions || []).length, 'faction')],
      ['ACTIVE COUNCILORS', countLabel(councilors.length, 'councilor')],
      ['ALIEN COUNCILORS', countLabel(councilors.filter(function isAlien(councilor) { return councilor.isAlien; }).length, 'councilor')],
      ['NATIONS', countLabel((snapshot.nations || []).length, 'nation')],
      ['HABS', countLabel((snapshot.habs || []).length, 'hab')],
      ['FLEETS', countLabel((snapshot.fleets || []).length, 'fleet')],
      ['MINING SITES', countLabel((snapshot.habSites || []).length, 'site')]
    ];
    var directives = (briefing && briefing.directives) || {};
    var directiveCount = ['geopolitical', 'council', 'space', 'research'].reduce(function sumDirectives(total, key) {
      return total + ((directives[key] || []).length);
    }, 0);

    return '<div class="intel-library-intro">' +
      '<div><div class="intel-library-kicker">CLASSIC DATA SURFACES / INTEGRATED</div>' +
      '<h3>Campaign intelligence library</h3>' +
      '<p>The full save-derived record is available here for inspection. The landing screen remains the executive brief; these panels are the underlying operating picture.</p></div>' +
      '<div class="intel-library-intro-meta">' +
        '<span>VIEW</span><strong>' + visibility(snapshot) + '</strong>' +
        '<span>OBSERVER</span><strong>' + display(snapshot.observerFactionName || observer.displayName) + '</strong>' +
      '</div>' +
    '</div>' +
    '<div class="intel-library-stat-grid">' + stats.map(function stat(item) {
      return '<div class="intel-library-stat"><span>' + item[0] + '</span><strong>' + item[1] + '</strong></div>';
    }).join('') + '</div>' +
    '<div class="intel-library-overview-grid">' +
      '<section class="intel-library-block"><div class="intel-library-block-heading"><span>DATA PROVENANCE</span><small>CURRENT SNAPSHOT</small></div>' +
        '<dl class="intel-library-definition-list">' +
          '<div><dt>Campaign date</dt><dd>' + display(metadata.gameTimeString) + '</dd></div>' +
          '<div><dt>Active save</dt><dd>' + display(metadata.activeSaveFileName || metadata.fileName) + '</dd></div>' +
          '<div><dt>Last modified</dt><dd>' + display(metadata.lastModified ? new Date(metadata.lastModified).toLocaleString() : null) + '</dd></div>' +
          '<div><dt>Executive directives</dt><dd>' + countLabel(directiveCount, 'directive') + '</dd></div>' +
        '</dl>' +
      '</section>' +
      '<section class="intel-library-block"><div class="intel-library-block-heading"><span>QUICK ROUTES</span><small>OPEN A DATASET</small></div>' +
        '<div class="intel-library-quick-grid">' +
          [['councilors', 'Council roster'], ['nations', 'Earth holdings'], ['space', 'Space assets'], ['research', 'Technology'], ['threats', 'Alien intelligence'], ['factions', 'Faction balance']].map(function quickRoute(item) {
            return '<button class="intel-library-quick" type="button" data-library-section="' + item[0] + '"><strong>' + item[1] + '</strong><span>Inspect records</span></button>';
          }).join('') +
        '</div>' +
      '</section>' +
    '</div>' +
    '<div class="intel-library-note"><strong>Visibility discipline:</strong> ' + escapeHtml(visibility(snapshot)) + '. Unknown values remain unknown; this library does not infer hidden assets from empty records.</div>';
  }

  function renderFactions(snapshot, observerId, factions) {
    var relationships = snapshot.factionRelationships || [];
    var councilors = activeCouncilors(snapshot);
    var rows = (snapshot.factions || []).map(function factionRow(faction) {
      var relation = relationFor(faction.ID, observerId, relationships);
      var power = faction.powerScore && typeof faction.powerScore === 'object' ? faction.powerScore.overall : faction.powerScore;
      var space = faction.spaceVisibility === 'unavailable' ? 'UNAVAILABLE' : countLabel(faction.shipsCount, 'ship');
      var factionCouncilors = councilors.filter(function factionCouncilor(councilor) { return String(councilor.factionId) === String(faction.ID); });
      var alienCouncilors = factionCouncilors.filter(function alienCouncilor(councilor) { return councilor.isAlien; }).length;
      return row([
        factionLabelHtml(faction, factions),
        display(relation.hateOfUs, 'UNAVAILABLE'),
        display(relation.ourHate, 'UNAVAILABLE'),
        power === null || power === undefined ? 'UNAVAILABLE' : number(power, 0) + '/100',
        number(faction.controlPointsCount, 0),
        money(faction.totalGdp),
        number(faction.habsCount, 0),
        escapeHtml(space),
        number(factionCouncilors.length, 0) + (alienCouncilors ? ' / ' + number(alienCouncilors, 0) + ' alien' : ''),
        statusChip(faction.spaceVisibility === 'unavailable' ? 'LIMITED' : 'AVAILABLE', faction.spaceVisibility === 'unavailable' ? 'muted' : 'good') +
          ' <button type="button" class="intel-library-inline-action" data-library-faction="' + escapeHtml(faction.ID) + '">Open dossier</button>'
      ]);
    });
    return '<div class="intel-library-section-intro"><div><div class="intel-library-kicker">STRATEGIC BALANCE / ALL FACTIONS</div><h3>Faction operating picture</h3><p>Directional hate is shown as “hate of us” and “our hate” when the filtered snapshot contains that relationship.</p></div><span class="intel-library-count">' + countLabel(rows.length, 'faction') + '</span></div>' +
      table(['Faction', 'Hate of us', 'Our hate', 'Strategic score (est.)', 'CPs', 'GDP', 'Habs', 'Ships', 'Councilors', 'Dossier'], rows, 'No faction records are available.');
  }

  function councilorProfile(councilor) {
    var orgNames = Array.isArray(councilor.orgs) ? councilor.orgs.map(function orgName(org) { return org.displayName; }).filter(Boolean) : [];
    var traitNames = Array.isArray(councilor.traits) ? councilor.traits.filter(Boolean) : [];
    var profile = orgNames.concat(traitNames).slice(0, 4).join(' · ');
    if (profile) return profile;
    return councilor.visibility === 'raw_save_only' || councilor.visibility === 'confirmed' ? 'No attached profile' : 'UNAVAILABLE';
  }

  function renderCouncilors(snapshot, factions, options) {
    var allCouncilors = activeCouncilors(snapshot);
    var selectedFaction = options && options.councilorFaction ? String(options.councilorFaction) : '';
    var search = options && options.councilorSearch ? String(options.councilorSearch).trim().toLowerCase() : '';
    var factionOptions = {};
    allCouncilors.forEach(function collectCouncilorFaction(councilor) {
      factionOptions[String(councilor.factionId)] = councilor.factionName || factionNameById(councilor.factionId, factions);
    });
    var visibleCouncilors = allCouncilors.filter(function filterCouncilor(councilor) {
      var matchesFaction = !selectedFaction || String(councilor.factionId) === selectedFaction;
      var haystack = [councilor.displayName, councilor.factionName, councilor.typeTemplateName, councilor.locationName, councilor.activeMissionName, councilorProfile(councilor)].join(' ').toLowerCase();
      return matchesFaction && (!search || haystack.indexOf(search) !== -1);
    });
    var rows = visibleCouncilors.map(function councilorRow(councilor) {
      var isAlien = councilor.isAlien;
      var status = councilor.isTurnedMole ? 'TURNED MOLE' : (councilor.status || 'ACTIVE');
      return row([
        display(councilor.displayName),
        factionLabelHtml(councilor.factionId, factions, councilor.factionName || factionNameById(councilor.factionId, factions)),
        display(councilor.typeTemplateName),
        display(councilor.locationName),
        display(status),
        display(councilor.activeMissionName),
        number(councilor.totalSkills, 0),
        display(topSkill(councilor)),
        display(councilorProfile(councilor)),
        isAlien ? statusChip('ALIEN', 'danger') : (councilor.visibility === 'raw_save_only' ? statusChip('RAW', 'muted') : statusChip('VISIBLE', 'good'))
      ], councilor.isTurnedMole ? 'intel-library-row-highlight' : '');
    });
    var factionSelect = '<select class="intel-library-filter-control" data-library-councilor-faction aria-label="Filter councilors by faction"><option value="">ALL ACTIVE FACTIONS (' + allCouncilors.length + ')</option>' +
      Object.keys(factionOptions).sort(function sortFactions(a, b) { return factionOptions[a].localeCompare(factionOptions[b]); }).map(function factionOption(factionId) {
        var count = allCouncilors.filter(function countFaction(councilor) { return String(councilor.factionId) === factionId; }).length;
        return '<option value="' + escapeHtml(factionId) + '"' + (selectedFaction === factionId ? ' selected' : '') + '>' + escapeHtml(factionOptions[factionId]) + ' (' + count + ')</option>';
      }).join('') + '</select>';
    var searchInput = '<input class="intel-library-filter-control intel-library-filter-search" type="search" data-library-councilor-search placeholder="Search name, location, mission" value="' + escapeHtml(options && options.councilorSearch || '') + '" aria-label="Search councilors">';
    return '<div class="intel-library-section-intro"><div><div class="intel-library-kicker">EARTH OPERATIONS / COUNCIL</div><h3>Councilor intelligence</h3><p>Skills use the filtered visible or masked values. Hidden attributes are intentionally represented as unavailable.</p></div><span class="intel-library-count">' + countLabel(rows.length, 'councilor') + '</span></div>' +
      '<div class="intel-library-filter-bar"><label class="intel-library-filter-field"><span>FACTION FILTER</span>' + factionSelect + '</label><label class="intel-library-filter-field intel-library-filter-field--search"><span>SEARCH ROSTER</span>' + searchInput + '</label><span class="intel-library-filter-result">SHOWING ' + rows.length + ' / ' + allCouncilors.length + ' ACTIVE</span></div>' +
      table(['Councilor', 'Faction', 'Profession', 'Location', 'Status', 'Mission', 'Total', 'Lead skill', 'Org / traits', 'Visibility'], rows, selectedFaction || search ? 'No active councilors match the current filter.' : 'No active councilors are available in this intelligence view.');
  }

  function renderNations(snapshot, factions) {
    var rows = (snapshot.nations || []).map(function nationRow(nation) {
      var executive = nation.executiveFactionName || 'None';
      var executiveColor = factionColorById(nation.executiveFactionId, factions);
      return row([
        display(nation.displayName),
        '<span style="color:' + escapeHtml(executiveColor) + '">' + display(executive) + '</span>',
        number((nation.controlPoints || []).length, 0),
        money(nation.GDP),
        number(nation.milTech, 1),
        number(nation.armies, 0),
        nation.nukes ? statusChip(number(nation.nukes, 0), 'danger') : '0',
        number(nation.unrest, 1),
        number(nation.cohesion, 1),
        number(nation.boost, 2),
        number(nation.missionControl, 0)
      ]);
    });
    var targetRows = (snapshot.servantTargets || []).slice(0, 8).map(function targetRow(target) {
      return '<div class="intel-library-target"><strong>' + display(target.nationName) + '</strong><span>' + display(target.targetFactionName) + ' / score ' + display(target.score) + '</span><small>' + display((target.reasons || []).join(' · ')) + '</small></div>';
    }).join('');
    return '<div class="intel-library-section-intro"><div><div class="intel-library-kicker">EARTH OPERATIONS / NATIONS</div><h3>Geopolitical holdings</h3><p>Every nation in the filtered snapshot, including control points, GDP, military posture and launch capacity.</p></div><span class="intel-library-count">' + countLabel(rows.length, 'nation') + '</span></div>' +
      table(['Nation', 'Executive', 'CPs', 'GDP', 'Mil tech', 'Armies', 'Nukes', 'Unrest', 'Cohesion', 'Boost/mo', 'MC'], rows, 'No nations are available in this intelligence view.') +
      (targetRows ? '<section class="intel-library-block intel-library-targets"><div class="intel-library-block-heading"><span>PRIORITY TARGETS</span><small>GENERATED FROM CURRENT OBSERVER</small></div><div class="intel-library-target-list">' + targetRows + '</div></section>' : '');
  }

  function resourceCell(value) {
    return number(value, 2);
  }

  function renderMining(snapshot, spaceTheater) {
    var rows = (snapshot.habSites || []).filter(function filterMiningSite(site) {
      return matchesSpaceTheater(site.parentBodyName, spaceTheater, site.spaceTheaterKey);
    }).map(function miningRow(site) {
      var construction = site.pendingHab ? (site.constructionStatus || 'building') : (site.mineModuleName || site.constructionStatus || 'not installed');
      return row([
        display(site.displayName),
        display(site.parentBodyName),
        display(site.factionName),
        resourceCell(site.water),
        resourceCell(site.volatiles),
        resourceCell(site.metals),
        resourceCell(site.nobleMetals),
        resourceCell(site.fissiles),
        display(site.mineTier),
        display(construction),
        display(site.daysRemaining),
        display(site.habName)
      ]);
    });
    return '<div class="intel-library-section-intro"><div><div class="intel-library-kicker">SPACE LOGISTICS / RESOURCE YIELDS</div><h3>Mining and construction sites</h3><p>Yield fields are reported per day from the save. Unclaimed sites remain visible when the selected intelligence mode permits them.</p></div><span class="intel-library-count">' + countLabel(rows.length, 'site') + '</span></div>' +
      table(['Site', 'Body', 'Owner', 'Water/day', 'Volatiles/day', 'Metals/day', 'Nobles/day', 'Fissiles/day', 'Mine tier', 'Status', 'Days left', 'Hab'], rows, 'No mining sites are available in this intelligence view.');
  }

  function renderHabs(snapshot, spaceTheater) {
    var rows = (snapshot.habs || []).filter(function filterHab(hab) {
      return matchesSpaceTheater(hab.orbitBody, spaceTheater, hab.spaceTheaterKey);
    }).map(function habRow(hab) {
      var status = hab.underAssault ? 'UNDER ASSAULT' : (hab.underBombardment ? 'UNDER BOMBARDMENT' : (hab.inCombat ? 'IN COMBAT' : 'OPERATIONAL'));
      return row([
        display(hab.displayName),
        display(hab.factionName),
        display(hab.habType),
        number(hab.tier, 0),
        display(hab.orbitBody),
        hab.inEarthLEO ? statusChip('LEO', 'good') : '—',
        statusChip(status, status === 'OPERATIONAL' ? 'good' : 'danger'),
        display(hab.templateName)
      ]);
    });
    return '<div class="intel-library-section-intro"><div><div class="intel-library-kicker">SPACE LOGISTICS / STATIONS</div><h3>Habitat and station registry</h3><p>Orbital position, ownership, tier and current combat status for every visible installation.</p></div><span class="intel-library-count">' + countLabel(rows.length, 'hab') + '</span></div>' +
      table(['Hab', 'Faction', 'Type', 'Tier', 'Orbit / body', 'LEO', 'Status', 'Template'], rows, 'No habs are available in this intelligence view.');
  }

  function renderFleets(snapshot, spaceTheater) {
    var rows = (snapshot.fleets || []).filter(function filterFleet(fleet) {
      return matchesSpaceTheater(fleet.orbitBody, spaceTheater, fleet.spaceTheaterKey);
    }).map(function fleetRow(fleet) {
      var power = fleet.combatPowerAvailable ? number(fleet.combatPower, 0) : 'UNAVAILABLE';
      return row([
        display(fleet.displayName),
        display(fleet.factionName),
        number(fleet.shipsCount, 0),
        power,
        display(fleet.weaponSummary || fleet.dominantWeaponType),
        display(fleet.orbitBody),
        display(fleet.mission),
        display(fleet.destination),
        display(fleet.arrivalDate)
      ]);
    });
    return '<div class="intel-library-section-intro"><div><div class="intel-library-kicker">SPACE LOGISTICS / FLEETS</div><h3>Fleet posture</h3><p>Combat power stays unavailable when the save does not provide a real value. Loadout grouping comes from equipped weapon systems.</p></div><span class="intel-library-count">' + countLabel(rows.length, 'fleet') + '</span></div>' +
      table(['Fleet', 'Faction', 'Ships', 'Combat power', 'Loadout', 'Orbit / body', 'Mission', 'Destination', 'Arrival'], rows, 'No fleets are available in this intelligence view.');
  }

  function renderShips(snapshot, spaceTheater) {
    var rows = [];
    (snapshot.fleets || []).filter(function filterFleet(fleet) {
      return matchesSpaceTheater(fleet.orbitBody, spaceTheater, fleet.spaceTheaterKey);
    }).forEach(function flattenFleet(fleet) {
      (fleet.ships || []).forEach(function shipRow(ship) {
        var weaponSummary = (ship.weaponLoadout || []).map(function loadout(item) {
          return item.role + ' x' + item.count;
        }).join(' · ') || ship.dominantWeaponType || 'UNAVAILABLE';
        rows.push(row([
          display(ship.displayName),
          display(fleet.factionName),
          display(fleet.displayName),
          display(ship.hullName),
          display(ship.dominantWeaponType),
          display(weaponSummary),
          ship.combatPower === null || ship.combatPower === undefined ? 'UNAVAILABLE' : number(ship.combatPower, 0)
        ]));
      });
    });
    return '<div class="intel-library-section-intro"><div><div class="intel-library-kicker">SPACE LOGISTICS / SHIPS</div><h3>Ship registry</h3><p>Ships are expanded from their fleet records so weapon roles and dominant loadouts can be compared directly.</p></div><span class="intel-library-count">' + countLabel(rows.length, 'ship') + '</span></div>' +
      table(['Ship', 'Faction', 'Fleet', 'Hull', 'Dominant', 'Equipped weapons', 'Combat power'], rows, 'No ship records are available in this intelligence view.');
  }

  function renderSpaceTheaters(briefing, spaceTheater) {
    var theaters = briefing && briefing.strategic && Array.isArray(briefing.strategic.spaceTheaters)
      ? briefing.strategic.spaceTheaters
      : [];
    theaters = theaters.filter(function visibleTheater(theater) { return theater.key !== 'unassigned' || theater.fleets || theater.habs || theater.miningSites; });
    if (spaceTheater) theaters = theaters.filter(function filterTheater(theater) { return String(theater.key) === String(spaceTheater); });
    if (!theaters.length) return '';
    var rows = theaters.map(function spaceTheaterRow(theater) {
      var weaponMix = (theater.weaponMix || []).slice(0, 3).map(function weapon(item) { return item.role + ' x' + item.count; }).join(' · ') || '—';
      return row([
        display(theater.name),
        number(theater.ownShips, 0) + ' / ' + number(theater.ownFleets, 0),
        theater.alienShips ? statusChip(number(theater.alienShips, 0) + ' / ' + number(theater.alienFleets, 0), 'danger') : '0 / 0',
        number(theater.ownHabs === undefined ? theater.habs : theater.ownHabs, 0),
        number(theater.ownMiningSites === undefined ? theater.miningSites : theater.ownMiningSites, 0),
        display(theater.status),
        display(weaponMix)
      ]);
    });
    return '<section class="intel-library-block intel-library-space-theaters"><div class="intel-library-block-heading"><span>SPACE THEATER POSTURE</span><small>OWN / HOSTILE / LOADOUT</small></div>' + table(['Theater', 'Own ships / fleets', 'Alien ships / fleets', 'Our habs', 'Our mining sites', 'Status', 'Alien weapon mix'], rows, 'No space theater posture is available.') + '</section>';
  }

  function renderSpace(snapshot, briefing, spaceTab, spaceTheater) {
    var activeTab = spaceTab || 'mining';
    var content = activeTab === 'habs' ? renderHabs(snapshot, spaceTheater) : activeTab === 'fleets' ? renderFleets(snapshot, spaceTheater) : activeTab === 'ships' ? renderShips(snapshot, spaceTheater) : renderMining(snapshot, spaceTheater);
    var filterNote = spaceTheater ? ' / FILTERED TO ' + String(spaceTheater).toUpperCase() : '';
    return '<div class="intel-library-section-intro"><div><div class="intel-library-kicker">SPACE & MINING / CLASSIC SURFACES' + filterNote + '</div><h3>Orbital operating picture</h3><p>Switch between yields, installations, fleet movement and individual hulls without leaving Mission Control.</p></div></div>' +
      '<div class="intel-library-space-panel" id="intel-library-space-panel" role="tabpanel" aria-labelledby="intel-library-space-tab-' + activeTab + '">' +
      renderSpaceTheaters(briefing, spaceTheater) +
      '<div class="intel-library-subnav" role="tablist" aria-label="Space and mining views">' +
        [['mining', 'Mining'], ['habs', 'Habs'], ['fleets', 'Fleets'], ['ships', 'Ships']].map(function spaceTabButton(item) {
          return '<button type="button" class="intel-library-subnav-btn ' + (activeTab === item[0] ? 'is-active' : '') + '" id="intel-library-space-tab-' + item[0] + '" data-library-space="' + item[0] + '" role="tab" aria-controls="intel-library-space-panel" aria-selected="' + (activeTab === item[0] ? 'true' : 'false') + '">' + item[1] + '</button>';
        }).join('') +
      '</div>' + content + '</div>';
  }

  function renderResearch(snapshot) {
    var research = snapshot.globalResearch || {};
    var slots = (research.activeSlots || []).map(function slotRow(slot) {
      return row([
        number(slot.slotNumber, 0),
        display(slot.displayName),
        display(slot.category),
        number(slot.accumulatedResearch, 0) + ' / ' + number(slot.totalCost, 0),
        number(slot.percent, 1) + '%',
        display(slot.leadFactionName),
        number(slot.leadContribution, 0)
      ]);
    });
    var completed = (research.finishedTechsNames || []).map(function completedTech(tech) {
      return '<span class="intel-library-tech-tag">' + display(tech) + '</span>';
    }).join('');
    var matrix = (snapshot.techMatrix || []).map(function matrixRow(project) {
      var observerStatus = project.factions && project.factions[String(snapshot.observerFactionId)] ? project.factions[String(snapshot.observerFactionId)].status : 'UNAVAILABLE';
      return row([
        display(project.displayName),
        display(project.projectId),
        display(project.category),
        statusChip(observerStatus, observerStatus === 'completed' ? 'good' : (observerStatus === 'locked' ? 'muted' : 'neutral')),
        display((project.effects || []).join(' · '))
      ]);
    });
    return '<div class="intel-library-section-intro"><div><div class="intel-library-kicker">TECHNOLOGY / RESEARCH TREE</div><h3>Research and capability record</h3><p>Global slots, completed technologies and the observer’s project status are shown together with the exact internal project IDs.</p></div><span class="intel-library-count">' + countLabel((snapshot.techMatrix || []).length, 'project') + '</span></div>' +
      '<section class="intel-library-block"><div class="intel-library-block-heading"><span>ACTIVE GLOBAL SLOTS</span><small>' + countLabel(slots.length, 'slot') + '</small></div>' + table(['Slot', 'Project', 'Category', 'Progress', 'Complete', 'Lead faction', 'Lead points'], slots, 'No active global research slots.') + '</section>' +
      '<section class="intel-library-block"><div class="intel-library-block-heading"><span>OBSERVER PROJECT MATRIX</span><small>INTERNAL IDs INCLUDED</small></div>' + table(['Project', 'dataName', 'Category', 'Observer status', 'Effects'], matrix, 'No technology matrix records are available.') + '</section>' +
      '<section class="intel-library-block"><div class="intel-library-block-heading"><span>COMPLETED GLOBAL TECHNOLOGIES</span><small>' + countLabel((research.finishedTechsNames || []).length, 'technology') + '</small></div><div class="intel-library-tech-list">' + (completed || '<span class="intel-library-muted">No completed technologies are available.</span>') + '</div></section>';
  }

  function renderThreats(snapshot) {
    var capabilities = snapshot.capabilities || {};
    var details = capabilities.details || {};
    var alienCouncilors = activeCouncilors(snapshot).filter(function filterAlien(councilor) { return councilor.isAlien; });
    var capabilityRows = Object.keys(details).map(function capabilityRow(key) {
      var detail = details[key] || {};
      return row([
        display(detail.name || key),
        detail.active ? statusChip('ACTIVE', 'good') : statusChip('LOCKED / UNAVAILABLE', 'muted'),
        display(detail.requiredDisplayName || detail.requiredProject || detail.requiredTech),
        display(detail.requiredEffect),
        display(detail.description)
      ]);
    });
    var xenoRows = (snapshot.activeXenoforming || []).map(function xenoRow(site) {
      return row([display(site.regionName), display(site.level), display(site.regionId)]);
    });
    var facilityRows = (snapshot.builtAlienFacilities || []).map(function facilityRow(facility) {
      return row([display(facility.displayName || facility.name), display(facility.regionName || facility.locationName), display(facility.factionName), display(facility.type || facility.templateName)]);
    });
    var alienCouncilorRows = alienCouncilors.map(function alienCouncilorRow(councilor) {
      return row([
        display(councilor.displayName),
        display(councilor.locationName),
        display(councilor.activeMissionName),
        display(councilor.activeMissionTarget),
        number(councilor.totalSkills, 0),
        statusChip(councilor.status || 'ACTIVE', 'danger')
      ]);
    });
    return '<div class="intel-library-section-intro"><div><div class="intel-library-kicker">ALIEN INTELLIGENCE / CAPABILITY GATING</div><h3>Threat and discovery record</h3><p>Detection capabilities are separated from raw records so an unavailable panel is not mistaken for an empty world.</p></div><span class="intel-library-count">' + countLabel(Object.keys(details).length, 'capability') + '</span></div>' +
      '<section class="intel-library-block"><div class="intel-library-block-heading"><span>CAPABILITY VALIDATION</span><small>TECH / STORY GATES</small></div>' + table(['Capability', 'State', 'Unlock', 'Effect', 'Description'], capabilityRows, 'No capability details are available.') + '</section>' +
      '<section class="intel-library-block"><div class="intel-library-block-heading"><span>ACTIVE ALIEN COUNCILORS</span><small>' + countLabel(alienCouncilorRows.length, 'confirmed record') + '</small></div>' + table(['Councilor', 'Location', 'Last mission', 'Target', 'Total skills', 'Status'], alienCouncilorRows, snapshot.mode === 'omniscient' ? 'No active alien councilors are present in the current save.' : 'Alien councilor records are unavailable at the current detection level.') + '</section>' +
      '<section class="intel-library-block"><div class="intel-library-block-heading"><span>XENOFORMING</span><small>' + countLabel(xenoRows.length, 'visible site') + '</small></div>' + table(['Region', 'Level', 'Region ID'], xenoRows, 'No xenoforming sites are visible in this intelligence view.') + '</section>' +
      '<section class="intel-library-block"><div class="intel-library-block-heading"><span>ALIEN FACILITIES</span><small>' + countLabel(facilityRows.length, 'facility') + '</small></div>' + table(['Facility', 'Location', 'Faction', 'Type'], facilityRows, 'No alien facilities are visible in this intelligence view.') + '</section>' +
      '<div class="intel-library-note"><strong>Discovery state:</strong> Deep System Skywatch is represented by the current filtered space records; it does not override the separate Earth-side discovery gates above.</div>';
  }

  function renderExports(snapshot) {
    return '<div class="intel-library-section-intro"><div><div class="intel-library-kicker">HANDOFF / AI ANALYSIS</div><h3>Snapshot exports</h3><p>Generate the same compact or full Markdown handoff available in the classic dashboard, using this observer and intelligence mode.</p></div><span class="intel-library-count">' + escapeHtml(visibility(snapshot)) + '</span></div>' +
      '<section class="intel-library-block intel-library-export-block"><div class="intel-library-block-heading"><span>EXPORT PACKAGE</span><small>MODE AND OBSERVER ARE INCLUDED</small></div>' +
        '<div class="intel-library-export-actions"><button class="init-btn init-btn-cyan" type="button" data-library-export="compact">Copy compact snapshot</button><button class="init-btn" type="button" data-library-export="full">Copy full snapshot</button></div>' +
        '<div class="intel-library-export-status" data-library-export-status>Ready to generate a current handoff.</div>' +
      '</section>' +
      '<div class="intel-library-note"><strong>Handoff label:</strong> ' + escapeHtml(visibility(snapshot)) + ' / ' + display(snapshot.observerFactionName) + '. This keeps the visibility context attached when the report leaves Mission Control.</div>';
  }

  function renderSection(root, snapshot, briefing, observerId, factions, section, spaceTab, options) {
    if (options) {
      options.section = section || options.section || 'overview';
      options.spaceTab = spaceTab || options.spaceTab || 'mining';
    }
    var content = section === 'factions'
      ? renderFactions(snapshot, observerId, factions)
      : section === 'councilors'
        ? renderCouncilors(snapshot, factions, options)
        : section === 'nations'
            ? renderNations(snapshot, factions)
            : section === 'space'
            ? renderSpace(snapshot, briefing, spaceTab, options && options.spaceTheater)
            : section === 'research'
              ? renderResearch(snapshot)
              : section === 'threats'
                ? renderThreats(snapshot)
                : section === 'exports'
                  ? renderExports(snapshot)
                : renderOverview(snapshot, briefing, observerId, factions);
    root.querySelector('[data-library-content]').innerHTML = content;
    var contentPanel = root.querySelector('[data-library-content]');
    var activeSectionButton = root.querySelector('[data-library-section="' + section + '"]');
    contentPanel.id = 'intel-library-panel';
    contentPanel.setAttribute('role', 'tabpanel');
    contentPanel.setAttribute('tabindex', '0');
    if (activeSectionButton) contentPanel.setAttribute('aria-labelledby', activeSectionButton.id);
    root.querySelectorAll('[data-library-section]').forEach(function bindSection(button) {
      button.classList.toggle('is-active', button.dataset.librarySection === section);
      button.setAttribute('aria-selected', button.dataset.librarySection === section ? 'true' : 'false');
      button.onclick = function onSectionClick() {
        if (options) {
          options.section = button.dataset.librarySection;
          options.spaceTab = 'mining';
          options.spaceTheater = null;
        }
        renderSection(root, snapshot, briefing, observerId, factions, button.dataset.librarySection, 'mining', options);
      };
    });
    root.querySelectorAll('[data-library-space]').forEach(function bindSpace(button) {
      button.onclick = function onSpaceClick() {
        if (options) {
          options.section = 'space';
          options.spaceTab = button.dataset.librarySpace;
        }
        renderSection(root, snapshot, briefing, observerId, factions, 'space', button.dataset.librarySpace, options);
      };
    });
    root.querySelectorAll('[data-library-councilor-faction]').forEach(function bindCouncilorFaction(select) {
      select.onchange = function onCouncilorFactionChange() {
        if (options) options.councilorFaction = select.value;
        renderSection(root, snapshot, briefing, observerId, factions, 'councilors', 'mining', options);
      };
    });
    root.querySelectorAll('[data-library-councilor-search]').forEach(function bindCouncilorSearch(input) {
      input.oninput = function onCouncilorSearchInput() {
        if (options) options.councilorSearch = input.value;
        renderSection(root, snapshot, briefing, observerId, factions, 'councilors', 'mining', options);
        var nextInput = root.querySelector('[data-library-councilor-search]');
        if (nextInput) {
          nextInput.focus();
          try { nextInput.setSelectionRange(nextInput.value.length, nextInput.value.length); } catch (error) { /* no-op */ }
        }
      };
    });
    root.querySelectorAll('[data-library-faction]').forEach(function bindFaction(button) {
      button.onclick = function onFactionClick() {
        if (options && typeof options.onOpenFaction === 'function') options.onOpenFaction(Number(button.dataset.libraryFaction));
      };
    });
    root.querySelectorAll('[data-library-export]').forEach(function bindExport(button) {
      button.onclick = function onExportClick() {
        var status = root.querySelector('[data-library-export-status]');
        if (options && typeof options.onCopyExport === 'function') {
          options.onCopyExport(button.dataset.libraryExport, status);
        }
      };
    });
  }

  function render(container, snapshot, briefing, observerId, options) {
    if (!container) return;
    var factions = factionMap(snapshot || {});
    var activeSection = options && options.section ? options.section : 'overview';
    container.innerHTML =
      '<div class="intel-library-shell">' +
        '<div class="intel-library-header"><div><div class="intel-library-kicker">MISSION CONTROL / INTELLIGENCE LIBRARY</div><h3>Record room</h3><p>All classic dashboard datasets, normalized for the current observer and intelligence mode.</p></div><div class="intel-library-header-meta"><span>' + escapeHtml(visibility(snapshot || {})) + '</span><strong>' + display(snapshot && (snapshot.metadata || {}).gameTimeString) + '</strong></div></div>' +
        '<div class="intel-library-layout"><nav class="intel-library-nav" aria-label="Intelligence library sections" role="tablist">' +
          [['overview', 'Overview'], ['factions', 'Faction balance'], ['councilors', 'Councilors'], ['nations', 'Nations'], ['space', 'Space & mining'], ['research', 'Technology'], ['threats', 'Alien intelligence'], ['exports', 'Exports']].map(function navItem(item) {
            return '<button type="button" class="intel-library-nav-btn" id="intel-library-tab-' + item[0] + '" data-library-section="' + item[0] + '" role="tab" aria-controls="intel-library-panel" aria-selected="false"><span>' + item[1] + '</span><small>VIEW</small></button>';
          }).join('') +
          '<a class="intel-library-nav-link" href="/" target="_self">Open classic dashboard</a>' +
        '</nav><div class="intel-library-content" data-library-content></div></div>' +
      '</div>';
    renderSection(container, snapshot, briefing, observerId, factions, activeSection, options && options.spaceTab || 'mining', options || {});
  }

  global.IntelligenceLibrary = { render: render };
}(window));
