/**
 * scripts/publish/techGraph.js -- stage 3a: what happens to the tech tree on
 * the way into a published row.
 *
 * Isolated because all three tech-tree modes -- shared, inline, omitted -- have
 * to agree on one fingerprint, and the fingerprint is what a reader uses to
 * decide whether the stored graph still matches the row it is splicing into.
 * Split across the row builder and the uploader, the fingerprint and the split
 * would be free to disagree.
 */

const crypto = require('crypto');

// The tech tree is 94% static: `nodes` (~959 KB) is derived from the game
// templates and is byte-identical across every row and every save, while
// finishedTechsNames / globalActive / factionStatus (~60 KB) are per-save.
//
// Split it: the static half is uploaded once per campaign and rehydrated by
// readers, the per-save half stays inline. An earlier blanket strip had to be
// reverted because the hosted worker cannot rebuild template data from a
// reference alone; sharing one stored copy keeps those queries working.
function splitTechTree(modeData, fingerprint) {
  if (!modeData || !modeData.techTree) return modeData;
  const { techTree, ...rest } = modeData;
  const { nodes, categories, unlockClasses, ...perSave } = techTree;
  return {
    ...rest,
    techTree: {
      ...perSave,
      // Readers splice the shared graph back in via this fingerprint.
      graphRef: {
        fingerprint,
        nodeCount: Array.isArray(nodes) ? nodes.length : 0,
        source: 'campaigns.tech_graph'
      }
    }
  };
}

function techGraphFingerprint(techTree) {
  const canonicalize = (value) => {
    if (Array.isArray(value)) return value.map(canonicalize);
    if (value && typeof value === 'object') {
      return Object.fromEntries(Object.keys(value).sort().map(key => [key, canonicalize(value[key])]));
    }
    return value;
  };
  const graph = {
    nodes: Array.isArray(techTree?.nodes)
      ? [...techTree.nodes].sort((left, right) => String(left?.id || '').localeCompare(String(right?.id || '')))
      : [],
    categories: techTree?.categories || {},
    unlockClasses: techTree?.unlockClasses || {}
  };
  // Include all graph content, not just IDs. Prerequisites, costs, effects,
  // categories, and unlock classes can change in a template patch while the
  // node set remains identical.
  const serialized = JSON.stringify(canonicalize(graph));
  const digest = crypto.createHash('sha256').update(serialized, 'utf8').digest('hex').slice(0, 32);
  return `tg:sha256:${digest}`;
}

function applyTechTreeMode(modeData, options, fingerprint) {
  if (options.omitTechTree) {
    const nodeCount = Array.isArray(modeData?.techTree?.nodes) ? modeData.techTree.nodes.length : 0;
    const { techTree, ...rest } = modeData || {};
    return {
      ...rest,
      techTreeRef: {
        omitted: true,
        nodeCount,
        reason: 'static template data omitted by --omit-tech-tree'
      }
    };
  }
  return options.shareTechGraph ? splitTechTree(modeData, fingerprint) : modeData;
}

/**
 * The campaign-level copy of the static graph, or null when this run is not
 * sharing it. Null is meaningful: the uploader must not write a tech_graph
 * column for an --inline-tech-tree or --omit-tech-tree run.
 */
function buildSharedTechGraph(rawSnapshot, options, fingerprint) {
  if (!options.shareTechGraph || !rawSnapshot.techTree) return null;
  return {
    fingerprint,
    nodes: rawSnapshot.techTree.nodes || [],
    categories: rawSnapshot.techTree.categories || {},
    unlockClasses: rawSnapshot.techTree.unlockClasses || {}
  };
}

module.exports = {
  splitTechTree,
  techGraphFingerprint,
  applyTechTreeMode,
  buildSharedTechGraph
};
