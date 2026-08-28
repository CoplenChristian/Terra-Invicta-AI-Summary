#!/usr/bin/env node
// scripts/verify_battle_composition.js
//
// Purpose: compose both battle sides from the LIVE save and print the
//   composition blocks and the saturation verdicts, per the acceptance check
//   in the battleComposition brief. Reads the latest save in the configured
//   save folder and the installed game templates — this is a live-save check,
//   deliberately NOT part of the unit suite (which must pass with the save
//   folder pointed at a directory that does not exist).
//
// Run with: node scripts/verify_battle_composition.js
//
// What the module itself cannot do is reported here rather than filled in:
// the raw-save mount join (every nose/hull weapon of every ship) is walked
// separately so its rate is on the output too, and a mount no pipeline can
// resolve is named.
//
// THE DIVERGENCE FROM THE ENGAGEMENT-MATCHUP-SPEC EXPECTED TABLE
// --------------------------------------------------------------
// The spec's expected table (observer 505 PD-targetable) counts every kinetic
// mount as interceptable. The module reads each resolved template's OWN
// `isPointDefenseTargetable` — the spec's stated source of truth — and the
// game's field says the observer's 33 `40mm Autocannon` mounts (family `gun`)
// are NOT interceptable: an unguided slug. So the field-true observer reading
// is 472, and the 33-mount gap is exactly the autocannons, which the
// composition reports in `notPdTargetableMounts` rather than dropping. The
// alien side is unaffected (all of its kinetics are marked targetable) and
// matches the table exactly: 3137 PD-targetable, 693 PD-immune, 472 PD mounts.

const saveParser = require('../server/saveParser');
const templateLoader = require('../server/templateLoader');

const OBSERVER_FACTION = 4712; // the Initiative
const ALIEN_FACTION = 4717; // the Aliens

