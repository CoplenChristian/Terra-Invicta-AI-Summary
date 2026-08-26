/**
 * src/v2/panels/worldMapUtils.js
 *
 * Purpose: pure geometry, pairing and presence helpers for the WorldMap panel —
 * everything the SVG needs that is not JSX, so the honesty rules can be read and
 * tested without a DOM.
 *
 * ---------------------------------------------------------------------------
 * THE PRESENCE CONTRACT IS <Value>'s, NOT THIS FILE'S (defect #19, fixed)
 * ---------------------------------------------------------------------------
 * This file used to carry `countLabel` and `valueState` — `<Value>`'s rule
 * restated locally, because the primitive emitted a `<span>` and a `<span>`
 * inside an `<svg>` is created in the SVG namespace and does not render. Both
 * are gone. `<Value>` now takes `as`, so the panel emits
 * `<Value as="tspan">` inside its `<text>` nodes, and exports `resolveValue`
 * for the two places on this surface where no element can go at all: the
 * `aria-label` / `<title>` string and the composed summary sentence.
 *
 * So there is one implementation of "absent stays null" on this surface and it
 * is the shared one. What remains local is `readCount` — the *reading* half,
 * which decides whether a briefing record measured a count at all. That is a
 * payload-shape question (`hostileCount` vs `hostile` vs `hostiles`, and
 * `Number(undefined)` staying `NaN`), not a rendering one, and `<Value>` takes
 * presence as an explicit argument precisely so that decision stays with the
 * caller who can actually make it.
 */

import { ABSENT_LABEL, resolveValue } from '../components/Value.jsx';

/**
 * The map's own type ladder, in SVG user units -- NOT the page's --fs-* scale.
 * The <svg> is `viewBox="0 0 720 360"` at `width: 100%`, so a size here is
 * multiplied by (container width / 720) before it reaches a pixel: 8 units
 * renders near 7px in a 640px card and near 10px in a 900px one. Mapping these
 * onto page-pixel tokens would assert an equivalence that does not hold at any
 * width but 720.
 *
 * Two steps, matched by --fs-map-name and --fs-map-note in 01-tokens-and-base.css
 * so the CSS-driven labels agree.
 */
export const TYPE = {
  name: 10.5,
  note: 8,
};

export const COLORS = {
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
  danger: 'var(--danger, #d47d76)',
};

/**
 * The save's six operational theaters remain the interaction model. The
 * geometry is real country geometry; country membership only tints/selects a
 * theater and never replaces save-derived metrics.
 */
export const THEATERS = [
  { key: 'nam', aliases: ['nam', 'north america', 'north american'], shortLabel: 'NORTH AMERICA', labelX: 135, labelY: 105, markerX: 119, markerY: 113 },
  { key: 'sam', aliases: ['sam', 'south america', 'south american'], shortLabel: 'SOUTH AMERICA', labelX: 194, labelY: 225, markerX: 181, markerY: 234 },
  { key: 'eur', aliases: ['eur', 'europe', 'europe mediterranean', 'europe and mediterranean'], shortLabel: 'EUROPE / MED', labelX: 322, labelY: 94, markerX: 306, markerY: 102 },
  { key: 'mea', aliases: ['mea', 'eurasia middle east', 'eurasia and middle east', 'middle east', 'eurasia'], shortLabel: 'EURASIA / M.E.', labelX: 436, labelY: 132, markerX: 419, markerY: 141 },
  { key: 'afr', aliases: ['afr', 'africa', 'african continent', 'african'], shortLabel: 'AFRICA', labelX: 346, labelY: 215, markerX: 330, markerY: 225 },
  { key: 'eap', aliases: ['eap', 'east asia pacific', 'east asia and pacific', 'east asia', 'pacific'], shortLabel: 'EAST ASIA / PACIFIC', labelX: 565, labelY: 111, markerX: 548, markerY: 121 },
];

export const HOSTILE_KEYS = ['hostileCount', 'hostile', 'hostiles', 'hostileNations'];
export const OWN_KEYS = ['ownCount', 'own', 'ownedCount', 'securedCount', 'friendlyCount'];
export const STATUS_KEYS = ['statusTone', 'status', 'currentStatus', 'state'];
export const ID_KEYS = ['id', 'ID', 'key', 'slug'];
export const NAME_KEYS = ['name', 'displayName', 'label', 'title'];

