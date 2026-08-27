/**
 * src/v2/panels/IntelligenceLibrary.jsx
 *
 * Purpose: renders the intelligence library — the drillable intelligence surface
 *   over the intel endpoints (RECORDS view).
 */

import React from 'react';
import { DataTable } from '../components/DataTable.jsx';
import { TruncationNote } from '../components/TruncationNote.jsx';
import { ABSENT_LABEL, UNAVAILABLE_LABEL, Value } from '../components/Value.jsx';
import {
  activeCouncilors,
  councilorProfile,
  factionColorById,
  factionLogoHtml,
  factionMap,
  factionNameById,
  formatCountLabel,
  formatMoney,
  formatNumber,
  isPresentNumeric,
  isPresentText,
  matchesSpaceTheater,
  number,
  numberValue,
  relationFor,
  resolveCouncilorProfile,
  resolveTopSkill,
  visibility,
} from './intelligenceLibraryUtils.js';

const NAV_SECTIONS = [
  ['overview', 'Overview'],
  ['factions', 'Faction balance'],
  ['councilors', 'Councilors'],
  ['nations', 'Nations'],
  ['space', 'Space & mining'],
  ['research', 'Technology'],
  ['threats', 'Alien intelligence'],
  ['exports', 'Exports'],
];

const QUICK_ROUTES = [
  ['councilors', 'Council roster'],
  ['nations', 'Earth holdings'],
  ['space', 'Space assets'],
  ['research', 'Technology'],
  ['threats', 'Alien intelligence'],
  ['factions', 'Faction balance'],
];

const SPACE_TABS = [
  ['mining', 'Mining'],
  ['habs', 'Habs'],
  ['fleets', 'Fleets'],
  ['ships', 'Ships'],
];

const PRIORITY_TARGET_CAP = 8;
const TABLE_HINT = 'Swipe horizontally to inspect all columns';

function Num({ value, decimals = 0, present, absentLabel = ABSENT_LABEL, className }) {
  const resolvedPresent = present ?? isPresentNumeric(value);
  return (
    <Value
      value={value}
      present={resolvedPresent}
      absentLabel={absentLabel}
      format={(raw) => formatNumber(raw, decimals)}
      className={className}
    />
  );
}

function Money({ value, className }) {
  return (
    <Value
      value={value}
      present={isPresentNumeric(value)}
      format={formatMoney}
      className={className}
    />
  );
}

function Txt({ value, fallback = ABSENT_LABEL, className }) {
  return (
    <Value
      value={value}
      present={isPresentText(value)}
      format={String}
      absentLabel={fallback}
      className={className}
    />
  );
}

function CountLbl({ value, noun, className }) {
  return (
    <Value
      value={value}
      present
      format={(raw) => formatCountLabel(raw, noun)}
      className={className}
    />
  );
}

function RelationHate({ hate, known, className }) {
  return (
    <Value
      value={hate}
      present={known && isPresentNumeric(hate)}
      absentLabel={known ? ABSENT_LABEL : UNAVAILABLE_LABEL}
      format={(raw) => formatNumber(raw, 2)}
      className={className}
    />
  );
}

function PowerScore({ power, className }) {
  return (
    <Value
      value={power}
      present={power !== null && power !== undefined}
      absentLabel={UNAVAILABLE_LABEL}
      format={(raw) => `${formatNumber(raw, 0)}/100`}
      className={className}
    />
  );
}

function TopSkillCell({ councilor, className }) {
  const resolved = resolveTopSkill(councilor);
  return (
    <span
      className={[resolved.className, className].filter(Boolean).join(' ') || undefined}
      data-primitive="value"
      data-value-state={resolved.state}
    >
      {resolved.text}
    </span>
  );
}

function CouncilorProfileCell({ councilor, className }) {
  const resolved = resolveCouncilorProfile(councilor);
  return (
    <span
      className={[resolved.className, className].filter(Boolean).join(' ') || undefined}
      data-primitive="value"
      data-value-state={resolved.state}
    >
      {resolved.text}
    </span>
  );
}

function StatusChip({ value, tone = 'neutral' }) {
  const text = value === null || value === undefined || value === ''
    ? UNAVAILABLE_LABEL
    : String(value);
  return (
    <span className={`intel-library-chip intel-library-chip--${tone}`}>
      {text}
    </span>
  );
}

function FactionLabel({ factionOrId, factions, displayNameOverride }) {
  const faction = factionOrId && typeof factionOrId === 'object'
    ? factionOrId
    : factions[String(factionOrId)];
  const logoHtml = factionLogoHtml(faction, 'faction-logo faction-logo--table');
  const color = faction?.color ? faction.color : factionColorById(factionOrId, factions);
  const name = displayNameOverride
    || (faction ? faction.displayName : factionNameById(factionOrId, factions));

  return (
    <span className={`intel-library-faction-name${logoHtml ? ' has-faction-logo' : ''}`}>
      {logoHtml ? (
        <span dangerouslySetInnerHTML={{ __html: logoHtml }} />
      ) : (
        <i style={{ background: color }} />
      )}
      <Txt value={name} />
    </span>
  );
}

function IntelLibraryTable({ headers, rows, emptyMessage }) {
  if (!rows.length) {
    return (
      <div className="intel-library-empty">
        {emptyMessage || 'No records are available in this intelligence view.'}
      </div>
    );
  }

  const columns = headers.map((label, index) => ({
    key: String(index),
    label,
  }));

  const tableRows = rows.map((row, index) => ({
    key: row.key ?? index,
    rowHeader: true,
    className: row.className,
    ...Object.fromEntries(row.cells.map((cell, cellIndex) => [String(cellIndex), cell])),
  }));

  return (
    <DataTable
      variant="intel-library"
      hintText={TABLE_HINT}
      caption="Filtered intelligence records"
      columns={columns}
      rows={tableRows}
    />
  );
}

