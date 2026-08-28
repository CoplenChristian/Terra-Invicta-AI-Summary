/**
 * src/v2/panels/battleSuggestionUtils.mjs
 *
 * Purpose: testable battle-matchup helpers behind BattleSuggestion.jsx — weapon
 *   index from baked componentStats, selected-ship resolution, saturation copy,
 *   and launcher-denominated advice. All counting joins through
 *   shared/battleComposition.mjs; nothing here reimplements the weapon join.
 */

import {
  buildWeaponIndex,
  composeBattleSide,
  saturationVerdict,
  weaponTemplatesFromComponentStats,
  PD_OVERWHELM_MULTIPLE,
  INTERCEPTION_ASSUMPTION,
} from '../../../shared/battleComposition.mjs';
import {
  fleetById,
  presentCount,
  shipId,
} from './battlePanelUtils.mjs';

// The weapon-family list and the componentStats -> template-record adapter now
// live beside the join they feed, in shared/battleComposition.mjs, because
// war-room section 1d needs the same two and a second copy of a join that took
// two rounds to get right would drift. Re-exported as the SAME function
// objects, so every existing importer of this module is unchanged.
export {
  WEAPON_FAMILIES,
  weaponTemplatesFromComponentStats,
} from '../../../shared/battleComposition.mjs';

/** Ships from one fleet whose ids are in the selection list. */
export function shipsForSelection(fleet, selectedShipIds) {
  if (!fleet || !Array.isArray(selectedShipIds) || selectedShipIds.length === 0) return [];
  const idSet = new Set(selectedShipIds.map(String));
  return (Array.isArray(fleet.ships) ? fleet.ships : []).filter((ship) => {
    const id = shipId(ship);
    return id != null && idSet.has(id);
  });
}

/**
 * @returns {{ weaponIndex: object|null, left: object|null, right: object|null,
 *   yourSalvoVsTheirScreen: object|null, theirSalvoVsYourScreen: object|null }}
 */
export function buildBattleMatchup({
  fleets,
  leftFleetId,
  leftSelectedShipIds,
  rightFleetId,
  rightSelectedShipIds,
  componentStats,
} = {}) {
  const leftFleet = fleetById(fleets, leftFleetId);
  const rightFleet = fleetById(fleets, rightFleetId);
  const leftShips = shipsForSelection(leftFleet, leftSelectedShipIds);
  const rightShips = shipsForSelection(rightFleet, rightSelectedShipIds);

  const templates = weaponTemplatesFromComponentStats(componentStats);
  const weaponIndex = templates.length > 0 ? buildWeaponIndex(templates) : null;

  const left = leftShips.length > 0 && weaponIndex
    ? composeBattleSide(leftShips, { weaponIndex })
    : null;
  const right = rightShips.length > 0 && weaponIndex
    ? composeBattleSide(rightShips, { weaponIndex })
    : null;

  const yourSalvoVsTheirScreen = left && right
    ? saturationVerdict({ attacker: left, defender: right })
    : null;
  const theirSalvoVsYourScreen = left && right
    ? saturationVerdict({ attacker: right, defender: left })
    : null;

  return {
    weaponIndex,
    leftShips,
    rightShips,
    left,
    right,
    yourSalvoVsTheirScreen,
    theirSalvoVsYourScreen,
  };
}

/** Label for launcher-denominated advice from the attacker's weapon mix. */
export function mountUnitLabel(attackerSide) {
  if (!attackerSide) return 'launcher or mount equivalents';
  const missileMounts = attackerSide.byCategory?.Missile ?? 0;
  const targetableKinetic = Math.max(
    0,
    (attackerSide.kineticMounts ?? 0) - (attackerSide.notPdTargetableMounts ?? 0),
  );
  if (missileMounts > 0 && targetableKinetic === 0) return 'salvo bays';
  if (targetableKinetic > 0 && missileMounts === 0) return 'kinetic mounts';
  return 'launcher or mount equivalents';
}

/**
 * Convert a shot shortfall or surplus into an estimated mount count using the
 * attacker's own targetable mix — never hulls.
 *
 * @returns {{ shots: number, estimatedMounts: number, unit: string }|null}
 */
export function mountEquivalentAdvice(shots, attackerSide) {
  if (!presentCount(shots) || shots <= 0 || !attackerSide) return null;

  const targetableKinetic = Math.max(
    0,
    (attackerSide.kineticMounts ?? 0) - (attackerSide.notPdTargetableMounts ?? 0),
  );
  const missileMounts = attackerSide.byCategory?.Missile ?? 0;
  const totalTargetableMounts = missileMounts + targetableKinetic;
  const totalShots = attackerSide.pdTargetableShots;

  if (!presentCount(totalShots) || totalShots <= 0 || totalTargetableMounts <= 0) return null;

  const shotsPerMount = totalShots / totalTargetableMounts;
  if (!Number.isFinite(shotsPerMount) || shotsPerMount <= 0) return null;

  return {
    shots,
    estimatedMounts: Math.ceil(shots / shotsPerMount),
    unit: mountUnitLabel(attackerSide),
  };
}

/** Join completeness as a percentage for display; null when no systems. */
export function joinRatePercent(side) {
  const rate = side?.join?.rate;
  if (!presentCount(rate)) return null;
  return Math.round(rate * 1000) / 10;
}

