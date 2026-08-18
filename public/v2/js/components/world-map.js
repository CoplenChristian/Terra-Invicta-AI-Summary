(function exposeWorldTheaterMap(global) {
  'use strict';

  var SVG_NS = 'http://www.w3.org/2000/svg';
  var instanceCount = 0;

  var COLORS = {
    canvas: 'var(--canvas, #081011)',
    surface: 'var(--surface, #101b1d)',
    surfaceRaised: 'var(--surface-raised, #142224)',
    surfaceInset: 'var(--surface-inset, #0b1517)',
    line: 'var(--line, #263837)',
    lineStrong: 'var(--line-strong, #3b504d)',
    text: 'var(--text, #e6eeea)',
    textSoft: 'var(--text-soft, #b7c5bf)',
    textMuted: 'var(--text-muted, #91a29b)',
    textDim: 'var(--text-dim, #6a7d75)',
    accent: 'var(--accent, #69c5b8)',
    accentStrong: 'var(--accent-strong, #a3e0d4)',
    success: 'var(--success, #91bd9b)',
    warning: 'var(--warning, #d4a35e)',
    danger: 'var(--danger, #d47d76)'
  };

  // These are deliberately schematic operational zones rather than surveyed borders.
  // They provide recognizable continental anchors while leaving geographic precision
  // to the supplied theater records.
  var THEATER_BLUEPRINTS = [
    {
      key: 'nam',
      aliases: ['nam', 'north america', 'north american'],
      shortLabel: 'NORTH AMERICA',
      labelX: 91,
      labelY: 103,
      markerX: 124,
      markerY: 111,
      path: 'M 48 86 C 69 61 101 50 132 54 C 156 56 181 68 198 83 L 211 100 L 196 115 L 178 116 L 167 135 L 148 146 L 129 138 L 110 148 L 94 134 L 75 130 L 65 112 L 47 101 Z M 154 133 L 171 144 L 180 160 L 169 176 L 160 157 L 148 148 Z'
    },
    {
      key: 'sam',
      aliases: ['sam', 'south america', 'south american'],
      shortLabel: 'SOUTH AMERICA',
      labelX: 183,
      labelY: 237,
      markerX: 207,
      markerY: 249,
      path: 'M 183 176 C 205 177 226 187 235 204 C 243 220 237 237 229 254 C 222 274 215 295 198 315 L 184 303 C 184 284 176 267 181 251 L 187 229 L 178 211 L 184 194 Z'
    },
    {
      key: 'eur',
      aliases: ['eur', 'europe', 'europe mediterranean', 'europe and mediterranean'],
      shortLabel: 'EUROPE / MED',
      labelX: 290,
      labelY: 91,
      markerX: 337,
      markerY: 91,
      path: 'M 279 80 L 294 68 L 315 69 L 327 60 L 349 66 L 367 60 L 382 70 L 400 70 L 414 84 L 402 96 L 384 94 L 374 104 L 355 99 L 342 108 L 324 102 L 307 107 L 293 99 L 278 100 L 271 89 Z M 301 112 L 319 113 L 335 122 L 348 126 L 343 138 L 322 136 L 308 130 Z'
    },
    {
      key: 'mea',
      aliases: ['mea', 'eurasia middle east', 'eurasia and middle east', 'middle east', 'eurasia'],
      shortLabel: 'EURASIA / M.E.',
      labelX: 375,
      labelY: 120,
      markerX: 430,
      markerY: 117,
      path: 'M 365 66 L 389 57 L 415 62 L 444 57 L 477 61 L 508 63 L 537 73 L 563 82 L 589 91 L 615 104 L 623 121 L 609 135 L 585 130 L 566 137 L 548 131 L 526 140 L 504 135 L 486 146 L 466 140 L 449 151 L 431 143 L 414 149 L 399 137 L 378 136 L 365 125 L 349 115 L 357 101 L 371 94 Z M 409 145 L 432 149 L 457 161 L 476 166 L 485 181 L 469 189 L 446 180 L 426 170 L 407 159 Z'
    },
    {
      key: 'afr',
      aliases: ['afr', 'africa', 'african continent', 'african'],
      shortLabel: 'AFRICA',
      labelX: 319,
      labelY: 218,
      markerX: 363,
      markerY: 226,
      path: 'M 314 146 C 334 137 365 143 383 156 L 408 171 L 426 191 L 426 215 L 415 236 L 411 260 L 400 283 L 382 306 L 360 323 L 342 308 L 330 287 L 317 265 L 311 242 L 300 220 L 302 197 L 292 181 Z'
    },
    {
      key: 'eap',
      aliases: ['eap', 'east asia pacific', 'east asia and pacific', 'east asia', 'pacific'],
      shortLabel: 'EAST ASIA / PACIFIC',
      labelX: 502,
      labelY: 111,
      markerX: 566,
      markerY: 122,
      path: 'M 492 88 L 519 81 L 543 85 L 562 96 L 583 99 L 597 111 L 612 119 L 625 136 L 638 145 L 632 159 L 616 163 L 601 155 L 588 163 L 571 155 L 556 160 L 540 151 L 522 156 L 505 146 L 492 136 L 479 123 L 485 106 Z M 510 175 C 535 166 558 176 570 191 L 566 211 L 552 218 L 535 205 L 520 190 Z M 551 247 C 578 231 622 238 657 255 C 669 270 657 287 639 298 C 616 308 581 306 555 294 C 541 283 541 263 551 247 Z'
    }
  ];

  var BASE_LANDMASSES = [
    {
      name: 'north-america',
      path: 'M 48 86 C 69 61 101 50 132 54 C 156 56 181 68 198 83 L 211 100 L 196 115 L 178 116 L 167 135 L 148 146 L 129 138 L 110 148 L 94 134 L 75 130 L 65 112 L 47 101 Z M 154 133 L 171 144 L 180 160 L 169 176 L 160 157 L 148 148 Z'
    },
    {
      name: 'south-america',
      path: 'M 183 176 C 205 177 226 187 235 204 C 243 220 237 237 229 254 C 222 274 215 295 198 315 L 184 303 C 184 284 176 267 181 251 L 187 229 L 178 211 L 184 194 Z'
    },
    {
      name: 'europe',
      path: 'M 279 80 L 294 68 L 315 69 L 327 60 L 349 66 L 367 60 L 382 70 L 400 70 L 414 84 L 402 96 L 384 94 L 374 104 L 355 99 L 342 108 L 324 102 L 307 107 L 293 99 L 278 100 L 271 89 Z M 301 112 L 319 113 L 335 122 L 348 126 L 343 138 L 322 136 L 308 130 Z'
    },
    {
      name: 'asia',
      path: 'M 350 70 L 375 56 L 405 51 L 442 55 L 477 58 L 514 64 L 548 77 L 582 89 L 615 105 L 633 126 L 640 148 L 625 165 L 601 157 L 579 166 L 551 158 L 526 165 L 499 151 L 471 158 L 445 148 L 421 157 L 397 142 L 369 139 L 349 119 L 339 97 Z'
    },
    {
      name: 'africa',
      path: 'M 314 146 C 334 137 365 143 383 156 L 408 171 L 426 191 L 426 215 L 415 236 L 411 260 L 400 283 L 382 306 L 360 323 L 342 308 L 330 287 L 317 265 L 311 242 L 300 220 L 302 197 L 292 181 Z'
    },
    {
      name: 'australia',
      path: 'M 551 247 C 578 231 622 238 657 255 C 669 270 657 287 639 298 C 616 308 581 306 555 294 C 541 283 541 263 551 247 Z'
    },
    {
      name: 'greenland',
      path: 'M 223 42 L 247 34 L 269 43 L 275 58 L 260 69 L 239 64 L 225 54 Z'
    }
  ];

  function createElement(doc, tagName, className) {
    var node = doc.createElement(tagName);
    if (className) node.className = className;
    return node;
  }

  function createSvgElement(doc, tagName, className) {
    var node = doc.createElementNS(SVG_NS, tagName);
    if (className) node.setAttribute('class', className);
    return node;
  }

  function setAttributes(node, attributes) {
    Object.keys(attributes).forEach(function setAttribute(key) {
      var value = attributes[key];
      if (value !== undefined && value !== null) {
        node.setAttribute(key, String(value));
      }
    });
    return node;
  }

  function appendText(doc, parent, className, value, attributes) {
    var node = createSvgElement(doc, 'text', className);
    setAttributes(node, attributes || {});
    node.textContent = String(value);
    parent.appendChild(node);
    return node;
  }

  function readFirst(record, keys) {
    if (!record || typeof record !== 'object') return undefined;

    for (var index = 0; index < keys.length; index += 1) {
      var value = record[keys[index]];
      if (value !== undefined && value !== null && value !== '') return value;
    }

    return undefined;
  }

  function readCount(record, keys) {
    var value = readFirst(record, keys);
    if (typeof value === 'number' && isFinite(value)) {
      return Math.max(0, Math.round(value));
    }

    if (typeof value === 'string' && value.trim() !== '') {
      var parsed = Number(value);
      if (isFinite(parsed)) return Math.max(0, Math.round(parsed));
    }

    return null;
  }

  function normalize(value) {
    return String(value || '')
      .toLowerCase()
      .replace(/&/g, ' and ')
      .replace(/[^a-z0-9]+/g, ' ')
      .trim()
      .replace(/\s+/g, ' ');
  }

  function recordName(record, blueprint) {
    var name = readFirst(record, ['name', 'displayName', 'label', 'title']);
    return name === undefined ? blueprint.shortLabel : String(name);
  }

  function recordId(record, fallback) {
    var id = readFirst(record, ['id', 'ID', 'key', 'slug']);
    return id === undefined ? fallback : String(id);
  }

  function matchesBlueprint(record, blueprint) {
    if (!record) return false;

    var id = normalize(readFirst(record, ['id', 'ID', 'key', 'slug']));
    var name = normalize(readFirst(record, ['name', 'displayName', 'label', 'title']));

    return blueprint.aliases.some(function hasAlias(alias) {
      var normalizedAlias = normalize(alias);
      return id === normalizedAlias || name === normalizedAlias || name.indexOf(normalizedAlias) !== -1;
    });
  }

  function statusLabel(statusValue, hostileCount, ownCount, hasRecord) {
    if (!hasRecord) return 'NO DATA';
    if (statusValue !== undefined) {
      var status = String(statusValue).split('(')[0].trim();
      if (status) return status.toUpperCase();
    }
    if (hostileCount > 0) return 'CONTESTED';
    if (ownCount > 0) return 'SECURED';
    return 'STABLE';
  }

  function statusKey(statusValue, hostileCount, ownCount, hasRecord) {
    if (!hasRecord) return 'neutral';

    var status = normalize(statusValue);
    if (hostileCount > 0 || /hostile|contest|critical|red/.test(status)) return 'hostile';
    if (ownCount > 0 || /secure|friendly|own|initiative/.test(status)) return 'own';
    if (/watch|alert|elevat|unstable|warn/.test(status)) return 'watch';
    return 'stable';
  }

  function paletteFor(key) {
    if (key === 'hostile') return { stroke: COLORS.danger, fill: COLORS.danger };
    if (key === 'own') return { stroke: COLORS.success, fill: COLORS.success };
    if (key === 'watch') return { stroke: COLORS.warning, fill: COLORS.warning };
    if (key === 'neutral') return { stroke: COLORS.lineStrong, fill: COLORS.lineStrong };
    return { stroke: COLORS.accent, fill: COLORS.accent };
  }

  function shortVisualLabel(name, blueprint) {
    var value = String(name || '').trim();
    if (!value || value.length > 19) return blueprint.shortLabel;
    return value.toUpperCase();
  }

  function countLabel(value) {
    return value === null ? '—' : String(value);
  }

  function buildPairings(records) {
    var pairings = THEATER_BLUEPRINTS.map(function emptyPairing() { return null; });
    var used = {};

    THEATER_BLUEPRINTS.forEach(function findNamedRecord(blueprint, blueprintIndex) {
      for (var recordIndex = 0; recordIndex < records.length; recordIndex += 1) {
        if (!used[recordIndex] && matchesBlueprint(records[recordIndex], blueprint)) {
          pairings[blueprintIndex] = records[recordIndex];
          used[recordIndex] = true;
          break;
        }
      }
    });

    THEATER_BLUEPRINTS.forEach(function fillUnmatched(blueprint, blueprintIndex) {
      if (pairings[blueprintIndex] !== null) return;

      for (var recordIndex = 0; recordIndex < records.length; recordIndex += 1) {
        if (!used[recordIndex]) {
          pairings[blueprintIndex] = records[recordIndex];
          used[recordIndex] = true;
          break;
        }
      }
    });

    return pairings;
  }

  function clearContainer(container) {
    while (container.firstChild) container.removeChild(container.firstChild);
  }

  function resolveContainer(container) {
    if (typeof container === 'string') {
      return global.document.querySelector(container);
    }
    return container;
  }

  function render(container, theaters, options) {
    var target = resolveContainer(container);
    if (!target || typeof target.appendChild !== 'function') {
      throw new TypeError('WorldTheaterMap.render requires a DOM container.');
    }

    var settings = options && typeof options === 'object' ? options : {};
    var source = Array.isArray(theaters)
      ? theaters
      : (theaters && Array.isArray(theaters.items) ? theaters.items : []);
    var records = source.slice(0, THEATER_BLUEPRINTS.length);
    var pairings = buildPairings(records);
    var doc = target.ownerDocument || global.document;
    var mapId = 'world-map-' + (++instanceCount);
    var titleId = mapId + '-title';
    var descriptionId = mapId + '-description';
    var selectedId = settings.selectedId !== undefined
      ? String(settings.selectedId)
      : (settings.selectedTheaterId !== undefined ? String(settings.selectedTheaterId) : null);
    var selectedRecord = settings.selectedTheater && typeof settings.selectedTheater === 'object'
      ? settings.selectedTheater
      : null;
    var onSelect = typeof settings.onSelect === 'function' ? settings.onSelect : null;
    var views = [];

    clearContainer(target);

    var root = createElement(doc, 'div', 'world-map');
    root.setAttribute('data-world-map-instance', mapId);
    root.setAttribute('role', 'group');
    root.setAttribute('aria-label', settings.ariaLabel || 'Global theater status map');
    root.style.cssText = [
      'display:block',
      'width:100%',
      'overflow:hidden',
      'border:1px solid ' + COLORS.line,
      'background:' + COLORS.surfaceInset,
      'color:' + COLORS.text,
      'font-family:var(--sans, system-ui, sans-serif)'
    ].join(';');

    var svg = createSvgElement(doc, 'svg', 'world-map-svg');
    setAttributes(svg, {
      viewBox: '0 0 720 360',
      width: '720',
      height: '360',
      role: 'group',
      'aria-labelledby': titleId + ' ' + descriptionId,
      preserveAspectRatio: 'xMidYMid meet'
    });
    svg.style.cssText = 'display:block;width:100%;height:auto;';

    var title = createSvgElement(doc, 'title', 'world-map-title');
    title.setAttribute('id', titleId);
    title.textContent = settings.title || 'Global theater status';
    svg.appendChild(title);

    var description = createSvgElement(doc, 'desc', 'world-map-description');
    description.setAttribute('id', descriptionId);
    description.textContent = 'Six schematic geographic theater regions. Select a region to inspect its supplied theater record.';
    svg.appendChild(description);

    setAttributes(createSvgElement(doc, 'rect', 'world-map-ocean'), {
      x: 0,
      y: 0,
      width: 720,
      height: 360,
      fill: COLORS.surfaceInset
    });

    appendText(doc, svg, 'world-map-heading', settings.title || 'GLOBAL THEATER STATUS', {
      x: 24,
      y: 24,
      fill: COLORS.textSoft,
      'font-family': 'var(--sans, system-ui, sans-serif)',
      'font-size': 10,
      'font-weight': 700,
      'letter-spacing': 2
    });

    appendText(doc, svg, 'world-map-heading-meta', 'SIX OPERATIONAL REGIONS / SELECT TO INSPECT', {
      x: 696,
      y: 24,
      fill: COLORS.textDim,
      'font-family': 'var(--mono, monospace)',
      'font-size': 8,
      'text-anchor': 'end',
      'letter-spacing': 1
    });

    var mapRule = createSvgElement(doc, 'path', 'world-map-rule');
    setAttributes(mapRule, {
      d: 'M 24 34 H 696',
      fill: 'none',
      stroke: COLORS.line,
      'stroke-width': 1,
      'vector-effect': 'non-scaling-stroke'
    });
    svg.appendChild(mapRule);

    var route = createSvgElement(doc, 'path', 'world-map-route');
    setAttributes(route, {
      d: 'M 35 179 C 178 143 518 143 685 179',
      fill: 'none',
      stroke: COLORS.line,
      'stroke-width': 1,
      'stroke-dasharray': '2 10',
      opacity: 0.7,
      'vector-effect': 'non-scaling-stroke',
      'pointer-events': 'none'
    });
    svg.appendChild(route);

    BASE_LANDMASSES.forEach(function drawLandmass(landmass) {
      var land = createSvgElement(doc, 'path', 'world-map-landmass');
      setAttributes(land, {
        d: landmass.path,
        fill: COLORS.surfaceRaised,
        stroke: COLORS.lineStrong,
        'stroke-width': 1,
        'vector-effect': 'non-scaling-stroke',
        'aria-hidden': 'true'
      });
      land.setAttribute('data-landmass', landmass.name);
      svg.appendChild(land);
    });

    var polarMarker = createSvgElement(doc, 'path', 'world-map-polar-marker');
    setAttributes(polarMarker, {
      d: 'M 25 56 H 43 M 34 47 V 65',
      fill: 'none',
      stroke: COLORS.textDim,
      'stroke-width': 1,
      opacity: 0.55,
      'vector-effect': 'non-scaling-stroke',
      'pointer-events': 'none'
    });
    svg.appendChild(polarMarker);

    function applyViewState(view) {
      var palette = paletteFor(view.statusKey);
      var isSelected = view.selected;
      var isHovered = view.hovered;
      setAttributes(view.shape, {
        fill: palette.fill,
        'fill-opacity': isSelected ? 0.34 : (isHovered ? 0.24 : 0.14),
        stroke: palette.stroke,
        'stroke-width': isSelected ? 2 : (isHovered ? 1.6 : 1),
        'stroke-linejoin': 'round'
      });
      view.group.setAttribute('aria-pressed', isSelected ? 'true' : 'false');
      view.focusRing.setAttribute('stroke', palette.stroke);
      view.focusRing.setAttribute('display', view.focused ? 'inline' : 'none');
      view.marker.setAttribute('fill', palette.stroke);
      view.markerHalo.setAttribute('stroke', palette.stroke);
      view.markerHalo.setAttribute('opacity', isSelected || isHovered ? '0.8' : '0.45');
      view.statusText.setAttribute('fill', palette.stroke);
    }

    function selectView(view) {
      if (!view.record) return;

      views.forEach(function clearSelection(otherView) {
        otherView.selected = otherView === view;
        applyViewState(otherView);
      });

      if (onSelect) onSelect(view.record);
    }

    THEATER_BLUEPRINTS.forEach(function drawTheater(blueprint, blueprintIndex) {
      var record = pairings[blueprintIndex];
      var name = recordName(record, blueprint);
      var hostileCount = readCount(record, ['hostileCount', 'hostile', 'hostiles', 'hostileNations']);
      var ownCount = readCount(record, ['ownCount', 'own', 'ownedCount', 'securedCount', 'friendlyCount']);
      var statusValue = readFirst(record, ['statusTone', 'status', 'currentStatus', 'state']);
      var hasRecord = !!record;
      var visualStatus = statusLabel(statusValue, hostileCount || 0, ownCount || 0, hasRecord);
      var stateKey = statusKey(statusValue, hostileCount || 0, ownCount || 0, hasRecord);
      var theaterId = recordId(record, blueprint.key);
      var ariaLabel = name + '. Current status ' + visualStatus + '. Hostile count ' + countLabel(hostileCount) + '; own count ' + countLabel(ownCount) + '. Activate to select this theater.';
      var group = createSvgElement(doc, 'g', 'world-map-region');
      var shape = createSvgElement(doc, 'path', 'world-map-region-shape');
      var focusRing = createSvgElement(doc, 'path', 'world-map-focus-ring');
      var markerHalo = createSvgElement(doc, 'circle', 'world-map-region-marker-halo');
      var marker = createSvgElement(doc, 'circle', 'world-map-region-marker');
      var titleNode = createSvgElement(doc, 'title', 'world-map-region-title');
      var label = createSvgElement(doc, 'text', 'world-map-region-label');
      var statusText = createSvgElement(doc, 'text', 'world-map-region-status');
      var countText = createSvgElement(doc, 'text', 'world-map-region-counts');

      setAttributes(group, {
        role: 'button',
        tabindex: 0,
        focusable: 'true',
        'aria-label': ariaLabel,
        'aria-pressed': 'false',
        'data-theater-id': theaterId
      });
      group.style.cursor = record ? 'pointer' : 'default';

      setAttributes(shape, {
        d: blueprint.path,
        'pointer-events': 'all',
        'vector-effect': 'non-scaling-stroke'
      });
      setAttributes(focusRing, {
        d: blueprint.path,
        fill: 'none',
        'stroke-width': 2.5,
        'stroke-dasharray': '4 3',
        'vector-effect': 'non-scaling-stroke',
        'pointer-events': 'none',
        display: 'none'
      });
      setAttributes(markerHalo, {
        cx: blueprint.markerX,
        cy: blueprint.markerY,
        r: 7,
        fill: 'none',
        'stroke-width': 1,
        'vector-effect': 'non-scaling-stroke',
        'pointer-events': 'none'
      });
      setAttributes(marker, {
        cx: blueprint.markerX,
        cy: blueprint.markerY,
        r: 2.5,
        'pointer-events': 'none'
      });

      titleNode.textContent = ariaLabel;
      setAttributes(label, {
        x: blueprint.labelX,
        y: blueprint.labelY,
        fill: COLORS.text,
        'font-family': 'var(--sans, system-ui, sans-serif)',
        'font-size': 9,
        'font-weight': 700,
        'letter-spacing': 0.6,
        'pointer-events': 'none'
      });
      label.textContent = shortVisualLabel(name, blueprint);

      setAttributes(statusText, {
        x: blueprint.labelX,
        y: blueprint.labelY + 12,
        'font-family': 'var(--mono, monospace)',
        'font-size': 7.5,
        'font-weight': 700,
        'letter-spacing': 0.55,
        'pointer-events': 'none'
      });
      statusText.textContent = visualStatus;

      setAttributes(countText, {
        x: blueprint.labelX,
        y: blueprint.labelY + 23,
        fill: COLORS.textMuted,
        'font-family': 'var(--mono, monospace)',
        'font-size': 7.5,
        'letter-spacing': 0.35,
        'pointer-events': 'none'
      });
      countText.textContent = 'H ' + countLabel(hostileCount) + '  /  OWN ' + countLabel(ownCount);

      group.appendChild(titleNode);
      group.appendChild(shape);
      group.appendChild(focusRing);
      group.appendChild(markerHalo);
      group.appendChild(marker);
      group.appendChild(label);
      group.appendChild(statusText);
      group.appendChild(countText);
      svg.appendChild(group);

      var view = {
        group: group,
        shape: shape,
        focusRing: focusRing,
        markerHalo: markerHalo,
        marker: marker,
        statusText: statusText,
        record: record,
        statusKey: stateKey,
        selected: (selectedId !== null && selectedId === theaterId) || record === selectedRecord,
        hovered: false,
        focused: false
      };
      views.push(view);

      group.addEventListener('click', function onRegionClick() {
        selectView(view);
      });
      group.addEventListener('keydown', function onRegionKeydown(event) {
        if (event.key === 'Enter' || event.key === ' ') {
          event.preventDefault();
          selectView(view);
        }
      });
      group.addEventListener('mouseenter', function onRegionEnter() {
        view.hovered = true;
        applyViewState(view);
      });
      group.addEventListener('mouseleave', function onRegionLeave() {
        view.hovered = false;
        applyViewState(view);
      });
      group.addEventListener('focus', function onRegionFocus() {
        view.focused = true;
        applyViewState(view);
      });
      group.addEventListener('blur', function onRegionBlur() {
        view.focused = false;
        applyViewState(view);
      });

      applyViewState(view);
    });

    var footerRule = createSvgElement(doc, 'path', 'world-map-footer-rule');
    setAttributes(footerRule, {
      d: 'M 24 310 H 696',
      fill: 'none',
      stroke: COLORS.line,
      'stroke-width': 1,
      'vector-effect': 'non-scaling-stroke'
    });
    svg.appendChild(footerRule);

    var legend = createSvgElement(doc, 'g', 'world-map-legend');
    setAttributes(legend, { 'aria-label': 'Map status legend' });
    var legendItems = [
      { label: 'STABLE', key: 'stable', x: 28 },
      { label: 'OWN HOLDINGS', key: 'own', x: 123 },
      { label: 'HOSTILE', key: 'hostile', x: 263 },
      { label: 'WATCH', key: 'watch', x: 361 }
    ];
    legendItems.forEach(function drawLegendItem(item) {
      var palette = paletteFor(item.key);
      var dot = createSvgElement(doc, 'circle', 'world-map-legend-dot');
      setAttributes(dot, {
        cx: item.x,
        cy: 332,
        r: 3,
        fill: palette.stroke,
        'aria-hidden': 'true'
      });
      legend.appendChild(dot);
      appendText(doc, legend, 'world-map-legend-label', item.label, {
        x: item.x + 9,
        y: 335,
        fill: COLORS.textDim,
        'font-family': 'var(--mono, monospace)',
        'font-size': 7.5,
        'letter-spacing': 0.55
      });
    });
    svg.appendChild(legend);

    var totalHostile = 0;
    var totalOwn = 0;
    views.forEach(function sumCounts(view) {
      totalHostile += view.record ? (readCount(view.record, ['hostileCount', 'hostile', 'hostiles', 'hostileNations']) || 0) : 0;
      totalOwn += view.record ? (readCount(view.record, ['ownCount', 'own', 'ownedCount', 'securedCount', 'friendlyCount']) || 0) : 0;
    });

    appendText(doc, svg, 'world-map-summary', 'CURRENT  /  HOSTILE ' + totalHostile + '  ·  OWN ' + totalOwn, {
      x: 696,
      y: 335,
      fill: COLORS.textSoft,
      'font-family': 'var(--mono, monospace)',
      'font-size': 8,
      'font-weight': 700,
      'text-anchor': 'end',
      'letter-spacing': 0.6
    });

    root.appendChild(svg);
    target.appendChild(root);
    return root;
  }

  global.WorldTheaterMap = {
    render: render
  };
}(window));
