const { test } = require('node:test');
const assert = require('node:assert/strict');
const path = require('path');

const TemplateLoader = require('../server/templateLoader').constructor;

test('template loader accepts a portable checked-in fixture directory', () => {
  const fixturePath = path.join(__dirname, 'fixtures', 'templates');
  const loader = new TemplateLoader({
    paths: { templatesPath: fixturePath },
    analysis: {
      effects: {
        Effect_DetectAbductions: { capability: 'detectAlienAbductions', category: 'alien', description: 'fixture', defaultProject: 'Project_TheirSignatures' }
      },
      strategicProjects: [],
      rules: {}
    }
  });
  loader.load();
  assert.equal(loader.templatesPath, fixturePath);
  assert.ok(loader.getProject('Project_TheirOperations'));
  assert.deepEqual(loader.getProjectEffects('Project_TheirOperations'), ['Effect_DetectAllOperations', 'Effect_UpdateAlienThreatMeter']);
});