function SectionIntro({ kicker, title, description, count }) {
  return (
    <div className="intel-library-section-intro">
      <div>
        <div className="intel-library-kicker">{kicker}</div>
        <h3>{title}</h3>
        {description ? <p>{description}</p> : null}
      </div>
      {count != null ? <span className="intel-library-count">{count}</span> : null}
    </div>
  );
}

function OverviewSection({ snapshot, briefing, observerId, factions, onNavigate }) {
  const metadata = snapshot.metadata || {};
  const councilors = activeCouncilors(snapshot);
  const observer = (snapshot.factions || []).find(
    (faction) => String(faction.ID) === String(observerId),
  ) || {};
  const stats = [
    ['FACTIONS', (snapshot.factions || []).length, 'faction'],
    ['ACTIVE COUNCILORS', councilors.length, 'councilor'],
    ['ALIEN COUNCILORS', councilors.filter((c) => c.isAlien).length, 'councilor'],
    ['NATIONS', (snapshot.nations || []).length, 'nation'],
    ['HABS', (snapshot.habs || []).length, 'hab'],
    ['FLEETS', (snapshot.fleets || []).length, 'fleet'],
    ['MINING SITES', (snapshot.habSites || []).length, 'site'],
  ];
  const directives = briefing?.directives || {};
  const directiveCount = ['geopolitical', 'council', 'space', 'research'].reduce(
    (total, key) => total + ((directives[key] || []).length),
    0,
  );

  return (
    <>
      <div className="intel-library-intro">
        <div>
          <div className="intel-library-kicker">CLASSIC DATA SURFACES / INTEGRATED</div>
          <h3>Campaign intelligence library</h3>
          <p>
            The full save-derived record is available here for inspection. The landing screen
            remains the executive brief; these panels are the underlying operating picture.
          </p>
        </div>
        <div className="intel-library-intro-meta">
          <span>VIEW</span>
          <strong>{visibility(snapshot)}</strong>
          <span>OBSERVER</span>
          <strong><Txt value={snapshot.observerFactionName || observer.displayName} /></strong>
        </div>
      </div>
      <div className="intel-library-stat-grid">
        {stats.map(([label, count, noun]) => (
          <div key={label} className="intel-library-stat">
            <span>{label}</span>
            <strong><CountLbl value={count} noun={noun} /></strong>
          </div>
        ))}
      </div>
      <div className="intel-library-overview-grid">
        <section className="intel-library-block">
          <div className="intel-library-block-heading">
            <span>DATA PROVENANCE</span>
            <small>CURRENT SNAPSHOT</small>
          </div>
          <dl className="intel-library-definition-list">
            <div>
              <dt>Campaign date</dt>
              <dd><Txt value={metadata.gameTimeString} /></dd>
            </div>
            <div>
              <dt>Active save</dt>
              <dd><Txt value={metadata.activeSaveFileName || metadata.fileName} /></dd>
            </div>
            <div>
              <dt>Last modified</dt>
              <dd>
                <Txt
                  value={
                    metadata.lastModified
                      ? new Date(metadata.lastModified).toLocaleString()
                      : null
                  }
                />
              </dd>
            </div>
            <div>
              <dt>Executive directives</dt>
              <dd><CountLbl value={directiveCount} noun="directive" /></dd>
            </div>
          </dl>
        </section>
        <section className="intel-library-block">
          <div className="intel-library-block-heading">
            <span>QUICK ROUTES</span>
            <small>OPEN A DATASET</small>
          </div>
          <div className="intel-library-quick-grid">
            {QUICK_ROUTES.map(([section, label]) => (
              <button
                key={section}
                className="intel-library-quick"
                type="button"
                data-library-section={section}
                onClick={() => onNavigate(section)}
              >
                <strong>{label}</strong>
                <span>Inspect records</span>
              </button>
            ))}
          </div>
        </section>
      </div>
      <div className="intel-library-note">
        <strong>Visibility discipline:</strong>
        {' '}
        {visibility(snapshot)}
        . Unknown values remain unknown; this library does not infer hidden assets from empty records.
      </div>
    </>
  );
}

function FactionsSection({ snapshot, observerId, factions, onOpenFaction }) {
  const relationships = snapshot.factionRelationships || [];
  const councilors = activeCouncilors(snapshot);
  const rows = (snapshot.factions || []).map((faction) => {
    const relation = relationFor(faction.ID, observerId, relationships);
    const power = faction.powerScore && typeof faction.powerScore === 'object'
      ? faction.powerScore.overall
      : faction.powerScore;
    const factionCouncilors = councilors.filter(
      (councilor) => String(councilor.factionId) === String(faction.ID),
    );
    const alienCouncilors = factionCouncilors.filter((councilor) => councilor.isAlien).length;
    return {
      key: faction.ID,
      cells: [
        <FactionLabel key="faction" factionOrId={faction} factions={factions} />,
        <RelationHate key="hateOfUs" hate={relation.hateOfUs} known={relation.hateOfUsKnown} />,
        <RelationHate key="ourHate" hate={relation.ourHate} known={relation.ourHateKnown} />,
        <PowerScore key="power" power={power} />,
        <Num key="cps" value={faction.controlPointsCount} decimals={0} />,
        <Money key="gdp" value={faction.totalGdp} />,
        <Num key="habs" value={faction.habsCount} decimals={0} />,
        faction.spaceVisibility === 'unavailable'
          ? <Txt key="ships" value={null} fallback={UNAVAILABLE_LABEL} />
          : <CountLbl key="ships" value={faction.shipsCount} noun="ship" />,
        <>
          <Num key="councilors-count" value={factionCouncilors.length} decimals={0} present />
          {alienCouncilors ? (
            <>
              {' / '}
              <Num value={alienCouncilors} decimals={0} present />
              {' alien'}
            </>
          ) : null}
        </>,
        <>
          <StatusChip
            value={faction.spaceVisibility === 'unavailable' ? 'LIMITED' : 'AVAILABLE'}
            tone={faction.spaceVisibility === 'unavailable' ? 'muted' : 'good'}
          />
          {' '}
          <button
            type="button"
            className="intel-library-inline-action"
            data-library-faction={faction.ID}
            onClick={() => onOpenFaction?.(Number(faction.ID))}
          >
            Open dossier
          </button>
        </>,
      ],
    };
  });

  return (
    <>
      <SectionIntro
        kicker="STRATEGIC BALANCE / ALL FACTIONS"
        title="Faction operating picture"
        description="Directional hate is shown as “hate of us” and “our hate” when the filtered snapshot contains that relationship."
        count={<CountLbl value={rows.length} noun="faction" />}
      />
      <IntelLibraryTable
        headers={['Faction', 'Hate of us', 'Our hate', 'Strategic score (est.)', 'CPs', 'GDP', 'Habs', 'Ships', 'Councilors', 'Dossier']}
        rows={rows}
        emptyMessage="No faction records are available."
      />
    </>
  );
}

