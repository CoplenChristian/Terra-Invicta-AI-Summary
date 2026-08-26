/**
 * src/v2/panels/ExecutiveBoards.jsx
 *
 * Purpose: renders the executive boards — faction power, resources, and the
 *   strategic ranking surface (COMMAND view).
 */

import React from 'react';
import { DataTable } from '../components/DataTable.jsx';
import {
  BOARD_SCROLL_HINT,
  EM_DASH,
  alienForceSummary,
  availabilityByProjectId,
  bodyKey,
  bodyLabel,
  completedProjectSignal,
  factionById,
  factionDelta,
  factionLogoHtml,
  factionName,
  factionStatus,
  formatDelta,
  formatGdp,
  formatNumber,
  nationPosture,
  numberValue,
  operativeRole,
  ownWeaponMix,
  rankLabel,
  shipCountLabel,
  shipLoadoutText,
  skillDetail,
  weaponCount,
} from './executiveBoardsUtils.js';

function BoardNote({ title, children }) {
  return (
    <div className="mc-board-note">
      <strong>{title}</strong>
      <span>{children}</span>
    </div>
  );
}

function BoardSubheading({ title, children }) {
  return (
    <div className="mc-board-subheading">
      <strong>{title}</strong>
      <span>{children}</span>
    </div>
  );
}

function StatusChip({ children, className = '' }) {
  return <span className={`mc-status-chip${className ? ` ${className}` : ''}`}>{children}</span>;
}

function BoardEmpty({ children }) {
  return <div className="mc-board-empty">{children}</div>;
}

function FactionLogoHead({ faction, displayName, subtitle }) {
  const logoHtml = factionLogoHtml(faction, 'faction-logo faction-logo--ledger');
  return (
    <span className="mc-board-faction-head">
      {logoHtml ? <span dangerouslySetInnerHTML={{ __html: logoHtml }} /> : null}
      <span>
        {displayName}
        {subtitle ? <small className="mc-board-secondary">{subtitle}</small> : null}
      </span>
    </span>
  );
}

function SkillCell({ councilor, skill }) {
  const detail = skillDetail(councilor, skill);
  if (detail.value === null) return <td>{EM_DASH}</td>;
  const total = detail.bonus || 0;
  const parts = [`${detail.base} base`];
  if (detail.orgBonus) parts.push(`${detail.orgBonus > 0 ? '+' : ''}${detail.orgBonus} orgs`);
  if (detail.traitBonus) parts.push(`${detail.traitBonus > 0 ? '+' : ''}${detail.traitBonus} traits`);
  if (detail.capped) parts.push(`capped at 25 (would be ${detail.uncapped})`);
  const bonus = total !== 0
    ? (
      <span
        className={`mc-skill-org${total < 0 ? ' is-negative' : ''}`}
        title={parts.join(', ')}
      >
        {total > 0 ? '+' : ''}{total}
      </span>
    )
    : null;
  return (
    <td className="mc-skill-cell">
      {formatNumber(detail.value)}
      {bonus}
    </td>
  );
}

function AvailabilityChip({ node }) {
  const availability = node && node.availability;
  if (!availability || !availability.known) {
    return <StatusChip>UNKNOWN</StatusChip>;
  }
  const wait = availability.expectedMonths === null || availability.expectedMonths === undefined
    ? ''
    : ` · ~${availability.expectedMonths} mo`;
  if (availability.schedulable) {
    return <StatusChip className="is-safe">GUARANTEED{wait}</StatusChip>;
  }
  return (
    <StatusChip className="is-warning">
      RNG {availability.maxPercent}% CAP{wait}
    </StatusChip>
  );
}

function McBoardTable({
  columns,
  subVariant,
  emptyMessage,
  rowCount,
  children,
}) {
  if (!rowCount) {
    return <BoardEmpty>{emptyMessage}</BoardEmpty>;
  }
  return (
    <DataTable
      variant="mc-board"
      subVariant={subVariant}
      columns={columns}
      hintText={BOARD_SCROLL_HINT}
    >
      {children}
    </DataTable>
  );
}

