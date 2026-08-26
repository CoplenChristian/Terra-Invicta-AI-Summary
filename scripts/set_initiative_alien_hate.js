#!/usr/bin/env node

/**
 * Purpose: safely edit the Initiative's assessed alien hate in a local save.
 *
 * This is an intentionally local, reversible save-editing utility. It changes
 * only `assessedAlienHateOfMe` on faction 4712, always creates a sibling backup,
 * and defaults to the newest configured save.
 *
 * Usage:
 *   node scripts/set_initiative_alien_hate.js --latest --value 35
 *   node scripts/set_initiative_alien_hate.js --latest --floor-from-mc
 *   node scripts/set_initiative_alien_hate.js --latest --dry-run --floor-from-mc
 */

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const zlib = require('zlib');

const saveParser = require('../server/saveParser');
const { buildAlienHateEconomics } = require('../shared/alienHateEconomics.mjs');

const FACTION_STATE = 'PavonisInteractive.TerraInvicta.TIFactionState';
const METADATA_STATE = 'PavonisInteractive.TerraInvicta.TIMetadataState';
const INITIATIVE_ID = 4712;

function usage() {
  return `
Set the Initiative's assessed alien hate in a Terra Invicta save.

Options:
  --latest, -l             Use the newest configured save (default)
  --save, -s <path>        Edit an explicit save path or configured filename
  --value, -v <number>     Set hate to this value (default: 35)
  --floor-from-mc, --floor Set hate to the shared MC/difficulty/concealment floor
  --dry-run                Show the change without writing the save
  --help, -h               Show this help

Every live edit creates a timestamped .before-hate-*.bak beside the save.
`;
}

function parseArgs(argv) {
  const options = {
    savePath: null,
    latest: true,
    value: 35,
    floorFromMc: false,
    dryRun: false,
    help: false
  };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === '--help' || arg === '-h') {
      options.help = true;
    } else if (arg === '--latest' || arg === '-l') {
      options.latest = true;
    } else if ((arg === '--save' || arg === '-s') && argv[index + 1]) {
      options.savePath = argv[++index];
      options.latest = false;
    } else if ((arg === '--value' || arg === '-v') && argv[index + 1]) {
      options.value = Number(argv[++index]);
    } else if (arg === '--floor-from-mc' || arg === '--floor') {
      options.floorFromMc = true;
    } else if (arg === '--dry-run') {
      options.dryRun = true;
    } else {
      throw new Error(`Unknown or incomplete option '${arg}'.`);
    }
  }

  if (options.floorFromMc && options.value !== 35) {
    throw new Error('Use either --value or --floor-from-mc, not both.');
  }
  if (!options.floorFromMc && (!Number.isFinite(options.value) || options.value < 0)) {
    throw new Error('--value must be a finite number greater than or equal to 0.');
  }
  return options;
}

function unwrapState(row) {
  return row && typeof row === 'object' && row.Value !== undefined ? row.Value : row;
}

function stateRows(container) {
  if (Array.isArray(container)) return container;
  if (container && typeof container === 'object') return Object.values(container);
  return [];
}

function referenceId(value) {
  if (value && typeof value === 'object' && value.value !== undefined) return value.value;
  return value;
}