function CouncilorsSection({
  snapshot,
  factions,
  councilorFaction,
  councilorSearch,
  onFactionChange,
  onSearchChange,
}) {
  const allCouncilors = activeCouncilors(snapshot);
  const selectedFaction = councilorFaction ? String(councilorFaction) : '';
  const search = councilorSearch ? String(councilorSearch).trim().toLowerCase() : '';
  const factionOptions = {};
  allCouncilors.forEach((councilor) => {
    factionOptions[String(councilor.factionId)] = councilor.factionName
      || factionNameById(councilor.factionId, factions);
  });
  const visibleCouncilors = allCouncilors.filter((councilor) => {
    const matchesFaction = !selectedFaction || String(councilor.factionId) === selectedFaction;
    const haystack = [
      councilor.displayName,
      councilor.factionName,
      councilor.typeTemplateName,
      councilor.locationName,
      councilor.activeMissionName,
      councilorProfile(councilor),
    ].join(' ').toLowerCase();
    return matchesFaction && (!search || haystack.includes(search));
  });
  const rows = visibleCouncilors.map((councilor) => ({
    key: councilor.ID,
    className: councilor.isTurnedMole ? 'intel-library-row-highlight' : undefined,
    cells: [
      <Txt key="name" value={councilor.displayName} />,
      <FactionLabel
        key="faction"
        factionOrId={councilor.factionId}
        factions={factions}
        displayNameOverride={councilor.factionName || factionNameById(councilor.factionId, factions)}
      />,
      <Txt key="profession" value={councilor.typeTemplateName} />,
      <Txt key="location" value={councilor.locationName} />,
      <Txt
        key="status"
        value={councilor.isTurnedMole ? 'TURNED MOLE' : (councilor.status || 'ACTIVE')}
      />,
      <Txt key="mission" value={councilor.activeMissionName} />,
      <Num key="total" value={councilor.totalSkills} decimals={0} />,
      <TopSkillCell key="lead" councilor={councilor} />,
      <CouncilorProfileCell key="profile" councilor={councilor} />,
      councilor.isAlien
        ? <StatusChip value="ALIEN" tone="danger" />
        : councilor.visibility === 'raw_save_only'
          ? <StatusChip value="RAW" tone="muted" />
          : <StatusChip value="VISIBLE" tone="good" />,
    ],
  }));

  return (
    <>
      <SectionIntro
        kicker="EARTH OPERATIONS / COUNCIL"
        title="Councilor intelligence"
        description="Skills use the filtered visible or masked values. Hidden attributes are intentionally represented as unavailable."
        count={<CountLbl value={rows.length} noun="councilor" />}
      />
      <div className="intel-library-filter-bar">
        <label className="intel-library-filter-field">
          <span>FACTION FILTER</span>
          <select
            className="intel-library-filter-control"
            data-library-councilor-faction
            aria-label="Filter councilors by faction"
            value={selectedFaction}
            onChange={(event) => onFactionChange(event.target.value)}
          >
            <option value="">
              {`ALL ACTIVE FACTIONS (${allCouncilors.length})`}
            </option>
            {Object.keys(factionOptions).sort((a, b) => factionOptions[a].localeCompare(factionOptions[b])).map((factionId) => (
              <option key={factionId} value={factionId}>
                {`${factionOptions[factionId]} (${allCouncilors.filter((c) => String(c.factionId) === factionId).length})`}
              </option>
            ))}
          </select>
        </label>
        <label className="intel-library-filter-field intel-library-filter-field--search">
          <span>SEARCH ROSTER</span>
          <input
            className="intel-library-filter-control intel-library-filter-search"
            type="search"
            data-library-councilor-search
            placeholder="Search name, location, mission"
            value={councilorSearch || ''}
            aria-label="Search councilors"
            onChange={(event) => onSearchChange(event.target.value)}
          />
        </label>
        <span className="intel-library-filter-result">
          {`SHOWING ${rows.length} / ${allCouncilors.length} ACTIVE`}
        </span>
      </div>
      <IntelLibraryTable
        headers={['Councilor', 'Faction', 'Profession', 'Location', 'Status', 'Mission', 'Total', 'Lead skill', 'Org / traits', 'Visibility']}
        rows={rows}
        emptyMessage={
          selectedFaction || search
            ? 'No active councilors match the current filter.'
            : 'No active councilors are available in this intelligence view.'
        }
      />
    </>
  );
}

function NationNukesCell({ nukes }) {
  if (numberValue(nukes) === null) {
    return <Value value={nukes} present={false} />;
  }
  return (
    <span className="intel-library-chip intel-library-chip--danger">
      {formatNumber(nukes, 0)}
    </span>
  );
}

