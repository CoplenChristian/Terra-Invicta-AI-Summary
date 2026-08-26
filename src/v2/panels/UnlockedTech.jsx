/**
 * src/v2/panels/UnlockedTech.jsx
 *
 * Purpose: the searchable list of the observer faction's unlocked research
 * projects in RECORDS, over /api/intel/tech-search and /api/intel/tech-tree.
 *
 * WHY THE PROJECT NAME LEADS EVERY ROW
 * ------------------------------------
 * Per docs/research-row-naming-spec.md, the project is what the player acts on
 * and searches for in game; the item is only what the project yields. The two
 * routinely differ beyond recognition -- Project_CopperheadMissileBay is named
 * "Hydrolox High Explosive Missiles" -- so the project name cannot be derived
 * from the item and must be read from the data. Searching "Copperhead" finding a
 * project with no "Copperhead" in its name is the whole point of this panel, so
 * when the match came from an unlocked item rather than the project name, the
 * matching item is marked to say why the row is here.
 *
 * WHERE THE TWO ENDPOINTS SPLIT
 * -----------------------------
 * Matching is the server's job and is NOT reimplemented here:
 *
 *   typed query   /api/intel/tech-search?q=  matches display names, internal
 *                 ids, unlock names and effect ids
 *   empty query   /api/intel/tech-tree       the whole graph, filtered by
 *                 `status` only -- a status filter, not a second search
 *
 * tech-search requires `q` (400 without it), which is why the default list
 * cannot come from it. Both read the same server-side graph, so the two agree.
 *
 * The graph response is ~570KB, so it is fetched on first RECORDS activation
 * rather than on page load -- see loadLazyViewPanels in mission-control.js.
 *
 * MODE
 * ----
 * This is the observer's OWN research. `observerGraph` always reads the
 * observer's own faction status, and `mode` is placed on the save state at
 * shared/techGraph.mjs:1084 and never read again, so the two modes are
 * structurally identical here -- not merely equal on the save that was spot
 * checked. Verified 2026-08-21 against the live save (19 items for q=laser, 165
 * completed of 750 projects in both) and pinned by
 * tests/unlockedTechRendering.test.js, which asserts the two modes render the
 * same text.
 */

import React from 'react';
import { TruncationNote, Value } from '../components/index.js';
import {
  DEBOUNCE_MS,
  RENDER_CAP,
  UNLOCK_CAP,
  applyScope,
  capSentence,
  categoryLabel,
  censusSentence,
  costLabel,
  fetchJson,
  isUnlocked,
  matchingUnlocks,
  readCensus,
  searchUrl,
  sortByName,
  statusLabel,
  statusModifier,
  treeUrl,
} from './unlockedTechUtils.js';

const SCOPES = [
  ['unlocked', 'UNLOCKED', 'Only projects this faction has completed'],
  ['all', 'ALL', 'Every project in the tree, whatever its state'],
];

function Controls({ inputValue, onInput, scope, onScope }) {
  return (
    <div className="ut-controls">
      <label className="ut-search">
        <span className="ut-search__label">SEARCH</span>
        <input
          type="search"
          className="ut-input"
          id="unlockedTechQuery"
          placeholder="project, item or effect — try Copperhead"
          autoComplete="off"
          spellCheck="false"
          value={inputValue}
          onChange={(event) => onInput(event.target.value)}
          aria-label="Search unlocked technology by project, item or effect name"
        />
      </label>
      <div className="ut-scope" role="group" aria-label="Which projects to list">
        {SCOPES.map(([value, label, title]) => (
          <button
            key={value}
            type="button"
            className={`ut-scope-btn${scope === value ? ' is-active' : ''}`}
            data-scope={value}
            aria-pressed={scope === value ? 'true' : 'false'}
            title={title}
            onClick={() => onScope(value)}
          >
            {label}
          </button>
        ))}
      </div>
    </div>
  );
}

/**
 * The per-row item chips.
 *
 * Only the item list is capped; the count beside it in the meta line is the
 * true one. The remainder is announced through `<TruncationNote>` so the cap
 * carries its own totals rather than depending on this file remembering to
 * print them.
 */
