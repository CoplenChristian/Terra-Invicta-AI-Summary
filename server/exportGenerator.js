const { INITIATIVE_DISPLAY_NAME } = require('../shared/constants.mjs');
const { resolveObserverFaction } = require('../shared/util.mjs');

// Trillions. GDP is quoted in dollars throughout the save.
const ONE_TRILLION = 1e12;

// Absence-preserving render helpers. Every one of these exists because
// `Number(null) === 0`: an unmeasured value coerced into a template reads as a
// measured zero, and `.toFixed` on an absent value throws outright.
const isMeasured = (value) => value !== null && value !== undefined && value !== '' && Number.isFinite(Number(value));

const fixedOr = (value, decimals, fallback = 'UNAVAILABLE') =>
  (isMeasured(value) ? Number(value).toFixed(decimals) : fallback);

const localeOr = (value, fallback = 'UNAVAILABLE') =>
  (isMeasured(value) ? Number(value).toLocaleString() : fallback);

class ExportGenerator {
  generateCompactSnapshot(filteredData) {
    const meta = filteredData.metadata;
    const observer = resolveObserverFaction(filteredData.factions, filteredData.observerFactionId, {
      fallbackToFirst: true
    });
    const isPlayer = filteredData.mode === 'player';

    const lines = [];
    lines.push(`# TI Strategic Snapshot`);
    lines.push(``);
    lines.push(`**Date:** ${meta.gameTimeString || 'Unknown'}`);
    lines.push(`**Observer Faction:** ${observer?.displayName || INITIATIVE_DISPLAY_NAME}`);
    lines.push(`**Intelligence Mode:** ${filteredData.mode.toUpperCase()}`);

    const hateInfo = observer?.alienHate;
    if (hateInfo) {
      if (hateInfo.visibility === 'unavailable') {
        lines.push(`**Assessed Alien Threat:** UNAVAILABLE (Requires Alien Operations research)`);
      } else if (hateInfo.visibility === 'estimated') {
        lines.push(`**Assessed Alien Threat:** ${hateInfo.visibleEstimate} (Game-visible estimate)`);
      } else {
        // `!== null` alone let an *undefined* actual through to .toFixed and
        // threw. Probe for a finite number, and fall back to whatever visible
        // estimate exists rather than crashing the whole export.
        lines.push(`**Alien Hate (Raw Save):** ${isMeasured(hateInfo.actual)
          ? Number(hateInfo.actual).toFixed(2)
          : (hateInfo.visibleEstimate || 'UNAVAILABLE')}`);
      }
    }
    lines.push(``);

    const economics = filteredData.alienHateEconomics;
    if (economics) {
      lines.push(`## Alien Hate Economics`);
      if (!economics.applicable) {
        lines.push(`- **Minimum-hate floor:** NOT APPLICABLE to ${observer?.displayName || 'this faction'}.`);
      } else {
        const actualHate = isMeasured(economics.actualAlienHate)
          ? Number(economics.actualAlienHate).toFixed(2)
          : economics.visibleHateEstimate || 'UNAVAILABLE';
        const actualLabel = isMeasured(economics.actualAlienHate)
          ? 'Raw-save actual hate'
          : economics.visibleHateEstimate
            ? 'Game-visible hate estimate'
            : 'Actual hate';
        lines.push(`- **${actualLabel}:** ${actualHate}`);
        lines.push(`- **Minimum hate floor:** ${fixedOr(economics.minimumAlienHate, 2)}`);
        lines.push(`- **Hate above floor:** ${fixedOr(economics.hateAboveFloor, 2)}`);
        lines.push(`- **War threshold:** ${fixedOr(economics.warThreshold, 2)}`);
        lines.push(`- **Minimum-hate headroom:** ${fixedOr(economics.minimumHateHeadroom, 2)}`);
        lines.push(`- **Mission Control used:** ${fixedOr(economics.usedMissionControl, 0)}`);
        lines.push(`- **Mission Control capacity:** ${fixedOr(economics.missionControlCapacity, 0)} (context only; capacity does not affect hate)`);
        lines.push(`- **MC threshold for a 50-hate floor:** ${fixedOr(economics.mcWarFloor, 1)} used MC`);
        lines.push(`- **Minimum floor status:** ${economics.minimumFloorStatus}`);
        lines.push(`- **Current hate status:** ${economics.currentWarStatus}`);
        lines.push(`- **Calculation:** \`${economics.formula?.text || 'UNAVAILABLE'}\``);
        for (const project of economics.reductionProjects || []) {
          if (!project.applicable) continue;
          lines.push(`- **${project.label}:** ${project.completed ? 'COMPLETED (×0.80)' : 'NOT COMPLETED'}`);
        }
      }
      lines.push(``);
    }

    // 1. Faction Balance
    lines.push(`## Faction Balance`);
    lines.push(``);
    for (const f of filteredData.factions) {
      // GDP gets the same treatment as research on the next line: an
      // unmeasured economy printed "$0.0T", which reads as a collapsed state
      // rather than an unknown one.
      const gdpT = isMeasured(f.totalGdp)
        ? `$${(Number(f.totalGdp) / ONE_TRILLION).toFixed(1)}T GDP`
        : 'UNAVAILABLE GDP';
      // Research output can legitimately be unmeasured. Printing "0.0k" for a
      // null reads as a faction with no research programme at all.
      const research = typeof f.totalResearch === 'number' && Number.isFinite(f.totalResearch)
        ? `${(f.totalResearch / 1e3).toFixed(1)}k Research/mo`
        : 'UNAVAILABLE Research/mo';
      const score = isMeasured(f.powerScore?.overall) ? `${f.powerScore.overall}/100` : 'UNKNOWN';
      const fleetPower = f.combatPowerAvailable ? f.combatPower : 'UNAVAILABLE';
      lines.push(`- **${f.displayName}**: ${f.controlPointsCount} CPs | ${gdpT} | ${f.habsCount ?? 'UNKNOWN'} Habs | ${f.shipsCount ?? 'UNKNOWN'} Ships (${fleetPower} Fleet Power) | ${research} | Dashboard Power Estimate: ${score}`);
    }
    lines.push(``);

    // 2. Strategic Servant / Hostile Holdings
    const priorityFactionName = filteredData.priorityTargetFaction?.name || 'the Servants';
    lines.push(`## Strategic Enemy Holdings (Priority Targets: ${priorityFactionName})`);
    lines.push(``);
    const topTargets = (filteredData.servantTargets || []).slice(0, 8);
    if (topTargets.length > 0) {
      for (const t of topTargets) {
        const targetCPs = t.targetCPCount ?? t.servantCPCount ?? 0;
        const targetGdp = isMeasured(t.gdpTrillion) ? `$${t.gdpTrillion}T GDP` : 'GDP UNAVAILABLE';
        lines.push(`- **${t.nationName}** (Target Score: ${t.score}/100) — ${targetGdp}, ${targetCPs}/${t.totalCPCount} ${t.targetFactionName || priorityFactionName} CPs${t.nukes > 0 ? `, ${t.nukes} Nukes` : ''} [${t.reasons.join('; ')}]`);
      }
    } else {
      lines.push(`- No major hostile holdings currently identified.`);
    }
    lines.push(``);

    // 3. Technology
    lines.push(`## Technology`);
    lines.push(``);
    lines.push(`### Global Research Slots:`);
    for (const slot of filteredData.globalResearch.activeSlots) {
      // An unresolved tech template leaves totalCost -- and therefore percent
      // -- genuinely unknown. Say so instead of printing "null%" or throwing
      // on .toLocaleString().
      const pct = isMeasured(slot.percent) ? `${slot.percent}%` : 'UNKNOWN%';
      lines.push(`- **Slot ${slot.slotNumber}: ${slot.displayName}** — ${pct} (${localeOr(slot.accumulatedResearch)} / ${localeOr(slot.totalCost)}) | Leading: ${slot.leadFactionName} (${localeOr(slot.leadContribution)})`);
    }
    lines.push(``);

    lines.push(`### Observer Projects (${observer?.displayName}):`);
    if (observer?.currentProjects?.length > 0) {
      for (const cp of observer.currentProjects) {
        const pct = isMeasured(cp.percent) ? `${cp.percent}%` : 'UNKNOWN%';
        const cost = isMeasured(cp.totalCost) ? cp.totalCost : 'UNKNOWN';
        lines.push(`- Researching: **${cp.displayName}** (${pct} - ${cp.accumulatedResearch}/${cost})`);
      }
    } else {
      lines.push(`- No active faction project research tracked.`);
    }
    lines.push(``);

    // 4. Alien Intelligence
    lines.push(`## Alien Intelligence`);
    lines.push(``);
    const alienStage = filteredData.alienIntelligenceStage;
    if (alienStage) {
      lines.push(`- **Abductions Detection:** ${alienStage.abductions.status}`);
      lines.push(`- **Alien Contacts Detection:** ${alienStage.contacts.status}`);
      lines.push(`- **Alien Operations Tracking:** ${alienStage.operations.status}`);
      const detected = alienStage.operatives.active ? (alienStage.operatives.detectedCount ?? 0) : 'UNAVAILABLE';
      lines.push(`- **Direct Operative Detection (Alien Movements):** ${alienStage.operatives.status} (${detected} detected)`);
    }

    const alienCouncilors = filteredData.councilors.filter(c => c.isAlien);
    if (alienCouncilors.length > 0) {
      lines.push(`\n**Detected Alien Operatives:**`);
      for (const ac of alienCouncilors) {
        lines.push(`- **${ac.displayName}** | Location: ${ac.locationName} | Status: ${ac.status}`);
      }
    } else {
      lines.push(`\n*No alien councilors currently detected.*`);
    }
    lines.push(``);

    // 5. Space Balance & Fleets
    lines.push(`## Space Balance & Fleets`);
    lines.push(``);
    const bodyFleets = new Map();
    for (const fl of filteredData.fleets) {
      const b = fl.orbitBody || 'Deep Space';
      if (!bodyFleets.has(b)) bodyFleets.set(b, []);
      bodyFleets.get(b).push(fl);
    }

    for (const [body, flList] of bodyFleets.entries()) {
      const summary = [];
      const fMap = new Map();
      for (const fl of flList) {
        if (!fMap.has(fl.factionName)) {
          fMap.set(fl.factionName, { ships: 0, shipsUnknown: false, power: 0, powerKnown: false, powerUnknown: false });
        }
        const obj = fMap.get(fl.factionName);
        // A fleet whose ship count or combat power the save omits is counted
        // as unknown rather than silently added as zero, so a partial total is
        // never presented as a complete one.
        if (Number.isFinite(fl.shipsCount)) obj.ships += fl.shipsCount; else obj.shipsUnknown = true;
        if (Number.isFinite(fl.combatPower)) { obj.power += fl.combatPower; obj.powerKnown = true; } else obj.powerUnknown = true;
      }
      for (const [fname, st] of fMap.entries()) {
        const loadouts = flList.filter(fl => fl.factionName === fname && fl.weaponSummary).map(fl => fl.weaponSummary);
        // A measured zero is reported as 0; only a genuinely absent reading is
        // called unavailable, and a partly-measured total says so.
        const powerLabel = st.powerKnown
          ? (st.powerUnknown ? `${st.power}+ (partial)` : st.power)
          : 'unavailable';
        const shipLabel = st.shipsUnknown ? `${st.ships}+ (partial)` : st.ships;
        summary.push(`${fname}: ${shipLabel} ships (${powerLabel} power${loadouts.length ? `; ${loadouts.join(', ')}` : ''})`);
      }
      lines.push(`- **${body}**: ${summary.join(' | ')}`);
    }

    return lines.join('\n');
  }

  generateFullMarkdownReport(filteredData) {
    const compact = this.generateCompactSnapshot(filteredData);
    const lines = [compact, ''];

    lines.push(`---`);
    lines.push(`## Full Tech Matrix Snapshot`);
    lines.push(``);
    lines.push(`| Project | ${filteredData.factions.map(f => f.displayName.replace('the ', '')).join(' | ')} |`);
    lines.push(`| :--- | ${filteredData.factions.map(() => ':---:').join(' | ')} |`);

    for (const row of filteredData.techMatrix) {
      const cols = [row.displayName];
      for (const f of filteredData.factions) {
        const st = row.factions[f.ID]?.status || 'unknown';
        let badge = '—';
        if (st === 'completed') badge = '✓';
        else if (st === 'researching') badge = '◐';
        else if (st === 'available') badge = '○';
        else if (st === 'unknown') badge = '?';
        cols.push(badge);
      }
      lines.push(`| ${cols.join(' | ')} |`);
    }

    return lines.join('\n');
  }
}

module.exports = new ExportGenerator();