async function main() {
  let saveFile;
  try {
    saveFile = saveParser.getLatestSaveFile();
  } catch (err) {
    console.error(`[verify_battle_composition] No save available: ${err.message}`);
    process.exit(2);
  }
  const save = saveParser.readSaveJson(saveFile.fullPath);

  templateLoader.load();
  if (!templateLoader.templatesPath) {
    console.error('[verify_battle_composition] No templates directory found; the join cannot run.');
    process.exit(2);
  }

  const { buildWeaponIndex, composeBattleSide, saturationVerdict, normalizeWeaponName, MAX_BATTLE_SIDE_SHIPS } =
    await import('../shared/battleComposition.mjs');

  const gamestates = save.gamestates;
  const ships = (gamestates['PavonisInteractive.TerraInvicta.TISpaceShipState'] || []).map(r => r.Value ?? r);
  const fleets = (gamestates['PavonisInteractive.TerraInvicta.TISpaceFleetState'] || []).map(r => r.Value ?? r);

  // Ship -> faction via its fleet, exactly as the snapshot does.
  const fleetOf = new Map();
  for (const fleet of fleets) {
    for (const ref of (Array.isArray(fleet.ships) ? fleet.ships : [])) {
      fleetOf.set(ref?.value, fleet.faction?.value);
    }
  }

  // Weapon modules resolve through a SAVE-WIDE ref map: a ship's nose/hull
  // entries are `$ref`s into ammo records that can live on any ship.
  const refsById = new Map();
  for (const ship of ships) {
    for (const field of ['noseWeapons', 'hullWeapons', 'utilityModules']) {
      for (const module of (Array.isArray(ship[field]) ? ship[field] : [])) {
        if (module?.$id && module.moduleTemplateName) refsById.set(String(module.$id), module.moduleTemplateName);
      }
    }
    for (const ammo of (Array.isArray(ship.ammo) ? ship.ammo : [])) {
      const key = ammo?.Key;
      if (key?.$id && key.moduleTemplateName) refsById.set(String(key.$id), key.moduleTemplateName);
    }
  }

  const weaponIndex = buildWeaponIndex([...templateLoader.templates.weaponModules.values()]);

  // Per-ship median armour across faces — the same reading the snapshot's
  // `medianArmor` takes — because raw ships do not carry `armorMedian`.
  function shipArmorMedian(ship) {
    const armor = ship?.armor;
    if (!armor || typeof armor !== 'object') return null;
    const values = Object.values(armor).map(face => Number(face?.armorValue)).filter(Number.isFinite);
    if (values.length === 0) return null;
    values.sort((a, b) => a - b);
    const middle = Math.floor(values.length / 2);
    return values.length % 2 ? values[middle] : (values[middle - 1] + values[middle]) / 2;
  }

  // Per-system loadout groups: one group per distinct (role, system) per ship,
  // count = mount instances. The snapshot groups by role only; per-system
  // groups keep the attribution exact, which is how the brief's numbers were
  // measured. Unresolvable mounts are skipped here (the snapshot pipeline
  // drops them too) and their join rate is reported separately below.
  function perSystemLoadout(ship) {
    const groups = new Map();
    for (const field of ['noseWeapons', 'hullWeapons']) {
      for (const moduleRef of (Array.isArray(ship[field]) ? ship[field] : [])) {
        const moduleTemplateName = moduleRef?.moduleTemplateName
          ? moduleRef.moduleTemplateName
          : (moduleRef?.$ref ? refsById.get(String(moduleRef.$ref)) : null);
        if (!moduleTemplateName) continue;
        const entry = weaponIndex.lookup.get(normalizeWeaponName(moduleTemplateName));
        if (!entry) continue;
        const key = `${entry.role}\u0000${entry.displayName}`;
        const current = groups.get(key) || { role: entry.role, category: entry.category, count: 0, systems: [entry.displayName] };
        current.count += 1;
        groups.set(key, current);
      }
    }
    return [...groups.values()];
  }

  // The RAW mount join — every nose/hull weapon of every ship, resolved or not —
  // so the module's 100% system join is backed by the per-mount number.
  function rawMountStats(factionId) {
    const factionShips = ships.filter(s => fleetOf.get(s.ID?.value) === factionId);
    let mounts = 0;
    let resolved = 0;
    const unresolvedNames = new Map();
    for (const ship of factionShips) {
      for (const field of ['noseWeapons', 'hullWeapons']) {
        for (const moduleRef of (Array.isArray(ship[field]) ? ship[field] : [])) {
          const moduleTemplateName = moduleRef?.moduleTemplateName
            ? moduleRef.moduleTemplateName
            : (moduleRef?.$ref ? refsById.get(String(moduleRef.$ref)) : null);
          mounts += 1;
          if (moduleTemplateName && weaponIndex.lookup.get(normalizeWeaponName(moduleTemplateName))) {
            resolved += 1;
          } else {
            const name = moduleTemplateName ?? '(no moduleTemplateName — ref target not in the pool)';
            unresolvedNames.set(name, (unresolvedNames.get(name) || 0) + 1);
          }
        }
      }
    }
    return { ships: factionShips.length, mounts, resolved, unresolved: mounts - resolved, unresolvedNames };
  }

  function composeFaction(factionId) {
    const factionShips = ships.filter(s => fleetOf.get(s.ID?.value) === factionId);
    return composeBattleSide(factionShips.map(s => ({
      armorMedian: shipArmorMedian(s),
      weaponLoadout: perSystemLoadout(s)
    })), { weaponIndex });
  }

  const observer = composeFaction(OBSERVER_FACTION);
  const aliens = composeFaction(ALIEN_FACTION);

  console.log(`Save: ${save.fileName} (${save.gameTimeString || 'time unknown'})`);
  console.log(`Weapon index: ${weaponIndex.templateCount} templates, ${weaponIndex.ambiguousNormalizedNames.length} ambiguous primary key(s)`);
  console.log(`Max battle side: ${MAX_BATTLE_SIDE_SHIPS} ships per side (user-stated, 2026-08-27)\n`);

  const header = ['side', 'ships', 'PD mounts', 'PD-targetable', 'missile shots', 'kinetic mounts', 'PD-immune', 'not PD-targetable', 'armorMedian', 'join rate', 'complete'];
  const rows = [
    ['observer 4712', observer.ships, observer.pointDefenceMounts, observer.pdTargetableShots,
      observer.missileShots, observer.kineticMounts, observer.pdImmuneWeapons,
      observer.notPdTargetableMounts, observer.armorMedian, observer.join.rate, observer.complete],
    ['aliens 4717', aliens.ships, aliens.pointDefenceMounts, aliens.pdTargetableShots,
      aliens.missileShots, aliens.kineticMounts, aliens.pdImmuneWeapons,
      aliens.notPdTargetableMounts, aliens.armorMedian, aliens.join.rate, aliens.complete]
  ];
  console.log(header.join(' | '));
  for (const row of rows) console.log(row.join(' | '));

  console.log('\nbyCategory:');
  for (const [label, side] of [['observer', observer], ['aliens', aliens]]) {
    console.log(`  ${label}: ${JSON.stringify(side.byCategory)}`);
  }

  console.log('\nraw-save mount join (every nose/hull weapon, per mount):');
  for (const [label, factionId] of [['observer', OBSERVER_FACTION], ['aliens', ALIEN_FACTION]]) {
    const raw = rawMountStats(factionId);
    const rate = raw.mounts === 0 ? null : Math.round((raw.resolved / raw.mounts) * 10000) / 100;
    console.log(`  ${label}: ${raw.resolved}/${raw.mounts} mounts resolved (${rate}%)`);
    for (const [name, count] of raw.unresolvedNames) {
      console.log(`    UNRESOLVED x${count}: ${name}`);
    }
  }

  console.log(`\nsalvo-shots-assumed mounts (absent field -> ${1} shot, per SALVO_SHOTS_WHEN_ABSENT): observer ${observer.salvoShotsAssumedMounts}, aliens ${aliens.salvoShotsAssumedMounts}`);

  for (const [label, attacker, defender] of [
    ['observer -> aliens', observer, aliens],
    ['aliens -> observer', aliens, observer]
  ]) {
    const v = saturationVerdict({ attacker, defender });
    console.log(`\nsaturation ${label} (default ${v.pdShotsPerMount}x rule):`);
    if (v.refused) {
      for (const reason of v.refusalReasons) console.log(`  REFUSED: ${reason}`);
    } else {
      console.log(`  attacker targetable shots ${v.attackerPdTargetableShots} vs ${v.defenderPdMounts} PD mounts x ${v.pdShotsPerMount} = ${v.interceptionCapacity} capacity`);
      console.log(`  difference ${v.difference >= 0 ? '+' : ''}${v.difference}, ratio ${v.ratio === null ? 'n/a' : v.ratio.toFixed(3)}, saturated: ${v.saturated}`);
      if (v.ratioUnavailableReason) console.log(`  ${v.ratioUnavailableReason}`);
      console.log(`  PD-immune weapons reported beside the verdict (never folded in): ${v.attackerPdImmuneWeapons}`);
      console.log(`  heuristic: ${v.heuristic.claim} (${v.heuristic.source}, ${v.heuristic.stated})`);
      console.log(`  interception assumption: ${v.assumption.claim} — verified: ${v.assumption.verified}; ${v.assumption.consequence}`);
    }
  }
}

main().catch(err => {
  console.error('[verify_battle_composition]', err);
  process.exit(1);
});