export function FactionLedgerBoard({ snapshot }) {
  const factions = Array.isArray(snapshot?.factions) ? snapshot.factions.slice() : [];
  factions.sort((a, b) => {
    const aObserver = String(a.ID) === String(snapshot?.observerFactionId) ? 1 : 0;
    const bObserver = String(b.ID) === String(snapshot?.observerFactionId) ? 1 : 0;
    return bObserver - aObserver || (numberValue(b.totalGdp) || 0) - (numberValue(a.totalGdp) || 0);
  });

  const columns = [
    { key: 'faction', label: 'Faction' },
    { key: 'cp', label: 'CP' },
    { key: 'gdp', label: 'GDP' },
    { key: 'habs', label: 'Habs / Ships' },
    { key: 'status', label: 'Strategic status' },
  ];

  return (
    <>
      <BoardNote title="LEDGER / CURRENT STATE">
        R&amp;D, alien hate, and save-to-save deltas sit beneath the primary control and asset signals. Ship count is an asset count, not a combat estimate.
      </BoardNote>
      <McBoardTable
        columns={columns}
        subVariant="ledger"
        emptyMessage="No faction records are available."
        rowCount={factions.length}
      >
        <tbody>
          {factions.map((faction) => {
            const shipDelta = factionDelta(snapshot, faction.ID, 'Ships');
            const gdpDelta = factionDelta(snapshot, faction.ID, 'GDP');
            const hate = faction.alienHate?.visibleEstimate ?? faction.assessedAlienHateOfMe;
            const isObserver = String(faction.ID) === String(snapshot?.observerFactionId);
            const hateLabel = hate === undefined || hate === null ? 'UNAVAILABLE' : formatNumber(hate, 1);
            const shipDeltaClass = shipDelta?.delta > 0 ? 'is-positive' : shipDelta?.delta < 0 ? 'is-negative' : '';
            return (
              <tr
                key={faction.ID}
                className={isObserver ? 'is-observer' : undefined}
                data-board-faction-id={faction.ID}
              >
                <th scope="row">
                  <FactionLogoHead
                    faction={faction}
                    displayName={faction.displayName}
                    subtitle={`R&D ${formatNumber(faction.totalResearch)} · HATE ${hateLabel}`}
                  />
                </th>
                <td>{formatNumber(faction.controlPointsCount)}</td>
                <td>
                  {formatGdp(faction.totalGdp)}
                  <small className="mc-board-secondary">GDP Δ {formatDelta(gdpDelta)}</small>
                </td>
                <td>
                  {formatNumber(faction.habsCount)} / {formatNumber(faction.shipsCount)}
                  <small className={`mc-board-secondary${shipDeltaClass ? ` ${shipDeltaClass}` : ''}`}>
                    Δ ships {formatDelta(shipDelta)}
                  </small>
                </td>
                <td><StatusChip>{factionStatus(faction, factions)}</StatusChip></td>
              </tr>
            );
          })}
        </tbody>
      </McBoardTable>
    </>
  );
}

export function LogisticsBoard({ snapshot, strategic }) {
  const position = strategic?.resourcePosition;
  const resources = position?.resources ? Object.values(position.resources) : [];

  const columns = [
    { key: 'resource', label: 'Resource' },
    { key: 'stock', label: 'Stockpile' },
    { key: 'gross', label: 'Gross/mo' },
    { key: 'spent', label: 'Spent / committed' },
    { key: 'queued', label: 'Queued / next' },
    { key: 'runway', label: 'Runway' },
    { key: 'source', label: 'Incoming production' },
  ];

  return (
    <>
      <BoardNote title="LOGISTICS / STOCKPILE + OUTPUT">
        Gross production is save-derived. Burn, committed spend, and runway remain UNAVAILABLE until those values are present in the save.
      </BoardNote>
      <McBoardTable
        columns={columns}
        emptyMessage="Resource production is unavailable in this snapshot."
        rowCount={resources.length}
      >
        <tbody>
          {resources.map((resource) => {
            const queue = resource.underConstruction || [];
            const queueText = queue.length
              ? `${queue.length} queued · ${queue.slice(0, 2).map((item) => `${item.body || item.site || 'site'}${numberValue(item.daysRemaining) === null ? '' : ` / ${formatNumber(item.daysRemaining, 1)}d`}`).join(', ')}`
              : 'No visible queue';
            const source = resource.topProducers?.[0]
              ? `${resource.topProducers[0].site || 'site'} · +${formatNumber(resource.topProducers[0].monthly, 1)}`
              : 'No active producer';
            return (
              <tr key={resource.label || resource.id}>
                <th scope="row">{resource.label}</th>
                <td>{formatNumber(resource.stock, 0)}</td>
                <td>+{formatNumber(resource.grossPerMonth, 1)}</td>
                <td>{resource.spendPerMonth === null ? 'UNAVAILABLE' : formatNumber(resource.spendPerMonth, 1)}</td>
                <td>{queueText}</td>
                <td>{resource.runwayDays === null ? 'UNAVAILABLE' : `${formatNumber(resource.runwayDays, 1)}d`}</td>
                <td>{source}</td>
              </tr>
            );
          })}
        </tbody>
      </McBoardTable>
    </>
  );
}

