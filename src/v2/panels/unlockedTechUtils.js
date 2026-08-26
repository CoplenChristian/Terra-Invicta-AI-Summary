/**
 * src/v2/panels/unlockedTechUtils.js
 *
 * Purpose: the pure reads behind the UNLOCKED TECHNOLOGY panel — census,
 * scope, sort, and the four label formatters — kept out of the JSX so the null
 * discipline is one small readable surface rather than something buried in a
 * render tree.
 */

/**
 * Rendering every match would put hundreds of rows in the DOM. The cap is
 * announced in the footer with both totals, never silently applied.
 */
export const RENDER_CAP = 60;

/** Per-row item chips. The count printed beside the row stays the TRUE total. */
export const UNLOCK_CAP = 6;

export const DEBOUNCE_MS = 220;

export function isUnlocked(project) {
  return Boolean(project) && project.status === 'completed';
}

/**
 * Absent stays absent. A project whose cost the graph does not carry is
 * reported as unavailable, never as 0 — `Number(null) === 0` and
 * `Number('') === 0` are the most repeated bug class in this repo.
 *
 * A cost that really IS zero is a measurement and must survive: the guard is on
 * presence, before coercion, and never on truthiness.
 */
export function costLabel(project) {
  const cost = project ? project.researchCost : null;
  if (cost === null || cost === undefined || cost === '') return null;
  const numeric = Number(cost);
  if (!Number.isFinite(numeric)) return null;
  return `${numeric.toLocaleString('en-US')} pts`;
}

/** A status the graph does not carry is UNKNOWN, not assumed locked. */
export function statusLabel(project) {
  const status = project && typeof project.status === 'string' ? project.status : null;
  if (!status) return 'UNKNOWN';
  return status.toUpperCase();
}

/** The class suffix the stylesheet colours the chip by. */
export function statusModifier(project) {
  return String((project && project.status) || 'unknown');
}

/** "MilitaryScience" -> "MILITARY SCIENCE". Absent stays null so the chip drops. */
export function categoryLabel(project) {
  const category = project && typeof project.category === 'string' ? project.category.trim() : '';
  if (!category) return null;
  return category.replace(/([a-z])([A-Z])/g, '$1 $2').toUpperCase();
}

export function normalise(value) {
  return String(value || '').toLowerCase().replace(/[^a-z0-9]/gi, '');
}

/**
 * Did this row surface because of an unlocked item rather than its own name?
 *
 * Only the DISPLAY name counts as self-explanatory. Testing the internal id too
 * was wrong and silently killed the panel's headline case: the id
 * `Project_CopperheadMissileBay` contains "Copperhead", so a search for
 * Copperhead was treated as a name match and the explanatory chip suppressed —
 * leaving a row titled "Hydrolox High Explosive Missiles" with nothing saying
 * why it was there, which is precisely the confusion this exists to resolve.
 * The id is rendered, but in small mono beneath the title; the item chip is what
 * makes the match legible.
 *
 * Returns the matching unlock OBJECTS, which the caller marks by reference. The
 * vanilla panel built a `Set` of `unlock.id` instead; an unlock carrying no id
 * put `undefined` in that set, and `has(undefined)` then marked every other
 * id-less chip as matched. Real payloads always carry `targetId`, so this
 * changes nothing that is rendered today — it removes the unresolvable-identity
 * key rather than waiting for a payload that trips it.
 */
export function matchingUnlocks(project, query) {
  const q = normalise(query);
  if (!q) return [];
  const unlocks = Array.isArray(project && project.unlocks) ? project.unlocks : [];
  if (normalise(project && project.displayName).includes(q)) return [];
  return unlocks.filter((u) => normalise(u && u.displayName).includes(q));
}

export function sortByName(rows) {
  return rows.slice().sort((a, b) => String(a.displayName || a.id || '')
    .localeCompare(String(b.displayName || b.id || ''), 'en'));
}

export function applyScope(rows, scope) {
  return scope === 'unlocked' ? rows.filter(isUnlocked) : rows;
}

/**
 * Read the project census out of a tech-tree response.
 *
 * Absent stays null. The research graph is a static parse of the game templates
 * — the same projects for every faction, verified against the live save
 * 2026-08-21 — so a response carrying no faction_project nodes is a census that
 * could not be read, not a faction with nothing to research. `nodes` missing and
 * `nodes` empty are the same unreadable state, and both used to land on 0, which
 * the footer then printed as the confident and false "0 unlocked of 0 projects".
 */
export function readCensus(payload) {
  const nodes = Array.isArray(payload && payload.nodes) ? payload.nodes : null;
  const projects = nodes === null ? [] : nodes.filter((node) => node && node.type === 'faction_project');
  const censusRead = projects.length > 0;
  return {
    projects,
    totalProjects: censusRead ? projects.length : null,
    unlockedCount: censusRead ? projects.filter(isUnlocked).length : null,
  };
}

/**
 * The footer's census sentence, or null when it cannot be stated.
 *
 * Null is the signal the caller routes through `<Value present={false}>`; it is
 * never a zero and never an empty string.
 */
export function censusSentence(unlockedCount, totalProjects) {
  if (unlockedCount === null || unlockedCount === undefined) return null;
  if (totalProjects === null || totalProjects === undefined) return null;
  return `${unlockedCount.toLocaleString('en-US')} unlocked of ${totalProjects.toLocaleString('en-US')} projects.`;
}

/** A cap announces itself, with both totals and the way to narrow the list. */
export function capSentence(shownCount, totalCount, omittedCount) {
  const tail = omittedCount > 0
    ? ` — ${omittedCount.toLocaleString('en-US')} omitted by the ${RENDER_CAP}-row display cap;`
      + ' narrow the search to see them'
    : '';
  return `${shownCount.toLocaleString('en-US')} shown of ${totalCount.toLocaleString('en-US')} matching${tail}.`;
}

/**
 * The two endpoints are written out literally rather than composed from
 * constants: `tests/unlockedTechPanel.test.js` greps for them, and a route this
 * panel reads should be findable by searching the repo for the route.
 */
export function treeUrl(observerId, mode) {
  return `/api/intel/tech-tree?observer=${encodeURIComponent(observerId)}`
    + `&mode=${encodeURIComponent(mode)}&category=all&includeEffects=false`;
}

export function searchUrl(observerId, mode, query) {
  return `/api/intel/tech-search?observer=${encodeURIComponent(observerId)}`
    + `&mode=${encodeURIComponent(mode)}&q=${encodeURIComponent(query)}`;
}

/** Throws the server's own explanation when it gave one, else the HTTP status. */
export async function fetchJson(url) {
  const response = await fetch(url);
  const payload = await response.json().catch(() => null);
  if (!response.ok) {
    const detail = payload && payload.error ? String(payload.error) : `HTTP ${response.status}`;
    throw new Error(detail);
  }
  return payload;
}