/** Which sides are selected enough to show anything. */
export function selectionPhase(leftShipCount, rightShipCount) {
  if (leftShipCount === 0 && rightShipCount === 0) return 'none';
  if (leftShipCount > 0 && rightShipCount > 0) return 'both';
  return 'one';
}

export function formatCount(value) {
  if (!presentCount(value)) return '—';
  return value.toLocaleString('en-US');
}

export function formatRatio(value) {
  if (!presentCount(value)) return '—';
  return `${(value * 100).toFixed(1)}%`;
}

/**
 * Plain-language saturation headline for one direction.
 *
 * @returns {{ headline: string, detail: string|null, saturated: boolean|null, refused: boolean }}
 */
export function saturationHeadline(verdict, { attackerLabel, defenderLabel }) {
  if (!verdict) {
    return { headline: 'Saturation not computed.', detail: null, saturated: null, refused: true };
  }

  if (verdict.refused) {
    return {
      headline: 'Saturation refused — weapon join incomplete.',
      detail: (verdict.refusalReasons || []).join(' '),
      saturated: null,
      refused: true,
    };
  }

  const shots = verdict.attackerPdTargetableShots;
  const capacity = verdict.interceptionCapacity;
  const diff = verdict.difference;

  if (verdict.ratioUnavailableReason) {
    return {
      headline: `${attackerLabel} targetable salvo arrives — ${defenderLabel} fields no point-defence screen.`,
      detail: verdict.ratioUnavailableReason,
      saturated: verdict.saturated,
      refused: false,
    };
  }

  if (verdict.saturated) {
    const surplus = presentCount(diff) && diff > 0 ? diff : 0;
    return {
      headline: `${attackerLabel} salvo overwhelms ${defenderLabel}'s screen.`,
      detail: surplus > 0
        ? `Surplus of ${surplus.toLocaleString('en-US')} targetable shot${surplus === 1 ? '' : 's'} above the ${PD_OVERWHELM_MULTIPLE}× rule.`
        : `Meets the ${PD_OVERWHELM_MULTIPLE}× point-defence rule exactly.`,
      saturated: true,
      refused: false,
    };
  }

  const shortfall = presentCount(diff) ? Math.abs(diff) : null;
  return {
    headline: `${defenderLabel}'s screen holds against ${attackerLabel}'s salvo.`,
    detail: presentCount(shortfall)
      ? `Shortfall of ${shortfall.toLocaleString('en-US')} targetable shot${shortfall === 1 ? '' : 's'} below the ${PD_OVERWHELM_MULTIPLE}× rule.`
      : null,
    saturated: false,
    refused: false,
  };
}

/**
 * Build advice for one saturation direction.
 *
 * @returns {{ kind: 'shortfall'|'surplus'|'none', text: string|null, advice: object|null }}
 */
export function changeAdvice(verdict, attackerSide, { attackerLabel, defenderLabel }) {
  if (!verdict || verdict.refused) {
    return { kind: 'none', text: null, advice: null };
  }

  const diff = verdict.difference;
  if (!presentCount(diff)) return { kind: 'none', text: null, advice: null };

  if (diff < 0) {
    const shortfall = Math.abs(diff);
    const mountAdvice = mountEquivalentAdvice(shortfall, attackerSide);
    if (!mountAdvice) {
      return {
        kind: 'shortfall',
        text: `${attackerLabel} is ${shortfall.toLocaleString('en-US')} targetable shot${shortfall === 1 ? '' : 's'} short of overwhelming ${defenderLabel}'s screen; mount mix cannot be denominated from this selection.`,
        advice: null,
      };
    }
    return {
      kind: 'shortfall',
      text: `${attackerLabel} is ${shortfall.toLocaleString('en-US')} targetable shot${shortfall === 1 ? '' : 's'} short of overwhelming ${defenderLabel}'s screen; that is roughly ${mountAdvice.estimatedMounts.toLocaleString('en-US')} more ${mountAdvice.unit}.`,
      advice: mountAdvice,
    };
  }

  if (diff > 0 && verdict.saturated) {
    const mountAdvice = mountEquivalentAdvice(diff, attackerSide);
    if (!mountAdvice) {
      return {
        kind: 'surplus',
        text: `${attackerLabel} exceeds the screen by ${diff.toLocaleString('en-US')} targetable shot${diff === 1 ? '' : 's'}.`,
        advice: null,
      };
    }
    return {
      kind: 'surplus',
      text: `${attackerLabel} exceeds the screen by ${diff.toLocaleString('en-US')} targetable shot${diff === 1 ? '' : 's'} — roughly ${mountAdvice.estimatedMounts.toLocaleString('en-US')} ${mountAdvice.unit} worth of headroom.`,
      advice: mountAdvice,
    };
  }

  return { kind: 'none', text: null, advice: null };
}

/** Visible interception caveat — must render on screen, not only in comments. */
export function interceptionCaveatText() {
  return `${INTERCEPTION_ASSUMPTION.claim} (${INTERCEPTION_ASSUMPTION.verified ? 'verified' : 'not verified'} — ${INTERCEPTION_ASSUMPTION.whyNotVerified}). ${INTERCEPTION_ASSUMPTION.consequence}`;
}
