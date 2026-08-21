/**
 * server/index.js -- the local Express composition root.
 *
 * The 2026-08-20 review (section D) called this a monolith mixing routing,
 * validation, caching, projection and HTML rendering. Those now live under
 * `server/http/`:
 *
 *   http/snapshotCache.js    the one parsed-save cache and its reset rules
 *   http/requestContext.js   request -> (mode, observer, save); snapshot -> identity
 *   http/publishControl.js   the local-only, service-role-backed publish route
 *   http/routes/runtime.js   /api/runtime, /api/publish, /api/saves
 *   http/routes/snapshot.js  whole-snapshot routes and their markdown renderings
 *   http/routes/intel.js     the focused-projection surface and its query contract
 *   http/routes/strategicHistory.js  the Supabase-backed history routes
 *   http/routes/tech.js      /api/templates/effects and the seven tech routes
 *
 * What is left here is only what an entry point should own: process-level error
 * handlers, middleware order, the registration ORDER of the route modules, and
 * `listen`.
 *
 * That order is load-bearing in one place and pinned by
 * `tests/serverRoutes.test.js` everywhere else. `snapshot.js` therefore
 * registers in two calls -- its live routes before the focused resources, its
 * read-only export routes after the tech routes -- because that is where they
 * sat before the split, and a tidier grouping would silently reshuffle the
 * Express route table.
 */

const express = require('express');
const path = require('path');
// Supabase-backed routes (strategic history) need SUPABASE_URL and a key.
// The publish script already loads .env; the server did not, so those routes
// reported "not configured" locally even when credentials were present.
require('dotenv').config({ path: path.join(__dirname, '../.env') });
const { resolveConfig } = require('./config');
const runtimeConfig = resolveConfig();
const templateLoader = require('./templateLoader');

const runtimeRoutes = require('./http/routes/runtime');
const snapshotRoutes = require('./http/routes/snapshot');
const intelRoutes = require('./http/routes/intel');
const strategicHistoryRoutes = require('./http/routes/strategicHistory');
const techRoutes = require('./http/routes/tech');

const app = express();
const PORT = runtimeConfig.server.port;
const HOST = runtimeConfig.server.host;

app.use(express.json({ limit: '5mb' }));

// Mission Control (v2) is the dashboard. Serve its shell at both the site root
// and /v2/ so either path renders the same live UI and existing /v2/ links keep
// working without a redirect. This is registered ahead of express.static so the
// root is answered by an explicit route rather than by directory-index
// behaviour over public/, which is what used to surface the legacy v1 shell.
//
// This is the ONE genuinely order-dependent registration in the file: moving it
// after express.static brings the legacy v1 shell back at `/`.
const missionControlShell = path.join(__dirname, '../public/v2/index.html');
app.get(['/', '/v2'], (req, res) => {
  res.sendFile(missionControlShell);
});

app.use(express.static(path.join(__dirname, '../public')));

if (require.main === module) {
  process.on('uncaughtException', (err) => {
    console.error('[Server] Uncaught Exception:', err);
    process.exit(1);
  });
  process.on('unhandledRejection', (reason) => {
    console.error('[Server] Unhandled Rejection:', reason);
    process.exit(1);
  });
}

runtimeRoutes.register(app);
snapshotRoutes.register(app);
intelRoutes.register(app);
strategicHistoryRoutes.register(app);
techRoutes.register(app);
snapshotRoutes.registerReadOnlyExports(app);

// Start Server
if (require.main === module) {
  templateLoader.load();
  app.listen(PORT, HOST, () => {
    console.log(`========================================================`);
    console.log(`  TERRA INVICTA STRATEGIC INTELLIGENCE DASHBOARD SERVER  `);
    console.log(`  Running at http://${HOST}:${PORT}                   `);
    console.log(`========================================================`);
  });
}

module.exports = app;