function finiteOrNull(value) {
  if (typeof value === 'number') return Number.isFinite(value) ? value : null;
  if (typeof value === 'string' && value.trim() !== '') {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
}

function readRawSave(savePath) {
  const compressed = path.extname(savePath).toLowerCase() === '.gz';
  const bytes = fs.readFileSync(savePath);
  const text = (compressed ? zlib.gunzipSync(bytes) : bytes).toString('utf8');
  const parseableText = text
    .replace(/:\s*Infinity\b/g, ': null')
    .replace(/:\s*-Infinity\b/g, ': null')
    .replace(/:\s*NaN\b/g, ': null')
    .replace(/^\uFEFF/, '');
  return { bytes, compressed, text, data: JSON.parse(parseableText) };
}

function sha256(bytes) {
  return crypto.createHash('sha256').update(bytes).digest('hex');
}

function skipWhitespace(text, index) {
  let cursor = index;
  while (cursor < text.length && /\s/.test(text[cursor])) cursor += 1;
  return cursor;
}

function skipString(text, start) {
  let cursor = start + 1;
  while (cursor < text.length) {
    if (text[cursor] === '\\') {
      cursor += 2;
    } else if (text[cursor] === '"') {
      return cursor + 1;
    } else {
      cursor += 1;
    }
  }
  throw new Error('Malformed save: unterminated JSON string.');
}

function matchingEnd(text, start) {
  const opening = text[start];
  const closing = opening === '{' ? '}' : '[';
  if (opening !== '{' && opening !== '[') throw new Error(`Malformed save: expected a JSON container at ${start}.`);
  const stack = [opening];
  let cursor = start + 1;
  while (cursor < text.length) {
    const character = text[cursor];
    if (character === '"') {
      cursor = skipString(text, cursor);
      continue;
    }
    if (character === '{' || character === '[') {
      stack.push(character);
    } else if (character === '}' || character === ']') {
      const expected = stack[stack.length - 1] === '{' ? '}' : ']';
      if (character !== expected) throw new Error('Malformed save: mismatched JSON containers.');
      stack.pop();
      if (stack.length === 0) return cursor + 1;
    }
    cursor += 1;
  }
  throw new Error('Malformed save: unterminated JSON container.');
}

function primitiveEnd(text, start, containerEnd) {
  let cursor = start;
  while (cursor < containerEnd && text[cursor] !== ',' && text[cursor] !== '}' && text[cursor] !== ']') cursor += 1;
  while (cursor > start && /\s/.test(text[cursor - 1])) cursor -= 1;
  return cursor;
}

function valueEnd(text, start, containerEnd) {
  const character = text[start];
  if (character === '"') return skipString(text, start);
  if (character === '{' || character === '[') return matchingEnd(text, start);
  return primitiveEnd(text, start, containerEnd);
}

function topLevelValueRanges(text, start, end) {
  const ranges = [];
  if (text[start] === '[') {
    let cursor = skipWhitespace(text, start + 1);
    while (cursor < end - 1) {
      if (text[cursor] === ',') {
        cursor = skipWhitespace(text, cursor + 1);
        continue;
      }
      const valueStart = cursor;
      const valueFinish = valueEnd(text, valueStart, end - 1);
      ranges.push([valueStart, valueFinish]);
      cursor = skipWhitespace(text, valueFinish);
      if (text[cursor] === ',') cursor = skipWhitespace(text, cursor + 1);
    }
    return ranges;
  }

  let cursor = skipWhitespace(text, start + 1);
  while (cursor < end - 1) {
    if (text[cursor] === ',') {
      cursor = skipWhitespace(text, cursor + 1);
      continue;
    }
    if (text[cursor] !== '"') throw new Error('Malformed save: expected an object key.');
    cursor = skipString(text, cursor);
    cursor = skipWhitespace(text, cursor);
    if (text[cursor] !== ':') throw new Error('Malformed save: expected a colon after an object key.');
    const valueStart = skipWhitespace(text, cursor + 1);
    const valueFinish = valueEnd(text, valueStart, end - 1);
    ranges.push([valueStart, valueFinish]);
    cursor = skipWhitespace(text, valueFinish);
    if (text[cursor] === ',') cursor = skipWhitespace(text, cursor + 1);
  }
  return ranges;
}

function findFactionElement(rawText, parsedSave) {
  const stateContainer = parsedSave.gamestates?.[FACTION_STATE];
  const parsedRows = stateRows(stateContainer);
  const marker = JSON.stringify(FACTION_STATE);
  const markerIndex = rawText.indexOf(marker);
  if (markerIndex < 0) throw new Error(`Save does not contain ${FACTION_STATE}.`);
  const colon = rawText.indexOf(':', markerIndex + marker.length);
  const containerStart = skipWhitespace(rawText, colon + 1);
  const containerEnd = valueEnd(rawText, containerStart, rawText.length);
  const ranges = topLevelValueRanges(rawText, containerStart, containerEnd);

  if (ranges.length !== parsedRows.length) {
    throw new Error('Faction state could not be mapped safely to its raw JSON rows.');
  }

  for (let index = 0; index < ranges.length; index += 1) {
    const [start, end] = ranges[index];
    const row = parsedRows[index];
    const faction = unwrapState(row);
    if (String(referenceId(faction?.ID)) === String(INITIATIVE_ID)) {
      return { start, end, faction, elementText: rawText.slice(start, end) };
    }
  }
  throw new Error(`Faction ${INITIATIVE_ID} (the Initiative) was not found in the save.`);
}

function replaceHateField(elementText, newValue) {
  const key = '"assessedAlienHateOfMe"';
  const keyStart = elementText.indexOf(key);
  if (keyStart < 0) throw new Error('The Initiative row has no assessedAlienHateOfMe field; refusing to guess where to insert it.');
  if (elementText.indexOf(key, keyStart + key.length) >= 0) {
    throw new Error('The Initiative row contains multiple assessedAlienHateOfMe fields; refusing an ambiguous edit.');
  }
  const colon = elementText.indexOf(':', keyStart + key.length);
  const valueStart = skipWhitespace(elementText, colon + 1);
  const valueFinish = valueEnd(elementText, valueStart, elementText.length);
  return elementText.slice(0, valueStart) + JSON.stringify(newValue) + elementText.slice(valueFinish);
}

function resolveSave(options) {
  if (!options.savePath) return saveParser.getLatestSaveFile();
  const configuredMatches = saveParser.getAvailableSaves().filter(save => save.name === options.savePath);
  if (configuredMatches.length === 1) return configuredMatches[0];
  const fullPath = path.resolve(options.savePath);
  if (!fs.existsSync(fullPath)) throw new Error(`Save file not found: ${options.savePath}`);
  const stats = fs.statSync(fullPath);
  return { name: path.basename(fullPath), fullPath, lastModified: stats.mtime };
}

function backupPathFor(savePath) {
  const stamp = new Date().toISOString().replace(/[.:]/g, '-');
  const base = `${savePath}.before-hate-${stamp}`;
  let candidate = `${base}.bak`;
  let suffix = 1;
  while (fs.existsSync(candidate)) candidate = `${base}-${suffix++}.bak`;
  return candidate;
}

function writeAtomically(savePath, payload, backupPath) {
  const temporaryPath = path.join(
    path.dirname(savePath),
    `.${path.basename(savePath)}.hate-${process.pid}-${Date.now()}.tmp`
  );
  fs.writeFileSync(temporaryPath, payload, { flag: 'wx' });
  try {
    fs.renameSync(savePath, backupPath);
    try {
      fs.renameSync(temporaryPath, savePath);
    } catch (error) {
      fs.renameSync(backupPath, savePath);
      throw error;
    }
  } finally {
    if (fs.existsSync(temporaryPath)) fs.unlinkSync(temporaryPath);
  }
}

async function main(argv = process.argv.slice(2)) {
  const options = parseArgs(argv);
  if (options.help) {
    console.log(usage());
    return;
  }

  const target = resolveSave(options);
  const before = readRawSave(target.fullPath);
  const beforeFingerprint = sha256(before.bytes);
  const factionMatch = findFactionElement(before.text, before.data);
  const faction = factionMatch.faction;
  const oldHate = finiteOrNull(faction.assessedAlienHateOfMe);
  const missionControlUsage = finiteOrNull(faction.missionControlUsage);
  const metadata = unwrapState(stateRows(before.data.gamestates?.[METADATA_STATE])[0]) || {};

  let nextHate = options.value;
  let floor = null;
  let floorDetails = null;
  if (options.floorFromMc) {
    const economics = buildAlienHateEconomics({
      observer: {
        displayName: faction.displayName,
        missionControlUsage,
        missionControlCapacity: finiteOrNull(faction.missionControlCapacity),
        assessedAlienHateOfMe: oldHate,
        completedProjects: Array.isArray(faction.finishedProjectNames) ? faction.finishedProjectNames : []
      },
      difficulty: metadata.difficulty,
      mode: 'omniscient'
    });
    floor = economics.minimumAlienHate;
    floorDetails = economics.formula;
    if (floor === null) {
      throw new Error('The shared hate model could not calculate a floor; used MC or difficulty is unavailable.');
    }
    nextHate = floor;
  }

  const updatedElement = replaceHateField(factionMatch.elementText, nextHate);
  const updatedText = before.text.slice(0, factionMatch.start) + updatedElement + before.text.slice(factionMatch.end);
  const parseableUpdatedText = updatedText
    .replace(/:\s*Infinity\b/g, ': null')
    .replace(/:\s*-Infinity\b/g, ': null')
    .replace(/:\s*NaN\b/g, ': null')
    .replace(/^\uFEFF/, '');
  JSON.parse(parseableUpdatedText);

  console.log(`Target save:        ${target.name}`);
  console.log(`Last modified:      ${new Date(target.lastModified).toISOString()}`);
  console.log(`Faction:            ${faction.displayName} (${INITIATIVE_ID})`);
  console.log(`Mission Control:    ${missionControlUsage ?? 'UNAVAILABLE'}`);
  console.log(`Current hate:       ${oldHate ?? 'UNAVAILABLE'}`);
  if (floorDetails) console.log(`MC floor:           ${floor} (${floorDetails.text})`);
  console.log(`New hate:           ${nextHate}`);

  if (options.dryRun) {
    console.log('DRY RUN: no save or backup written.');
    return;
  }

  const currentBytes = fs.readFileSync(target.fullPath);
  if (sha256(currentBytes) !== beforeFingerprint) {
    throw new Error('The save changed while it was being read; refusing to overwrite it.');
  }
  const payload = before.compressed
    ? zlib.gzipSync(Buffer.from(updatedText, 'utf8'))
    : Buffer.from(updatedText, 'utf8');
  const backupPath = backupPathFor(target.fullPath);
  writeAtomically(target.fullPath, payload, backupPath);
  console.log(`Backup created:     ${backupPath}`);
  console.log('Save updated successfully.');
}

if (require.main === module) {
  main().catch(error => {
    console.error(`[Error] ${error.message}`);
    process.exitCode = 1;
  });
}

module.exports = { main, parseArgs, finiteOrNull };