export const LEGEND_ITEMS = [
  { label: 'STABLE', key: 'stable', x: 28 },
  { label: 'OWN HOLDINGS', key: 'own', x: 123 },
  { label: 'HOSTILE', key: 'hostile', x: 263 },
  { label: 'WATCH', key: 'watch', x: 361 },
];

export function normalize(value) {
  return String(value || '')
    .toLowerCase()
    .replace(/&/g, ' and ')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()
    .replace(/\s+/g, ' ');
}

function setOf(values) {
  const result = {};
  values.forEach((value) => { result[normalize(value)] = true; });
  return result;
}

/**
 * The bundled 177-feature map contains names rather than ISO codes. These sets
 * spell out the operational theater boundaries so they remain stable even when
 * the save does not contain country-level theater metadata.
 *
 * `Togo` is absent from `afr` — 175 of 177 features resolve to a theater; the two
 * that do not are Antarctica (intentional) and Togo (a known gap carried forward
 * unchanged so this migration changes no pixel).
 */
export const COUNTRY_THEATERS = {
  nam: setOf([
    'Canada', 'USA', 'Greenland', 'Mexico', 'Belize', 'Costa Rica', 'El Salvador',
    'Guatemala', 'Honduras', 'Nicaragua', 'Panama', 'Cuba', 'Dominican Republic',
    'Haiti', 'Jamaica', 'Puerto Rico', 'The Bahamas', 'Trinidad and Tobago',
  ]),
  sam: setOf([
    'Argentina', 'Bolivia', 'Brazil', 'Chile', 'Colombia', 'Ecuador',
    'Falkland Islands', 'Guyana', 'Paraguay', 'Peru', 'Suriname', 'Uruguay', 'Venezuela',
  ]),
  eur: setOf([
    'Albania', 'Austria', 'Belarus', 'Belgium', 'Bosnia and Herzegovina', 'Bulgaria',
    'Croatia', 'Cyprus', 'Czech Republic', 'Denmark', 'England', 'Estonia', 'Finland',
    'France', 'Germany', 'Greece', 'Hungary', 'Iceland', 'Ireland', 'Italy', 'Kosovo',
    'Latvia', 'Lithuania', 'Luxembourg', 'Macedonia', 'Malta', 'Moldova', 'Montenegro',
    'Netherlands', 'Northern Cyprus', 'Norway', 'Poland', 'Portugal', 'Republic of Serbia',
    'Romania', 'Slovakia', 'Slovenia', 'Spain', 'Sweden', 'Switzerland', 'Ukraine',
  ]),
  mea: setOf([
    'Afghanistan', 'Armenia', 'Azerbaijan', 'Bangladesh', 'Bhutan', 'Egypt', 'Georgia',
    'India', 'Iran', 'Iraq', 'Israel', 'Jordan', 'Kazakhstan', 'Kuwait', 'Kyrgyzstan',
    'Lebanon', 'Nepal', 'Oman', 'Pakistan', 'Qatar', 'Russia', 'Saudi Arabia', 'Sri Lanka',
    'Syria', 'Tajikistan', 'Turkey', 'Turkmenistan', 'United Arab Emirates', 'Uzbekistan',
    'West Bank', 'Yemen',
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
    'Uganda', 'Western Sahara', 'Zambia', 'Zimbabwe',
  ]),
  eap: setOf([
    'Australia', 'Brunei', 'Cambodia', 'China', 'East Timor', 'Fiji', 'Indonesia',
    'Japan', 'Laos', 'Malaysia', 'Mongolia', 'Myanmar', 'New Caledonia', 'New Zealand',
    'North Korea', 'Papua New Guinea', 'Philippines', 'Solomon Islands', 'South Korea',
    'Taiwan', 'Thailand', 'Vanuatu', 'Vietnam',
  ]),
};

/** The first key that is present — `undefined`, `null` and `''` are all absent. */
export function readFirst(record, keys) {
  if (!record || typeof record !== 'object') return undefined;
  for (let index = 0; index < keys.length; index += 1) {
    const value = record[keys[index]];
    if (value !== undefined && value !== null && value !== '') return value;
  }
  return undefined;
}

/**
 * A count, or `null` when it was not read.
 *
 * `Number(undefined)` is `NaN`, not finite, so absent stays absent. Nothing here
 * falls through to zero, and no caller may add a `?? 0` to it.
 */
export function readCount(record, keys) {
  const value = readFirst(record, keys);
  const parsed = Number(value);
  return value !== undefined && Number.isFinite(parsed) ? Math.max(0, Math.round(parsed)) : null;
}

