// server/engine/candidates/normalize.js
//
// One schema for every candidate, whatever generator produced it.
//
// Before this existed the hand-written generators emitted `value.*`,
// `hate.toAliens`, and lower-case `cost.kind`, while the catalogue generator
// emitted `baseValue`, flat `successHate`/`failureHate`, and capitalised
// `cost.kind` -- so `hate/total-war-budget`, `hate/war-threshold-crossing`
// and `cost/affordability` all had `appliesTo` predicates that were false for
// every catalogue candidate. Three safety vetoes silently did not run.
//
// The fix belongs here rather than in each rule: a rule that has to accept two
// shapes will be missed by the next generator someone adds.

/**
 * The canonical candidate families. Every rule's `appliesTo` keys off one of
 * these, so a generator inventing its own spelling silently opts its
 * candidates out of the rules that were supposed to govern them.
 *
 *   expansion    - taking or denying a control point (Control Nation, Purge)
 *   defense      - protecting a holding we already own (Defend Interests)
 *   council      - councilor-targeted operations (Investigate, Turn)
 *   intelligence - alien-facing intelligence (sightings, Detain an alien)
 *   advisory     - persistent output missions (Advise)
 */
const CANDIDATE_FAMILIES = Object.freeze(['expansion', 'defense', 'council', 'intelligence', 'advisory']);

function looksUnresolved(value) {
  if (value === null || value === undefined) return true;
  const text = String(value).trim();
  if (text === '') return true;
  // `${nation.id || nation.name}` on a record carrying neither stringifies to
  // "undefined", which is a perfectly valid Set key -- so 295 distinct nations
  // collapsed onto one entry and 294 candidates vanished into the dedupe.
  return /(^|[:\-/])(undefined|null|NaN)([:\-/]|$)/.test(text);
}

/**
 * Reduces the template's three hate outcome slots to the {low, high} envelope
 * the hate rules read. Returns null when NO slot is measurable -- and null
 * here means unknown, which the hate rules turn into an 'unknown' outcome,
 * not into a pass. A slot that is absent is skipped rather than counted as 0.
 */
function hateEnvelopeFromSlots(slots) {
  const measured = slots.filter((slot) => typeof slot === 'number' && Number.isFinite(slot));
  if (measured.length === 0) return null;
  return {
    low: Math.min(...measured),
    high: Math.max(...measured),
    measuredSlots: measured.length,
    totalSlots: slots.length
  };
}

function normalizeCandidate(candidate) {
  const spec = candidate.missionSpec || null;

  // --- mission naming -------------------------------------------------
  // The catalogue keys missions by dataName ('DefendInterests') while every
  // rule, clock and roster comparison in this codebase uses the friendly name
  // ('Defend Interests'). Normalise to the friendly name.
  const missionType = (spec && spec.friendlyName) || candidate.missionType || null;

  // --- hate ------------------------------------------------------------
  const templateApplies = candidate.templateApplies !== false;
  const slots = [
    candidate.successHate ?? (templateApplies ? spec?.successHate : undefined),
    candidate.criticalHate ?? (templateApplies ? spec?.criticalHate : undefined),
    candidate.failureHate ?? (templateApplies ? spec?.failureHate : undefined)
  ];
  let hate;
  if (candidate.hate && candidate.hate.toAliens
    && typeof candidate.hate.toAliens.low === 'number'
    && typeof candidate.hate.toAliens.high === 'number') {
    // An explicitly measured envelope always wins -- Detain against an alien
    // is special-cased in the wiki and its candidate says so in its own note,
    // so the human-target template row must not be folded back over it.
    hate = candidate.hate;
  } else {
    const envelope = hateEnvelopeFromSlots(slots);
    hate = envelope
      ? { toAliens: envelope, note: candidate.hate?.note || (spec ? `TIMissionTemplate ${missionType} outcome hate slots.` : null) }
      : { toAliens: null, note: candidate.hate?.note || `Alien-hate exposure for ${missionType || 'this mission'} is not in this snapshot.` };
  }

  // Flat slots for the pairing layer, which weights success/failure hate by
  // the odds. Null stays null: pairing must not read an unmeasured slot as 0.
  const successHate = typeof slots[0] === 'number' ? slots[0] : null;
  const criticalHate = typeof slots[1] === 'number' ? slots[1] : null;
  const failureHate = typeof slots[2] === 'number' ? slots[2] : null;

  // --- cost -------------------------------------------------------------
  let cost = null;
  const rawCost = candidate.cost || null;
  const resource = rawCost?.resource ?? spec?.costResource ?? null;
  const kindRaw = rawCost?.kind ?? spec?.costKind ?? null;
  const amountRaw = rawCost && rawCost.amount !== undefined
    ? rawCost.amount
    : (typeof spec?.costAmount === 'number' ? spec.costAmount : null);
  if (resource || kindRaw) {
    cost = {
      resource: resource || null,
      kind: kindRaw ? String(kindRaw).toLowerCase() : null,
      amount: typeof amountRaw === 'number' && Number.isFinite(amountRaw) ? amountRaw : null
    };
  }

  // --- value / provenance / preconditions -------------------------------
  const value = (candidate.value && typeof candidate.value === 'object' && !Array.isArray(candidate.value))
    ? candidate.value
    : {};
  const provenance = (candidate.provenance && typeof candidate.provenance === 'object')
    ? candidate.provenance
    : { source: candidate.provenance ? String(candidate.provenance) : 'unattributed generator', estimateClass: 'heuristic' };

  const target = candidate.target && typeof candidate.target === 'object' ? { ...candidate.target } : {};
  if (target.kind === undefined && target.type !== undefined) target.kind = target.type;
  if (target.type === undefined && target.kind !== undefined) target.type = target.kind;

  return {
    ...candidate,
    missionType,
    friendlyName: candidate.friendlyName || missionType,
    family: candidate.family || null,
    target,
    hate,
    successHate,
    criticalHate,
    failureHate,
    cost,
    value,
    provenance,
    unmetPreconditions: Array.isArray(candidate.unmetPreconditions) ? candidate.unmetPreconditions : [],
    baseValue: typeof candidate.baseValue === 'number' && Number.isFinite(candidate.baseValue)
      ? candidate.baseValue
      : null
  };
}

module.exports = {
  CANDIDATE_FAMILIES,
  looksUnresolved,
  hateEnvelopeFromSlots,
  normalizeCandidate
};