export function CapabilityMatrixBoard({ snapshot, briefing }) {
  const factions = Array.isArray(snapshot?.factions) ? snapshot.factions : [];
  const observer = factionById(snapshot, snapshot.observerFactionId) || {};
  const humans = factions.filter((faction) => !String(faction.displayName).toLowerCase().includes('alien'));
  const mix = ownWeaponMix(snapshot, snapshot.observerFactionId);
  const capabilities = snapshot.capabilities || {};
  const completed = completedProjectSignal(observer, /Drive|Rockets|Propulsion/i, [
    { test: /NervaDrive/i, label: 'Nerva Drive' },
    { test: /BurnerDrive/i, label: 'Burner Drive' },
    { test: /NuclearFreighters/i, label: 'Nuclear Freighters' },
  ]);
  const kinetic = completedProjectSignal(observer, /Rail|Autocannon|Railgun/i, [
    { test: /RailCannonMk3/i, label: 'Rail Cannon Mk3' },
    { test: /RailgunBatteryMk3/i, label: 'Railgun Battery Mk3' },
    { test: /RailCannonMk2/i, label: 'Rail Cannon Mk2' },
  ]);
  const missile = completedProjectSignal(observer, /Missile/i, [
    { test: /CopperheadMissileBay/i, label: 'Copperhead Missile Bay' },
    { test: /AnacondaMissileBay/i, label: 'Anaconda Missile Bay' },
  ]);
  const pd = completedProjectSignal(observer, /PointDefense/i, [
    { test: /PointDefenseArray/i, label: 'Point Defense Array' },
    { test: /PointDefenseLaserTurret/i, label: 'Point Defense Laser Turret' },
  ]);
  const intelDetails = capabilities.details || {};
  const intelActive = ['detectAlienAbductions', 'detectAlienHumanContacts', 'detectAlienOperations', 'detectAlienCouncilors']
    .map((key) => intelDetails[key])
    .filter(Boolean)
    .map((detail) => `${detail.requiredDisplayName}: ${detail.active ? 'ONLINE' : 'LOCKED'}`)
    .join(' · ') || 'UNAVAILABLE';

  const matrixRows = [
    ['Earth GDP rank', rankLabel(factions, observer, 'totalGdp'), formatGdp(observer.totalGdp)],
    ['Research output rank', rankLabel(factions, observer, 'totalResearch'), `${formatNumber(observer.totalResearch, 0)} / month`],
    ['Human ship rank', rankLabel(humans, observer, 'shipsCount'), `${formatNumber(observer.shipsCount)} ships`],
    ['Space hab rank', rankLabel(factions, observer, 'habsCount'), `${formatNumber(observer.habsCount)} habs`],
    ['Dominant loadout', mix[0] ? `${mix[0][0]} × ${formatNumber(mix[0][1])}` : 'UNAVAILABLE', mix.length ? mix.map((entry) => `${entry[0]} ${entry[1]}`).join(' · ') : 'No fleet loadout visible'],
    ['Best drive signal', completed, 'Derived from completed ship / propulsion projects'],
    ['Best kinetic signal', kinetic, 'Derived from completed weapon projects'],
    ['Best missile signal', missile, 'Derived from completed weapon projects'],
    ['Point defense signal', pd, 'Derived from completed weapon projects'],
    ['Alien intelligence', capabilities.canDetectAlienOperations ? 'OPERATIONS ONLINE' : 'OPERATIONS LOCKED', intelActive],
  ];

  const columns = [
    { key: 'capability', label: 'Capability' },
    { key: 'signal', label: 'Current signal' },
    { key: 'evidence', label: 'Evidence / consequence' },
  ];

  return (
    <>
      <BoardNote title="CAPABILITY / DISCRETE SIGNALS">
        Ranks compare current save values. Weapon and technology labels are evidence from the parsed save, not a combat-power estimate.
      </BoardNote>
      <DataTable variant="mc-board" columns={columns} hintText={BOARD_SCROLL_HINT}>
        <tbody>
          {matrixRows.map(([label, signal, evidence]) => (
            <tr key={label}>
              <th scope="row">{label}</th>
              <td>{signal}</td>
              <td>{evidence}</td>
            </tr>
          ))}
        </tbody>
      </DataTable>
    </>
  );
}

