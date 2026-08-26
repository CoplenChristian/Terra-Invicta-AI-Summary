/**
 * src/v2/panels/WorldMap.jsx
 *
 * Purpose: renders the interactive world/space theater map surface — six
 * clickable operational theaters drawn over real country geometry.
 *
 * ---------------------------------------------------------------------------
 * THE TYPE LADDER IS NOT THE PAGE TYPE SCALE
 * ---------------------------------------------------------------------------
 * `TYPE` lives in worldMapUtils.js and its two values are SVG **user units**.
 * The <svg> is `viewBox="0 0 720 360"` at `width: 100%`, so 8 units renders near
 * 7px in a 640px card and near 10px in a 900px one. Converting these to the
 * page's `--fs-*` tokens would assert an equivalence that holds at exactly one
 * container width. `tests/typeScale.test.js` exempts SVG user units for this
 * reason and `--fs-map-name` / `--fs-map-note` in 01-tokens-and-base.css exist so
 * the three CSS-driven labels agree with the inline ones.
 *
 * ---------------------------------------------------------------------------
 * WHAT THIS PORT CHANGED, AND WHY
 * ---------------------------------------------------------------------------
 * 1. **`aria-pressed="true"` on all six theaters with no data.** The vanilla
 *    initial-selection test was `record === selectedRecord`, and BOTH are `null`
 *    when no record paired to a slot and no `selectedTheater` was supplied — so
 *    `null === null` marked every region pressed. Measured on the empty payload:
 *    `nam=true sam=true eur=true mea=true afr=true eap=true`. An absent reading
 *    was announcing itself to a screen reader as a positive selection. The
 *    identity match now requires a record. Nothing else about selection moved.
 * 2. **The 6-slot cap is announced.** `resolveRecords` returns `totalCount` and
 *    `omittedCount` and the root carries them as data attributes. The vanilla
 *    dropped a seventh record with no count, no note and no warning. No visible
 *    text changed — a caller can now see the cap fired.
 * 3. **Element ids come from `useId()`.** They only feed `aria-labelledby`, so
 *    the format moved from `world-map-1-title` to a React-generated id. Nothing
 *    asserts on the old format.
 * 4. **The never-appended `<rect class="world-map-ocean">` is gone.** The vanilla
 *    built it and dropped it on the floor; the ocean colour comes from the root's
 *    inline background. Rendering it now would be a new pixel, not a port.
 *
 * Everything else — the substring alias pairing hazard, the missing `Togo`, the
 * `name.length > 19` short-label swap, the status truncation at the first `(` —
 * is carried across unchanged and is documented in worldMapUtils.js.
 */

import React from 'react';
import {
  COLORS,
  GRATICULE_PATHS,
  LEGEND_ITEMS,
  TYPE,
  buildCountryPaths,
  buildTheaterViews,
  paletteFor,
  resolveRecords,
  summariseCounts,
  valueState,
} from './worldMapUtils.js';

const DEFAULT_GEOJSON_URL = '/v2/data/world.geojson';

/**
 * One in-flight promise per URL, shared by every instance — the vanilla panel's
 * `geographyCache`, unchanged. A rejection is cached too, exactly as before: the
 * bundled asset either ships or it does not, and re-requesting a 252KB file on
 * every remount is not the behaviour that was there.
 */
const geographyCache = {};

export function loadGeography(url) {
  const key = String(url || DEFAULT_GEOJSON_URL);
  if (!geographyCache[key]) {
    geographyCache[key] = fetch(key).then((response) => {
      if (!response.ok) throw new Error(`World geometry request failed: ${response.status}`);
      return response.json();
    });
  }
  return geographyCache[key];
}

/** Test seam — the browser harness renders one page per payload, so this is only
 *  reached when a suite deliberately re-exercises the fetch. */
export function resetGeographyCache() {
  Object.keys(geographyCache).forEach((key) => { delete geographyCache[key]; });
}