function NationsSection({ snapshot, factions }) {
  const rows = (snapshot.nations || []).map((nation, index) => {
    const executive = nation.executiveFactionName || 'None';
    const executiveColor = factionColorById(nation.executiveFactionId, factions);
    return {
      key: nation.displayName || index,
      cells: [
        <Txt key="nation" value={nation.displayName} />,
        <span key="exec" style={{ color: executiveColor }}><Txt value={executive} /></span>,
        <Num key="cps" value={(nation.controlPoints || []).length} decimals={0} present />,
        <Money key="gdp" value={nation.GDP} />,
        <Num key="milTech" value={nation.milTech} decimals={1} />,
        <Num key="armies" value={nation.armies} decimals={0} />,
        <NationNukesCell key="nukes" nukes={nation.nukes} />,
        <Num key="unrest" value={nation.unrest} decimals={1} />,
        <Num key="cohesion" value={nation.cohesion} decimals={1} />,
        <Num key="boost" value={nation.boost} decimals={2} />,
        <Num key="mc" value={nation.missionControl} decimals={0} />,
      ],
    };
  });

  const allTargets = Array.isArray(snapshot.servantTargets) ? snapshot.servantTargets : null;
  const shownTargets = allTargets ? allTargets.slice(0, PRIORITY_TARGET_CAP) : [];
  const omittedCount = allTargets ? allTargets.length - shownTargets.length : 0;

  return (
    <>
      <SectionIntro
        kicker="EARTH OPERATIONS / NATIONS"
        title="Geopolitical holdings"
        description="Every nation in the filtered snapshot, including control points, GDP, military posture and launch capacity."
        count={<CountLbl value={rows.length} noun="nation" />}
      />
      <IntelLibraryTable
        headers={['Nation', 'Executive', 'CPs', 'GDP', 'Mil tech', 'Armies', 'Nukes', 'Unrest', 'Cohesion', 'Boost/mo', 'MC']}
        rows={rows}
        emptyMessage="No nations are available in this intelligence view."
      />
      {allTargets && allTargets.length > 0 ? (
        <section className="intel-library-block intel-library-targets">
          <div className="intel-library-block-heading">
            <span>PRIORITY TARGETS</span>
            <small>GENERATED FROM CURRENT OBSERVER</small>
          </div>
          <div className="intel-library-target-list">
            {shownTargets.map((target, index) => (
              <div key={`${target.nationName}-${index}`} className="intel-library-target">
                <strong><Txt value={target.nationName} /></strong>
                <span>
                  <Txt value={target.targetFactionName} />
                  {' / score '}
                  <Txt value={target.score} />
                </span>
                <small><Txt value={(target.reasons || []).join(' · ')} /></small>
              </div>
            ))}
          </div>
          {omittedCount > 0 ? (
            <TruncationNote
              className="intel-library-muted"
              totalCount={allTargets.length}
              omittedCount={omittedCount}
              shownCount={shownTargets.length}
              formatCount={(n) => number(n, 0)}
              formatTruncated={({ shown, omitted, total, formatCount }) => (
                `Showing ${formatCount(shown)} of ${formatCount(total)} targets; `
                + `${formatCount(omitted)} further target${omitted === 1 ? ' is' : 's are'} omitted from this view.`
              )}
            />
          ) : null}
        </section>
      ) : null}
    </>
  );
}

function MiningSection({ snapshot, spaceTheater }) {
  const rows = (snapshot.habSites || [])
    .filter((site) => matchesSpaceTheater(site.parentBodyName, spaceTheater, site.spaceTheaterKey))
    .map((site, index) => {
      const construction = site.pendingHab
        ? (site.constructionStatus || 'building')
        : (site.mineModuleName || site.constructionStatus || 'not installed');
      return {
        key: site.displayName || index,
        cells: [
          <Txt key="site" value={site.displayName} />,
          <Txt key="body" value={site.parentBodyName} />,
          <Txt key="owner" value={site.factionName} />,
          <Num key="water" value={site.water} decimals={2} />,
          <Num key="volatiles" value={site.volatiles} decimals={2} />,
          <Num key="metals" value={site.metals} decimals={2} />,
          <Num key="nobles" value={site.nobleMetals} decimals={2} />,
          <Num key="fissiles" value={site.fissiles} decimals={2} />,
          <Txt key="tier" value={site.mineTier} />,
          <Txt key="status" value={construction} />,
          <Txt key="days" value={site.daysRemaining} />,
          <Txt key="hab" value={site.habName} />,
        ],
      };
    });

  return (
    <>
      <SectionIntro
        kicker="SPACE LOGISTICS / RESOURCE YIELDS"
        title="Mining and construction sites"
        description="Yield fields are reported per day from the save. Unclaimed sites remain visible when the selected intelligence mode permits them."
        count={<CountLbl value={rows.length} noun="site" />}
      />
      <IntelLibraryTable
        headers={['Site', 'Body', 'Owner', 'Water/day', 'Volatiles/day', 'Metals/day', 'Nobles/day', 'Fissiles/day', 'Mine tier', 'Status', 'Days left', 'Hab']}
        rows={rows}
        emptyMessage="No mining sites are available in this intelligence view."
      />
    </>
  );
}

function HabsSection({ snapshot, spaceTheater }) {
  const rows = (snapshot.habs || [])
    .filter((hab) => matchesSpaceTheater(hab.orbitBody, spaceTheater, hab.spaceTheaterKey))
    .map((hab, index) => {
      const status = hab.underAssault
        ? 'UNDER ASSAULT'
        : (hab.underBombardment ? 'UNDER BOMBARDMENT' : (hab.inCombat ? 'IN COMBAT' : 'OPERATIONAL'));
      return {
        key: hab.displayName || index,
        cells: [
          <Txt key="hab" value={hab.displayName} />,
          <Txt key="faction" value={hab.factionName} />,
          <Txt key="type" value={hab.habType} />,
          <Num key="tier" value={hab.tier} decimals={0} />,
          <Txt key="orbit" value={hab.orbitBody} />,
          hab.inEarthLEO ? <StatusChip key="leo" value="LEO" tone="good" /> : <Value key="leo" value="" present={false} />,
          <StatusChip key="status" value={status} tone={status === 'OPERATIONAL' ? 'good' : 'danger'} />,
          <Txt key="template" value={hab.templateName} />,
        ],
      };
    });

  return (
    <>
      <SectionIntro
        kicker="SPACE LOGISTICS / STATIONS"
        title="Habitat and station registry"
        description="Orbital position, ownership, tier and current combat status for every visible installation."
        count={<CountLbl value={rows.length} noun="hab" />}
      />
      <IntelLibraryTable
        headers={['Hab', 'Faction', 'Type', 'Tier', 'Orbit / body', 'LEO', 'Status', 'Template']}
        rows={rows}
        emptyMessage="No habs are available in this intelligence view."
      />
    </>
  );
}