function FleetRosterDetails({ fleet }) {
  const ships = Array.isArray(fleet?.ships) ? fleet.ships : [];
  if (!ships.length) {
    return <BoardEmpty>Ship-level loadouts are unavailable for this fleet.</BoardEmpty>;
  }
  return ships.map((ship) => (
    <div key={ship.displayName || ship.ID} className="mc-fleet-ship-row">
      <strong>{ship.displayName || 'Unnamed ship'}</strong>
      <span>{shipLoadoutText(ship)}</span>
    </div>
  ));
}

function OwnFleetBreakdown({ snapshot, fleets }) {
  const observerId = snapshot?.observerFactionId;
  const ownFleets = fleets
    .filter((fleet) => String(fleet.factionId) === String(observerId))
    .slice()
    .sort((a, b) => String(a.orbitBody || '').localeCompare(String(b.orbitBody || '')) || String(a.displayName || '').localeCompare(String(b.displayName || '')));

  if (!ownFleets.length) {
    return <BoardEmpty>No fleet composition is visible for the selected faction.</BoardEmpty>;
  }

  const columns = [
    { key: 'fleet', label: 'Fleet' },
    { key: 'body', label: 'Orbit body' },
    { key: 'ships', label: 'Ships' },
    { key: 'dominant', label: 'Dominant' },
    { key: 'weapons', label: 'Weapon composition' },
  ];

  return (
    <div className="mc-fleet-breakdown">
      <BoardSubheading
        title={`${(factionName(snapshot, observerId) || 'SELECTED FACTION').toUpperCase()} FLEET BREAKDOWN`}
      >
        Dominant role + equipped weapons
      </BoardSubheading>
      <McBoardTable columns={columns} subVariant="fleet" emptyMessage="No fleet records are available." rowCount={ownFleets.length}>
        <tbody>
          {ownFleets.map((fleet) => (
            <tr key={fleet.ID || fleet.displayName}>
              <th scope="row">{fleet.displayName || 'Unnamed fleet'}</th>
              <td>{bodyLabel(fleet.orbitBody)}</td>
              <td>{formatNumber(fleet.shipsCount)}</td>
              <td><StatusChip>{fleet.dominantWeaponType || 'UNAVAILABLE'}</StatusChip></td>
              <td>{fleet.weaponSummary || 'Loadout unavailable'}</td>
            </tr>
          ))}
        </tbody>
      </McBoardTable>
      <div className="mc-fleet-roster-list">
        {ownFleets.map((fleet) => (
          <details key={fleet.ID || fleet.displayName} className="mc-fleet-roster-item">
            <summary>
              <strong>{fleet.displayName || 'Unnamed fleet'}</strong>
              <span>
                {shipCountLabel(fleet.shipsCount)} · {bodyLabel(fleet.orbitBody)} · {fleet.dominantWeaponType || 'loadout unavailable'} · {fleet.mission || 'mission unavailable'}
              </span>
            </summary>
            <div className="mc-fleet-ship-list">
              <FleetRosterDetails fleet={fleet} />
            </div>
          </details>
        ))}
      </div>
    </div>
  );
}

