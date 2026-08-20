const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

const { MISSION_SUCCESS_HATE } = require('../server/directiveAdvisor');
const { resolveConfig } = require('../server/config');
// templateLoader probes mounted Steam libraries when nothing is configured, and
// on this machine that is the ONLY candidate that resolves -- config's
// paths.templatesPath is null and no TI_TEMPLATES_DIR is set, so without this
// the guard silently skipped on a machine that has the install. A rot check
// that never runs is not a rot check.
const templateLoader = require('../server/templateLoader');

// MISSION_SUCCESS_HATE is hand-maintained, because the mission templates are
// not among the files templateLoader pulls in. That makes it exactly the kind
// of table that silently rots when the game patches. When a local install is
// present, pin every entry to the shipping template so drift fails loudly
// instead of quietly changing what the dashboard recommends.
//
// TIMissionTemplate.hate is a six-slot outcome array. Slot 4 is the normal
// success, which is the outcome a directive is proposing.
const SUCCESS_SLOT = 4;

const configuredTemplates = resolveConfig().paths.templatesPath;
const installSuffix = path.join('steamapps', 'common', 'Terra Invicta', 'TerraInvicta_Data', 'StreamingAssets', 'Templates');
const CANDIDATE_TEMPLATE_DIRS = [
  configuredTemplates,
  process.env.TI_TEMPLATES_DIR,
  templateLoader.templatesPath,
  process.env.STEAM_LIBRARY_PATH && path.join(process.env.STEAM_LIBRARY_PATH, installSuffix),
  process.env.ProgramFiles && path.join(process.env.ProgramFiles, installSuffix),
  process.env['ProgramFiles(x86)'] && path.join(process.env['ProgramFiles(x86)'], installSuffix)
].filter(Boolean);

// The advisor keys on the names the game shows a player, which are template
// friendlyNames, not dataNames -- and the two diverge: "Public Campaign" is
// dataName "Propaganda". Map by dataName only where the advisor label is a
// composite that has no single template of its own; everything else resolves
// by friendlyName.
//
// Composite entries take the hate of their worst branch, which is the one a
// player has to budget for.
const DATANAME_FOR = {
  'Crackdown / Purge': 'Purge',
  'Sabotage Facilities': 'SabotageFacilities'
};

function loadMissionTemplates() {
  for (const dir of CANDIDATE_TEMPLATE_DIRS) {
    const file = path.join(dir, 'TIMissionTemplate.json');
    try {
      if (fs.existsSync(file)) return JSON.parse(fs.readFileSync(file, 'utf8'));
    } catch {
      // A malformed or unreadable install is the same as no install here.
    }
  }
  return null;
}

test('advisor hate table matches the shipping mission templates', (t) => {
  const templates = loadMissionTemplates();
  if (!templates) {
    t.skip('no local Terra Invicta install found; set TI_TEMPLATES_DIR to check');
    return;
  }

  const byDataName = new Map(templates.map((m) => [m.dataName, m]));
  const byFriendlyName = new Map(templates.map((m) => [m.friendlyName, m]));

  for (const [label, expected] of Object.entries(MISSION_SUCCESS_HATE)) {
    const dataName = DATANAME_FOR[label];
    const template = dataName ? byDataName.get(dataName) : byFriendlyName.get(label);
    assert.ok(
      template,
      `no mission template matches advisor entry "${label}"`
      + `${dataName ? ` (dataName ${dataName})` : ' (searched friendlyNames)'}`
    );

    const hate = Array.isArray(template.hate) ? template.hate : [];
    // A mission with no hate array at all is all-zero hate, not unknown.
    const actual = hate.length === 0 ? 0 : hate[SUCCESS_SLOT];

    assert.strictEqual(
      actual,
      expected,
      `${label} (${template.dataName}) success-slot hate is ${actual} in the `
      + `templates but ${expected} in MISSION_SUCCESS_HATE`
    );
  }
});
