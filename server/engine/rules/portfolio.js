// server/engine/rules/portfolio.js
//
// Purpose: resource-portfolio constraints — can the observer pay for this
//   action out of the stock it actually holds.
//
// Resource-portfolio constraints: can the observer pay for this action out of
// the stock it actually holds?
//
// Only flat costs are answerable. A bonus cost scales with the roll and is not
// a fixed number this snapshot could carry, so there is no affordability
// question to answer rather than an unanswered one -- the rule does not apply
// at all rather than returning 'unknown'.

const { toFiniteNumber } = require('../../../shared/util.mjs');

const affordability = {
  id: 'cost/affordability',
  kind: 'veto',
  // `kind` is lower-cased by normalizeCandidate. The game templates spell it
  // 'Flat'/'Bonus' and the hand-written generators spell it 'flat'/'bonus',
  // and this predicate only ever matched the lower-case spelling -- so every
  // catalogue-derived candidate skipped the affordability veto. The
  // comparison stays strict; the normalisation is what makes it correct.
  //
  // Bonus costs are deliberately out of scope: their amount scales with the
  // roll and is not a fixed number this snapshot could carry, so there is no
  // affordability question to answer rather than an unanswered one.
  appliesTo: (candidate) => candidate.cost !== null && candidate.cost !== undefined && candidate.cost.kind === 'flat',
  evaluate(world, candidate) {
    const amount = toFiniteNumber(candidate.cost.amount);
    if (amount === null) return 'unknown';
    const stock = world.resources ? toFiniteNumber(world.resources[candidate.cost.resource]) : null;
    if (stock === null) return 'unknown';
    return amount > stock ? 'veto' : 'pass';
  },
  because(world, candidate) {
    const amount = candidate.cost?.amount;
    const stock = world.resources ? world.resources[candidate.cost.resource] : undefined;
    if (amount === null || amount === undefined) return 'Flat cost amount is not resolvable for this candidate.';
    const stockNumber = toFiniteNumber(stock);
    if (stockNumber === null) {
      return `${candidate.cost.resource} stock is not available in this snapshot -- affordability cannot be confirmed.`;
    }
    return amount > stockNumber
      ? `Costs ${amount} ${candidate.cost.resource}, only ${stockNumber} in stock.`
      : `Costs ${amount} ${candidate.cost.resource}; ${stockNumber} in stock covers it.`;
  },
  source: 'Notion 09 / TIMissionTemplate -- Defend Interests is a verified flat 20 Influence cost; '
    + 'generalised here to any flat-cost mission candidate.',
  estimateClass: 'exact'
};

module.exports = { affordability };