export function TheaterBoard({ snapshot, strategic }) {
  const theaters = (strategic?.spaceTheaters || []).filter((theater) => theater.key !== 'unassigned' || theater.fleets || theater.habs || theater.miningSites);
  const posture = strategic?.spacePosture;
  const fleets = Array.isArray(snapshot?.fleets) ? snapshot.fleets : [];
  const aliens = fleets.filter((fleet) => String(fleet.factionName || '').toLowerCase().includes('alien') || String(fleet.factionId) === '4717');
  const force = alienForceSummary(aliens);

  const theaterColumns = [
    { key: 'theater', label: 'Theater' },
    { key: 'own', label: 'Our ships / fleets' },
    { key: 'hostile', label: 'Hostile ships / fleets' },
    { key: 'habs', label: 'Our habs' },
    { key: 'mines', label: 'Mines' },
    { key: 'largest', label: 'Largest hostile fleet' },
    { key: 'inbound', label: 'Inbound' },
    { key: 'status', label: 'Status' },
  ];

  const contactColumns = [
    { key: 'fleet', label: 'Fleet' },
    { key: 'ships', label: 'Ships' },
    { key: 'body', label: 'Body' },
    { key: 'pd', label: 'PD' },
    { key: 'missiles', label: 'Missiles' },
    { key: 'lasers', label: 'Lasers' },
    { key: 'kinetics', label: 'Kinetics' },
    { key: 'mission', label: 'Mission' },
    { key: 'destination', label: 'Destination' },
    { key: 'eta', label: 'ETA' },
  ];

  const contacts = aliens.slice().sort((a, b) => (numberValue(b.shipsCount) || 0) - (numberValue(a.shipsCount) || 0)).slice(0, 8);

  return (
    <>
      <BoardNote title="SPACE / LOCATION FIRST">
        Sol is one orbit-body, not a synonym for the whole solar system. Fragmentation is derived from visible Sol fleet size; contact loadouts are summarized from equipped ship weapons.
      </BoardNote>
      {posture ? (
        <>
          <div className="mc-space-scope">
            <span>
              <strong>{posture.scope?.totalLabel || 'ALL TRACKED BODIES'}</strong>
              <b>{formatNumber(posture.total?.fleets)} fleets / {formatNumber(posture.total?.ships)} ships</b>
            </span>
            <span>
              <strong>{posture.scope?.solLabel || 'ORBIT BODY: SOL'}</strong>
              <b>{formatNumber(posture.sol?.fleets)} fleets / {formatNumber(posture.sol?.ships)} ships</b>
            </span>
          </div>
          <div className="mc-board-scope-note">{posture.scope?.note || 'Sol is a specific orbit-body value, not the whole system.'}</div>
        </>
      ) : null}
      <div className="mc-space-force-summary">
        <div>
          <strong>{formatNumber(force.totalShips)}</strong>
          <span>ALIEN SHIPS / ALL TRACKED BODIES</span>
        </div>
        <div>
          <strong>{formatNumber(force.totalFleets)}</strong>
          <span>ALIEN FLEETS</span>
        </div>
        <div>
          <strong>{formatNumber(force.solShips)} / {formatNumber(force.solFleets)}</strong>
          <span>SOL SHIPS / FLEETS</span>
        </div>
        <div>
          <strong>{force.averageSolFleet === null ? 'UNAVAILABLE' : formatNumber(force.averageSolFleet, 1)}</strong>
          <span>AVERAGE SOL FLEET</span>
        </div>
        <div>
          <strong>{force.fragmentation}</strong>
          <span>SOL FRAGMENTATION</span>
        </div>
      </div>
      <div className="mc-space-body-list">
        <BoardSubheading title="ALIEN FORCE BY ORBIT BODY">Largest concentrations first</BoardSubheading>
        {force.bodies.length ? force.bodies.map(([body, group]) => (
          <div key={body} className="mc-space-body-row">
            <strong>{body}</strong>
            <span>{formatNumber(group.ships)} ships / {formatNumber(group.fleets)} fleets</span>
          </div>
        )) : (
          <BoardEmpty>Alien force posture is unavailable in this intelligence mode.</BoardEmpty>
        )}
      </div>
      <OwnFleetBreakdown snapshot={snapshot} fleets={fleets} />
      <McBoardTable
        columns={theaterColumns}
        emptyMessage="No theater posture is available."
        rowCount={theaters.length}
      >
        <tbody>
          {theaters.map((theater) => {
            const hostile = aliens.filter((fleet) => bodyKey(fleet.orbitBody, fleet.spaceTheaterKey) === theater.key);
            const largest = hostile.slice().sort((a, b) => (numberValue(b.shipsCount) || 0) - (numberValue(a.shipsCount) || 0))[0];
            const inbound = hostile.filter((fleet) => fleet.arrivalDate || String(fleet.destination || '') !== String(fleet.orbitBody || '')).length;
            const status = hostile.length ? (theater.ownShips ? 'CONTESTED' : 'HOSTILE PRESENCE') : (theater.ownShips ? 'OWN HOLDINGS' : 'NO VISIBLE CONTACT');
            return (
              <tr key={theater.key} data-board-theater={theater.key}>
                <th scope="row">
                  <button className="mc-board-row-link" type="button" data-board-theater-link={theater.key}>
                    {theater.name}
                  </button>
                </th>
                <td>{formatNumber(theater.ownShips)} / {formatNumber(theater.ownFleets)}</td>
                <td>{formatNumber(theater.alienShips)} / {formatNumber(theater.alienFleets)}</td>
                <td>{formatNumber(theater.ownHabs ?? theater.habs)}</td>
                <td>{formatNumber(theater.ownMiningSites ?? theater.miningSites)}</td>
                <td>{largest ? `${largest.displayName} · ${formatNumber(largest.shipsCount)} ships` : EM_DASH}</td>
                <td>{inbound ? formatNumber(inbound) : EM_DASH}</td>
                <td><StatusChip className={hostile.length ? 'is-danger' : ''}>{status}</StatusChip></td>
              </tr>
            );
          })}
        </tbody>
      </McBoardTable>
      {contacts.length ? (
        <>
          <BoardSubheading title="HOSTILE CONTACT BOARD">Largest visible contacts by ship count</BoardSubheading>
          <McBoardTable columns={contactColumns} emptyMessage="No hostile contacts are visible." rowCount={contacts.length}>
            <tbody>
              {contacts.map((fleet) => (
                <tr key={fleet.ID || fleet.displayName}>
                  <th scope="row">{fleet.displayName}</th>
                  <td>{formatNumber(fleet.shipsCount)}</td>
                  <td>{bodyLabel(fleet.orbitBody)}</td>
                  <td>{formatNumber(weaponCount(fleet, 'point defense'))}</td>
                  <td>{formatNumber(weaponCount(fleet, 'missile'))}</td>
                  <td>{formatNumber(weaponCount(fleet, 'laser'))}</td>
                  <td>{formatNumber(weaponCount(fleet, 'kinetic'))}</td>
                  <td>{fleet.mission || 'UNAVAILABLE'}</td>
                  <td>{bodyLabel(fleet.destination || fleet.orbitBody)}</td>
                  <td>{fleet.arrivalDate || EM_DASH}</td>
                </tr>
              ))}
            </tbody>
          </McBoardTable>
        </>
      ) : null}
    </>
  );
}