/**
 * One count, resolved through the shared primitive.
 *
 * `readCount` returns a number or `null` and never `undefined`, so presence is
 * `!== null` and is passed to `<Value>` explicitly rather than inferred from
 * falsiness — a measured 0 is present.
 *
 * The returned object is what the view model carries: `.present` feeds
 * `<Value as="tspan">` in the SVG, `.text` feeds the aria-label and `<title>`
 * strings that can hold no element, and `.state` feeds the per-axis
 * `data-*-state` attributes on the emitting `<text>`.
 */
export function countFigure(value) {
  const present = value !== null && value !== undefined;
  return { present, ...resolveValue({ value, present }) };
}

export function recordName(record, theater) {
  return String(readFirst(record, NAME_KEYS) || theater.shortLabel);
}

export function recordId(record, fallback) {
  return String(readFirst(record, ID_KEYS) || fallback);
}

export function matchesTheater(record, theater) {
  if (!record) return false;
  const id = normalize(readFirst(record, ID_KEYS));
  const name = normalize(readFirst(record, NAME_KEYS));
  return theater.aliases.some((alias) => {
    const normalizedAlias = normalize(alias);
    return id === normalizedAlias || name === normalizedAlias || name.indexOf(normalizedAlias) !== -1;
  });
}

/**
 * Pairs each of the six geometry slots with at most one record.
 *
 * Carried across unchanged, substring alias test included. `eur`'s alias list
 * contains the bare string `'eur'`, and `normalize('Eurasia & Middle East')`
 * starts with it, so EUR would match the MEA record if the briefing ever emitted
 * `mea` first. That is a live ordering hazard documented in
 * docs/react-component-contracts-detail.md; it is NOT introduced here and is not
 * fixed here, because changing it would change which label sits over which
 * geometry and this migration must change nothing.
 */
export function pairTheaters(records) {
  const pairings = THEATERS.map(() => null);
  const used = {};
  THEATERS.forEach((theater, theaterIndex) => {
    records.forEach((record, recordIndex) => {
      if (!used[recordIndex] && pairings[theaterIndex] === null && matchesTheater(record, theater)) {
        pairings[theaterIndex] = record;
        used[recordIndex] = true;
      }
    });
  });
  THEATERS.forEach((theater, theaterIndex) => {
    if (pairings[theaterIndex] !== null) return;
    records.forEach((record, recordIndex) => {
      if (!used[recordIndex] && pairings[theaterIndex] === null) {
        pairings[theaterIndex] = record;
        used[recordIndex] = true;
      }
    });
  });
  return pairings;
}

/**
 * The status line.
 *
 * Every count comparison guards presence explicitly. An unmeasured pair reaches
 * `UNKNOWN`, never `STABLE` — a positive claim is only made from a reading that
 * was actually taken.
 */
export function statusLabel(statusValue, hostileCount, ownCount, hasRecord) {
  if (!hasRecord) return 'NO DATA';
  if (statusValue !== undefined && statusValue !== null && String(statusValue).trim() !== '') {
    const status = String(statusValue).split('(')[0].trim();
    if (status) return status.toUpperCase();
  }
  if (hostileCount !== null && hostileCount !== undefined && hostileCount > 0) return 'CONTESTED';
  if (ownCount !== null && ownCount !== undefined && ownCount > 0) return 'SECURED';
  if (hostileCount !== null && hostileCount !== undefined && ownCount !== null && ownCount !== undefined) return 'STABLE';
  return 'UNKNOWN';
}

export function statusKey(statusValue, hostileCount, ownCount, hasRecord) {
  if (!hasRecord) return 'neutral';
  const status = normalize(statusValue);
  if ((hostileCount !== null && hostileCount !== undefined && hostileCount > 0) || /hostile|contest|critical|red/.test(status)) return 'hostile';
  if ((ownCount !== null && ownCount !== undefined && ownCount > 0) || /secure|friendly|own|initiative/.test(status)) return 'own';
  if (/watch|alert|elevat|unstable|warn/.test(status)) return 'watch';
  if (hostileCount !== null && hostileCount !== undefined && ownCount !== null && ownCount !== undefined) return 'stable';
  if (status) return 'stable';
  return 'neutral';
}

export function paletteFor(key) {
  if (key === 'hostile') return { stroke: COLORS.danger, fill: COLORS.danger };
  if (key === 'own') return { stroke: COLORS.success, fill: COLORS.success };
  if (key === 'watch') return { stroke: COLORS.warning, fill: COLORS.warning };
  if (key === 'neutral') return { stroke: COLORS.lineStrong, fill: COLORS.lineStrong };
  return { stroke: COLORS.accent, fill: COLORS.accent };
}