function UnlockChips({ project, query }) {
  const unlocks = Array.isArray(project.unlocks) ? project.unlocks : [];
  if (unlocks.length === 0) return null;

  // Matched BY REFERENCE, not by id -- see matchingUnlocks().
  const matched = new Set(matchingUnlocks(project, query));
  const shown = unlocks.slice(0, UNLOCK_CAP);
  const hidden = unlocks.length - shown.length;

  return (
    <ul className="ut-unlocks">
      {shown.map((unlock, index) => (
        <li
          key={`${unlock && unlock.id ? unlock.id : 'unlock'}-${index}`}
          className={`ut-unlock${matched.has(unlock) ? ' ut-unlock--matched' : ''}`}
        >
          {(unlock && (unlock.displayName || unlock.id)) || 'unnamed'}
          {matched.has(unlock) ? <>{' '}<span className="ut-unlock__why">MATCHED</span></> : null}
        </li>
      ))}
      {hidden > 0 ? (
        <li className="ut-unlock ut-unlock--more">
          <TruncationNote
            shownCount={shown.length}
            totalCount={unlocks.length}
            omittedCount={hidden}
            formatTruncated={({ omitted, total }) => `+${omitted} more of ${total}`}
          />
        </li>
      ) : null}
    </ul>
  );
}

function Row({ project, query, scope }) {
  const unlocks = Array.isArray(project.unlocks) ? project.unlocks : [];
  const cost = costLabel(project);
  const category = categoryLabel(project);

  return (
    <li className={`ut-row${isUnlocked(project) ? ' ut-row--unlocked' : ''}`}>
      <div className="ut-row__head">
        <span className="ut-row__project">
          {project.displayName || project.id || 'Unnamed project'}
        </span>
        {scope === 'all' ? (
          <span className={`ut-status ut-status--${statusModifier(project)}`}>
            {statusLabel(project)}
          </span>
        ) : null}
      </div>
      <div className="ut-row__meta">
        <code className="ut-id">{project.id || ''}</code>
        {category ? <span className="ut-meta-item">{category}</span> : null}
        <span className="ut-meta-item">
          {/* Presence is explicit. Rendering `{cost}` here would print nothing
              at all for an absent cost -- the React shape of the confident zero,
              and invisible rather than merely wrong. */}
          <Value
            value={cost}
            present={cost !== null}
            format={(raw) => String(raw)}
            absentLabel="RESEARCH COST UNAVAILABLE"
            className={cost === null ? 'ut-unavailable' : undefined}
          />
        </span>
        {unlocks.length > 0 ? (
          <span className="ut-meta-item">
            {`${unlocks.length} item${unlocks.length === 1 ? '' : 's'}`}
          </span>
        ) : null}
      </div>
      <UnlockChips project={project} query={query} />
    </li>
  );
}

/** A cap announces itself, with both totals and the way to narrow the list. */
function Footer({ shownCount, totalCount, omittedCount, unlockedCount, totalProjects }) {
  const census = censusSentence(unlockedCount, totalProjects);
  return (
    <div className="ut-footer">
      {/* The census and the cap line are two independent facts: the census can
          be unreadable while the cap line is perfectly well measured. */}
      <Value
        value={census}
        present={census !== null}
        format={(raw) => String(raw)}
        absentLabel="Project census unavailable."
      />
      <TruncationNote
        shownCount={shownCount}
        omittedCount={omittedCount}
        allShownLabel={capSentence(shownCount, totalCount, 0)}
        formatTruncated={() => capSentence(shownCount, totalCount, omittedCount)}
      />
    </div>
  );
}