const OPERATIONS_SKILLS = ['Persuasion', 'Investigation', 'Espionage', 'Command', 'Administration', 'Science', 'Security'];

export function OperationsBoard({ snapshot, strategic }) {
  const councilors = (snapshot?.councilors || []).filter((councilor) => String(councilor.factionId) === String(snapshot.observerFactionId) && councilor.isActiveCouncilor !== false && councilor.isIndependent !== true && String(councilor.status || 'Active').toLowerCase() === 'active');
  const roles = strategic?.councilCapabilities?.missionRoles || [];

  const columns = [
    { key: 'operative', label: 'Operative' },
    { key: 'location', label: 'Location' },
    { key: 'mission', label: 'Current mission' },
    { key: 'per', label: 'PER' },
    { key: 'inv', label: 'INV' },
    { key: 'esp', label: 'ESP' },
    { key: 'cmd', label: 'CMD' },
    { key: 'adm', label: 'ADM' },
    { key: 'sci', label: 'SCI' },
    { key: 'sec', label: 'SEC' },
    { key: 'role', label: 'Role' },
  ];

  return (
    <>
      <BoardNote title="OPERATIONS / ACTIVE COUNCILORS">
        Skill values are <strong>effective</strong>: base attributes plus equipped-org bonuses, which is what missions actually resolve against. A <em>+n</em> marks the org contribution. Trait modifiers are not included — many are conditional on nation state. Independent and inactive records are excluded.
      </BoardNote>
      <McBoardTable columns={columns} emptyMessage="No active councilors are available." rowCount={councilors.length}>
        <tbody>
          {councilors.map((councilor) => (
            <tr key={councilor.ID || councilor.displayName}>
              <th scope="row">{councilor.displayName}</th>
              <td>{councilor.locationName || 'Unknown'}</td>
              <td>{councilor.activeMissionName || 'No active mission'}</td>
              {OPERATIONS_SKILLS.map((skill) => (
                <SkillCell key={skill} councilor={councilor} skill={skill} />
              ))}
              <td><StatusChip>{operativeRole(councilor)}</StatusChip></td>
            </tr>
          ))}
        </tbody>
      </McBoardTable>
      {roles.length ? (
        <>
          <BoardSubheading title="MISSION COVERAGE">Best available operative by role</BoardSubheading>
          <div className="mc-coverage-grid">
            {roles.map((role) => (
              <div key={role.mission} className="mc-coverage-row">
                <span>{role.mission}</span>
                <strong>{role.best?.name || 'UNAVAILABLE'}</strong>
                <em>
                  {role.best?.value === null || role.best?.value === undefined
                    ? EM_DASH
                    : `${formatNumber(role.best.value)} ${role.skill.slice(0, 3).toUpperCase()}`}
                </em>
              </div>
            ))}
          </div>
        </>
      ) : null}
    </>
  );
}