function CountryPath({ entry, fill, fillOpacity, stroke, strokeWidth }) {
  return (
    <path
      className={`world-map-country${entry.assigned ? '' : ' world-map-country--unassigned'}`}
      d={entry.d}
      data-country={entry.country}
      aria-hidden={entry.assigned ? 'false' : 'true'}
      fill={fill}
      fillOpacity={fillOpacity}
      stroke={stroke}
      strokeWidth={strokeWidth}
    >
      <title className="world-map-country-title">{entry.title}</title>
    </path>
  );
}

function TheaterRegion({ view, countries, selected, hovered, focused, onSelect, onHoverChange, onFocusChange }) {
  const palette = paletteFor(view.statusKey);
  const active = selected || hovered || focused;
  const opacity = selected ? 0.85 : (hovered || focused ? 0.68 : 0.5);
  const strokeWidth = selected ? 1.45 : (hovered || focused ? 1.1 : 0.7);
  const interactive = !!view.record;

  return (
    <g
      className="world-map-region"
      role="button"
      tabIndex={interactive ? 0 : -1}
      focusable="true"
      aria-label={view.ariaLabel}
      aria-pressed={selected ? 'true' : 'false'}
      data-theater-id={view.theaterId}
      style={{ cursor: interactive ? 'pointer' : 'default' }}
      onClick={onSelect}
      onKeyDown={(event) => {
        if (event.key === 'Enter' || event.key === ' ') {
          event.preventDefault();
          onSelect();
        }
      }}
      onMouseEnter={() => onHoverChange(true)}
      onMouseLeave={() => onHoverChange(false)}
      onFocus={() => onFocusChange(true)}
      onBlur={() => onFocusChange(false)}
    >
      <title className="world-map-region-title">{view.ariaLabel}</title>
      <circle
        className="world-map-region-marker-halo"
        cx={view.theater.markerX}
        cy={view.theater.markerY}
        r={active ? 9 : 7}
        fill="none"
        stroke={palette.stroke}
        strokeWidth={1}
        opacity={active ? 1 : 0.6}
        vectorEffect="non-scaling-stroke"
        pointerEvents="none"
      />
      <circle
        className="world-map-region-marker"
        cx={view.theater.markerX}
        cy={view.theater.markerY}
        r={2.5}
        fill={palette.stroke}
        pointerEvents="none"
      />
      <text
        className="world-map-region-label"
        x={view.theater.labelX}
        y={view.theater.labelY}
        fill={COLORS.text}
        fontFamily="var(--sans,system-ui,sans-serif)"
        fontSize={TYPE.name}
        fontWeight={800}
        letterSpacing={0.6}
        pointerEvents="none"
        textAnchor="middle"
      >
        {view.labelText}
      </text>
      <text
        className="world-map-region-status"
        x={view.theater.labelX}
        y={view.theater.labelY + 13}
        fill={palette.stroke}
        fontFamily="var(--mono,monospace)"
        fontSize={TYPE.note}
        fontWeight={800}
        letterSpacing={0.55}
        pointerEvents="none"
        textAnchor="middle"
        data-status-key={view.statusKey}
      >
        {view.statusLabel}
      </text>
      <text
        className="world-map-region-counts"
        x={view.theater.labelX}
        y={view.theater.labelY + 25}
        fill={COLORS.textSoft}
        fontFamily="var(--mono,monospace)"
        fontSize={TYPE.note}
        letterSpacing={0.35}
        pointerEvents="none"
        textAnchor="middle"
        data-hostile-state={valueState(view.hostileCount)}
        data-own-state={valueState(view.ownCount)}
      >
        {view.countsText}
      </text>
      {countries.map((entry, index) => (
        <CountryPath
          key={`${entry.country}-${index}`}
          entry={entry}
          fill={palette.fill}
          fillOpacity={opacity}
          stroke={palette.stroke}
          strokeWidth={strokeWidth}
        />
      ))}
    </g>
  );
}

