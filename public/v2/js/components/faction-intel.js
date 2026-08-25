/*
 * COMPONENT DIRECTION
 * Purpose: faction intelligence as a scan-first decision surface.
 * THESIS: Make faction intelligence a scan-first decision surface, not a second dashboard.
 * OWN-WORLD: Quiet command-console structure, hard data labels, and faction accents supplied by the save.
 * STORY: The observer can select one faction, see only the current filtered truth, and leave with a next move.
 * FIRST VIEWPORT: Roster on the left; selected faction identity, visibility, metrics, and action plan on the right.
 * FORM: A DOM-built two-pane dossier with native buttons and a faction-intel-select event for handoff.
 * FINISH: unreviewed and undocumented is unfinished; this build ends with the finish review, the verdict, DESIGN.md, and every shipping raster carrying its provenance
 */

(function attachFactionIntel(global) {
  'use strict';

  var UNKNOWN_VALUE = 'UNAVAILABLE';
  var UNKNOWN_RELATIONSHIP = 'UNKNOWN';
  var MISSING_VALUES = {
    '': true,
    'UNKNOWN': true,
    'UNAVAILABLE': true,
    'N/A': true,
    'NA': true,
    'NULL': true
  };

  function render(container, snapshot, briefing, observerId) {
    var target = resolveContainer(container);
    if (!target) {
      return createEmptyController();
    }

    var data = unwrapSnapshot(snapshot);
    var factions = Array.isArray(data.factions) ? data.factions : [];
    var resolvedObserverId = resolveObserverId(data, briefing, observerId);
    var context = {
      data: data,
      briefing: briefing || null,
      factions: factions,
      observerId: resolvedObserverId,
      observer: findFaction(factions, resolvedObserverId),
      mode: getMode(data),
      priorityKey: resolvePriorityKey(data, factions)
    };
    var documentRef = target.ownerDocument || global.document;

    clearChildren(target);

    var shell = createElement(documentRef, 'div', 'faction-intel-shell');
    shell.setAttribute('data-faction-intel-component', 'true');

    var selectedKey = chooseInitialKey(factions, resolvedObserverId);
    var rosterEntries = [];
    var roster = buildRoster(documentRef, context, selectedKey, rosterEntries);
    var detail = createElement(documentRef, 'section', 'faction-intel-detail');
    detail.setAttribute('aria-live', 'polite');
    detail.setAttribute('aria-label', 'Selected faction intelligence');

    shell.appendChild(buildHeader(documentRef, context));

    var layout = createElement(documentRef, 'div', 'faction-intel-layout');
    layout.appendChild(roster);
    layout.appendChild(detail);
    shell.appendChild(layout);
    target.appendChild(shell);

    var state = {
      selectedKey: selectedKey,
      destroyed: false
    };

    function selectFaction(key, emitEvent) {
      if (state.destroyed) return false;

      var entry = rosterEntries.find(function (candidate) {
        return candidate.key === String(key);
      });
      if (!entry) return false;

      state.selectedKey = entry.key;
      rosterEntries.forEach(function (candidate) {
        var selected = candidate.key === state.selectedKey;
        candidate.button.setAttribute('aria-selected', selected ? 'true' : 'false');
        candidate.button.classList.toggle('faction-intel-faction--selected', selected);
      });

      clearChildren(detail);
      detail.appendChild(buildDetail(documentRef, context, entry.faction));

      if (emitEvent !== false) {
        notifySelection(target, context, entry.faction);
      }

      return true;
    }

    function handleClick(event) {
      var node = event.target;
      while (node && node !== shell && node.tagName !== 'BUTTON') {
        node = node.parentNode;
      }
      if (!node || node === shell || node.tagName !== 'BUTTON') return;

      var key = node.getAttribute('data-faction-intel-key');
      if (key !== null) selectFaction(key, true);
    }

    shell.addEventListener('click', handleClick);

    if (selectedKey !== null) {
      selectFaction(selectedKey, false);
    } else {
      detail.appendChild(buildEmptyState(documentRef, 'No faction data is present in the current snapshot.'));
    }

    return {
      select: function (key) {
        return selectFaction(key, true);
      },
      getSelectedFaction: function () {
        var selected = rosterEntries.find(function (entry) {
          return entry.key === state.selectedKey;
        });
        return selected ? selected.faction : null;
      },
      getSelectedId: function () {
        var faction = this.getSelectedFaction();
        return faction ? getFactionId(faction) : null;
      },
      destroy: function () {
        if (state.destroyed) return;
        state.destroyed = true;
        shell.removeEventListener('click', handleClick);
        if (shell.parentNode === target) target.removeChild(shell);
      }
    };
  }

  function resolveContainer(container) {
    if (container && typeof container.nodeType === 'number') return container;
    if (typeof container === 'string' && global.document) {
      return global.document.querySelector(container);
    }
    return null;
  }

  function unwrapSnapshot(snapshot) {
    if (!snapshot || typeof snapshot !== 'object') return {};
    if (snapshot.data && typeof snapshot.data === 'object' && Array.isArray(snapshot.data.factions)) {
      return snapshot.data;
    }
    return snapshot;
  }

  function createEmptyController() {
    return {
      select: function () { return false; },
      getSelectedFaction: function () { return null; },
      getSelectedId: function () { return null; },
      destroy: function () {}
    };
  }

  function clearChildren(node) {
    while (node && node.firstChild) node.removeChild(node.firstChild);
  }

  function createElement(documentRef, tagName, className, text) {
    var node = documentRef.createElement(tagName);
    if (className) node.className = className;
    if (text !== undefined && text !== null) node.textContent = String(text);
    return node;
  }

  function appendChildren(parent) {
    for (var index = 1; index < arguments.length; index += 1) {
      var child = arguments[index];
      if (child) parent.appendChild(child);
    }
    return parent;
  }

  function createTextNode(documentRef, text) {
    return documentRef.createTextNode(String(text));
  }

  function buildHeader(documentRef, context) {
    var header = createElement(documentRef, 'header', 'faction-intel-header');
    var heading = createElement(documentRef, 'div', 'faction-intel-header-copy');
    var title = createElement(documentRef, 'h2', 'faction-intel-title', 'Faction intelligence');
    var description = createElement(
      documentRef,
      'p',
      'faction-intel-description',
      'Observer-relative telemetry from the supplied current snapshot.'
    );
    heading.appendChild(title);
    heading.appendChild(description);

    var metadata = createElement(documentRef, 'div', 'faction-intel-header-meta');
    metadata.appendChild(buildMetaItem(documentRef, 'VIEW', context.mode));
    metadata.appendChild(buildMetaItem(documentRef, 'OBSERVER', getFactionName(context.observer) || UNKNOWN_RELATIONSHIP));
    metadata.appendChild(buildMetaItem(documentRef, 'FACTIONS', String(context.factions.length)));

    var date = context.data.metadata && (context.data.metadata.gameTimeString || context.data.metadata.lastModified);
    if (!date && context.briefing) date = context.briefing.campaignDate;
    if (date) metadata.appendChild(buildMetaItem(documentRef, 'CYCLE', date));

    header.appendChild(heading);
    header.appendChild(metadata);
    return header;
  }

  function buildMetaItem(documentRef, label, value) {
    var item = createElement(documentRef, 'div', 'faction-intel-meta-item');
    item.appendChild(createElement(documentRef, 'span', 'faction-intel-meta-label', label));
    item.appendChild(createElement(documentRef, 'strong', 'faction-intel-meta-value', value));
    return item;
  }

  function buildRoster(documentRef, context, selectedKey, entries) {
    var aside = createElement(documentRef, 'aside', 'faction-intel-roster');
    aside.setAttribute('aria-label', 'Faction roster');

    var heading = createElement(documentRef, 'div', 'faction-intel-roster-heading');
    heading.appendChild(createElement(documentRef, 'h3', 'faction-intel-section-title', 'Faction roster'));
    heading.appendChild(createElement(
      documentRef,
      'span',
      'faction-intel-roster-count',
      context.factions.length + (context.factions.length === 1 ? ' entry' : ' entries')
    ));
    aside.appendChild(heading);

    var list = createElement(documentRef, 'div', 'faction-intel-roster-list');
    list.setAttribute('role', 'listbox');
    list.setAttribute('aria-label', 'Select a faction');

    context.factions.forEach(function (faction, index) {
      var key = getEntryKey(faction, index);
      var button = createElement(documentRef, 'button', 'faction-intel-faction');
      button.type = 'button';
      button.setAttribute('role', 'option');
      button.setAttribute('data-faction-intel-key', key);
      button.setAttribute('aria-selected', key === selectedKey ? 'true' : 'false');
      button.classList.toggle('faction-intel-faction--selected', key === selectedKey);

      var swatch = createElement(documentRef, 'span', 'faction-intel-faction-swatch');
      swatch.setAttribute('aria-hidden', 'true');
      applyAccent(swatch, faction.color);
      if (global.MissionControlShared && global.MissionControlShared.appendFactionLogo) {
        var rosterLogo = global.MissionControlShared.appendFactionLogo(documentRef, swatch, faction, 'faction-logo faction-logo--roster');
        if (rosterLogo) swatch.style.backgroundColor = 'transparent';
      }

      var copy = createElement(documentRef, 'span', 'faction-intel-faction-copy');
      copy.appendChild(createElement(documentRef, 'strong', 'faction-intel-faction-name', getFactionName(faction)));
      copy.appendChild(createElement(
        documentRef,
        'span',
        'faction-intel-faction-relation',
        getRelationship(context, faction).value
      ));

      var power = createElement(
        documentRef,
        'span',
        'faction-intel-faction-power',
        'POWER ' + formatPower(faction)
      );

      button.appendChild(swatch);
      button.appendChild(copy);
      button.appendChild(power);
      list.appendChild(button);
      entries.push({ key: key, faction: faction, button: button });
    });

    list.addEventListener('keydown', function handleRosterKeydown(event) {
      var buttons = entries.map(function entryButton(entry) { return entry.button; });
      if (!buttons.length || !['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key)) return;
      event.preventDefault();
      var currentIndex = buttons.indexOf(document.activeElement);
      if (event.key === 'Home') currentIndex = 0;
      else if (event.key === 'End') currentIndex = buttons.length - 1;
      else if (event.key === 'ArrowDown') currentIndex = currentIndex < 0 ? 0 : (currentIndex + 1) % buttons.length;
      else currentIndex = currentIndex <= 0 ? buttons.length - 1 : currentIndex - 1;
      buttons[currentIndex].focus();
    });

    if (!context.factions.length) {
      list.appendChild(buildEmptyState(documentRef, 'No selectable factions were supplied.'));
    }

    aside.appendChild(list);
    return aside;
  }

  function buildDetail(documentRef, context, faction) {
    if (!faction) return buildEmptyState(documentRef, 'No faction is selected.');

    var detail = createElement(documentRef, 'div', 'faction-intel-detail-content');
    var relationship = getRelationship(context, faction);
    var hate = getAlienHate(context, faction);
    var councilors = getFactionCouncilors(context, faction);
    var earth = getEarthMetrics(context, faction);
    var space = getSpaceMetrics(context, faction);
    var research = getResearchMetrics(context, faction);

    var identity = createElement(documentRef, 'header', 'faction-intel-identity');
    var identityMark = createElement(documentRef, 'span', 'faction-intel-identity-mark');
    identityMark.setAttribute('aria-hidden', 'true');
    applyAccent(identityMark, faction.color);
    if (global.MissionControlShared && global.MissionControlShared.appendFactionLogo) {
      var identityLogo = global.MissionControlShared.appendFactionLogo(documentRef, identityMark, faction, 'faction-logo faction-logo--identity');
      if (identityLogo) identityMark.style.backgroundColor = 'transparent';
    }

    var identityCopy = createElement(documentRef, 'div', 'faction-intel-identity-copy');
    identityCopy.appendChild(createElement(documentRef, 'h3', 'faction-intel-identity-name', getFactionName(faction)));
    identityCopy.appendChild(createElement(
      documentRef,
      'p',
      'faction-intel-identity-relation',
      'Observer-relative relationship: ' + relationship.value
    ));
    identity.appendChild(identityMark);
    identity.appendChild(identityCopy);

    var visibility = createElement(documentRef, 'div', 'faction-intel-visibility');
    visibility.appendChild(buildVisibilityTag(documentRef, 'RELATION', relationship.visibility));
    if (!sameId(getFactionId(faction), context.observerId)) {
      visibility.appendChild(buildVisibilityTag(documentRef, 'HATE OF US', relationship.theirsVisibility));
      visibility.appendChild(buildVisibilityTag(documentRef, 'OUR HATE', relationship.oursVisibility));
    }
    visibility.appendChild(buildVisibilityTag(documentRef, 'ALIEN HATE', hate.visibility));
    visibility.appendChild(buildVisibilityTag(documentRef, 'EARTH', earth.visibility));
    visibility.appendChild(buildVisibilityTag(documentRef, 'SPACE', space.visibility));
    visibility.appendChild(buildVisibilityTag(documentRef, 'RESEARCH', research.visibility));

    var metrics = createElement(documentRef, 'div', 'faction-intel-metrics');
    if (!sameId(getFactionId(faction), context.observerId)) {
      metrics.appendChild(buildMetricGroup(
        documentRef,
        'Relationship posture',
        relationshipMetrics(relationship),
        relationship.visibility
      ));
    }
    metrics.appendChild(buildMetricGroup(documentRef, 'Power', powerMetrics(faction), visibilityForPower(context, faction)));
    metrics.appendChild(buildMetricGroup(documentRef, 'Earth footprint', earth.metrics, earth.visibility));
    metrics.appendChild(buildMetricGroup(documentRef, 'Space posture', space.metrics, space.visibility));
    metrics.appendChild(buildMetricGroup(documentRef, 'Research posture', research.metrics, research.visibility));

    var councilSection = buildCouncilorSection(documentRef, context, faction, councilors);

    var notes = createElement(documentRef, 'div', 'faction-intel-notes');
    if (faction.visibilityNote) {
      notes.appendChild(buildNote(documentRef, 'Visibility note', faction.visibilityNote));
    }
    if (hate.note) {
      notes.appendChild(buildNote(documentRef, 'Alien-hate access', hate.note));
    }
    if (!notes.childNodes.length) {
      notes.appendChild(buildNote(
        documentRef,
        'Data discipline',
        'Values below are limited to fields present in the supplied snapshot.'
      ));
    }

    var plan = buildActionPlan(documentRef, context, faction, {
      relationship: relationship,
      hate: hate,
      earth: earth,
      space: space,
      research: research
    });

    detail.appendChild(identity);
    detail.appendChild(visibility);
    detail.appendChild(metrics);
    detail.appendChild(councilSection);
    detail.appendChild(notes);
    detail.appendChild(plan);
    return detail;
  }

  function buildMetricGroup(documentRef, title, metrics, visibility) {
    var group = createElement(documentRef, 'section', 'faction-intel-metric-group');
    var heading = createElement(documentRef, 'div', 'faction-intel-metric-heading');
    heading.appendChild(createElement(documentRef, 'h4', 'faction-intel-metric-title', title));
    heading.appendChild(buildVisibilityTag(documentRef, 'VISIBILITY', visibility));
    group.appendChild(heading);

    var grid = createElement(documentRef, 'div', 'faction-intel-metric-grid');
    metrics.forEach(function (metric) {
      var item = createElement(documentRef, 'div', 'faction-intel-metric');
      item.appendChild(createElement(documentRef, 'span', 'faction-intel-metric-label', metric.label));
      var metricValue = String(metric.value === undefined || metric.value === null ? UNKNOWN_VALUE : metric.value);
      var metricValueClass = metricValue.length > 10
        ? 'faction-intel-metric-value faction-intel-metric-value--text'
        : 'faction-intel-metric-value';
      item.appendChild(createElement(documentRef, 'strong', metricValueClass, metricValue));
      if (metric.note) {
        item.appendChild(createElement(documentRef, 'span', 'faction-intel-metric-note', metric.note));
      }
      grid.appendChild(item);
    });
    group.appendChild(grid);
    return group;
  }

  function buildCouncilorSection(documentRef, context, faction, councilors) {
    var section = createElement(documentRef, 'section', 'faction-intel-council');
    var heading = createElement(documentRef, 'div', 'faction-intel-council-heading');
    heading.appendChild(createElement(documentRef, 'h4', 'faction-intel-section-title', 'Councilor roster'));

    var visibility = councilorVisibility(context, faction, councilors);
    var countLabel = councilors.length + ' visible';
    heading.appendChild(createElement(documentRef, 'span', 'faction-intel-council-count', countLabel));
    section.appendChild(heading);

    var subhead = createElement(documentRef, 'div', 'faction-intel-council-subhead');
    subhead.appendChild(createElement(documentRef, 'span', 'faction-intel-meta-label', 'COUNCIL INTELLIGENCE'));
    subhead.appendChild(createElement(documentRef, 'strong', 'faction-intel-council-visibility', normalizeVisibility(visibility)));
    section.appendChild(subhead);

    var list = createElement(documentRef, 'div', 'faction-intel-council-list');
    if (!councilors.length) {
      list.appendChild(buildEmptyState(
        documentRef,
        'No councilors are visible for this faction in the current intelligence mode.'
      ));
    } else {
      councilors.forEach(function (councilor) {
        list.appendChild(buildCouncilorRow(documentRef, context, councilor));
      });
    }
    section.appendChild(list);
    return section;
  }

  function buildCouncilorRow(documentRef, context, councilor) {
    var row = createElement(documentRef, 'article', 'faction-intel-councilor');
    var main = createElement(documentRef, 'div', 'faction-intel-councilor-main');
    var name = firstValue(councilor, ['displayName', 'name', 'personalName']) || UNKNOWN_VALUE;
    var profession = firstValue(councilor, ['typeTemplateName', 'profession', 'type']) || 'Councilor';
    var location = firstValue(councilor, ['locationName', 'location', 'regionName']) || UNKNOWN_VALUE;
    var mission = firstValue(councilor, ['activeMissionName', 'missionName', 'assignment']) || 'No active mission';
    var target = firstValue(councilor, ['activeMissionTarget', 'missionTarget']);
    var skill = councilorTopSkill(councilor, context);

    main.appendChild(createElement(documentRef, 'strong', 'faction-intel-councilor-name', name));
    main.appendChild(createElement(documentRef, 'span', 'faction-intel-councilor-profession', profession));
    main.appendChild(createElement(documentRef, 'span', 'faction-intel-councilor-location', 'LOCATION / ' + location));

    var side = createElement(documentRef, 'div', 'faction-intel-councilor-side');
    side.appendChild(createElement(documentRef, 'span', 'faction-intel-councilor-skill', skill));
    side.appendChild(createElement(
      documentRef,
      'span',
      'faction-intel-councilor-mission',
      'MISSION / ' + String(mission) + (target ? ' → ' + String(target) : '')
    ));
    side.appendChild(createElement(
      documentRef,
      'span',
      'faction-intel-councilor-status',
      normalizeVisibility(councilor.visibility || councilor.investigationConfidence || 'unknown')
    ));

    row.appendChild(main);
    row.appendChild(side);
    return row;
  }

  function getFactionCouncilors(context, faction) {
    var factionId = getFactionId(faction);
    if (factionId === null || factionId === undefined) return [];
    var councilors = Array.isArray(context.data.councilors) ? context.data.councilors : [];
    return councilors
      .filter(function (councilor) {
        if (councilor.isActiveCouncilor === false || councilor.isIndependent === true) return false;
        if (String(councilor.status || 'Active').toLowerCase() !== 'active') return false;
        return sameId(councilor.factionId, factionId);
      })
      .sort(function (a, b) {
        var aSkills = Number(a.totalSkills);
        var bSkills = Number(b.totalSkills);
        if (Number.isFinite(aSkills) && Number.isFinite(bSkills) && aSkills !== bSkills) return bSkills - aSkills;
        return String(a.displayName || '').localeCompare(String(b.displayName || ''));
      });
  }

  function councilorVisibility(context, faction, councilors) {
    if (context.mode === 'OMNISCIENT') return 'RAW SAVE ONLY';
    if (sameId(getFactionId(faction), context.observerId)) return 'CONFIRMED';
    if (councilors.some(function (councilor) { return councilor.visibility === 'detected'; })) return 'PARTIAL';
    if (councilors.some(function (councilor) { return councilor.isTurnedMole === true; })) return 'CONFIRMED';
    return councilors.length ? 'VISIBLE' : 'UNAVAILABLE';
  }

  function councilorTopSkill(councilor, context) {
    var source = councilor && councilor.maskedAttributes && typeof councilor.maskedAttributes === 'object'
      ? councilor.maskedAttributes
      : councilor && councilor.attributes;
    var bestName = null;
    var bestValue = null;
    if (source && typeof source === 'object') {
      Object.keys(source).forEach(function (name) {
        var entry = source[name];
        var value = entry && typeof entry === 'object' ? entry.visible : entry;
        if (!['Administration', 'Persuasion', 'Investigation', 'Espionage', 'Command', 'Science', 'Security'].includes(name)) return;
        if (value === null || value === undefined || value === '') return;
        var numeric = Number(value);
        if (!Number.isFinite(numeric)) return;
        if (bestValue === null || numeric > bestValue) {
          bestName = name;
          bestValue = numeric;
        }
      });
    }

    if (bestName === null) return 'SKILL / ' + UNKNOWN_VALUE;
    var abbreviations = {
      Administration: 'ADM',
      Persuasion: 'PER',
      Investigation: 'INV',
      Espionage: 'ESP',
      Command: 'CMD',
      Science: 'SCI',
      Security: 'SEC'
    };
    var prefix = abbreviations[bestName] || bestName;
    return 'SKILL / ' + prefix + ' ' + formatCount(bestValue);
  }

  function relationshipMetrics(relationship) {
    var theirs = cleanRelationshipValue(relationship.theirs);
    var ours = cleanRelationshipValue(relationship.ours);
    var directionCount = [theirs, ours].filter(function (value) {
      return value !== UNKNOWN_VALUE;
    }).length;
    return [
      { label: 'Hate of us', value: theirs },
      { label: 'Our hate', value: ours },
      {
        label: 'Summary',
        value: directionCount === 2
          ? 'BOTH DIRECTIONS RECORDED'
          : directionCount === 1
            ? 'ONE DIRECTION RECORDED'
            : relationship.value || UNKNOWN_RELATIONSHIP,
        note: directionCount ? 'Directional hate values shown above.' : null
      }
    ];
  }

  function cleanRelationshipValue(value) {
    if (!hasMetricValue(value)) return UNKNOWN_VALUE;
    var text = String(value).trim();
    var cleaned = text.replace(/^(?:HATE\s+OF\s+US|OUR\s+HATE|HATE)\s*/i, '').trim();
    return hasMetricValue(cleaned) ? cleaned : UNKNOWN_VALUE;
  }

  function summarizeRelationship(theirs, ours) {
    var parts = [];
    var cleanTheirs = cleanRelationshipValue(theirs);
    var cleanOurs = cleanRelationshipValue(ours);
    if (cleanTheirs !== UNKNOWN_VALUE) parts.push('Hate of us ' + cleanTheirs);
    if (cleanOurs !== UNKNOWN_VALUE) parts.push('Our hate ' + cleanOurs);
    return parts.join(' · ') || UNKNOWN_RELATIONSHIP;
  }

  function buildVisibilityTag(documentRef, label, visibility) {
    var tag = createElement(documentRef, 'span', 'faction-intel-visibility-tag');
    tag.appendChild(createElement(documentRef, 'span', 'faction-intel-visibility-label', label));
    tag.appendChild(createElement(documentRef, 'strong', 'faction-intel-visibility-value', normalizeVisibility(visibility)));
    return tag;
  }

  function buildNote(documentRef, label, text) {
    var note = createElement(documentRef, 'p', 'faction-intel-note');
    note.appendChild(createElement(documentRef, 'strong', 'faction-intel-note-label', label + ':'));
    note.appendChild(createTextNode(documentRef, ' ' + String(text)));
    return note;
  }

  function buildActionPlan(documentRef, context, faction, intel) {
    var plan = createElement(documentRef, 'section', 'faction-intel-plan');
    var heading = createElement(documentRef, 'div', 'faction-intel-plan-heading');
    heading.appendChild(createElement(documentRef, 'h4', 'faction-intel-plan-title', 'Plan of action'));
    heading.appendChild(createElement(documentRef, 'span', 'faction-intel-plan-label', 'DERIVED FROM CURRENT DATA'));
    plan.appendChild(heading);

    var actions = deriveActions(context, faction, intel);
    var list = createElement(documentRef, 'ol', 'faction-intel-plan-list');
    actions.forEach(function (action) {
      list.appendChild(createElement(documentRef, 'li', 'faction-intel-plan-item', action));
    });
    plan.appendChild(list);
    return plan;
  }

  function buildEmptyState(documentRef, text) {
    var empty = createElement(documentRef, 'div', 'faction-intel-empty');
    empty.appendChild(createElement(documentRef, 'strong', 'faction-intel-empty-title', 'No intelligence to display'));
    empty.appendChild(createElement(documentRef, 'p', 'faction-intel-empty-text', text));
    return empty;
  }

  function deriveActions(context, faction, intel) {
    var actions = [];
    var isObserver = sameId(getFactionId(faction), context.observerId);
    var factionName = getFactionName(faction);

    if (isObserver) {
      var activeProject = firstActiveProject(faction);
      if (activeProject) {
        actions.push('Keep ' + activeProject.name + ' moving; the listed research progress is ' + activeProject.progress + '.');
      } else if (hasMetricValue(intel.research.output)) {
        actions.push('Protect the current research throughput of ' + formatResearch(intel.research.output) + '.');
      } else {
        actions.push('Reacquire research telemetry before setting a project priority.');
      }

      if (hasMetricValue(intel.earth.controlPoints) || hasMetricValue(intel.earth.nations)) {
        actions.push('Consolidate the visible terrestrial footprint: ' + metricText(intel.earth.controlPoints) + ' control points across ' + metricText(intel.earth.nations) + ' nations.');
      } else {
        actions.push('Reacquire terrestrial control data before changing the faction posture.');
      }

      if (intel.space.visibility === 'UNAVAILABLE') {
        actions.push('Restore orbital telemetry before committing to a space posture.');
      } else if (intel.space.combatPower.value === UNKNOWN_VALUE) {
        actions.push('Confirm fleet combat telemetry before committing the visible orbital assets.');
      } else {
        actions.push('Maintain the visible orbital posture of ' + metricText(intel.space.habs) + ' habs and ' + metricText(intel.space.ships) + ' ships.');
      }
    } else {
      if (intel.relationship.value === UNKNOWN_RELATIONSHIP) {
        actions.push('Keep the diplomatic posture open; no observer-relative relationship is present in this snapshot.');
      } else {
        actions.push('Use the recorded relationship posture — ' + intel.relationship.value + ' — when assigning surveillance priority.');
      }

      if (context.priorityKey && context.priorityKey === getEntryKey(faction, context.factions.indexOf(faction))) {
        actions.push('Keep ' + factionName + ' on the priority watchlist; the snapshot flags it as the current priority target.');
      } else if (hasMetricValue(intel.earth.controlPoints) || hasMetricValue(intel.earth.nations)) {
        actions.push('Track ' + factionName + '\'s terrestrial footprint at ' + metricText(intel.earth.controlPoints) + ' control points across ' + metricText(intel.earth.nations) + ' nations.');
      } else {
        actions.push('Maintain surveillance until terrestrial holdings are visible in a later snapshot.');
      }

      if (intel.space.visibility === 'UNAVAILABLE') {
        actions.push('Develop orbital intelligence before estimating ' + factionName + '\'s total space strength.');
      } else if (intel.space.visibility === 'PARTIAL') {
        actions.push('Treat the orbital counts as visible assets only; total space strength remains unknown.');
      } else {
        actions.push('Compare the confirmed orbital posture against the next save before changing priorities.');
      }
    }

    if (intel.hate.value === UNKNOWN_VALUE) {
      if (intel.hate.requiredProject) {
        actions.push('Advance ' + intel.hate.requiredProject + ' only if an alien-hate estimate is needed; the current value is unavailable.');
      } else {
        actions.push('Treat alien-hate posture as unknown until a visible estimate is supplied.');
      }
    } else {
      actions.push('Track the visible alien-hate signal (' + intel.hate.value + '; ' + normalizeVisibility(intel.hate.visibility) + ').');
    }

    return actions.slice(0, 4);
  }

  function getEarthMetrics(context, faction) {
    var controlPoints = readField(faction, ['controlPointsCount', 'controlPointCount', 'controlPoints']);
    var nations = readField(faction, ['nationsCount', 'nationCount', 'nations']);
    var gdp = readField(faction, ['totalGdp', 'gdp', 'GDP']);
    var population = readField(faction, ['totalPopulation', 'population']);
    var power = getPowerComponents(faction);
    var hasData = controlPoints.found || nations.found || gdp.found || population.found || power.earthEconomy.found || power.earthPolitics.found;

    return {
      controlPoints: metricValue(controlPoints.value, formatCount),
      nations: metricValue(nations.value, formatCount),
      gdp: metricValue(gdp.value, formatGdp),
      population: metricValue(population.value, formatPopulation),
      metrics: [
        { label: 'Control points', value: metricValue(controlPoints.value, formatCount) },
        { label: 'Nations', value: metricValue(nations.value, formatCount) },
        { label: 'GDP', value: metricValue(gdp.value, formatGdp) },
        { label: 'Population', value: metricValue(population.value, formatPopulation) },
        { label: 'Economy score', value: metricScore(power.earthEconomy.value) },
        { label: 'Politics score', value: metricScore(power.earthPolitics.value) }
      ],
      visibility: visibilityForMetric(context, faction, 'earth', hasData)
    };
  }

  function getSpaceMetrics(context, faction) {
    var habs = readField(faction, ['habsCount', 'habCount']);
    var fleets = readField(faction, ['fleetsCount', 'fleetCount']);
    var ships = readField(faction, ['shipsCount', 'shipCount']);
    var combatPower = getCombatPower(faction);
    var factionId = getFactionId(faction);
    var fallbackHabs = !habs.found ? countVisibleAssets(context.data.habs, factionId) : { found: false };
    var fallbackFleets = !fleets.found ? countVisibleAssets(context.data.fleets, factionId) : { found: false };
    var fallbackShips = !ships.found ? countVisibleShips(context.data.fleets, factionId) : { found: false };

    if (!habs.found && fallbackHabs.found) habs = fallbackHabs;
    if (!fleets.found && fallbackFleets.found) fleets = fallbackFleets;
    if (!ships.found && fallbackShips.found) ships = fallbackShips;

    var power = getPowerComponents(faction);
    var hasData = habs.found || fleets.found || ships.found || combatPower.found || power.spaceEconomy.found || power.fleet.found;
    var visibility = visibilityForMetric(context, faction, 'space', hasData);
    var countSuffix = visibility === 'PARTIAL' ? ' visible' : '';

    return {
      habs: metricValue(habs.value, function (value) { return formatCount(value) + countSuffix; }),
      fleets: metricValue(fleets.value, function (value) { return formatCount(value) + countSuffix; }),
      ships: metricValue(ships.value, function (value) { return formatCount(value) + countSuffix; }),
      combatPower: { value: metricValue(combatPower.value, formatCount), found: combatPower.found },
      metrics: [
        { label: 'Habs / stations', value: metricValue(habs.value, function (value) { return formatCount(value) + countSuffix; }) },
        { label: 'Fleets', value: metricValue(fleets.value, function (value) { return formatCount(value) + countSuffix; }) },
        { label: 'Ships', value: metricValue(ships.value, function (value) { return formatCount(value) + countSuffix; }) },
        { label: 'Combat power', value: metricValue(combatPower.value, formatCount) },
        { label: 'Space score', value: metricScore(power.spaceEconomy.value) },
        { label: 'Fleet score', value: metricScore(power.fleet.value) }
      ],
      visibility: visibility
    };
  }

  function getResearchMetrics(context, faction) {
    var output = readField(faction, ['totalResearch', 'monthlyResearch', 'researchOutput']);
    var completed = readProjectCount(faction, ['completedProjectsCount', 'completedProjects']);
    var current = readProjectCount(faction, ['currentProjectsCount', 'currentProjects']);
    var available = readField(faction, ['availableProjectsCount']);
    var hasData = output.found || completed.found || current.found || available.found;

    return {
      output: output.value,
      metrics: [
        { label: 'Research output', value: metricValue(output.value, formatResearch) },
        { label: 'Projects listed', value: metricValue(completed.value, formatCount, 'listed') },
        { label: 'Active projects listed', value: metricValue(current.value, formatCount, 'listed') },
        { label: 'Available projects', value: metricValue(available.value, formatCount) },
        { label: 'Research score', value: metricScore(getPowerComponents(faction).research.value) }
      ],
      visibility: visibilityForMetric(context, faction, 'research', hasData)
    };
  }

  function powerMetrics(faction) {
    var power = getPowerValue(faction);
    var components = getPowerComponents(faction);
    return [
      { label: 'Composite score estimate', value: metricValue(power, function (value) { return formatCount(value) + ' / 100'; }) },
      { label: 'Military score', value: metricScore(components.military.value) },
      { label: 'Estimated', value: isPowerEstimate(faction) ? 'YES' : (power === null ? UNKNOWN_VALUE : 'NO') }
    ];
  }

  function visibilityForPower(context, faction) {
    var power = getPowerValue(faction);
    var explicit = readField(faction, ['powerVisibility', 'visibility']);
    if (explicit.found && !isExplicitlyEmpty(explicit.value)) return normalizeVisibility(explicit.value);
    return visibilityForMetric(context, faction, 'power', power !== null);
  }

  function getPowerValue(faction) {
    var direct = readField(faction, ['powerScore']);
    if (direct.found && typeof direct.value === 'number' && Number.isFinite(direct.value)) return direct.value;
    if (direct.found && direct.value && typeof direct.value === 'object') {
      var overall = readField(direct.value, ['overall']);
      if (overall.found && typeof overall.value === 'number' && Number.isFinite(overall.value)) return overall.value;
    }
    var fallback = readField(faction, ['overallPower', 'power']);
    return fallback.found && typeof fallback.value === 'number' && Number.isFinite(fallback.value) ? fallback.value : null;
  }

  function getPowerComponents(faction) {
    var source = faction && faction.powerScore && typeof faction.powerScore === 'object' ? faction.powerScore : faction;
    return {
      earthEconomy: readField(source, ['earthEconomy', 'earthEconomyScore']),
      earthPolitics: readField(source, ['earthPolitics', 'earthPoliticsScore']),
      research: readField(source, ['research', 'researchPower', 'researchScore']),
      spaceEconomy: readField(source, ['spaceEconomy', 'spaceEconomyScore']),
      fleet: readField(source, ['fleet', 'fleetPower', 'fleetScore']),
      military: readField(source, ['military', 'militaryPower', 'militaryScore'])
    };
  }

  function getCombatPower(faction) {
    var available = readField(faction, ['combatPowerAvailable']);
    var power = readField(faction, ['combatPower', 'fleetCombatPower']);
    if (available.found && available.value === false) return { found: false, value: null };
    if (power.found && hasMetricValue(power.value)) return power;
    return { found: false, value: null };
  }

  function readProjectCount(faction, keys) {
    for (var index = 0; index < keys.length; index += 1) {
      var result = readField(faction, [keys[index]]);
      if (!result.found) continue;
      if (Array.isArray(result.value)) return { found: true, value: result.value.length };
      return result;
    }
    return { found: false, value: null };
  }

  function countVisibleAssets(items, factionId) {
    if (!Array.isArray(items) || factionId === null || factionId === undefined) return { found: false, value: null };
    return {
      found: true,
      value: items.filter(function (item) { return sameId(getFactionId(item), factionId); }).length,
      visibleOnly: true
    };
  }

  function countVisibleShips(items, factionId) {
    if (!Array.isArray(items) || factionId === null || factionId === undefined) return { found: false, value: null };
    var total = 0;
    var matched = false;
    items.forEach(function (item) {
      if (!sameId(getFactionId(item), factionId)) return;
      matched = true;
      var count = readField(item, ['shipsCount', 'shipCount']);
      if (count.found && typeof count.value === 'number' && Number.isFinite(count.value)) total += count.value;
    });
    return { found: matched, value: matched ? total : null, visibleOnly: true };
  }

  function getAlienHate(context, faction) {
    var hate = faction && faction.alienHate;
    var modeAllowsRaw = context.mode === 'OMNISCIENT' || context.mode === 'ENHANCED';

    if (hate && typeof hate === 'object') {
      var visibility = hate.visibility || (hate.playerVisible ? 'visible' : 'unavailable');
      var actual = readField(hate, ['actual', 'value']);
      var visible = readField(hate, ['visibleEstimate', 'estimate', 'display']);
      var value = null;

      if (actual.found && hasMetricValue(actual.value) && (modeAllowsRaw || hate.playerVisible === true)) {
        value = formatHate(actual.value);
      } else if (visible.found && !isMissingLabel(visible.value)) {
        value = String(visible.value);
      }

      return {
        value: value === null ? UNKNOWN_VALUE : value,
        visibility: value === null ? 'unavailable' : visibility,
        requiredProject: hate.requiredProject || null,
        note: value === null && hate.requiredProject ? 'Required project: ' + hate.requiredProject + '.' : null
      };
    }

    if (modeAllowsRaw) {
      var raw = readField(faction, ['assessedAlienHateOfMe', 'alienHateValue']);
      if (raw.found && hasMetricValue(raw.value)) {
        return { value: formatHate(raw.value), visibility: 'raw_save_only', requiredProject: null, note: null };
      }
    }

    return { value: UNKNOWN_VALUE, visibility: 'unavailable', requiredProject: null, note: null };
  }

  function getRelationship(context, faction) {
    if (sameId(getFactionId(faction), context.observerId)) {
      return {
        value: 'OBSERVER',
        visibility: 'confirmed',
        explicit: true,
        ours: null,
        theirs: null,
        oursVisibility: 'confirmed',
        theirsVisibility: 'unavailable'
      };
    }

    var factionId = getFactionId(faction);
    var relation = findExplicitRelationship(context.data, context.observerId, factionId, faction);
    var inverse = findDirectionalRelationship(context.data, factionId, context.observerId);
    var ours = relation.found && hasMetricValue(relation.value)
      ? directionalRelationshipValue(relation.value, 'OUR')
      : null;
    var theirs = inverse.found && hasMetricValue(inverse.value)
      ? directionalRelationshipValue(inverse.value, 'HATE OF US')
      : null;

    if (ours || theirs) {
      return {
        value: summarizeRelationship(theirs, ours),
        visibility: (inverse.visibility || relation.visibility || 'confirmed'),
        explicit: true,
        ours: ours,
        theirs: theirs,
        oursVisibility: relation.visibility || 'unavailable',
        theirsVisibility: inverse.visibility || 'unavailable'
      };
    }

    var key = getEntryKey(faction, context.factions.indexOf(faction));
    if (context.priorityKey && context.priorityKey === key) {
      return {
        value: 'PRIORITY TARGET',
        visibility: 'snapshot flag',
        explicit: true,
        ours: null,
        theirs: null,
        oursVisibility: 'unavailable',
        theirsVisibility: 'unavailable'
      };
    }

    return {
      value: UNKNOWN_RELATIONSHIP,
      visibility: 'unavailable',
      explicit: false,
      ours: null,
      theirs: null,
      oursVisibility: 'unavailable',
      theirsVisibility: 'unavailable'
    };
  }

  function findExplicitRelationship(data, observerId, factionId, faction) {
    var direct = readField(faction, [
      'relationshipToObserver',
      'observerRelationship',
      'relationship',
      'relation',
      'diplomaticStatus',
      'attitude',
      'stance'
    ]);
    if (direct.found) {
      return {
        found: true,
        value: unwrapRelationshipValue(direct.value),
        visibility: direct.value && typeof direct.value === 'object' ? direct.value.visibility : null
      };
    }

    var directional = findDirectionalRelationship(data, observerId, factionId);
    if (directional.found) return directional;

    return { found: false, value: null, visibility: null };
  }

  function findDirectionalRelationship(data, sourceId, targetId) {
    var sources = [data.relationships, data.factionRelationships, data.diplomacy];
    for (var sourceIndex = 0; sourceIndex < sources.length; sourceIndex += 1) {
      var source = sources[sourceIndex];
      if (Array.isArray(source)) {
        for (var relationIndex = 0; relationIndex < source.length; relationIndex += 1) {
          var candidate = source[relationIndex];
          if (relationshipMatches(candidate, sourceId, targetId)) {
            return {
              found: true,
              value: unwrapRelationshipValue(candidate),
              visibility: candidate && candidate.visibility
            };
          }
        }
      } else if (source && typeof source === 'object') {
        var bySource = source[String(sourceId)];
        var byTarget = source[String(targetId)];
        var value = bySource && typeof bySource === 'object' && bySource[String(targetId)] !== undefined
          ? bySource[String(targetId)]
          : byTarget && typeof byTarget === 'object' && byTarget[String(sourceId)] !== undefined
            ? byTarget[String(sourceId)]
            : undefined;
        if (value !== undefined) {
          return {
            found: true,
            value: unwrapRelationshipValue(value),
            visibility: value && typeof value === 'object' ? value.visibility : null
          };
        }
      }
    }

    return { found: false, value: null, visibility: null };
  }

  function directionalRelationshipValue(value, direction) {
    var rendered = displayRelationship(value);
    var hateMatch = /^HATE\s+(.+)$/i.exec(rendered);
    if (hateMatch) return direction === 'HATE OF US'
      ? direction + ' ' + hateMatch[1]
      : direction + ' HATE ' + hateMatch[1];
    return direction + ' ' + rendered;
  }

  function relationshipMatches(relation, observerId, factionId) {
    if (!relation || typeof relation !== 'object') return false;
    var from = firstValue(relation, ['observerFactionId', 'observerId', 'fromFactionId', 'fromId', 'sourceFactionId']);
    var to = firstValue(relation, ['targetFactionId', 'targetId', 'toFactionId', 'toId', 'factionId']);
    return sameId(from, observerId) && sameId(to, factionId);
  }

  function unwrapRelationshipValue(value) {
    if (!value || typeof value !== 'object') return value;
    return firstValue(value, ['relationship', 'relation', 'status', 'attitude', 'stance', 'label', 'name', 'value']);
  }

  function displayRelationship(value) {
    if (value === null || value === undefined) return UNKNOWN_RELATIONSHIP;
    if (typeof value === 'number' && Number.isFinite(value)) return formatCount(value);
    return String(value);
  }

  function deriveActionsForTesting() {
    return null;
  }

  function notifySelection(target, context, faction) {
    var detail = {
      faction: faction,
      factionId: getFactionId(faction),
      observerId: context.observerId,
      snapshot: context.data,
      briefing: context.briefing
    };

    if (typeof target.onFactionIntelSelect === 'function') {
      target.onFactionIntelSelect(detail);
    }

    if (typeof target.dispatchEvent !== 'function') return;
    var documentRef = target.ownerDocument || global.document;
    var view = documentRef && documentRef.defaultView;
    var event = null;
    if (view && typeof view.CustomEvent === 'function') {
      event = new view.CustomEvent('faction-intel-select', { detail: detail, bubbles: true });
    } else if (documentRef && typeof documentRef.createEvent === 'function') {
      event = documentRef.createEvent('CustomEvent');
      event.initCustomEvent('faction-intel-select', true, false, detail);
    }
    if (event) target.dispatchEvent(event);
  }

  function chooseInitialKey(factions, observerId) {
    var observerIndex = factions.findIndex(function (faction) {
      return sameId(getFactionId(faction), observerId);
    });
    if (observerIndex >= 0) return getEntryKey(factions[observerIndex], observerIndex);
    return factions.length ? getEntryKey(factions[0], 0) : null;
  }

  function resolveObserverId(data, briefing, suppliedId) {
    if (suppliedId !== undefined && suppliedId !== null && suppliedId !== '') return suppliedId;
    if (data.observerFactionId !== undefined && data.observerFactionId !== null) return data.observerFactionId;
    if (briefing && briefing.observerFactionId !== undefined) return briefing.observerFactionId;
    if (briefing && briefing.observerId !== undefined) return briefing.observerId;
    return null;
  }

  function resolvePriorityKey(data, factions) {
    var priority = data.priorityTargetFaction;
    if (!priority) return null;
    var priorityId = typeof priority === 'object'
      ? firstValue(priority, ['id', 'ID', 'factionId'])
      : priority;
    if (priorityId !== undefined && priorityId !== null && priorityId !== '') {
      var byId = factions.findIndex(function (faction) { return sameId(getFactionId(faction), priorityId); });
      if (byId >= 0) return getEntryKey(factions[byId], byId);
    }
    var priorityName = typeof priority === 'object' ? firstValue(priority, ['name', 'displayName', 'factionName']) : priority;
    if (priorityName) {
      var byName = factions.findIndex(function (faction) { return getFactionName(faction) === String(priorityName); });
      if (byName >= 0) return getEntryKey(factions[byName], byName);
    }
    return null;
  }

  function getMode(data) {
    var raw = data.mode || data.intelMode || data.visibility;
    if (data.isOmniscient === true || String(raw || '').toLowerCase() === 'omniscient') return 'OMNISCIENT';
    if (String(raw || '').toLowerCase() === 'enhanced') return 'ENHANCED';
    if (String(raw || '').toLowerCase() === 'player' || String(raw || '').toLowerCase() === 'player intel') return 'PLAYER INTEL';
    return raw ? normalizeVisibility(raw) : 'UNKNOWN VIEW';
  }

  function getFactionId(faction) {
    if (!faction || typeof faction !== 'object') return null;
    var field = readField(faction, ['ID', 'id', 'factionId']);
    return field.found ? field.value : null;
  }

  function getFactionName(faction) {
    if (!faction || typeof faction !== 'object') return UNKNOWN_RELATIONSHIP;
    var field = readField(faction, ['displayName', 'name', 'factionName', 'templateName']);
    return field.found && hasMetricValue(field.value) ? String(field.value) : UNKNOWN_RELATIONSHIP;
  }

  function findFaction(factions, id) {
    return factions.find(function (faction) { return sameId(getFactionId(faction), id); }) || null;
  }

  function getEntryKey(faction, index) {
    var id = getFactionId(faction);
    return id === null || id === undefined || id === '' ? 'index-' + index : String(id);
  }

  function firstActiveProject(faction) {
    var projects = faction && Array.isArray(faction.currentProjects) ? faction.currentProjects : [];
    var project = projects.find(function (candidate) {
      var percent = firstValue(candidate, ['percent', 'progress']);
      return percent === undefined || Number(percent) < 100;
    });
    if (!project) return null;
    var name = firstValue(project, ['displayName', 'name', 'projectId', 'id']);
    var progress = firstValue(project, ['percent', 'progress']);
    return {
      name: name ? String(name) : 'the listed project',
      progress: progress === undefined || progress === null ? 'progress unknown' : String(progress) + '%'
    };
  }

  function visibilityForMetric(context, faction, metricName, hasData) {
    var keys = {
      earth: ['earthVisibility', 'terrestrialVisibility', 'politicalVisibility'],
      space: ['spaceVisibility'],
      research: ['researchVisibility', 'technologyVisibility'],
      power: ['powerVisibility']
    }[metricName] || [];
    var explicit = readField(faction, keys);
    // Distinguish "field absent or empty" (fall back to data inference) from
    // "field explicitly set, including to an UNAVAILABLE / UNKNOWN sentinel"
    // (respect the caller's declaration). Using hasMetricValue here collapses
    // both into the same branch because UNAVAILABLE / UNKNOWN are themselves
    // missing labels for numeric purposes; that meant an explicit
    // earthVisibility: 'UNAVAILABLE' fell through to VISIBLE on a faction that
    // had data — the defect this guard is rewritten to avoid.
    if (explicit.found && !isExplicitlyEmpty(explicit.value)) return normalizeVisibility(explicit.value);
    if (!hasData) return 'UNAVAILABLE';
    if (context.mode === 'OMNISCIENT') return 'RAW SAVE ONLY';
    if (context.mode === 'ENHANCED') return 'ENHANCED';
    return 'VISIBLE';
  }
  function isExplicitlyEmpty(value) {
    if (value === null || value === undefined) return true;
    if (typeof value === 'string') return value.trim() === '';
    return false;
  }

  function normalizeVisibility(value) {
    if (isExplicitlyEmpty(value)) return 'UNAVAILABLE';
    var raw = String(value).trim();
    var lower = raw.toLowerCase().replace(/[-\s]+/g, '_');
    var labels = {
      raw_save_only: 'RAW SAVE ONLY',
      raw_save: 'RAW SAVE ONLY',
      unavailable: 'UNAVAILABLE',
      unknown: 'UNKNOWN',
      partial: 'PARTIAL',
      estimated: 'ESTIMATED',
      confirmed: 'CONFIRMED',
      visible: 'VISIBLE',
      available: 'AVAILABLE',
      enhanced: 'ENHANCED',
      'snapshot_flag': 'SNAPSHOT FLAG'
    };
    return labels[lower] || raw.toUpperCase();
  }

  function metricValue(value, formatter, suffix) {
    if (!hasMetricValue(value)) return UNKNOWN_VALUE;
    var result = formatter ? formatter(value) : String(value);
    if (suffix && result !== UNKNOWN_VALUE) result += ' ' + suffix;
    return result;
  }

  function metricText(value) {
    return hasMetricValue(value) ? String(value) : UNKNOWN_VALUE;
  }

  function metricScore(value) {
    return hasMetricValue(value) ? formatCount(value) + ' / 100' : UNKNOWN_VALUE;
  }

  function formatPower(faction) {
    var value = getPowerValue(faction);
    return value === null ? UNKNOWN_VALUE : formatCount(value) + '/100';
  }

  function formatCount(value) {
    if (!hasMetricValue(value)) return UNKNOWN_VALUE;
    var number = Number(value);
    if (!Number.isFinite(number)) return String(value);
    return number.toLocaleString(undefined, { maximumFractionDigits: 1 });
  }

  function formatGdp(value) {
    if (!hasMetricValue(value)) return UNKNOWN_VALUE;
    var number = Number(value);
    if (!Number.isFinite(number)) return String(value);
    return '$' + (number / 1000000000000).toLocaleString(undefined, { maximumFractionDigits: 1 }) + 'T';
  }

  function formatPopulation(value) {
    if (!hasMetricValue(value)) return UNKNOWN_VALUE;
    var number = Number(value);
    if (!Number.isFinite(number)) return String(value);
    return number.toLocaleString(undefined, { maximumFractionDigits: 1 });
  }

  function formatResearch(value) {
    if (!hasMetricValue(value)) return UNKNOWN_VALUE;
    var number = Number(value);
    if (!Number.isFinite(number)) return String(value);
    return number.toLocaleString(undefined, { maximumFractionDigits: 1 }) + ' / cycle';
  }

  function formatHate(value) {
    if (typeof value === 'number' && Number.isFinite(value)) return value.toFixed(2);
    return String(value);
  }

  function isPowerEstimate(faction) {
    return Boolean(faction && faction.powerScore && typeof faction.powerScore === 'object' && faction.powerScore.isEstimate === true);
  }

  function applyAccent(node, color) {
    if (!node || typeof color !== 'string') return;
    if (/^#[0-9a-f]{3,8}$/i.test(color)) {
      node.style.backgroundColor = color;
      node.style.setProperty('--faction-intel-accent', color);
    }
  }

  function readField(source, keys) {
    if (!source || typeof source !== 'object') return { found: false, value: null };
    for (var index = 0; index < keys.length; index += 1) {
      var key = keys[index];
      if (Object.prototype.hasOwnProperty.call(source, key) && source[key] !== undefined) {
        return { found: true, value: source[key] };
      }
    }
    return { found: false, value: null };
  }

  function firstValue(source, keys) {
    var field = readField(source, keys);
    return field.found ? field.value : undefined;
  }

  function hasMetricValue(value) {
    if (value === null || value === undefined) return false;
    if (typeof value === 'number') return Number.isFinite(value);
    if (typeof value === 'string') return !MISSING_VALUES[value.trim().toUpperCase()];
    return true;
  }

  function isMissingLabel(value) {
    return !hasMetricValue(value);
  }

  function sameId(left, right) {
    if (left === null || left === undefined || left === '' || right === null || right === undefined || right === '') return false;
    return String(left) === String(right);
  }

  global.FactionIntelScreen = {
    render: render
  };
})(typeof window !== 'undefined' ? window : globalThis);
