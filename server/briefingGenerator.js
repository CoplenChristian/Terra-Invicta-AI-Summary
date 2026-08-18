/**
 * Mission Control Briefing & SITREP Synthesis Engine
 *
 * Compiles raw game-state snapshot data into immersive, actionable,
 * natural-language intelligence statements and strategic directives
 * for the Executive Council in Mission Control v2.
 */

class BriefingGenerator {
  generateMissionControlBriefing(snapshot, rawSnapshot = null) {
    const observerId = snapshot.observerFactionId || 4712;
    const observerName = snapshot.observerFactionName || 'the Initiative';
    const metadata = snapshot.metadata || {};
    const factions = snapshot.factions || [];
    const observer = factions.find(f => f.ID === observerId) || factions[0] || {};
    const councilors = snapshot.councilors || [];
    const nations = snapshot.nations || [];
    const servantTargets = snapshot.servantTargets || [];
    const targetFactionName = snapshot.priorityTargetFaction?.name || 'the Servants';
    const activeAlienStages = snapshot.alienIntelligenceStage || {};
    const xenoforming = snapshot.activeXenoforming || [];
    const globalResearch = snapshot.globalResearch || [];
    const habs = snapshot.habs || [];
    const fleets = snapshot.fleets || [];
    const habSites = snapshot.habSites || [];

    // Calculate Strategic Rank
    const sortedFactions = [...factions].sort((a, b) => (b.powerScore || 0) - (a.powerScore || 0));
    const observerRank = sortedFactions.findIndex(f => f.ID === observerId) + 1;
    const topFaction = sortedFactions[0] || observer;

    // 1. Executive SITREP
    const sitrep = this.buildExecutiveSitrep({
      metadata,
      observer,
      observerRank,
      totalFactions: factions.length,
      topFaction,
      factions,
      targetFactionName,
      servantTargets,
      activeAlienStages,
      xenoforming,
      councilors,
      habs,
      fleets
    });

    // 2. Department Directives (Actionable Statements)
    const geopoliticalDirectives = this.buildGeopoliticalDirectives(servantTargets, nations, targetFactionName, observer);
    const councilDirectives = this.buildCouncilDirectives(councilors, observerId);
    const spaceDirectives = this.buildSpaceDirectives(habs, fleets, habSites, observer);
    const researchDirectives = this.buildResearchDirectives(globalResearch, observer, activeAlienStages);

    // 3. Theater Command Status
    const theaterStatus = this.buildTheaterStatus(nations, xenoforming, targetFactionName, observerId);

    // 4. Operative Roster with Tactical Recommendations
    const operativeRoster = this.buildOperativeRoster(councilors, observerId);

    return {
      campaignDate: metadata.gameTimeString || 'Unknown',
      observerName,
      observerRank,
      powerScore: observer.powerScore || 0,
      alienHateStatus: observer.alienHate?.visibleEstimate || 'UNAVAILABLE',
      sitrep,
      directives: {
        geopolitical: geopoliticalDirectives,
        council: councilDirectives,
        space: spaceDirectives,
        research: researchDirectives
      },
      theaters: theaterStatus,
      operatives: operativeRoster
    };
  }