function FleetsSection({ snapshot, spaceTheater }) {
  const rows = (snapshot.fleets || [])
    .filter((fleet) => matchesSpaceTheater(fleet.orbitBody, spaceTheater, fleet.spaceTheaterKey))
    .map((fleet, index) => ({
        key: fleet.displayName || index,
        cells: [
          <Txt key="fleet" value={fleet.displayName} />,
          <Txt key="faction" value={fleet.factionName} />,
          <Num key="ships" value={fleet.shipsCount} decimals={0} />,
          <Num
            key="power"
            value={fleet.combatPower}
            decimals={0}
            present={Boolean(fleet.combatPowerAvailable) && isPresentNumeric(fleet.combatPower)}
            absentLabel={UNAVAILABLE_LABEL}
          />,
          <Txt key="loadout" value={fleet.weaponSummary || fleet.dominantWeaponType} />,
          <Txt key="orbit" value={fleet.orbitBody} />,
          <Txt key="mission" value={fleet.mission} />,
          <Txt key="destination" value={fleet.destination} />,
          <Txt key="arrival" value={fleet.arrivalDate} />,
        ],
      }));

  return (
    <>
      <SectionIntro
        kicker="SPACE LOGISTICS / FLEETS"
        title="Fleet posture"
        description="Combat power stays unavailable when the save does not provide a real value. Loadout grouping comes from equipped weapon systems."
        count={<CountLbl value={rows.length} noun="fleet" />}
      />
      <IntelLibraryTable
        headers={['Fleet', 'Faction', 'Ships', 'Combat power', 'Loadout', 'Orbit / body', 'Mission', 'Destination', 'Arrival']}
        rows={rows}
        emptyMessage="No fleets are available in this intelligence view."
      />
    </>
  );
}

function ShipsSection({ snapshot, spaceTheater }) {
  const rows = [];
  (snapshot.fleets || [])
    .filter((fleet) => matchesSpaceTheater(fleet.orbitBody, spaceTheater, fleet.spaceTheaterKey))
    .forEach((fleet) => {
      (fleet.ships || []).forEach((ship, index) => {
        const weaponSummary = (ship.weaponLoadout || []).map((item) => `${item.role} x${item.count}`).join(' · ')
          || ship.dominantWeaponType
          || null;
        rows.push({
          key: `${fleet.displayName}-${ship.displayName}-${index}`,
          cells: [
            <Txt key="ship" value={ship.displayName} />,
            <Txt key="faction" value={fleet.factionName} />,
            <Txt key="fleet" value={fleet.displayName} />,
            <Txt key="hull" value={ship.hullName} />,
            <Txt key="dominant" value={ship.dominantWeaponType} />,
            weaponSummary
              ? <Txt key="weapons" value={weaponSummary} />
              : <Txt key="weapons" value={null} fallback={UNAVAILABLE_LABEL} />,
            <Num
              key="power"
              value={ship.combatPower}
              decimals={0}
              present={ship.combatPower !== null && ship.combatPower !== undefined}
              absentLabel={UNAVAILABLE_LABEL}
            />,
          ],
        });
      });
    });

  return (
    <>
      <SectionIntro
        kicker="SPACE LOGISTICS / SHIPS"
        title="Ship registry"
        description="Ships are expanded from their fleet records so weapon roles and dominant loadouts can be compared directly."
        count={<CountLbl value={rows.length} noun="ship" />}
      />
      <IntelLibraryTable
        headers={['Ship', 'Faction', 'Fleet', 'Hull', 'Dominant', 'Equipped weapons', 'Combat power']}
        rows={rows}
        emptyMessage="No ship records are available in this intelligence view."
      />
    </>
  );
}

function SpaceTheatersBlock({ briefing, spaceTheater }) {
  let theaters = briefing?.strategic?.spaceTheaters && Array.isArray(briefing.strategic.spaceTheaters)
    ? briefing.strategic.spaceTheaters
    : [];
  theaters = theaters.filter(
    (theater) => theater.key !== 'unassigned' || theater.fleets || theater.habs || theater.miningSites,
  );
  if (spaceTheater) {
    theaters = theaters.filter((theater) => String(theater.key) === String(spaceTheater));
  }
  if (!theaters.length) return null;

  const rows = theaters.map((theater, index) => {
    const weaponMix = (theater.weaponMix || []).slice(0, 3).map((item) => `${item.role} x${item.count}`).join(' · ')
      || null;
    return {
      key: theater.key || index,
      cells: [
        <Txt key="name" value={theater.name} />,
        <>
          <Num value={theater.ownShips} decimals={0} />
          {' / '}
          <Num value={theater.ownFleets} decimals={0} />
        </>,
        theater.alienShips
          ? (
            <StatusChip
              key="alien"
              value={`${formatNumber(theater.alienShips, 0)} / ${formatNumber(theater.alienFleets, 0)}`}
              tone="danger"
            />
          )
          : <>0 / 0</>,
        <Num
          key="habs"
          value={theater.ownHabs === undefined ? theater.habs : theater.ownHabs}
          decimals={0}
        />,
        <Num
          key="mining"
          value={theater.ownMiningSites === undefined ? theater.miningSites : theater.ownMiningSites}
          decimals={0}
        />,
        <Txt key="status" value={theater.status} />,
        weaponMix ? <Txt key="mix" value={weaponMix} /> : <Value key="mix" value="" present={false} />,
      ],
    };
  });

  return (
    <section className="intel-library-block intel-library-space-theaters">
      <div className="intel-library-block-heading">
        <span>SPACE THEATER POSTURE</span>
        <small>OWN / HOSTILE / LOADOUT</small>
      </div>
      <IntelLibraryTable
        headers={['Theater', 'Own ships / fleets', 'Alien ships / fleets', 'Our habs', 'Our mining sites', 'Status', 'Alien weapon mix']}
        rows={rows}
        emptyMessage="No space theater posture is available."
      />
    </section>
  );
}