export function NationQueueBoard({ snapshot, briefing }) {
  const observerId = snapshot.observerFactionId;
  const priorityId = briefing?.priorityTargetFaction?.id;
  const nations = (snapshot?.nations || []).filter((nation) => nation.executiveFactionId || nation.controlPoints?.length).slice().sort((a, b) => {
    const aPriority = String(a.executiveFactionId) === String(priorityId) || String(a.executiveFactionId) === String(observerId) ? 1 : 0;
    const bPriority = String(b.executiveFactionId) === String(priorityId) || String(b.executiveFactionId) === String(observerId) ? 1 : 0;
    return bPriority - aPriority || (numberValue(b.GDP) || 0) - (numberValue(a.GDP) || 0);
  }).slice(0, 12);

  const columns = [
    { key: 'nation', label: 'Nation' },
    { key: 'executive', label: 'Executive' },
    { key: 'cp', label: 'CP composition' },
    { key: 'gdp', label: 'GDP' },
    { key: 'research', label: 'Research' },
    { key: 'cohesion', label: 'Cohesion' },
    { key: 'unrest', label: 'Unrest' },
    { key: 'armies', label: 'Armies' },
    { key: 'posture', label: 'Recommended posture' },
  ];

  return (
    <>
      <BoardNote title="EARTH / ACTION QUEUE">
        Postures are triage labels derived from executive control, unrest, and the selected priority faction. They are not completed operations.
      </BoardNote>
      <McBoardTable columns={columns} emptyMessage="No nation holdings are available." rowCount={nations.length}>
        <tbody>
          {nations.map((nation) => {
            const cp = (nation.controlPoints || []).reduce((counts, point) => {
              const key = point.factionName || factionName(snapshot, point.factionId);
              counts[key] = (counts[key] || 0) + 1;
              return counts;
            }, {});
            const cpText = Object.entries(cp).map(([name, count]) => `${name.replace(/^the /i, '')} ${count}`).join(' · ') || 'No CP detail';
            const risk = (numberValue(nation.unrest) || 0) >= 2 ? ' · unrest watch' : '';
            return (
              <tr key={nation.displayName}>
                <th scope="row">{nation.displayName}</th>
                <td>{nation.executiveFactionName || 'Independent'}</td>
                <td>{cpText}</td>
                <td>{formatGdp(nation.GDP)}</td>
                <td>{formatNumber(nation.research, 0)}</td>
                <td>{formatNumber(nation.cohesion, 1)}</td>
                <td>{formatNumber(nation.unrest, 1)}</td>
                <td>{formatNumber(nation.armies)}</td>
                <td>
                  <StatusChip>{nationPosture(nation, observerId, priorityId)}</StatusChip>
                  <small className="mc-board-secondary">{`${formatNumber(nation.nukes)} nukes${risk}`}</small>
                </td>
              </tr>
            );
          })}
        </tbody>
      </McBoardTable>
    </>
  );
}