  buildExecutiveSitrep(ctx) {
    const {
      metadata,
      observer,
      observerRank,
      totalFactions,
      topFaction,
      targetFactionName,
      servantTargets,
      activeAlienStages,
      xenoforming,
      councilors,
      habs,
      fleets
    } = ctx;

    const ownCouncilors = councilors.filter(c => c.isOwnCouncilor);
    const moles = councilors.filter(c => c.isTurnedMole);
    const hydras = councilors.filter(c => c.isAlien);

    // Overall Status Tone
    let defconLevel = 'DEFCON 3 — ELEVATED TACTICAL SURVEILLANCE';
    if (xenoforming.length > 5 || hydras.length > 0) {
      defconLevel = 'DEFCON 2 — ACTIVE ALIEN INCURSION IN PROGRESS';
    }

    // Paragraph 1: Global Geopolitical Stance
    const p1 = `As of ${metadata.gameTimeString || 'the current operational cycle'}, ${observer.displayName} maintains rank #${observerRank} among global factions with a Strategic Power Index of ${observer.powerScore}/100. Our network commands ${observer.controlPointsCount || 0} control points controlling $${observer.gdpTrillion || 0}T in terrestrial GDP, supported by ${observer.monthlyResearch || 0} monthly scientific output. The leading rival faction is ${topFaction.displayName} (Power Index: ${topFaction.powerScore}/100).`;

    // Paragraph 2: Hostile Infiltration & Primary Target
    let p2 = '';
    if (servantTargets.length > 0) {
      const topTarget = servantTargets[0];
      p2 = `PRIORITY THEATER ALERT: Hostile ${targetFactionName} control remains concentrated in ${topTarget.nationName} ($${topTarget.gdpTrillion}T GDP, ${topTarget.targetCPCount || topTarget.servantCPCount}/${topTarget.totalCPCount} CPs). ${topTarget.vulnerabilities?.length > 0 ? `Key intelligence vulnerabilities identified: ${topTarget.vulnerabilities.join(', ')}.` : 'Immediate crackdown authorization recommended.'}`;
    } else {
      p2 = `Terrestrial geopolitics are relatively stabilized; no immediate critical superpower takeover alerts for ${targetFactionName}. Continue consolidating executive control in core territories.`;
    }

    // Paragraph 3: Alien Threat & Extraterrestrial Activity
    let p3 = '';
    const xenoCount = xenoforming.length;
    if (xenoCount > 0) {
      const topXeno = xenoforming[0];
      p3 = `ALIEN INCURSION ADVISORY: Planetary surveillance tracks active xenoforming in ${xenoCount} terrestrial regions (highest activity centered in ${topXeno.regionName} at level ${topXeno.level}). Direct Hydra detection capability: ${activeAlienStages.operatives?.active ? 'ONLINE' : 'RESTRICTED (Alien Movements project required)'}.`;
    } else {
      p3 = `Extraterrestrial terrestrial presence is currently subdued; no anomalous planetary xenoforming hot-zones detected in surveyed sectors.`;
    }

    // Paragraph 4: Space Logistics & Asset Posture
    const ownHabs = habs.filter(h => h.factionId === observer.ID);
    const ownFleets = fleets.filter(f => f.factionId === observer.ID);
    const p4 = `SPACE POSTURE: Strategic aerospace command oversees ${ownHabs.length} orbital installations and ${ownFleets.length} naval battle groups with an active combat fleet rating of ${observer.fleetCombatPower || 0}. Space resource logistics are operational.`;

    return {
      defcon: defconLevel,
      summaryParagraphs: [p1, p2, p3, p4],
      keyMetrics: {
        strategicRank: `#${observerRank} of ${totalFactions}`,
        powerScore: `${observer.powerScore}/100`,
        activeOperatives: `${ownCouncilors.length} Field Agents`,
        turnedMoles: `${moles.length} Assets Embedded`,
        alienHateAssessment: observer.alienHate?.visibleEstimate || 'UNAVAILABLE',
        orbitalInstallations: `${ownHabs.length} Habs Active`
      }
    };
  }

  buildGeopoliticalDirectives(servantTargets, nations, targetFactionName, observer) {
    const directives = [];

    // Target 1: Top Hostile Country
    if (servantTargets.length > 0) {
      const t = servantTargets[0];
      directives.push({
        id: 'geo-1',
        title: `Authorize Operation 'Severance' in ${t.nationName}`,
        category: 'CRACKDOWN & PURGE',
        severity: 'CRITICAL',
        target: t.nationName,
        statement: `${t.nationName} ($${t.gdpTrillion}T GDP) holds ${t.targetCPCount || t.servantCPCount} ${targetFactionName} control points including Executive authority. Stability index is ${t.unrest > 4 ? 'severely degraded (Unrest: ' + t.unrest + ')' : 'stable'}.`,
        action: `Deploy high-Espionage operative to execute Crackdown on executive point, followed by Purge to permanently eliminate ${targetFactionName} control.`,
        successFactor: t.unrest > 4 ? 'HIGH (Vulnerable to subversion)' : 'MODERATE'
      });
    }

    // Target 2: Secondary Superpower or Contested Zone
    if (servantTargets.length > 1) {
      const t2 = servantTargets[1];
      directives.push({
        id: 'geo-2',
        title: `Containment Sweep in ${t2.nationName}`,
        category: 'PUBLIC CAMPAIGN',
        severity: 'HIGH',
        target: t2.nationName,
        statement: `${targetFactionName} maintain ${t2.targetCPCount || t2.servantCPCount} control points in ${t2.nationName} ($${t2.gdpTrillion}T GDP). Popular support can be shifted before next council cycle.`,
        action: `Deploy high-Persuasion councilor on continuous Public Campaign mission to lower crackdown defense thresholds.`,
        successFactor: 'VERY HIGH'
      });
    }

    // General Defense Directive
    directives.push({
      id: 'geo-3',
      title: 'Consolidate Executive Defense in Core Superpowers',
      category: 'DEFEND INTERESTS',
      severity: 'STANDARD',
      target: 'Core National Holdings',
      statement: 'Unprotected control points in high-GDP nations are susceptible to rival Hostile Takeover and Purge operations during council turnovers.',
      action: 'Verify all executive and major economy control points have active "Defend Interests" wards in place.',
      successFactor: 'GUARANTEED PROTECTION'
    });

    return directives;
  }