function SpaceSection({
  snapshot,
  briefing,
  spaceTab,
  spaceTheater,
  onSpaceTabChange,
}) {
  const activeTab = spaceTab || 'mining';
  const filterNote = spaceTheater ? ` / FILTERED TO ${String(spaceTheater).toUpperCase()}` : '';
  let tabContent = null;
  if (activeTab === 'habs') tabContent = <HabsSection snapshot={snapshot} spaceTheater={spaceTheater} />;
  else if (activeTab === 'fleets') tabContent = <FleetsSection snapshot={snapshot} spaceTheater={spaceTheater} />;
  else if (activeTab === 'ships') tabContent = <ShipsSection snapshot={snapshot} spaceTheater={spaceTheater} />;
  else tabContent = <MiningSection snapshot={snapshot} spaceTheater={spaceTheater} />;

  return (
    <>
      <SectionIntro
        kicker={`SPACE & MINING / CLASSIC SURFACES${filterNote}`}
        title="Orbital operating picture"
        description="Switch between yields, installations, fleet movement and individual hulls without leaving Mission Control."
      />
      <div
        className="intel-library-space-panel"
        id="intel-library-space-panel"
        role="tabpanel"
        aria-labelledby={`intel-library-space-tab-${activeTab}`}
      >
        <SpaceTheatersBlock briefing={briefing} spaceTheater={spaceTheater} />
        <div className="intel-library-subnav" role="tablist" aria-label="Space and mining views">
          {SPACE_TABS.map(([tab, label]) => (
            <button
              key={tab}
              type="button"
              className={`intel-library-subnav-btn${activeTab === tab ? ' is-active' : ''}`}
              id={`intel-library-space-tab-${tab}`}
              data-library-space={tab}
              role="tab"
              aria-controls="intel-library-space-panel"
              aria-selected={activeTab === tab ? 'true' : 'false'}
              onClick={() => onSpaceTabChange(tab)}
            >
              {label}
            </button>
          ))}
        </div>
        {tabContent}
      </div>
    </>
  );
}

function ResearchSection({ snapshot }) {
  const research = snapshot.globalResearch || {};
  const slots = (research.activeSlots || []).map((slot, index) => ({
    key: slot.slotNumber ?? index,
    cells: [
      <Num key="slot" value={slot.slotNumber} decimals={0} />,
      <Txt key="project" value={slot.displayName} />,
      <Txt key="category" value={slot.category} />,
      <>
        <Num value={slot.accumulatedResearch} decimals={0} />
        {' / '}
        <Num value={slot.totalCost} decimals={0} />
      </>,
      <>
        <Num value={slot.percent} decimals={1} />
        %
      </>,
      <Txt key="lead" value={slot.leadFactionName} />,
      <Num key="points" value={slot.leadContribution} decimals={0} />,
    ],
  }));
  const matrix = (snapshot.techMatrix || []).map((project, index) => {
    const observerStatus = project.factions?.[String(snapshot.observerFactionId)]?.status || 'UNAVAILABLE';
    return {
      key: project.projectId || index,
      cells: [
        <Txt key="project" value={project.displayName} />,
        <Txt key="id" value={project.projectId} />,
        <Txt key="category" value={project.category} />,
        <StatusChip
          key="status"
          value={observerStatus}
          tone={observerStatus === 'completed' ? 'good' : (observerStatus === 'locked' ? 'muted' : 'neutral')}
        />,
        <Txt key="effects" value={(project.effects || []).join(' · ')} />,
      ],
    };
  });
  const completed = (research.finishedTechsNames || []).map((tech, index) => (
    <span key={`${tech}-${index}`} className="intel-library-tech-tag"><Txt value={tech} /></span>
  ));

  return (
    <>
      <SectionIntro
        kicker="TECHNOLOGY / RESEARCH TREE"
        title="Research and capability record"
        description="Global slots, completed technologies and the observer’s project status are shown together with the exact internal project IDs."
        count={<CountLbl value={(snapshot.techMatrix || []).length} noun="project" />}
      />
      <section className="intel-library-block">
        <div className="intel-library-block-heading">
          <span>ACTIVE GLOBAL SLOTS</span>
          <small><CountLbl value={slots.length} noun="slot" /></small>
        </div>
        <IntelLibraryTable
          headers={['Slot', 'Project', 'Category', 'Progress', 'Complete', 'Lead faction', 'Lead points']}
          rows={slots}
          emptyMessage="No active global research slots."
        />
      </section>
      <section className="intel-library-block">
        <div className="intel-library-block-heading">
          <span>OBSERVER PROJECT MATRIX</span>
          <small>INTERNAL IDs INCLUDED</small>
        </div>
        <IntelLibraryTable
          headers={['Project', 'dataName', 'Category', 'Observer status', 'Effects']}
          rows={matrix}
          emptyMessage="No technology matrix records are available."
        />
      </section>
      <section className="intel-library-block">
        <div className="intel-library-block-heading">
          <span>COMPLETED GLOBAL TECHNOLOGIES</span>
          <small><CountLbl value={(research.finishedTechsNames || []).length} noun="technology" /></small>
        </div>
        <div className="intel-library-tech-list">
          {completed.length
            ? completed
            : <span className="intel-library-muted">No completed technologies are available.</span>}
        </div>
      </section>
    </>
  );
}

