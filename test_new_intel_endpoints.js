const http = require('http');

async function get(url, options = {}) {
  return new Promise((resolve, reject) => {
    const parsed = new URL(url);
    const reqOptions = {
      hostname: parsed.hostname,
      port: parsed.port || 3000,
      path: parsed.pathname + parsed.search,
      method: options.method || 'GET',
      headers: options.headers || {}
    };
    const req = http.request(reqOptions, (res) => {
      let body = '';
      res.on('data', chunk => body += chunk);
      res.on('end', () => {
        try {
          const json = JSON.parse(body);
          resolve({ status: res.statusCode, json });
        } catch (e) {
          resolve({ status: res.statusCode, raw: body });
        }
      });
    });
    req.on('error', reject);
    if (options.body) {
      req.write(typeof options.body === 'string' ? options.body : JSON.stringify(options.body));
    }
    req.end();
  });
}

async function runTests() {
  console.log('========================================================');
  console.log('  TESTING STRATEGIC INTELLIGENCE ENDPOINTS              ');
  console.log('========================================================\n');

  let passed = 0;
  let failed = 0;

  function verifyContract(name, json) {
    const required = ['snapshotId', 'campaignDate', 'saveFilename', 'saveModifiedAt', 'generatedAt', 'intelMode'];
    const missing = required.filter(k => json[k] === undefined);
    if (missing.length > 0) {
      console.error(`  ❌ [${name}] Missing contract fields: ${missing.join(', ')}`);
      return false;
    }
    return true;
  }

  // 1. Logistics
  try {
    const res = await get('http://127.0.0.1:3000/api/intel/logistics?observer=4712&mode=omniscient');
    if (res.status === 200 && res.json.resources && res.json.resources.length === 5 && verifyContract('logistics', res.json)) {
      console.log(`✓ 1. /api/intel/logistics: OK (${res.json.resources.length} resources, MC used: ${res.json.missionControl?.used}/${res.json.missionControl?.cap})`);
      passed++;
    } else {
      console.error('❌ 1. /api/intel/logistics failed:', res);
      failed++;
    }
  } catch (e) { console.error('❌ 1. logistics error:', e.message); failed++; }

  // 2. Construction
  try {
    const res = await get('http://127.0.0.1:3000/api/intel/construction?observer=4712&mode=omniscient');
    if (res.status === 200 && Array.isArray(res.json.items) && verifyContract('construction', res.json)) {
      console.log(`✓ 2. /api/intel/construction: OK (${res.json.items.length} build queue items)`);
      passed++;
    } else {
      console.error('❌ 2. /api/intel/construction failed:', res);
      failed++;
    }
  } catch (e) { console.error('❌ 2. construction error:', e.message); failed++; }

  // 3. Transfers
  try {
    const res = await get('http://127.0.0.1:3000/api/intel/transfers?observer=4712&mode=omniscient');
    if (res.status === 200 && Array.isArray(res.json.items) && verifyContract('transfers', res.json)) {
      console.log(`✓ 3. /api/intel/transfers: OK (${res.json.items.length} fleet transfers)`);
      passed++;
    } else {
      console.error('❌ 3. /api/intel/transfers failed:', res);
      failed++;
    }
  } catch (e) { console.error('❌ 3. transfers error:', e.message); failed++; }

  // 4. Ship Designs
  try {
    const res = await get('http://127.0.0.1:3000/api/intel/ship-designs?observer=4712&mode=omniscient&faction=4712');
    if (res.status === 200 && Array.isArray(res.json.items) && verifyContract('ship-designs', res.json)) {
      console.log(`✓ 4. /api/intel/ship-designs: OK (${res.json.items.length} designs parsed with component IDs)`);
      passed++;
    } else {
      console.error('❌ 4. /api/intel/ship-designs failed:', res);
      failed++;
    }
  } catch (e) { console.error('❌ 4. ship-designs error:', e.message); failed++; }

  // 5. Theaters
  try {
    const res = await get('http://127.0.0.1:3000/api/intel/theaters?observer=4712&mode=omniscient');
    if (res.status === 200 && Array.isArray(res.json.items) && res.json.items.length > 0 && verifyContract('theaters', res.json)) {
      console.log(`✓ 5. /api/intel/theaters: OK (${res.json.items.length} celestial theaters evaluated)`);
      passed++;
    } else {
      console.error('❌ 5. /api/intel/theaters failed:', res);
      failed++;
    }
  } catch (e) { console.error('❌ 5. theaters error:', e.message); failed++; }

  // 6. Infrastructure
  try {
    const res = await get('http://127.0.0.1:3000/api/intel/infrastructure?observer=4712&mode=omniscient');
    if (res.status === 200 && Array.isArray(res.json.items) && verifyContract('infrastructure', res.json)) {
      console.log(`✓ 6. /api/intel/infrastructure: OK (${res.json.items.length} hab installations with module manifests)`);
      passed++;
    } else {
      console.error('❌ 6. /api/intel/infrastructure failed:', res);
      failed++;
    }
  } catch (e) { console.error('❌ 6. infrastructure error:', e.message); failed++; }

  // 7. Alien Threat
  try {
    const res = await get('http://127.0.0.1:3000/api/intel/alien-threat?observer=4712&mode=omniscient');
    if (res.status === 200 && res.json.actualHate !== undefined && res.json.minimumHate !== undefined && verifyContract('alien-threat', res.json)) {
      console.log(`✓ 7. /api/intel/alien-threat: OK (Actual: ${res.json.actualHate}, Min Floor: ${res.json.minimumHate}, War Threshold: ${res.json.warThreshold})`);
      passed++;
    } else {
      console.error('❌ 7. /api/intel/alien-threat failed:', res);
      failed++;
    }
  } catch (e) { console.error('❌ 7. alien-threat error:', e.message); failed++; }

  // 8. Delta
  try {
    const res = await get('http://127.0.0.1:3000/api/intel/delta?observer=4712&mode=omniscient');
    if (res.status === 200 && res.json.changes && verifyContract('delta', res.json)) {
      console.log(`✓ 8. /api/intel/delta: OK (${res.json.events?.length || 0} event summaries)`);
      passed++;
    } else {
      console.error('❌ 8. /api/intel/delta failed:', res);
      failed++;
    }
  } catch (e) { console.error('❌ 8. delta error:', e.message); failed++; }

  // 9. Mining Analysis
  try {
    const res = await get('http://127.0.0.1:3000/api/intel/mining?observer=4712&mode=omniscient&sort=water');
    if (res.status === 200 && Array.isArray(res.json.bestAvailableWaterSites) && verifyContract('mining', res.json)) {
      console.log(`✓ 9. /api/intel/mining: OK (${res.json.items?.length || 0} sites, top water deposit: ${res.json.bestAvailableWaterSites[0]?.site} @ ${res.json.bestAvailableWaterSites[0]?.water}/d)`);
      passed++;
    } else {
      console.error('❌ 9. /api/intel/mining failed:', res);
      failed++;
    }
  } catch (e) { console.error('❌ 9. mining error:', e.message); failed++; }

  // 10. Mobility
  try {
    const res = await get('http://127.0.0.1:3000/api/intel/mobility?observer=4712&mode=omniscient');
    if (res.status === 200 && Array.isArray(res.json.transfers) && verifyContract('mobility', res.json)) {
      console.log(`✓ 10. /api/intel/mobility: OK (${res.json.transfers.length} destinations evaluated from ${res.json.currentLocation})`);
      passed++;
    } else {
      console.error('❌ 10. /api/intel/mobility failed:', res);
      failed++;
    }
  } catch (e) { console.error('❌ 10. mobility error:', e.message); failed++; }

  // 11. Production Plan (POST)
  try {
    const res = await get('http://127.0.0.1:3000/api/intel/production-plan?observer=4712&mode=omniscient', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: { designId: 'playerShipTemplate584', quantity: 4 }
    });
    if (res.status === 200 && res.json.requestedQuantity === 4 && verifyContract('production-plan', res.json)) {
      console.log(`✓ 11. /api/intel/production-plan (POST): OK (Can afford: ${res.json.canAffordNow}, Max: ${res.json.maxAffordableNow}, Bottleneck: ${res.json.bottleneckResource})`);
      passed++;
    } else {
      console.error('❌ 11. /api/intel/production-plan failed:', res);
      failed++;
    }
  } catch (e) { console.error('❌ 11. production-plan error:', e.message); failed++; }

  // 12. Body Status (GET)
  try {
    const res = await get('http://127.0.0.1:3000/api/intel/body-status?body=Mars&observer=4712&mode=omniscient');
    if (res.status === 200 && res.json.body === 'Mars' && verifyContract('body-status', res.json)) {
      console.log(`✓ 12. /api/intel/body-status?body=Mars: OK (${res.json.habsCount} habs, ${res.json.fleetsCount} fleets, ${res.json.miningSitesCount} mines)`);
      passed++;
    } else {
      console.error('❌ 12. /api/intel/body-status failed:', res);
      failed++;
    }
  } catch (e) { console.error('❌ 12. body-status error:', e.message); failed++; }

  console.log(`\n========================================================`);
  console.log(`  SUMMARY: ${passed} PASSED, ${failed} FAILED`);
  console.log(`========================================================`);

  if (failed > 0) process.exit(1);
}

runTests().catch(e => { console.error('Test script crashed:', e); process.exit(1); });