  buildCouncilDirectives(councilors, observerId) {
    const directives = [];
    const ownCouncilors = councilors.filter(c => c.isOwnCouncilor);
    const moles = councilors.filter(c => c.isTurnedMole);

    // Mole Directive
    if (moles.length > 0) {
      const m = moles[0];
      directives.push({
        id: 'c-mole',
        title: `Exploit Embedded Asset '${m.displayName}' (${m.factionName})`,
        category: 'COUNTER-INTELLIGENCE',
        severity: 'CRITICAL',
        statement: `Turned operative ${m.displayName} remains embedded inside ${m.factionName} hierarchy at location ${m.locationName}. Current mission telemetry: ${m.activeMissionName || 'Standby'}.`,
        action: 'Maintain intelligence surveillance stream. Use known enemy movement schedules to preempt hostile council actions.',
        successFactor: 'CONFIRMED STREAM'
      });
    }

    // Operative Readiness Directives
    const idleAgents = ownCouncilors.filter(c => !c.activeMissionName || c.activeMissionName.includes('Idle') || c.activeMissionName.includes('Standby'));
    if (idleAgents.length > 0) {
      const agent = idleAgents[0];
      directives.push({
        id: 'c-idle',
        title: `Assign Mission Orders to ${agent.displayName} (${agent.typeTemplateName})`,
        category: 'OPERATIVE ASSIGNMENT',
        severity: 'HIGH',
        statement: `${agent.displayName} is currently stationed in ${agent.locationName} with no active operations queued (Skills: ADM ${agent.attributes.Administration}, PER ${agent.attributes.Persuasion}, ESP ${agent.attributes.Espionage}).`,
        action: `Deploy on priority mission matched to specialty: ${agent.attributes.Persuasion > 10 ? 'Public Campaign' : (agent.attributes.Espionage > 10 ? 'Crackdown / Sabotage' : 'Advise Nation')}.`,
        successFactor: 'IMMEDIATE'
      });
    }

    // High Stat Specialization
    const masterAgent = [...ownCouncilors].sort((a, b) => (b.totalSkills || 0) - (a.totalSkills || 0))[0];
    if (masterAgent) {
      directives.push({
        id: 'c-master',
        title: `Leverage Master Operative '${masterAgent.displayName}' (Total Skills: ${masterAgent.totalSkills})`,
        category: 'STRATEGIC ASSET',
        severity: 'STANDARD',
        statement: `${masterAgent.displayName} (${masterAgent.typeTemplateName}) possesses our highest operational skill rating with ${masterAgent.orgs?.length || 0} assigned organizations.`,
        action: `Assign to spearhead critical superpower acquisition or council turn operations.`,
        successFactor: 'PEAK EFFICIENCY'
      });
    }

    return directives;
  }

