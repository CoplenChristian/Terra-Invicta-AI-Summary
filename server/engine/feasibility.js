/**
 * server/engine/feasibility.js
 *
 * Evaluates candidate-councilor pairing feasibility against TIMissionCondition rules.
 * Emits a three-outcome signal ('pass', 'fail', 'unknown') rather than binary pass/fail.
 */

function isCouncilorOnEarth(councilor) {
  if (!councilor) return false;
  if (councilor.locationType === 'space') return false;
  if (councilor.locationType === 'earth') return true;
  const loc = String(councilor.location || '').toLowerCase();
  if (loc.includes('orbit') || loc.includes('station') || loc.includes('base') || loc.includes('hab') || loc.includes('fleet')) {
    return false;
  }
  return true;
}

function isCouncilorFree(councilor) {
  if (!councilor) return false;
  const status = String(councilor.status || '').toLowerCase();
  return status !== 'detained' && status !== 'captured' && status !== 'dead';
}

function isCouncilorHuman(councilor) {
  if (!councilor) return false;
  return councilor.isAlien !== true && !String(councilor.type || '').toLowerCase().includes('alien');
}

function evaluateCondition(conditionName, candidate, councilor, world = {}) {
  const norm = String(conditionName || '').replace('TIMissionCondition_', '');

  switch (norm) {
    case 'TargetInRange': {
      const context = candidate?.missionSpec?.context || candidate?.context;
      const onEarth = isCouncilorOnEarth(councilor);
      if (context === 'EarthOnly' && !onEarth) {
        return { status: 'fail', reason: 'Councilor is in space; mission requires Earth theater.' };
      }
      if (context === 'SpaceOnly' && onEarth) {
        return { status: 'fail', reason: 'Councilor is on Earth; mission requires space theater.' };
      }
      // Target specific check if target is nation vs space asset
      if (candidate?.target?.type === 'space_asset' && onEarth) {
        return { status: 'fail', reason: 'Councilor is on Earth; target is in space orbit/body.' };
      }
      return { status: 'pass' };
    }

    case 'CouncilorOnEarth': {
      if (!isCouncilorOnEarth(councilor)) {
        return { status: 'fail', reason: 'Councilor must be stationed on Earth.' };
      }
      return { status: 'pass' };
    }

    case 'Human': {
      if (!isCouncilorHuman(councilor)) {
        return { status: 'fail', reason: 'Mission requires a human operative.' };
      }
      return { status: 'pass' };
    }

    case 'FreeCouncilor': {
      if (!isCouncilorFree(councilor)) {
        return { status: 'fail', reason: 'Councilor is detained or unavailable.' };
      }
      return { status: 'pass' };
    }

    case 'AvailableControlPoint': {
      if (candidate?.target?.availableControlPoints === false || candidate?.target?.hasOpenCP === false) {
        return { status: 'fail', reason: 'Target nation has no available control point slots.' };
      }
      return { status: 'pass' };
    }

    case 'TurnableEnemyCouncilor': {
      const targetCouncilor = candidate?.target?.councilor || candidate?.target;
      if (targetCouncilor?.isTurned === true) {
        return { status: 'fail', reason: 'Target operative is already turned.' };
      }
      if (targetCouncilor?.isAlien === true) {
        return { status: 'fail', reason: 'Alien councilors cannot be turned via standard Turn Councilor.' };
      }
      return { status: 'pass' };
    }

    case 'HasIntelOnCouncilorSecrets': {
      const targetCouncilor = candidate?.target?.councilor || candidate?.target;
      if (targetCouncilor?.secretsKnown === true) {
        return { status: 'pass' };
      }
      if (targetCouncilor?.secretsKnown === false) {
        return {
          status: 'unknown',
          reason: 'Operative secrets are unverified; prior Investigate Councilor recommended.'
        };
      }
      // In player intel mode, secrets status is typically unconfirmed
      return {
        status: 'unknown',
        reason: 'Target councilor secrets unconfirmed in current intelligence picture.'
      };
    }

    case 'DefendableAsset':
    case 'ScannableObjectWithMyControlPoints': {
      return { status: 'pass' };
    }

    default: {
      // Long tail of conditions without direct save models returns unknown rather than fail/pass
      return {
        status: 'unknown',
        reason: `Precondition [${norm}] requires in-theater verification.`
      };
    }
  }
}

function evaluatePairingFeasibility(candidate, councilor, world = {}) {
  if (!isCouncilorFree(councilor)) {
    return {
      status: 'fail',
      reasons: ['Operative is detained or unavailable for mission assignments.']
    };
  }

  const conditions = Array.isArray(candidate?.missionSpec?.conditions)
    ? candidate.missionSpec.conditions
    : (Array.isArray(candidate?.conditions) ? candidate.conditions : []);

  const failReasons = [];
  const unknownReasons = [];

  for (const cond of conditions) {
    const result = evaluateCondition(cond, candidate, councilor, world);
    if (result.status === 'fail') {
      failReasons.push(result.reason || `Failed condition ${cond}`);
    } else if (result.status === 'unknown') {
      unknownReasons.push(result.reason || `Unverified condition ${cond}`);
    }
  }

  if (failReasons.length > 0) {
    return { status: 'fail', reasons: failReasons };
  }
  if (unknownReasons.length > 0) {
    return { status: 'unknown', reasons: unknownReasons };
  }
  return { status: 'pass', reasons: [] };
}

module.exports = {
  isCouncilorOnEarth,
  isCouncilorFree,
  isCouncilorHuman,
  evaluateCondition,
  evaluatePairingFeasibility
};