export function theaterForCountry(name) {
  const normalizedName = normalize(name);
  for (let index = 0; index < THEATERS.length; index += 1) {
    const theater = THEATERS[index];
    if (COUNTRY_THEATERS[theater.key] && COUNTRY_THEATERS[theater.key][normalizedName]) return theater.key;
  }
  return null;
}

export function projectCoordinate(coordinate) {
  const longitude = Number(coordinate[0]);
  const latitude = Number(coordinate[1]);
  if (!Number.isFinite(longitude) || !Number.isFinite(latitude)) return null;
  return [24 + ((longitude + 180) / 360) * 672, 43 + ((90 - latitude) / 180) * 257];
}

export function ringPath(ring) {
  const commands = [];
  ring.forEach((coordinate, index) => {
    const projected = projectCoordinate(coordinate);
    if (!projected) return;
    commands.push(`${index === 0 ? 'M ' : 'L '}${projected[0].toFixed(2)} ${projected[1].toFixed(2)}`);
  });
  return commands.length ? `${commands.join(' ')} Z` : '';
}

export function geometryPath(geometry) {
  if (!geometry) return '';
  if (geometry.type === 'Polygon') return geometry.coordinates.map(ringPath).filter(Boolean).join(' ');
  if (geometry.type === 'MultiPolygon') {
    return geometry.coordinates
      .map((polygon) => polygon.map(ringPath).filter(Boolean).join(' '))
      .filter(Boolean)
      .join(' ');
  }
  return '';
}

function straightPath(from, to) {
  const start = projectCoordinate(from);
  const end = projectCoordinate(to);
  return `M ${start[0].toFixed(2)} ${start[1].toFixed(2)} L ${end[0].toFixed(2)} ${end[1].toFixed(2)}`;
}

/** The graticule, precomputed — it never depends on the payload. */
export const GRATICULE_PATHS = [
  ...[-120, -60, 0, 60, 120].map((longitude) => straightPath([longitude, 90], [longitude, -90])),
  ...[-60, -30, 0, 30, 60].map((latitude) => straightPath([-180, latitude], [180, latitude])),
];

/**
 * `theaters` accepts an array, an object carrying `.items`, or anything else
 * (which is no data at all rather than an error).
 *
 * The 6-slot cap is real and the counts come back with it so a caller can say so
 * — `totalCount` is what arrived, `omittedCount` is what the six slots could not
 * hold. The vanilla panel dropped the seventh record with no count at all.
 */
export function resolveRecords(theaters) {
  const source = Array.isArray(theaters)
    ? theaters
    : (theaters && Array.isArray(theaters.items) ? theaters.items : []);
  const records = source.slice(0, THEATERS.length);
  return {
    records,
    totalCount: source.length,
    omittedCount: Math.max(0, source.length - records.length),
  };
}

/**
 * The footer total.
 *
 * DEFECT #2 (docs/live-defect-register.md), fixed in a3f8487 and carried across
 * here deliberately rather than re-simplified: the per-theater line renders `—`
 * for an unmeasured count, so a footer that summed the same nulls through
 * `|| 0` put the right answer and the wrong answer on screen together — and the
 * reader who saw the dash was reassured by the total.
 *
 * A sum is only printed bare when EVERY theater was measured. Otherwise the line
 * says how many of the six it covers, and a wholly unread axis renders `—`.
 *
 * The two figures are resolved by `<Value>`'s own `resolveValue`, so the dash
 * here is the same dash the per-theater lines print. The SENTENCE is composed
 * locally because it is a sentence, not a value cell — `state` below is a
 * completeness verdict ('complete' | 'partial' | 'unmeasured'), a different
 * vocabulary from the primitive's presence state, and `data-summary-state`
 * carries it.
 */