  buildSpaceDirectives(habs, fleets, habSites, observer) {
    const directives = [];
    const ownHabs = habs.filter(h => h.factionId === observer.ID);
    const ownFleets = fleets.filter(f => f.factionId === observer.ID);

    // Directive 1: Mining Infrastructure
    directives.push({
      id: 'sp-1',
      title: 'Accelerate Off-World Mining Grid (Water & Fissiles)',
      category: 'LOGISTICS & MINING',
      severity: 'HIGH',
      statement: 'Off-world industrial shipyards and propulsion systems require steady daily yields of Water, Volatiles, Metals, and Fissiles to sustain naval parity.',
      action: 'Deploy automated colony probes and claim high-yield celestial mining deposits on Luna and Mars.',
      successFactor: 'EXPONENTIAL COMPOUNDING'
    });

    // Directive 2: Orbital Fleet Readiness
    directives.push({
      id: 'sp-2',
      title: `Orbital Defense Squadron Posture (${ownFleets.length} Fleets Active)`,
      category: 'SPACE DEFENSE',
      severity: 'STANDARD',
      statement: `Extraterrestrial reconnaissance fleets operate across inner system orbits. Current fleet combat power: ${observer.fleetCombatPower || 0}.`,
      action: 'Maintain intercept squadrons in Low Earth Orbit (LEO) to interdict incoming alien surveillance gunships.',
      successFactor: 'DETERRENCE'
    });

    return directives;
  }

  buildResearchDirectives(globalResearch, observer, activeAlienStages) {
    const directives = [];

    // Research Vector 1: Alien Threat Meter
    if (!activeAlienStages.operations?.active) {
      directives.push({
        id: 'res-1',
        title: "Unlock Project 'Alien Operations' (Project_TheirOperations)",
        category: 'STRATEGIC INTEL UNLOCK',
        severity: 'CRITICAL',
        statement: 'Our intelligence command is currently blind to the calibrated Alien Threat Meter and worldwide alien operations.',
        action: 'Prioritize faction engineering slots on Alien Operations to unlock real-time alien hate estimation.',
        successFactor: 'MISSION CRITICAL'
      });
    }

    // Research Vector 2: Direct Hydra Detection
    if (!activeAlienStages.operatives?.active) {
      directives.push({
        id: 'res-2',
        title: "Advance Project 'Alien Movements' (Project_TheirMovements)",
        category: 'TACTICAL RECONNAISSANCE',
        severity: 'HIGH',
        statement: 'Alien Hydra operatives on Earth cannot be directly targeted or unmasked on satellite telemetry without completed xenobiology tracking.',
        action: 'Direct science leadership to unlock Alien Movements upon completing Alien Operations.',
        successFactor: 'TACTICAL ADVANTAGE'
      });
    }

    // Research Vector 3: Global Tech Dominance
    if (globalResearch.length > 0) {
      const topSlot = globalResearch[0];
      directives.push({
        id: 'res-3',
        title: `Contribute to Global Technology: ${topSlot.displayName}`,
        category: 'GLOBAL R&D LEADERSHIP',
        severity: 'STANDARD',
        statement: `Global research slot #1 is researching '${topSlot.displayName}' (${Math.round(topSlot.progressPct || 0)}% complete). Leading contributor decides the next global tech branch.`,
        action: 'Maintain majority research allocation to select the subsequent planetary technological vector.',
        successFactor: `${topSlot.isLeading ? 'CURRENT LEADER' : 'CONTESTED'}`
      });
    }

    return directives;
  }