function Body({ status, message, results, query, scope, unlockedCount, totalProjects }) {
  if (status === 'error') {
    return (
      <div className="ut-notice ut-notice--error">
        {`The unlocked technology index is unavailable: ${message || 'unknown reason'}`}
      </div>
    );
  }
  if (status === 'loading' && !results) {
    return <div className="ut-notice">Reading the research graph…</div>;
  }

  const rows = Array.isArray(results) ? results : [];
  const trimmed = query.trim();

  if (rows.length === 0) {
    if (trimmed) {
      return (
        <div className="ut-notice">
          {`Nothing ${scope === 'unlocked' ? 'unlocked ' : ''}matches “${trimmed}”. `}
          {scope === 'unlocked'
            ? 'Switch to ALL to search the projects this faction has not completed.'
            : ''}
        </div>
      );
    }
    // The census is the evidence for "nothing unlocked". Without it an empty
    // list is indistinguishable from an unread one, and the panel must not
    // report the faction has completed nothing on the strength of a graph it
    // could not read. These two branches make OPPOSITE claims; collapsing them
    // into one "nothing found" state re-opens the defect they exist to close.
    if (totalProjects === null) {
      return (
        <div className="ut-notice ut-notice--error">
          The project census is unavailable, so this panel cannot say what this faction has unlocked.
        </div>
      );
    }
    return <div className="ut-notice">This faction has not completed any research projects yet.</div>;
  }

  const shown = rows.slice(0, RENDER_CAP);
  const omitted = rows.length - shown.length;

  return (
    <>
      <ul className="ut-list">
        {shown.map((project, index) => (
          <Row
            key={`${project.id || 'row'}-${index}`}
            project={project}
            query={query}
            scope={scope}
          />
        ))}
      </ul>
      <Footer
        shownCount={shown.length}
        totalCount={rows.length}
        omittedCount={omitted}
        unlockedCount={unlockedCount}
        totalProjects={totalProjects}
      />
    </>
  );
}

/**
 * @param {object} props
 * @param {number|string} props.observerId
 * @param {string} props.mode  'player' | 'omniscient'
 */
export function UnlockedTech({ observerId, mode }) {
  const [inputValue, setInputValue] = React.useState('');
  // The query the CURRENT render reflects, which is the one the in-flight or
  // completed request was made with -- not the live input. The vanilla panel
  // repainted only when a refresh started, so a half-typed word never re-marked
  // the matched chips; keeping the two separate preserves that.
  const [query, setQuery] = React.useState('');
  const [scope, setScope] = React.useState('unlocked');
  const [status, setStatus] = React.useState('loading');
  const [message, setMessage] = React.useState(null);
  const [results, setResults] = React.useState(null);
  const [census, setCensus] = React.useState({ totalProjects: null, unlockedCount: null });

  // The ~570KB graph, cached per observer+mode. A scope toggle or a keystroke
  // must not re-read it.
  const graphRef = React.useRef({ key: null, projects: null, totalProjects: null, unlockedCount: null });
  const seqRef = React.useRef(0);

  React.useEffect(() => {
    if (inputValue === query) return undefined;
    const timer = setTimeout(() => setQuery(inputValue), DEBOUNCE_MS);
    return () => clearTimeout(timer);
  }, [inputValue, query]);

  React.useEffect(() => {
    const seq = seqRef.current + 1;
    seqRef.current = seq;

    const key = `${observerId}|${mode}`;
    if (graphRef.current.key !== key) {
      graphRef.current = { key, projects: null, totalProjects: null, unlockedCount: null };
      setResults(null);
      setCensus({ totalProjects: null, unlockedCount: null });
    }
    setStatus('loading');

    (async () => {
      try {
        if (graphRef.current.projects === null) {
          const payload = await fetchJson(treeUrl(observerId, mode));
          const read = readCensus(payload);
          graphRef.current = { key, ...read };
        }
        const graph = graphRef.current;
        if (seq !== seqRef.current) return; // a newer keystroke already won
        setCensus({ totalProjects: graph.totalProjects, unlockedCount: graph.unlockedCount });

        const trimmed = query.trim();
        let rows;
        if (!trimmed) {
          rows = applyScope(graph.projects, scope);
        } else {
          // Matching stays on the server -- this panel never reimplements it.
          const payload = await fetchJson(searchUrl(observerId, mode, trimmed));
          rows = applyScope(Array.isArray(payload && payload.items) ? payload.items : [], scope);
        }

        if (seq !== seqRef.current) return;
        setResults(sortByName(rows));
        setStatus('ready');
        setMessage(null);
      } catch (err) {
        if (seq !== seqRef.current) return;
        setStatus('error');
        setResults(null);
        setMessage(err && err.message ? err.message : 'The technology index could not be read.');
      }
    })();

    return undefined;
  }, [observerId, mode, query, scope]);

  return (
    <>
      <Controls
        inputValue={inputValue}
        onInput={setInputValue}
        scope={scope}
        onScope={(next) => setScope((current) => (next === current ? current : next))}
      />
      <Body
        status={status}
        message={message}
        results={results}
        query={query}
        scope={scope}
        unlockedCount={census.unlockedCount}
        totalProjects={census.totalProjects}
      />
    </>
  );
}

export default UnlockedTech;