/**
 * @param {object} props
 * @param {Array|{items: Array}|null|undefined} props.theaters
 * @param {object} [props.options] — `selectedId`, `selectedTheater`, `onSelect`,
 *   `ariaLabel`, `title`, `geoJsonUrl`. The only call site also passes
 *   `observerName`; the vanilla panel never read it and neither does this one.
 */
export function WorldMap({ theaters, options }) {
  const settings = options && typeof options === 'object' ? options : {};
  const reactId = React.useId();
  const mapId = `world-map-${String(reactId).replace(/[^a-zA-Z0-9_-]/g, '')}`;
  const titleId = `${mapId}-title`;
  const descriptionId = `${mapId}-description`;

  const geoJsonUrl = settings.geoJsonUrl || DEFAULT_GEOJSON_URL;
  const [geography, setGeography] = React.useState(null);
  const [error, setError] = React.useState(null);

  React.useEffect(() => {
    let cancelled = false;
    setGeography(null);
    setError(null);
    loadGeography(geoJsonUrl).then(
      (data) => { if (!cancelled) setGeography(data); },
      (reason) => { if (!cancelled) setError(reason instanceof Error ? reason : new Error(String(reason))); },
    );
    return () => { cancelled = true; };
  }, [geoJsonUrl]);

  // `null` means "no explicit selection yet" — the initial selection from
  // options is used until the reader picks a theater. It is NOT an index of 0.
  const [selectedIndex, setSelectedIndex] = React.useState(null);
  const [hoveredIndex, setHoveredIndex] = React.useState(null);
  const [focusedIndex, setFocusedIndex] = React.useState(null);

  const selectedId = settings.selectedId !== undefined ? String(settings.selectedId) : null;
  const selectedTheater = settings.selectedTheater && typeof settings.selectedTheater === 'object'
    ? settings.selectedTheater
    : null;
  const onSelect = typeof settings.onSelect === 'function' ? settings.onSelect : null;

  const { records, totalCount, omittedCount } = React.useMemo(
    () => resolveRecords(theaters),
    [theaters],
  );
  const views = React.useMemo(
    () => buildTheaterViews(records, { selectedId, selectedTheater }),
    [records, selectedId, selectedTheater],
  );
  const summary = React.useMemo(() => summariseCounts(views), [views]);
  const countryPaths = React.useMemo(() => buildCountryPaths(geography), [geography]);

  const mapState = error ? 'error' : (geography ? 'ready' : 'loading');
  const heading = settings.title || 'GLOBAL THEATER STATUS';
  const svgTitle = settings.title || 'Global theater status';

  const isSelected = (index) => (
    selectedIndex === null ? views[index].initiallySelected : selectedIndex === index
  );

  const selectView = (index) => {
    if (!views[index].record) return;
    setSelectedIndex(index);
    if (onSelect) onSelect(views[index].record);
  };

  return (
    <div
      className="world-map"
      data-world-map-instance={mapId}
      data-map-state={mapState}
      data-theater-total-count={totalCount}
      data-theater-omitted-count={omittedCount}
      role="group"
      aria-label={settings.ariaLabel || 'Global theater status map'}
      style={{
        display: 'block',
        width: '100%',
        overflow: 'hidden',
        border: `1px solid ${COLORS.line}`,
        background: COLORS.surfaceInset,
        color: COLORS.text,
        fontFamily: 'var(--sans,system-ui,sans-serif)',
      }}
    >
      <svg
        className="world-map-svg"
        viewBox="0 0 720 360"
        width="720"
        height="360"
        role="group"
        aria-labelledby={`${titleId} ${descriptionId}`}
        preserveAspectRatio="xMidYMid meet"
        style={{ display: 'block', width: '100%', height: 'auto' }}
      >
        <title className="world-map-title" id={titleId}>{svgTitle}</title>
        <desc className="world-map-description" id={descriptionId}>
          World map with country geometry grouped into six clickable operational theaters.
        </desc>

        <text
          className="world-map-heading"
          x={24}
          y={24}
          fill={COLORS.textSoft}
          fontFamily="var(--sans,system-ui,sans-serif)"
          fontSize={TYPE.name}
          fontWeight={700}
          letterSpacing={2}
        >
          {heading}
        </text>
        <text
          className="world-map-heading-meta"
          x={696}
          y={24}
          fill={COLORS.textSoft}
          fontFamily="var(--mono,monospace)"
          fontSize={TYPE.note}
          textAnchor="end"
          letterSpacing={1}
        >
          ACTUAL COUNTRY GEOMETRY / SELECT THEATER
        </text>
        <path
          className="world-map-rule"
          d="M 24 34 H 696"
          fill="none"
          stroke={COLORS.line}
          strokeWidth={1}
          vectorEffect="non-scaling-stroke"
        />

        {GRATICULE_PATHS.map((d) => (
          <path key={d} className="world-map-graticule" d={d} aria-hidden="true" />
        ))}

        {mapState !== 'ready' && (
          <text className="world-map-loading" x={360} y={178} textAnchor="middle">
            {mapState === 'error' ? 'WORLD GEOMETRY UNAVAILABLE' : 'LOADING BUNDLED WORLD GEOMETRY'}
          </text>
        )}

        {mapState === 'ready' && (
          <g className="world-map-country-layer">
            {countryPaths.unassigned.map((entry, index) => (
              <CountryPath key={`unassigned-${entry.country}-${index}`} entry={entry} />
            ))}
            {views.map((view, index) => (
              <TheaterRegion
                key={view.theater.key}
                view={view}
                countries={countryPaths.assigned[view.theater.key] || []}
                selected={isSelected(index)}
                hovered={hoveredIndex === index}
                focused={focusedIndex === index}
                onSelect={() => selectView(index)}
                onHoverChange={(next) => setHoveredIndex((current) => (next ? index : (current === index ? null : current)))}
                onFocusChange={(next) => setFocusedIndex((current) => (next ? index : (current === index ? null : current)))}
              />
            ))}
          </g>
        )}

        <path
          className="world-map-footer-rule"
          d="M 24 310 H 696"
          fill="none"
          stroke={COLORS.line}
          strokeWidth={1}
          vectorEffect="non-scaling-stroke"
        />

        <g className="world-map-legend" aria-label="Map status legend">
          {LEGEND_ITEMS.map((item) => (
            <React.Fragment key={item.key}>
              <circle
                className="world-map-legend-dot"
                cx={item.x}
                cy={332}
                r={3}
                fill={paletteFor(item.key).stroke}
                aria-hidden="true"
              />
              <text
                className="world-map-legend-label"
                x={item.x + 9}
                y={335}
                fill={COLORS.textSoft}
                fontFamily="var(--mono,monospace)"
                fontSize={TYPE.note}
                letterSpacing={0.55}
              >
                {item.label}
              </text>
            </React.Fragment>
          ))}
        </g>

        {mapState === 'ready' && (
          <>
            <text
              className="world-map-summary"
              x={696}
              y={335}
              fill={COLORS.textSoft}
              fontFamily="var(--mono,monospace)"
              fontSize={TYPE.note}
              fontWeight={700}
              textAnchor="end"
              letterSpacing={0.6}
              data-summary-state={summary.state}
              data-hostile-measured-count={summary.hostileMeasuredCount}
              data-own-measured-count={summary.ownMeasuredCount}
              data-theater-count={summary.totalTheaters}
            >
              {summary.text}
            </text>
            <text className="world-map-data-note" x={360} y={300} textAnchor="middle">
              COUNTRY GEOMETRY: BUNDLED GEOJSON
            </text>
          </>
        )}

        {mapState === 'error' && (
          <text className="world-map-error" x={360} y={194} textAnchor="middle">
            {error && error.message ? error.message : 'Check the bundled map asset.'}
          </text>
        )}
      </svg>
    </div>
  );
}
