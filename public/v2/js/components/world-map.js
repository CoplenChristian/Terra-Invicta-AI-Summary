// public/v2/js/components/world-map.js
//
// Purpose: renders the interactive world/space theater map surface.
(function exposeWorldTheaterMap(global) {
  'use strict';

  var SVG_NS = 'http://www.w3.org/2000/svg';
  var instanceCount = 0;
  var geographyCache = {};

  var COLORS = {
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

  // The save's six operational theaters remain the interaction model. The
  // geometry is real country geometry; country membership only tints/selects
  // a theater and never replaces save-derived metrics.
  var THEATERS = [
    { key: 'nam', aliases: ['nam', 'north america', 'north american'], shortLabel: 'NORTH AMERICA', labelX: 135, labelY: 105, markerX: 119, markerY: 113 },
    { key: 'sam', aliases: ['sam', 'south america', 'south american'], shortLabel: 'SOUTH AMERICA', labelX: 194, labelY: 225, markerX: 181, markerY: 234 },
    { key: 'eur', aliases: ['eur', 'europe', 'europe mediterranean', 'europe and mediterranean'], shortLabel: 'EUROPE / MED', labelX: 322, labelY: 94, markerX: 306, markerY: 102 },
    { key: 'mea', aliases: ['mea', 'eurasia middle east', 'eurasia and middle east', 'middle east', 'eurasia'], shortLabel: 'EURASIA / M.E.', labelX: 436, labelY: 132, markerX: 419, markerY: 141 },
    { key: 'afr', aliases: ['afr', 'africa', 'african continent', 'african'], shortLabel: 'AFRICA', labelX: 346, labelY: 215, markerX: 330, markerY: 225 },
    { key: 'eap', aliases: ['eap', 'east asia pacific', 'east asia and pacific', 'east asia', 'pacific'], shortLabel: 'EAST ASIA / PACIFIC', labelX: 565, labelY: 111, markerX: 548, markerY: 121 }
  ];

  function normalize(value) {
    return String(value || '')
      .toLowerCase()
      .replace(/&/g, ' and ')
      .replace(/[^a-z0-9]+/g, ' ')
      .trim()
      .replace(/\s+/g, ' ');
  }

  function setOf(values) {
    var result = {};
    values.forEach(function addValue(value) { result[normalize(value)] = true; });
    return result;
  }

  // The bundled 177-feature map contains names rather than ISO codes. These
  // sets spell out the operational theater boundaries so they remain stable
  // even when the save does not contain country-level theater metadata.
  var COUNTRY_THEATERS = {
    nam: setOf([
      'Canada', 'USA', 'Greenland', 'Mexico', 'Belize', 'Costa Rica', 'El Salvador',
      'Guatemala', 'Honduras', 'Nicaragua', 'Panama', 'Cuba', 'Dominican Republic',
      'Haiti', 'Jamaica', 'Puerto Rico', 'The Bahamas', 'Trinidad and Tobago'
    ]),
    sam: setOf([
      'Argentina', 'Bolivia', 'Brazil', 'Chile', 'Colombia', 'Ecuador',
      'Falkland Islands', 'Guyana', 'Paraguay', 'Peru', 'Suriname', 'Uruguay', 'Venezuela'
    ]),
    eur: setOf([
      'Albania', 'Austria', 'Belarus', 'Belgium', 'Bosnia and Herzegovina', 'Bulgaria',
      'Croatia', 'Cyprus', 'Czech Republic', 'Denmark', 'England', 'Estonia', 'Finland',
      'France', 'Germany', 'Greece', 'Hungary', 'Iceland', 'Ireland', 'Italy', 'Kosovo',
      'Latvia', 'Lithuania', 'Luxembourg', 'Macedonia', 'Malta', 'Moldova', 'Montenegro',
      'Netherlands', 'Northern Cyprus', 'Norway', 'Poland', 'Portugal', 'Republic of Serbia',
      'Romania', 'Slovakia', 'Slovenia', 'Spain', 'Sweden', 'Switzerland', 'Ukraine'
    ]),
    mea: setOf([
      'Afghanistan', 'Armenia', 'Azerbaijan', 'Bangladesh', 'Bhutan', 'Egypt', 'Georgia',
      'India', 'Iran', 'Iraq', 'Israel', 'Jordan', 'Kazakhstan', 'Kuwait', 'Kyrgyzstan',
      'Lebanon', 'Nepal', 'Oman', 'Pakistan', 'Qatar', 'Russia', 'Saudi Arabia', 'Sri Lanka',
      'Syria', 'Tajikistan', 'Turkey', 'Turkmenistan', 'United Arab Emirates', 'Uzbekistan',
      'West Bank', 'Yemen'
    ]),
    afr: setOf([
      'Algeria', 'Angola', 'Benin', 'Botswana', 'Burkina Faso', 'Burundi', 'Cameroon',
      'Central African Republic', 'Chad', 'Democratic Republic of the Congo', 'Djibouti',
      'Equatorial Guinea', 'Eritrea', 'Ethiopia', 'French Southern and Antarctic Lands',
      'Gabon', 'Gambia', 'Ghana', 'Guinea', 'Guinea Bissau', 'Ivory Coast', 'Kenya',
      'Lesotho', 'Liberia', 'Libya', 'Madagascar', 'Malawi', 'Mali', 'Mauritania',
      'Morocco', 'Mozambique', 'Namibia', 'Niger', 'Nigeria', 'Republic of the Congo',
      'Rwanda', 'Senegal', 'Sierra Leone', 'Somalia', 'Somaliland', 'South Africa',
      'South Sudan', 'Sudan', 'Swaziland', 'United Republic of Tanzania', 'Tunisia',
      'Uganda', 'Western Sahara', 'Zambia', 'Zimbabwe'
    ]),
    eap: setOf([
      'Australia', 'Brunei', 'Cambodia', 'China', 'East Timor', 'Fiji', 'Indonesia',
      'Japan', 'Laos', 'Malaysia', 'Mongolia', 'Myanmar', 'New Caledonia', 'New Zealand',
      'North Korea', 'Papua New Guinea', 'Philippines', 'Solomon Islands', 'South Korea',
      'Taiwan', 'Thailand', 'Vanuatu', 'Vietnam'
    ])
  };

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
      if (value !== undefined && value !== null) node.setAttribute(key, String(value));
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
    var parsed = Number(value);
    return value !== undefined && Number.isFinite(parsed) ? Math.max(0, Math.round(parsed)) : null;
  }

  function countLabel(value) {
    return value === null || value === undefined ? '—' : String(value);
  }

  function recordName(record, theater) {
    return String(readFirst(record, ['name', 'displayName', 'label', 'title']) || theater.shortLabel);
  }

  function recordId(record, fallback) {
    return String(readFirst(record, ['id', 'ID', 'key', 'slug']) || fallback);
  }

  function matchesTheater(record, theater) {
    if (!record) return false;
    var id = normalize(readFirst(record, ['id', 'ID', 'key', 'slug']));
    var name = normalize(readFirst(record, ['name', 'displayName', 'label', 'title']));
    return theater.aliases.some(function hasAlias(alias) {
      var normalizedAlias = normalize(alias);
      return id === normalizedAlias || name === normalizedAlias || name.indexOf(normalizedAlias) !== -1;
    });
  }

  function pairTheaters(records) {
    var pairings = THEATERS.map(function blank() { return null; });
    var used = {};
    THEATERS.forEach(function findNamed(theater, theaterIndex) {
      records.forEach(function inspectRecord(record, recordIndex) {
        if (!used[recordIndex] && pairings[theaterIndex] === null && matchesTheater(record, theater)) {
          pairings[theaterIndex] = record;
          used[recordIndex] = true;
        }
      });
    });
    THEATERS.forEach(function fillUnmatched(theater, theaterIndex) {
      if (pairings[theaterIndex] !== null) return;
      records.forEach(function useNext(record, recordIndex) {
        if (!used[recordIndex] && pairings[theaterIndex] === null) {
          pairings[theaterIndex] = record;
          used[recordIndex] = true;
        }
      });
    });
    return pairings;
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

  function theaterForCountry(name) {
    var normalizedName = normalize(name);
    for (var index = 0; index < THEATERS.length; index += 1) {
      var theater = THEATERS[index];
      if (COUNTRY_THEATERS[theater.key] && COUNTRY_THEATERS[theater.key][normalizedName]) return theater.key;
    }
    return null;
  }

  function projectCoordinate(coordinate) {
    var longitude = Number(coordinate[0]);
    var latitude = Number(coordinate[1]);
    if (!Number.isFinite(longitude) || !Number.isFinite(latitude)) return null;
    return [24 + ((longitude + 180) / 360) * 672, 43 + ((90 - latitude) / 180) * 257];
  }

  function ringPath(ring) {
    var commands = [];
    ring.forEach(function mapCoordinate(coordinate, index) {
      var projected = projectCoordinate(coordinate);
      if (!projected) return;
      commands.push((index === 0 ? 'M ' : 'L ') + projected[0].toFixed(2) + ' ' + projected[1].toFixed(2));
    });
    return commands.length ? commands.join(' ') + ' Z' : '';
  }

  function geometryPath(geometry) {
    if (!geometry) return '';
    if (geometry.type === 'Polygon') return geometry.coordinates.map(ringPath).filter(Boolean).join(' ');
    if (geometry.type === 'MultiPolygon') {
      return geometry.coordinates.map(function polygonPath(polygon) {
        return polygon.map(ringPath).filter(Boolean).join(' ');
      }).filter(Boolean).join(' ');
    }
    return '';
  }

  function loadGeography(url) {
    var key = String(url || '/v2/data/world.geojson');
    if (!geographyCache[key]) {
      geographyCache[key] = global.fetch(key).then(function readResponse(response) {
        if (!response.ok) throw new Error('World geometry request failed: ' + response.status);
        return response.json();
      });
    }
    return geographyCache[key];
  }

  function clearContainer(container) {
    while (container.firstChild) container.removeChild(container.firstChild);
  }

  function resolveContainer(container) {
    return typeof container === 'string' ? global.document.querySelector(container) : container;
  }

  function drawGraticule(doc, svg) {
    [-120, -60, 0, 60, 120].forEach(function longitudeLine(longitude) {
      var start = projectCoordinate([longitude, 90]);
      var end = projectCoordinate([longitude, -90]);
      var line = createSvgElement(doc, 'path', 'world-map-graticule');
      setAttributes(line, { d: 'M ' + start[0].toFixed(2) + ' ' + start[1].toFixed(2) + ' L ' + end[0].toFixed(2) + ' ' + end[1].toFixed(2), 'aria-hidden': 'true' });
      svg.appendChild(line);
    });
    [-60, -30, 0, 30, 60].forEach(function latitudeLine(latitude) {
      var start = projectCoordinate([-180, latitude]);
      var end = projectCoordinate([180, latitude]);
      var line = createSvgElement(doc, 'path', 'world-map-graticule');
      setAttributes(line, { d: 'M ' + start[0].toFixed(2) + ' ' + start[1].toFixed(2) + ' L ' + end[0].toFixed(2) + ' ' + end[1].toFixed(2), 'aria-hidden': 'true' });
      svg.appendChild(line);
    });
  }

  function render(container, theaters, options) {
    var target = resolveContainer(container);
    if (!target || typeof target.appendChild !== 'function') throw new TypeError('WorldTheaterMap.render requires a DOM container.');

    var settings = options && typeof options === 'object' ? options : {};
    var source = Array.isArray(theaters) ? theaters : (theaters && Array.isArray(theaters.items) ? theaters.items : []);
    var records = source.slice(0, THEATERS.length);
    var pairings = pairTheaters(records);
    var doc = target.ownerDocument || global.document;
    var mapId = 'world-map-' + (++instanceCount);
    var titleId = mapId + '-title';
    var descriptionId = mapId + '-description';
    var selectedId = settings.selectedId !== undefined ? String(settings.selectedId) : null;
    var selectedRecord = settings.selectedTheater && typeof settings.selectedTheater === 'object' ? settings.selectedTheater : null;
    var onSelect = typeof settings.onSelect === 'function' ? settings.onSelect : null;

    clearContainer(target);
    var root = createElement(doc, 'div', 'world-map');
    root.setAttribute('data-world-map-instance', mapId);
    root.setAttribute('data-map-state', 'loading');
    root.setAttribute('role', 'group');
    root.setAttribute('aria-label', settings.ariaLabel || 'Global theater status map');
    root.style.cssText = 'display:block;width:100%;overflow:hidden;border:1px solid ' + COLORS.line + ';background:' + COLORS.surfaceInset + ';color:' + COLORS.text + ';font-family:var(--sans,system-ui,sans-serif)';

    var svg = createSvgElement(doc, 'svg', 'world-map-svg');
    setAttributes(svg, { viewBox: '0 0 720 360', width: '720', height: '360', role: 'group', 'aria-labelledby': titleId + ' ' + descriptionId, preserveAspectRatio: 'xMidYMid meet' });
    svg.style.cssText = 'display:block;width:100%;height:auto;';

    var title = createSvgElement(doc, 'title', 'world-map-title');
    title.setAttribute('id', titleId);
    title.textContent = settings.title || 'Global theater status';
    svg.appendChild(title);
    var description = createSvgElement(doc, 'desc', 'world-map-description');
    description.setAttribute('id', descriptionId);
    description.textContent = 'World map with country geometry grouped into six clickable operational theaters.';
    svg.appendChild(description);
    setAttributes(createSvgElement(doc, 'rect', 'world-map-ocean'), { x: 0, y: 0, width: 720, height: 360, fill: COLORS.surfaceInset });
    appendText(doc, svg, 'world-map-heading', settings.title || 'GLOBAL THEATER STATUS', { x: 24, y: 24, fill: COLORS.textSoft, 'font-family': 'var(--sans,system-ui,sans-serif)', 'font-size': 10, 'font-weight': 700, 'letter-spacing': 2 });
    appendText(doc, svg, 'world-map-heading-meta', 'ACTUAL COUNTRY GEOMETRY / SELECT THEATER', { x: 696, y: 24, fill: COLORS.textSoft, 'font-family': 'var(--mono,monospace)', 'font-size': 8.5, 'text-anchor': 'end', 'letter-spacing': 1 });
    var mapRule = createSvgElement(doc, 'path', 'world-map-rule');
    setAttributes(mapRule, { d: 'M 24 34 H 696', fill: 'none', stroke: COLORS.line, 'stroke-width': 1, 'vector-effect': 'non-scaling-stroke' });
    svg.appendChild(mapRule);
    drawGraticule(doc, svg);
    appendText(doc, svg, 'world-map-loading', 'LOADING BUNDLED WORLD GEOMETRY', { x: 360, y: 178, 'text-anchor': 'middle' });

    var footerRule = createSvgElement(doc, 'path', 'world-map-footer-rule');
    setAttributes(footerRule, { d: 'M 24 310 H 696', fill: 'none', stroke: COLORS.line, 'stroke-width': 1, 'vector-effect': 'non-scaling-stroke' });
    svg.appendChild(footerRule);

    var legend = createSvgElement(doc, 'g', 'world-map-legend');
    setAttributes(legend, { 'aria-label': 'Map status legend' });
    [
      { label: 'STABLE', key: 'stable', x: 28 },
      { label: 'OWN HOLDINGS', key: 'own', x: 123 },
      { label: 'HOSTILE', key: 'hostile', x: 263 },
      { label: 'WATCH', key: 'watch', x: 361 }
    ].forEach(function drawLegendItem(item) {
      var palette = paletteFor(item.key);
      var dot = createSvgElement(doc, 'circle', 'world-map-legend-dot');
      setAttributes(dot, { cx: item.x, cy: 332, r: 3, fill: palette.stroke, 'aria-hidden': 'true' });
      legend.appendChild(dot);
      appendText(doc, legend, 'world-map-legend-label', item.label, { x: item.x + 9, y: 335, fill: COLORS.textSoft, 'font-family': 'var(--mono,monospace)', 'font-size': 8, 'letter-spacing': 0.55 });
    });
    svg.appendChild(legend);
    root.appendChild(svg);
    target.appendChild(root);

    function renderError(error) {
      root.setAttribute('data-map-state', 'error');
      var loading = svg.querySelector('.world-map-loading');
      if (loading) loading.textContent = 'WORLD GEOMETRY UNAVAILABLE';
      appendText(doc, svg, 'world-map-error', error && error.message ? error.message : 'Check the bundled map asset.', { x: 360, y: 194, 'text-anchor': 'middle' });
    }

    function drawGeography(geojson) {
      root.setAttribute('data-map-state', 'ready');
      var loading = svg.querySelector('.world-map-loading');
      if (loading) loading.remove();
      var countryLayer = createSvgElement(doc, 'g', 'world-map-country-layer');
      var regionViews = {};
      var views = [];

      THEATERS.forEach(function createView(theater, theaterIndex) {
        var record = pairings[theaterIndex];
        var hostileCount = readCount(record, ['hostileCount', 'hostile', 'hostiles', 'hostileNations']);
        var ownCount = readCount(record, ['ownCount', 'own', 'ownedCount', 'securedCount', 'friendlyCount']);
        var statusValue = readFirst(record, ['statusTone', 'status', 'currentStatus', 'state']);
        var visualStatus = statusLabel(statusValue, hostileCount || 0, ownCount || 0, !!record);
        var view = {
          theater: theater,
          record: record,
          statusKey: statusKey(statusValue, hostileCount || 0, ownCount || 0, !!record),
          selected: (selectedId !== null && selectedId === recordId(record, theater.key)) || record === selectedRecord,
          hovered: false,
          countries: [],
          label: null,
          statusText: null,
          marker: null,
          markerHalo: null,
          group: createSvgElement(doc, 'g', 'world-map-region')
        };
        var name = recordName(record, theater);
        var theaterId = recordId(record, theater.key);
        var ariaLabel = name + '. Current status ' + visualStatus + '. Hostile count ' + countLabel(hostileCount) + '; own count ' + countLabel(ownCount) + '. Activate to select this theater.';
        setAttributes(view.group, { role: 'button', tabindex: record ? 0 : -1, focusable: 'true', 'aria-label': ariaLabel, 'aria-pressed': view.selected ? 'true' : 'false', 'data-theater-id': theaterId });
        view.group.style.cursor = record ? 'pointer' : 'default';
        var titleNode = createSvgElement(doc, 'title', 'world-map-region-title');
        titleNode.textContent = ariaLabel;
        view.group.appendChild(titleNode);
        var markerHalo = createSvgElement(doc, 'circle', 'world-map-region-marker-halo');
        setAttributes(markerHalo, { cx: theater.markerX, cy: theater.markerY, r: 7, fill: 'none', 'stroke-width': 1, 'vector-effect': 'non-scaling-stroke', 'pointer-events': 'none' });
        var marker = createSvgElement(doc, 'circle', 'world-map-region-marker');
        setAttributes(marker, { cx: theater.markerX, cy: theater.markerY, r: 2.5, 'pointer-events': 'none' });
        var label = createSvgElement(doc, 'text', 'world-map-region-label');
        setAttributes(label, { x: theater.labelX, y: theater.labelY, fill: COLORS.text, 'font-family': 'var(--sans,system-ui,sans-serif)', 'font-size': 10.5, 'font-weight': 800, 'letter-spacing': 0.6, 'pointer-events': 'none', 'text-anchor': 'middle' });
        label.textContent = name.length > 19 ? theater.shortLabel : name.toUpperCase();
        var statusText = createSvgElement(doc, 'text', 'world-map-region-status');
        setAttributes(statusText, { x: theater.labelX, y: theater.labelY + 13, 'font-family': 'var(--mono,monospace)', 'font-size': 8.5, 'font-weight': 800, 'letter-spacing': 0.55, 'pointer-events': 'none', 'text-anchor': 'middle' });
        statusText.textContent = visualStatus;
        var countText = createSvgElement(doc, 'text', 'world-map-region-counts');
        setAttributes(countText, { x: theater.labelX, y: theater.labelY + 25, fill: COLORS.textSoft, 'font-family': 'var(--mono,monospace)', 'font-size': 8.25, 'letter-spacing': 0.35, 'pointer-events': 'none', 'text-anchor': 'middle' });
        countText.textContent = 'H ' + countLabel(hostileCount) + ' / OWN ' + countLabel(ownCount);
        view.group.appendChild(markerHalo);
        view.group.appendChild(marker);
        view.group.appendChild(label);
        view.group.appendChild(statusText);
        view.group.appendChild(countText);
        view.label = label;
        view.statusText = statusText;
        view.marker = marker;
        view.markerHalo = markerHalo;
        regionViews[theater.key] = view;
        views.push(view);
      });

      (geojson.features || []).forEach(function drawCountry(feature) {
        var name = feature && feature.properties ? feature.properties.name : '';
        var pathData = geometryPath(feature && feature.geometry);
        if (!pathData) return;
        var theaterKey = theaterForCountry(name);
        var view = theaterKey ? regionViews[theaterKey] : null;
        var country = createSvgElement(doc, 'path', 'world-map-country' + (view ? '' : ' world-map-country--unassigned'));
        setAttributes(country, { d: pathData, 'data-country': name || 'Unknown', 'aria-hidden': view ? 'false' : 'true' });
        var titleNode = createSvgElement(doc, 'title', 'world-map-country-title');
        titleNode.textContent = name || 'Unassigned geography';
        country.appendChild(titleNode);
        (view ? view.group : countryLayer).appendChild(country);
        if (view) view.countries.push(country);
      });

      views.forEach(function appendView(view) { countryLayer.appendChild(view.group); });
      svg.insertBefore(countryLayer, footerRule);

      function applyViewState(view) {
        var palette = paletteFor(view.statusKey);
        var opacity = view.selected ? 0.85 : (view.hovered || view.focused ? 0.68 : 0.5);
        view.countries.forEach(function colorCountry(country) {
          setAttributes(country, { fill: palette.fill, 'fill-opacity': opacity, stroke: palette.stroke, 'stroke-width': view.selected ? 1.45 : (view.hovered || view.focused ? 1.1 : 0.7) });
        });
        view.group.setAttribute('aria-pressed', view.selected ? 'true' : 'false');
        view.marker.setAttribute('fill', palette.stroke);
        view.markerHalo.setAttribute('stroke', palette.stroke);
        view.markerHalo.setAttribute('opacity', view.selected || view.hovered || view.focused ? '1' : '0.6');
        view.markerHalo.setAttribute('r', view.selected || view.hovered || view.focused ? '9' : '7');
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

      views.forEach(function bindView(view) {
        view.group.addEventListener('click', function onRegionClick() { selectView(view); });
        view.group.addEventListener('keydown', function onRegionKeydown(event) {
          if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); selectView(view); }
        });
        view.group.addEventListener('mouseenter', function onRegionEnter() { view.hovered = true; applyViewState(view); });
        view.group.addEventListener('mouseleave', function onRegionLeave() { view.hovered = false; applyViewState(view); });
        view.group.addEventListener('focus', function onRegionFocus() { view.focused = true; applyViewState(view); });
        view.group.addEventListener('blur', function onRegionBlur() { view.focused = false; applyViewState(view); });
        applyViewState(view);
      });

      var totalHostile = 0;
      var totalOwn = 0;
      views.forEach(function sumCounts(view) {
        totalHostile += view.record ? (readCount(view.record, ['hostileCount', 'hostile', 'hostiles', 'hostileNations']) || 0) : 0;
        totalOwn += view.record ? (readCount(view.record, ['ownCount', 'own', 'ownedCount', 'securedCount', 'friendlyCount']) || 0) : 0;
      });
      appendText(doc, svg, 'world-map-summary', 'CURRENT / HOSTILE ' + totalHostile + ' · OWN ' + totalOwn, { x: 696, y: 335, fill: COLORS.textSoft, 'font-family': 'var(--mono,monospace)', 'font-size': 8, 'font-weight': 700, 'text-anchor': 'end', 'letter-spacing': 0.6 });
      appendText(doc, svg, 'world-map-data-note', 'COUNTRY GEOMETRY: BUNDLED GEOJSON', { x: 360, y: 300, 'text-anchor': 'middle' });
    }

    loadGeography(settings.geoJsonUrl || '/v2/data/world.geojson').then(drawGeography).catch(renderError);
    return root;
  }

  global.WorldTheaterMap = { render: render };
}(window));