export function ResearchWatchlistBoard({ snapshot }) {
  const observer = factionById(snapshot, snapshot.observerFactionId) || {};
  const observerLabel = observer.displayName || snapshot.observerFactionName || 'SELECTED FACTION';
  const slots = snapshot.globalResearch?.activeSlots || [];
  const availability = availabilityByProjectId(snapshot);
  const projects = (observer.currentProjects || []).slice().sort((a, b) => (numberValue(b.percent) || 0) - (numberValue(a.percent) || 0));
  const gaps = Object.values(snapshot.capabilities?.details || {}).filter((detail) => detail.active === false).slice(0, 6);

  const globalColumns = [
    { key: 'project', label: 'Project' },
    { key: 'progress', label: 'Progress' },
    { key: 'lead', label: 'Current lead' },
    { key: 'output', label: 'Lead output' },
  ];
  const projectColumns = [
    { key: 'project', label: 'Project' },
    { key: 'progress', label: 'Progress' },
    { key: 'accumulated', label: 'Accumulated / cost' },
    { key: 'availability', label: 'Availability' },
  ];
  const gapColumns = [
    { key: 'capability', label: 'Capability' },
    { key: 'status', label: 'Status' },
    { key: 'unlock', label: 'Unlock / consequence' },
  ];

  return (
    <div className="mc-watch-grid">
      <section>
        <BoardSubheading title="GLOBAL RESEARCH">Active slots</BoardSubheading>
        <McBoardTable columns={globalColumns} emptyMessage="No global research slots are available." rowCount={slots.length}>
          <tbody>
            {slots.map((slot) => (
              <tr key={slot.techId || slot.displayName}>
                <th scope="row">{slot.displayName || slot.techId}</th>
                <td>{formatNumber(slot.percent, 1)}%</td>
                <td>{slot.leadFactionName || 'UNAVAILABLE'}</td>
                <td>{formatNumber(slot.leadContribution, 0)}</td>
              </tr>
            ))}
          </tbody>
        </McBoardTable>
      </section>
      <section>
        <BoardSubheading title={`${observerLabel.toUpperCase()} PROJECTS`}>Active projects</BoardSubheading>
        <McBoardTable columns={projectColumns} emptyMessage="No active faction projects are available." rowCount={projects.length}>
          <tbody>
            {projects.map((project) => (
              <tr key={project.projectId || project.displayName}>
                <th scope="row">{project.displayName || project.projectId}</th>
                <td>{formatNumber(project.percent, 1)}%</td>
                <td>{formatNumber(project.accumulatedResearch, 0)} / {formatNumber(project.totalCost, 0)}</td>
                <td><AvailabilityChip node={availability.get(project.projectId)} /></td>
              </tr>
            ))}
          </tbody>
        </McBoardTable>
      </section>
      <section>
        <BoardSubheading title="INTELLIGENCE GAPS">Capability unlocks</BoardSubheading>
        <McBoardTable columns={gapColumns} emptyMessage="No locked capability records are available." rowCount={gaps.length}>
          <tbody>
            {gaps.map((detail) => (
              <tr key={detail.name || detail.requiredProject}>
                <th scope="row">{detail.name}</th>
                <td><StatusChip className="is-danger">LOCKED</StatusChip></td>
                <td>{detail.requiredDisplayName || detail.requiredProject || 'Requirement unavailable'}</td>
              </tr>
            ))}
          </tbody>
        </McBoardTable>
      </section>
    </div>
  );
}
