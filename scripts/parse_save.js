#!/usr/bin/env node

/**
 * Universal Terra Invicta Save Parser & Intelligence CLI
 *
 * Inspects save game state, executes intel projections, and formats data for agents and humans.
 *
 * Usage:
 *   node scripts/parse_save.js --latest
 *   node scripts/parse_save.js --latest --endpoint mining --format json
 *   node scripts/parse_save.js --save Again.gz --endpoint alien-threat --mode omniscient
 *   node scripts/parse_save.js --latest --endpoint councilors --format table
 *   node scripts/parse_save.js --latest --field metadata.gameTimeString
 */

const fs = require('fs');
const path = require('path');
const { loadSnapshot, loadFilteredSnapshot, queryIntel } = require('../server/snapshotLoader');
const { INTEL_ENDPOINT_INDEX } = require('../shared/intelResources.mjs');
const { INITIATIVE_DISPLAY_NAME, DEFAULT_OBSERVER_FACTION_ID } = require('../shared/constants.mjs');

function parseArgs(args) {
  const options = {
    savePath: null,
    latest: true,
    mode: 'player',
    observer: INITIATIVE_DISPLAY_NAME,
    endpoint: null,
    format: 'pretty', // 'json', 'pretty', 'table', 'summary'
    field: null,
    out: null,
    limit: null,
    body: null,
    theater: null,
    factionId: null,
    help: false
  };

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg === '--help' || arg === '-h') {
      options.help = true;
    } else if (arg === '--latest' || arg === '-l') {
      options.latest = true;
    } else if ((arg === '--save' || arg === '-s') && i + 1 < args.length) {
      options.savePath = args[++i];
      options.latest = false;
    } else if ((arg === '--mode' || arg === '-m') && i + 1 < args.length) {
      options.mode = args[++i].toLowerCase();
    } else if ((arg === '--observer' || arg === '-o') && i + 1 < args.length) {
      options.observer = args[++i];
    } else if ((arg === '--endpoint' || arg === '-e' || arg === '--resource' || arg === '-r') && i + 1 < args.length) {
      options.endpoint = args[++i];
    } else if ((arg === '--format' || arg === '-f') && i + 1 < args.length) {
      options.format = args[++i].toLowerCase();
    } else if ((arg === '--field' || arg === '-q' || arg === '--query') && i + 1 < args.length) {
      options.field = args[++i];
    } else if (arg === '--out' && i + 1 < args.length) {
      options.out = args[++i];
    } else if (arg === '--limit' && i + 1 < args.length) {
      options.limit = parseInt(args[++i], 10);
    } else if (arg === '--body' && i + 1 < args.length) {
      options.body = args[++i];
    } else if (arg === '--theater' && i + 1 < args.length) {
      options.theater = args[++i];
    } else if ((arg === '--faction' || arg === '--factionId') && i + 1 < args.length) {
      options.factionId = args[++i];
    }
  }

  return options;
}

function printHelp() {
  console.log(`
Universal Terra Invicta Save Parser & Intelligence CLI

Options:
  --latest, -l             Use the most recently modified save (default: true)
  --save, -s <path>        Path or filename of a specific save file
  --mode, -m <mode>        Intelligence mode: 'player' (default), 'enhanced', 'omniscient'
  --observer, -o <name|id> Observer faction (default: '${INITIATIVE_DISPLAY_NAME}' / ${DEFAULT_OBSERVER_FACTION_ID})
  --endpoint, -e <name>    Query a specific intel projection (e.g., summary, councilors,
                           habs, mining, mining-expansion, alien-threat, tech-tree)
  --field, -q <path>       Extract a specific dotted/nested field from the output
  --format, -f <fmt>       Output format: 'pretty' (default), 'json', 'table', 'summary'
  --limit <n>              Limit results for collection endpoints
  --body <name>            Filter by celestial body (e.g. Mars, Ceres)
  --theater <name>         Filter by space theater
  --faction <id>           Filter by faction ID
  --out <file>             Write output to a file instead of stdout
  --help, -h               Show this help message

Available Endpoints:
${Object.keys(INTEL_ENDPOINT_INDEX).map(k => `  ${k.padEnd(20)} ${INTEL_ENDPOINT_INDEX[k]}`).join('\n')}
`);
}

function resolveNestedField(obj, fieldPath) {
  if (!fieldPath || !obj) return obj;
  const parts = fieldPath.replace(/^\[/, '').replace(/\]$/, '').split(/\.|\/|\[|\]\./);
  let current = obj;
  for (const part of parts) {
    if (part === '') continue;
    if (current === null || current === undefined) return null;
    current = current[part];
  }
  return current;
}

function formatOutput(data, format) {
  if (format === 'json') {
    return JSON.stringify(data);
  }
  if (format === 'pretty') {
    return JSON.stringify(data, null, 2);
  }
  if (format === 'table' && Array.isArray(data)) {
    console.table(data);
    return null;
  }
  if (format === 'summary') {
    if (typeof data !== 'object' || data === null) {
      return String(data);
    }
    const lines = [];
    lines.push(`Campaign Date: ${data.campaignDate || data.metadata?.gameTimeString || 'Unknown'}`);
    lines.push(`Observer:      ${data.observerFaction?.name || data.observerFactionName || 'Unknown'} (ID: ${data.observerFaction?.id || data.observerFactionId || 'Unknown'})`);
    lines.push(`Intel Mode:    ${data.intelMode || data.visibility || 'player'}`);
    if (data.activeSnapshot?.saveFilename || data.metadata?.fileName) {
      lines.push(`Save File:     ${data.activeSnapshot?.saveFilename || data.metadata?.fileName}`);
    }
    if (data.resource) {
      lines.push(`Resource:      ${data.resource} (Items: ${data.count ?? (Array.isArray(data.items) ? data.items.length : 'N/A')})`);
    }
    return lines.join('\n');
  }
  return JSON.stringify(data, null, 2);
}

function main() {
  const options = parseArgs(process.argv.slice(2));

  if (options.help) {
    printHelp();
    return;
  }

  try {
    let result = null;

    if (options.endpoint) {
      // Query specific intel endpoint
      result = queryIntel({
        savePath: options.savePath,
        mode: options.mode,
        observer: options.observer,
        endpoint: options.endpoint,
        queryOptions: {
          limit: options.limit,
          body: options.body,
          theater: options.theater,
          factionId: options.factionId
        }
      });
    } else {
      // Return full filtered snapshot
      result = loadFilteredSnapshot({
        savePath: options.savePath,
        mode: options.mode,
        observer: options.observer
      });
    }

    if (options.field) {
      result = resolveNestedField(result, options.field);
    }

    const output = formatOutput(result, options.format);

    if (output !== null) {
      if (options.out) {
        fs.writeFileSync(path.resolve(options.out), output, 'utf8');
        console.log(`Wrote output to ${options.out}`);
      } else {
        console.log(output);
      }
    }
  } catch (err) {
    console.error(`[Error] ${err.message}`);
    process.exit(1);
  }
}

if (require.main === module) {
  main();
}

module.exports = { main, parseArgs, formatOutput, resolveNestedField };