  buildTheaterStatus(nations, xenoforming, targetFactionName, observerId) {
    const theaters = [
      { id: 'nam', name: 'North America', nations: ['United States', 'Canada', 'Mexico'] },
      { id: 'eur', name: 'Europe & Mediterranean', nations: ['France', 'Germany', 'United Kingdom', 'Italy', 'Spain', 'Poland', 'Ukraine'] },
      { id: 'eap', name: 'East Asia & Pacific', nations: ['China', 'Japan', 'South Korea', 'Taiwan', 'Australia', 'Indonesia'] },
      { id: 'sam', name: 'South America', nations: ['Brazil', 'Argentina', 'Colombia', 'Chile', 'Peru'] },
      { id: 'mea', name: 'Eurasia & Middle East', nations: ['Russia', 'India', 'Pakistan', 'Saudi Arabia', 'Iran', 'Turkey'] },
      { id: 'afr', name: 'African Continent', nations: ['Nigeria', 'Egypt', 'South Africa', 'Ethiopia', 'Kenya'] }
    ];

    return theaters.map(t => {
      const matchedNations = nations.filter(n => t.nations.includes(n.displayName));
      const totalGdp = matchedNations.reduce((sum, n) => sum + (n.GDP || 0), 0);
      const totalGdpTrillion = (totalGdp / 1000).toFixed(1);

      const hostileCount = matchedNations.filter(n => n.executiveFactionName === targetFactionName).length;
      const ownCount = matchedNations.filter(n => n.executiveFactionId === observerId).length;

      let statusTone = 'STABLE';
      let statusColor = '#10b981';
      if (hostileCount > 0) {
        statusTone = `CONTESTED (${hostileCount} Hostile ${targetFactionName} Executives)`;
        statusColor = '#ef4444';
      } else if (ownCount > 0) {
        statusTone = `SECURED (${ownCount} Initiative Executives)`;
        statusColor = '#00e5ff';
      }

      // Xenoforming check
      const sectorXeno = xenoforming.filter(x => matchedNations.some(n => n.displayName.includes(x.regionName) || x.regionName.includes(n.displayName)));

      return {
        id: t.id,
        name: t.name,
        gdpTrillion: totalGdpTrillion,
        statusTone,
        statusColor,
        hostileCount,
        ownCount,
        nationsCount: matchedNations.length,
        xenoformingActive: sectorXeno.length > 0,
        xenoCount: sectorXeno.length,
        keyNations: matchedNations.slice(0, 4).map(n => ({
          name: n.displayName,
          executive: n.executiveFactionName,
          gdpTrillion: ((n.GDP || 0) / 1000).toFixed(1),
          nukes: n.nukes || 0,
          unrest: (n.unrest || 0).toFixed(1)
        }))
      };
    });
  }

  buildOperativeRoster(councilors, observerId) {
    const ownCouncilors = councilors.filter(c => c.isOwnCouncilor);

    return ownCouncilors.map(c => {
      let readiness = 'READY FOR DEPLOYMENT';
      let readinessColor = '#10b981';
      if (c.activeMissionName && !c.activeMissionName.includes('Idle') && !c.activeMissionName.includes('Standby')) {
        readiness = `EXECUTING: ${c.activeMissionName.toUpperCase()}`;
        readinessColor = '#00e5ff';
      }

      // Determine Tactical Recommendation
      let recOrder = 'Maintain current patrol and intelligence sweep.';
      const attrs = c.attributes || {};
      if (attrs.Persuasion >= 12) {
        recOrder = 'Deploy to high-GDP nation to run Public Campaign or Defend Interests.';
      } else if (attrs.Espionage >= 12) {
        recOrder = 'Deploy to hostile territory to execute Crackdown or Sabotage Facilities.';
      } else if (attrs.Investigation >= 12) {
        recOrder = 'Conduct Surveil Location or Investigate Councilor to unmask enemy moles.';
      } else if (attrs.Administration >= 12) {
        recOrder = 'Manage assigned organizations, advise executive nations, or conduct Hostile Takeover.';
      } else if (attrs.Command >= 12) {
        recOrder = 'Lead military assault, suppress unrest, or organize orbital defense.';
      }

      return {
        id: c.ID,
        name: c.displayName,
        profession: c.typeTemplateName,
        location: c.locationName,
        locationType: c.locationType || 'Earth Region',
        activeMission: c.activeMissionName || 'Standby',
        activeMissionTarget: c.activeMissionTarget || null,
        readiness,
        readinessColor,
        totalSkills: c.totalSkills || 0,
        topSkill: this.getTopSkillString(attrs),
        orgsCount: c.orgs?.length || 0,
        traitsCount: c.traits?.length || 0,
        recommendedOrder: recOrder
      };
    });
  }

  getTopSkillString(attrs) {
    if (!attrs) return 'Standard';
    const skills = [
      { name: 'Administration', val: attrs.Administration || 0, code: 'ADM' },
      { name: 'Persuasion', val: attrs.Persuasion || 0, code: 'PER' },
      { name: 'Investigation', val: attrs.Investigation || 0, code: 'INV' },
      { name: 'Espionage', val: attrs.Espionage || 0, code: 'ESP' },
      { name: 'Command', val: attrs.Command || 0, code: 'CMD' },
      { name: 'Science', val: attrs.Science || 0, code: 'SCI' },
      { name: 'Security', val: attrs.Security || 0, code: 'SEC' }
    ];
    skills.sort((a, b) => b.val - a.val);
    const top = skills[0];
    return `${top.code} ${top.val} (${top.name})`;
  }
}

module.exports = new BriefingGenerator();