function ThreatsSection({ snapshot }) {
  const details = snapshot.capabilities?.details || {};
  const alienCouncilors = activeCouncilors(snapshot).filter((councilor) => councilor.isAlien);
  const capabilityRows = Object.keys(details).map((key) => {
    const detail = details[key] || {};
    return {
      key,
      cells: [
        <Txt key="name" value={detail.name || key} />,
        detail.active
          ? <StatusChip key="state" value="ACTIVE" tone="good" />
          : <StatusChip key="state" value="LOCKED / UNAVAILABLE" tone="muted" />,
        <Txt key="unlock" value={detail.requiredDisplayName || detail.requiredProject || detail.requiredTech} />,
        <Txt key="effect" value={detail.requiredEffect} />,
        <Txt key="description" value={detail.description} />,
      ],
    };
  });
  const xenoRows = (snapshot.activeXenoforming || []).map((site, index) => ({
    key: site.regionId || index,
    cells: [
      <Txt key="region" value={site.regionName} />,
      <Txt key="level" value={site.level} />,
      <Txt key="id" value={site.regionId} />,
    ],
  }));
  const facilityRows = (snapshot.builtAlienFacilities || []).map((facility, index) => ({
    key: facility.displayName || index,
    cells: [
      <Txt key="facility" value={facility.displayName || facility.name} />,
      <Txt key="location" value={facility.regionName || facility.locationName} />,
      <Txt key="faction" value={facility.factionName} />,
      <Txt key="type" value={facility.type || facility.templateName} />,
    ],
  }));
  const alienCouncilorRows = alienCouncilors.map((councilor, index) => ({
    key: councilor.ID || index,
    cells: [
      <Txt key="name" value={councilor.displayName} />,
      <Txt key="location" value={councilor.locationName} />,
      <Txt key="mission" value={councilor.activeMissionName} />,
      <Txt key="target" value={councilor.activeMissionTarget} />,
      <Num key="skills" value={councilor.totalSkills} decimals={0} />,
      <StatusChip key="status" value={councilor.status || 'ACTIVE'} tone="danger" />,
    ],
  }));

  return (
    <>
      <SectionIntro
        kicker="ALIEN INTELLIGENCE / CAPABILITY GATING"
        title="Threat and discovery record"
        description="Detection capabilities are separated from raw records so an unavailable panel is not mistaken for an empty world."
        count={<CountLbl value={Object.keys(details).length} noun="capability" />}
      />
      <section className="intel-library-block">
        <div className="intel-library-block-heading">
          <span>CAPABILITY VALIDATION</span>
          <small>TECH / STORY GATES</small>
        </div>
        <IntelLibraryTable
          headers={['Capability', 'State', 'Unlock', 'Effect', 'Description']}
          rows={capabilityRows}
          emptyMessage="No capability details are available."
        />
      </section>
      <section className="intel-library-block">
        <div className="intel-library-block-heading">
          <span>ACTIVE ALIEN COUNCILORS</span>
          <small><CountLbl value={alienCouncilorRows.length} noun="confirmed record" /></small>
        </div>
        <IntelLibraryTable
          headers={['Councilor', 'Location', 'Last mission', 'Target', 'Total skills', 'Status']}
          rows={alienCouncilorRows}
          emptyMessage={
            snapshot.mode === 'omniscient'
              ? 'No active alien councilors are present in the current save.'
              : 'Alien councilor records are unavailable at the current detection level.'
          }
        />
      </section>
      <section className="intel-library-block">
        <div className="intel-library-block-heading">
          <span>XENOFORMING</span>
          <small><CountLbl value={xenoRows.length} noun="visible site" /></small>
        </div>
        <IntelLibraryTable
          headers={['Region', 'Level', 'Region ID']}
          rows={xenoRows}
          emptyMessage="No xenoforming sites are visible in this intelligence view."
        />
      </section>
      <section className="intel-library-block">
        <div className="intel-library-block-heading">
          <span>ALIEN FACILITIES</span>
          <small><CountLbl value={facilityRows.length} noun="facility" /></small>
        </div>
        <IntelLibraryTable
          headers={['Facility', 'Location', 'Faction', 'Type']}
          rows={facilityRows}
          emptyMessage="No alien facilities are visible in this intelligence view."
        />
      </section>
      <div className="intel-library-note">
        <strong>Discovery state:</strong>
        {' '}
        Deep System Skywatch is represented by the current filtered space records; it does not override the separate Earth-side discovery gates above.
      </div>
    </>
  );
}

function ExportsSection({ snapshot, onCopyExport }) {
  const statusRef = React.useRef(null);

  const handleExport = (type) => {
    if (onCopyExport) {
      onCopyExport(type, statusRef.current);
    }
  };

  return (
    <>
      <SectionIntro
        kicker="HANDOFF / AI ANALYSIS"
        title="Snapshot exports"
        description="Generate the same compact or full Markdown handoff available in the classic dashboard, using this observer and intelligence mode."
        count={visibility(snapshot)}
      />
      <section className="intel-library-block intel-library-export-block">
        <div className="intel-library-block-heading">
          <span>EXPORT PACKAGE</span>
          <small>MODE AND OBSERVER ARE INCLUDED</small>
        </div>
        <div className="intel-library-export-actions">
          <button
            className="init-btn init-btn-cyan"
            type="button"
            data-library-export="compact"
            onClick={() => handleExport('compact')}
          >
            Copy compact snapshot
          </button>
          <button
            className="init-btn"
            type="button"
            data-library-export="full"
            onClick={() => handleExport('full')}
          >
            Copy full snapshot
          </button>
        </div>
        <div className="intel-library-export-status" data-library-export-status ref={statusRef}>
          Ready to generate a current handoff.
        </div>
      </section>
      <div className="intel-library-note">
        <strong>Handoff label:</strong>
        {' '}
        {visibility(snapshot)}
        {' / '}
        <Txt value={snapshot.observerFactionName} />
        . This keeps the visibility context attached when the report leaves Mission Control.
      </div>
    </>
  );
}

