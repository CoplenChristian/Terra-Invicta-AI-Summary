class ExportGenerator {
  generateCompactSnapshot(filteredData) {
    const meta = filteredData.metadata;
    const observer = filteredData.factions.find(f => f.ID === filteredData.observerFactionId) || filteredData.factions[0];
    const isPlayer = filteredData.mode === 'player';

    const lines = [];
    lines.push(`# TI Strategic Snapshot`);
    lines.push(``);
    lines.push(`**Date:** ${meta.gameTimeString || 'Unknown'}`);
    lines.push(`**Observer Faction:** ${observer?.displayName || 'the Initiative'}`);
    lines.push(`**Intelligence Mode:** ${filteredData.mode.toUpperCase()}`);

    const hateInfo = observer?.alienHate;
    if (hateInfo) {
      if (hateInfo.visibility === 'unavailable') {
        lines.push(`**Assessed Alien Threat:** UNAVAILABLE (Requires Alien Operations research)`);
      } else if (hateInfo.visibility === 'estimated') {
        lines.push(`**Assessed Alien Threat:** ${hateInfo.visibleEstimate} (Game-visible estimate)`);
      } else {
        lines.push(`**Alien Hate (Raw Save):** ${hateInfo.actual !== null ? hateInfo.actual.toFixed(2) : hateInfo.visibleEstimate}`);
      }
    }
    lines.push(``);

    // 1. Faction Balance
    lines.push(`## Faction Balance`);
    lines.push(``);
    for (const f of filteredData.factions) {
      const gdpT = ((f.totalGdp || 0) / 1e12).toFixed(1);
      const resK = ((f.totalResearch || 0) / 1e3).toFixed(1);
      const score = f.powerScore?.overall ?? 'UNKNOWN';
      const fleetPower = f.combatPowerAvailable ? f.combatPower : 'UNAVAILABLE';
      lines.push(`- **${f.displayName}**: ${f.controlPointsCount} CPs | $${gdpT}T GDP | ${f.habsCount ?? 'UNKNOWN'} Habs | ${f.shipsCount ?? 'UNKNOWN'} Ships (${fleetPower} Fleet Power) | ${resK}k Research/mo | Dashboard Power Estimate: ${score}/100`);
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
        lines.push(`- **${t.nationName}** (Target Score: ${t.score}/100) — $${t.gdpTrillion}T GDP, ${targetCPs}/${t.totalCPCount} ${t.targetFactionName || priorityFactionName} CPs${t.nukes > 0 ? `, ${t.nukes} Nukes` : ''} [${t.reasons.join('; ')}]`);
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
      lines.push(`- **Slot ${slot.slotNumber}: ${slot.displayName}** — ${slot.percent}% (${slot.accumulatedResearch.toLocaleString()} / ${slot.totalCost.toLocaleString()}) | Leading: ${slot.leadFactionName} (${slot.leadContribution.toLocaleString()})`);
    }
    lines.push(``);

    lines.push(`### Observer Projects (${observer?.displayName}):`);
    if (observer?.currentProjects?.length > 0) {
      for (const cp of observer.currentProjects) {
        lines.push(`- Researching: **${cp.displayName}** (${cp.percent}% - ${cp.accumulatedResearch}/${cp.totalCost})`);
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
        if (!fMap.has(fl.factionName)) fMap.set(fl.factionName, { ships: 0, power: 0 });
        const obj = fMap.get(fl.factionName);
        obj.ships += fl.shipsCount;
        obj.power += fl.combatPower;
      }
      for (const [fname, st] of fMap.entries()) {
        const loadouts = flList.filter(fl => fl.factionName === fname && fl.weaponSummary).map(fl => fl.weaponSummary);
        summary.push(`${fname}: ${st.ships} ships (${st.power || 'unavailable'} power${loadouts.length ? `; ${loadouts.join(', ')}` : ''})`);
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