export function summariseCounts(views) {
  const totalTheaters = THEATERS.length;
  let totalHostile = 0;
  let totalOwn = 0;
  let hostileMeasuredCount = 0;
  let ownMeasuredCount = 0;

  views.forEach((view) => {
    if (!view.record) return;
    if (view.hostileCount !== null) {
      totalHostile += view.hostileCount;
      hostileMeasuredCount += 1;
    }
    if (view.ownCount !== null) {
      totalOwn += view.ownCount;
      ownMeasuredCount += 1;
    }
  });

  // A sum of nothing is not a zero. `present` is the count of theaters that
  // contributed, never the total itself.
  const hostileFigure = resolveValue({ value: totalHostile, present: hostileMeasuredCount > 0 });
  const ownFigure = resolveValue({ value: totalOwn, present: ownMeasuredCount > 0 });

  let text;
  let state;
  if (hostileMeasuredCount === totalTheaters && ownMeasuredCount === totalTheaters) {
    state = 'complete';
    text = `CURRENT / HOSTILE ${hostileFigure.text} · OWN ${ownFigure.text}`;
  } else if (hostileMeasuredCount === 0 && ownMeasuredCount === 0) {
    state = 'unmeasured';
    text = `CURRENT / HOSTILE ${ABSENT_LABEL} · OWN ${ABSENT_LABEL} (0 OF ${totalTheaters} THEATERS MEASURED)`;
  } else if (hostileMeasuredCount === ownMeasuredCount) {
    state = 'partial';
    const unmeasured = totalTheaters - hostileMeasuredCount;
    text = `CURRENT / HOSTILE ${hostileFigure.text} · OWN ${ownFigure.text} (${hostileMeasuredCount} OF ${totalTheaters} THEATERS MEASURED, ${unmeasured} UNMEASURED)`;
  } else {
    state = 'partial';
    const hPart = hostileMeasuredCount === totalTheaters || hostileMeasuredCount === 0
      ? hostileFigure.text
      : `${hostileFigure.text} (${hostileMeasuredCount}/${totalTheaters})`;
    const oPart = ownMeasuredCount === totalTheaters || ownMeasuredCount === 0
      ? ownFigure.text
      : `${ownFigure.text} (${ownMeasuredCount}/${totalTheaters})`;
    text = `CURRENT / HOSTILE ${hPart} · OWN ${oPart}`;
  }

  return {
    text,
    state,
    totalHostile,
    totalOwn,
    hostileMeasuredCount,
    ownMeasuredCount,
    totalTheaters,
  };
}

/**
 * One view model per geometry slot. `record` is null when no record paired to
 * this slot, which is a different thing from a record whose counts are absent —
 * the first renders NO DATA, the second renders its status with `—` counts.
 */
export function buildTheaterViews(records, { selectedId = null, selectedTheater = null } = {}) {
  const pairings = pairTheaters(records);
  return THEATERS.map((theater, index) => {
    const record = pairings[index];
    const hostileCount = readCount(record, HOSTILE_KEYS);
    const ownCount = readCount(record, OWN_KEYS);
    const hostile = countFigure(hostileCount);
    const own = countFigure(ownCount);
    const statusValue = readFirst(record, STATUS_KEYS);
    const hasRecord = !!record;
    const label = statusLabel(statusValue, hostileCount, ownCount, hasRecord);
    const name = recordName(record, theater);
    const theaterId = recordId(record, theater.key);
    const ariaLabel = `${name}. Current status ${label}. Hostile count ${hostile.text}; own count ${own.text}. Activate to select this theater.`;
    return {
      theater,
      record,
      hostileCount,
      ownCount,
      hostile,
      own,
      statusLabel: label,
      statusKey: statusKey(statusValue, hostileCount, ownCount, hasRecord),
      name,
      theaterId,
      ariaLabel,
      labelText: name.length > 19 ? theater.shortLabel : name.toUpperCase(),
      initiallySelected: (selectedId !== null && selectedId === theaterId) || (record !== null && record === selectedTheater),
    };
  });
}

/**
 * The country paths, split into the ones a theater owns and the ones no theater
 * claims. A feature whose geometry yields no path is dropped entirely, exactly
 * as the vanilla panel dropped it.
 */
export function buildCountryPaths(geojson) {
  const assigned = {};
  const unassigned = [];
  THEATERS.forEach((theater) => { assigned[theater.key] = []; });

  ((geojson && geojson.features) || []).forEach((feature) => {
    const name = feature && feature.properties ? feature.properties.name : '';
    const pathData = geometryPath(feature && feature.geometry);
    if (!pathData) return;
    const theaterKey = theaterForCountry(name);
    const entry = {
      d: pathData,
      country: name || 'Unknown',
      title: name || 'Unassigned geography',
      assigned: !!theaterKey,
    };
    if (theaterKey) assigned[theaterKey].push(entry);
    else unassigned.push(entry);
  });

  return { assigned, unassigned };
}