function LibraryContent({
  section,
  snapshot,
  briefing,
  observerId,
  factions,
  spaceTab,
  spaceTheater,
  councilorFaction,
  councilorSearch,
  onNavigate,
  onSpaceTabChange,
  onCouncilorFactionChange,
  onCouncilorSearchChange,
  onOpenFaction,
  onCopyExport,
}) {
  if (section === 'factions') {
    return (
      <FactionsSection
        snapshot={snapshot}
        observerId={observerId}
        factions={factions}
        onOpenFaction={onOpenFaction}
      />
    );
  }
  if (section === 'councilors') {
    return (
      <CouncilorsSection
        snapshot={snapshot}
        factions={factions}
        councilorFaction={councilorFaction}
        councilorSearch={councilorSearch}
        onFactionChange={onCouncilorFactionChange}
        onSearchChange={onCouncilorSearchChange}
      />
    );
  }
  if (section === 'nations') {
    return <NationsSection snapshot={snapshot} factions={factions} />;
  }
  if (section === 'space') {
    return (
      <SpaceSection
        snapshot={snapshot}
        briefing={briefing}
        spaceTab={spaceTab}
        spaceTheater={spaceTheater}
        onSpaceTabChange={onSpaceTabChange}
      />
    );
  }
  if (section === 'research') {
    return <ResearchSection snapshot={snapshot} />;
  }
  if (section === 'threats') {
    return <ThreatsSection snapshot={snapshot} />;
  }
  if (section === 'exports') {
    return <ExportsSection snapshot={snapshot} onCopyExport={onCopyExport} />;
  }
  return (
    <OverviewSection
      snapshot={snapshot}
      briefing={briefing}
      observerId={observerId}
      factions={factions}
      onNavigate={onNavigate}
    />
  );
}

export function IntelligenceLibrary({
  snapshot,
  briefing,
  observerId,
  options = {},
}) {
  const opts = options || {};
  const [section, setSection] = React.useState(opts.section || 'overview');
  const [spaceTab, setSpaceTab] = React.useState(opts.spaceTab || 'mining');
  const [spaceTheater, setSpaceTheater] = React.useState(opts.spaceTheater ?? null);
  const [councilorFaction, setCouncilorFaction] = React.useState(opts.councilorFaction || '');
  const [councilorSearch, setCouncilorSearch] = React.useState(opts.councilorSearch || '');
  const rootRef = React.useRef(null);

  React.useEffect(() => {
    setSection(opts.section || 'overview');
    setSpaceTab(opts.spaceTab || 'mining');
    setSpaceTheater(opts.spaceTheater ?? null);
    setCouncilorFaction(opts.councilorFaction || '');
    setCouncilorSearch(opts.councilorSearch || '');
  }, [snapshot]);

  React.useLayoutEffect(() => {
    const views = typeof window !== 'undefined' ? window.MissionControlViews : null;
    if (views?.syncScrollHints && rootRef.current) {
      views.syncScrollHints(rootRef.current);
    }
  }, [section, spaceTab, spaceTheater, councilorFaction, councilorSearch, snapshot]);

  const navigateSection = React.useCallback((nextSection) => {
    if (opts) {
      opts.section = nextSection;
      opts.spaceTab = 'mining';
      opts.spaceTheater = null;
    }
    setSection(nextSection);
    setSpaceTab('mining');
    setSpaceTheater(null);
  }, [opts]);

  const changeSpaceTab = React.useCallback((tab) => {
    if (opts) {
      opts.section = 'space';
      opts.spaceTab = tab;
    }
    setSection('space');
    setSpaceTab(tab);
  }, [opts]);

  const changeCouncilorFaction = React.useCallback((value) => {
    if (opts) opts.councilorFaction = value;
    setCouncilorFaction(value);
  }, [opts]);

  const changeCouncilorSearch = React.useCallback((value) => {
    if (opts) opts.councilorSearch = value;
    setCouncilorSearch(value);
  }, [opts]);

  const factions = React.useMemo(() => factionMap(snapshot || {}), [snapshot]);
  const activeSectionButtonId = `intel-library-tab-${section}`;

  return (
    <div className="intel-library-shell" ref={rootRef}>
      <div className="intel-library-header">
        <div>
          <div className="intel-library-kicker">MISSION CONTROL / INTELLIGENCE LIBRARY</div>
          <h3>Record room</h3>
          <p>
            All classic dashboard datasets, normalized for the current observer and intelligence mode.
          </p>
        </div>
        <div className="intel-library-header-meta">
          <span>{visibility(snapshot || {})}</span>
          <strong><Txt value={snapshot?.metadata?.gameTimeString} /></strong>
        </div>
      </div>
      <div className="intel-library-layout">
        <nav className="intel-library-nav" aria-label="Intelligence library sections" role="tablist">
          {NAV_SECTIONS.map(([navSection, label]) => (
            <button
              key={navSection}
              type="button"
              className={`intel-library-nav-btn${section === navSection ? ' is-active' : ''}`}
              id={`intel-library-tab-${navSection}`}
              data-library-section={navSection}
              role="tab"
              aria-controls="intel-library-panel"
              aria-selected={section === navSection ? 'true' : 'false'}
              onClick={() => navigateSection(navSection)}
            >
              <span>{label}</span>
              <small>VIEW</small>
            </button>
          ))}
          <a className="intel-library-nav-link" href="/" target="_self">Open classic dashboard</a>
        </nav>
        <div
          className="intel-library-content"
          data-library-content
          id="intel-library-panel"
          role="tabpanel"
          tabIndex={0}
          aria-labelledby={activeSectionButtonId}
        >
          <LibraryContent
            section={section}
            snapshot={snapshot || {}}
            briefing={briefing}
            observerId={observerId}
            factions={factions}
            spaceTab={spaceTab}
            spaceTheater={spaceTheater}
            councilorFaction={councilorFaction}
            councilorSearch={councilorSearch}
            onNavigate={navigateSection}
            onSpaceTabChange={changeSpaceTab}
            onCouncilorFactionChange={changeCouncilorFaction}
            onCouncilorSearchChange={changeCouncilorSearch}
            onOpenFaction={opts.onOpenFaction}
            onCopyExport={opts.onCopyExport}
          />
        </div>
      </div>
    </div>
  );
}
