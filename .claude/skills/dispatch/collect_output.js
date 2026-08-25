#!/usr/bin/env node
'use strict';

/*
 * collect_output.js — read a dispatch output file, print it, then delete it.
 *
 * Primarily for codex's `-o/--output-last-message` file, which is a far more
 * reliable way to collect a final answer than scraping stdout. check_lanes.js
 * requires this module for its automatic path, so the read/delete logic exists
 * once rather than twice.
 *
 *   node collect_output.js <path> [--keep] [--json] [--force]
 *
 * This script's job is DELETION, so the states below are kept strictly apart.
 * The repo's one recurring defect is an absent value rendered as a confident
 * default, and here that would mean a missing file reading exactly like an agent
 * that answered with nothing:
 *
 *   missing        -> non-zero exit and a clear message. Never "" + exit 0.
 *   empty          -> a real result. Says so, and still deletes.
 *   unreadable     -> reports why, and does NOT delete what it could not read.
 *   delete failed  -> reports, non-zero, and states the file STILL EXISTS.
 *   not deletable  -> prints the content, refuses, names the rule it failed.
 */

const fs = require('fs');
const os = require('os');
const path = require('path');

const EXIT = {
  OK: 0,
  MISSING: 1,
  UNREADABLE: 2,
  DELETE_FAILED: 3,
  REFUSED_TO_DELETE: 4,
  USAGE_ERROR: 5,
};

// A file this tool may plausibly own, by name alone. Matches what
// check_lanes.js generates (dispatch-<lane>-<ts>-<pid>.txt) plus the obvious
// hand-written variants.
const DISPATCH_BASENAME = /^(dispatch|codex-last-message|agent-output)[A-Za-z0-9._-]*\.(txt|md|json|jsonl)$/i;

const REPO_ROOT = path.resolve(__dirname, '..', '..', '..');

function samePath(a, b) {
  return process.platform === 'win32' ? a.toLowerCase() === b.toLowerCase() : a === b;
}

function isUnder(child, root) {
  const c = process.platform === 'win32' ? child.toLowerCase() : child;
  const r = process.platform === 'win32' ? root.toLowerCase() : root;
  return c === r || c.startsWith(r.endsWith(path.sep) ? r : r + path.sep);
}

/** Temp/scratch roots a dispatch output file may legitimately live under. */
function allowedRoots() {
  const roots = [];
  const push = (p) => {
    if (typeof p !== 'string' || p.trim() === '') return;
    const resolved = path.resolve(p.trim());
    if (!roots.some((r) => samePath(r, resolved))) roots.push(resolved);
  };

  push(os.tmpdir());
  push(path.join(REPO_ROOT, 'tmp')); // gitignored
  push(process.env.CLAUDE_SCRATCHPAD_DIR);
  const extra = process.env.DISPATCH_TEMP_ROOTS;
  if (typeof extra === 'string' && extra.trim() !== '') {
    for (const part of extra.split(path.delimiter)) push(part);
  }
  return roots;
}

/**
 * May this path be deleted? Answered before any destructive call.
 *
 * The script takes a path and destroys it, so a typo or a stray argument must
 * not eat a real file. Deletion needs the resolved path — AND its realpath, so a
 * symlinked parent directory cannot smuggle the target outside a root — to sit
 * under a temp/scratch root, or the basename to look like dispatch output.
 */
function classifyForDeletion(resolvedPath, realPath) {
  const roots = allowedRoots();
  const checkPath = realPath === null ? resolvedPath : realPath;

  const underRoot = roots.find((r) => isUnder(checkPath, r));
  if (underRoot !== undefined) {
    return { deletable: true, rule: 'under-temp-root', detail: `Resolved under the temp/scratch root ${underRoot}.` };
  }

  if (DISPATCH_BASENAME.test(path.basename(checkPath))) {
    return {
      deletable: true,
      rule: 'dispatch-output-basename',
      detail: `Basename "${path.basename(checkPath)}" matches the dispatch-output pattern ${DISPATCH_BASENAME}.`,
    };
  }

  return {
    deletable: false,
    rule: 'outside-allowed-roots',
    detail:
      `${checkPath} is not under any allowed temp/scratch root and its basename ` +
      `"${path.basename(checkPath)}" does not match the dispatch-output pattern. ` +
      `Allowed roots: ${roots.join(' ; ')}. ` +
      `Pass --force to delete it anyway, or delete it by hand.`,
  };
}

/**
 * Reads a dispatch output file and, when permitted, deletes it.
 *
 * The content is fully read into memory before any delete is attempted, so a
 * file is never destroyed unless its contents were successfully recovered.
 * Returns a result; it does not exit. `onContent` is invoked with the content
 * before deletion so a caller can print first.
 */
function collectOutput(targetPath, options) {
  const opts = options || {};
  const keep = opts.keep === true;
  const force = opts.force === true;
  const onContent = typeof opts.onContent === 'function' ? opts.onContent : null;

  const resolved = path.resolve(targetPath);
  const result = {
    path: resolved,
    bytes: null, // absent stays null: unknown size is not zero bytes
    content: null,
    deleted: false,
    reason: null,
    existed: null,
    empty: null,
    rule: null,
    exit: EXIT.OK,
  };

  // --- presence, and what kind of thing it is ---
  let lst;
  try {
    lst = fs.lstatSync(resolved);
  } catch (err) {
    if (err.code === 'ENOENT') {
      result.existed = false;
      result.reason = `No file at ${resolved}. Nothing was read and nothing was deleted. This is a FAILURE, not an empty result — an agent that answered with nothing would have left an empty file, not no file.`;
      result.exit = EXIT.MISSING;
      return result;
    }
    result.existed = null;
    result.reason = `${resolved} could not be examined: ${err.message}`;
    result.exit = EXIT.UNREADABLE;
    return result;
  }

  result.existed = true;

  if (lst.isDirectory()) {
    result.reason = `${resolved} is a directory. This tool only reads and deletes files; it never removes directories.`;
    result.exit = EXIT.UNREADABLE;
    return result;
  }
  if (lst.isSymbolicLink()) {
    result.reason = `${resolved} is a symlink. Refusing to read or delete it — deleting a symlink's target through an alias is exactly how the wrong file gets destroyed.`;
    result.exit = EXIT.UNREADABLE;
    return result;
  }
  if (!lst.isFile()) {
    result.reason = `${resolved} is not a regular file.`;
    result.exit = EXIT.UNREADABLE;
    return result;
  }

  // --- read (always before any delete) ---
  try {
    result.content = fs.readFileSync(resolved, 'utf8');
    result.bytes = Buffer.byteLength(result.content, 'utf8');
  } catch (err) {
    result.content = null;
    result.reason = `${resolved} exists but could not be read: ${err.message}. It was NOT deleted — nothing is destroyed that could not first be recovered.`;
    result.exit = EXIT.UNREADABLE;
    return result;
  }

  result.empty = result.bytes === 0;

  // Hand the content to the caller before anything destructive happens.
  if (onContent !== null) onContent(result.content, result);

  if (keep) {
    result.reason = `--keep: printed without deleting. The file remains at ${resolved}.`;
    return result;
  }

  // --- may we delete it? ---
  let realPath = null;
  try {
    realPath = fs.realpathSync(resolved);
  } catch (_) {
    realPath = null; // unknown; classify against the resolved path instead
  }

  const verdict = classifyForDeletion(resolved, realPath);
  result.rule = verdict.rule;

  if (!verdict.deletable && !force) {
    result.reason = `Contents printed, but NOT deleted. ${verdict.detail}`;
    result.exit = EXIT.REFUSED_TO_DELETE;
    return result;
  }

  if (!verdict.deletable && force) {
    result.forced = true;
    result.forceWarning = `--force: deleting ${resolved}, which failed the "${verdict.rule}" check. ${verdict.detail}`;
  }

  try {
    fs.unlinkSync(resolved);
    result.deleted = true;
    result.reason = result.empty
      ? `The file existed and was EMPTY (0 bytes). An empty result is a real result. Deleted ${resolved}.`
      : `Read ${result.bytes} byte(s) and deleted ${resolved}.`;
  } catch (err) {
    result.deleted = false;
    result.reason = `Contents were read and printed, but the file could NOT be deleted: ${err.message}. THE FILE STILL EXISTS AT ${resolved} — delete it by hand.`;
    result.exit = EXIT.DELETE_FAILED;
  }

  return result;
}

// ---------------------------------------------------------------------------
// CLI
// ---------------------------------------------------------------------------

const HELP = `
collect_output.js — read a dispatch output file, print it, then delete it.

  node collect_output.js <path> [--keep] [--json] [--force]

    --keep    print without deleting
    --json    emit {path, bytes, content, deleted, reason}
    --force   delete even when the path is outside the allowed temp/scratch
              roots. Prints a warning naming the file.

  Deletion is allowed only when the resolved path (and its realpath) sits under
  a temp/scratch root, or the basename matches the dispatch-output pattern.
  Directories and symlinks are never deleted.

  Exit codes
    ${EXIT.OK}  ok
    ${EXIT.MISSING}  no such file (NOT the same as an empty result)
    ${EXIT.UNREADABLE}  present but unreadable / a directory / a symlink — not deleted
    ${EXIT.DELETE_FAILED}  contents printed, but delete failed and the file still exists
    ${EXIT.REFUSED_TO_DELETE}  contents printed, delete refused (outside allowed roots)
    ${EXIT.USAGE_ERROR}  usage error
`;

function main() {
  const argv = process.argv.slice(2);
  const flags = { keep: false, json: false, force: false };
  const positionals = [];
  const errors = [];

  for (const arg of argv) {
    if (arg === '--keep') flags.keep = true;
    else if (arg === '--json') flags.json = true;
    else if (arg === '--force') flags.force = true;
    else if (arg === '--help' || arg === '-h') {
      process.stdout.write(`${HELP}\n`);
      process.exit(EXIT.OK);
    } else if (arg.startsWith('--')) errors.push(`unrecognised argument "${arg}"`);
    else positionals.push(arg);
  }

  if (positionals.length === 0) errors.push('a <path> is required');
  if (positionals.length > 1) errors.push(`expected one <path>, got ${positionals.length}: ${positionals.join(', ')}`);
  if (flags.keep && flags.force) errors.push('--keep and --force contradict each other: --keep never deletes, --force deletes harder. Pass one.');

  if (errors.length > 0) {
    process.stderr.write(`Argument error:\n  ${errors.join('\n  ')}\n${HELP}\n`);
    process.exit(EXIT.USAGE_ERROR);
  }

  // In text mode the content is printed before any delete is attempted. In JSON
  // mode the content is already safely in memory and is emitted in the single
  // object afterwards, so the delete outcome can be reported accurately.
  const result = collectOutput(positionals[0], {
    keep: flags.keep,
    force: flags.force,
    onContent: flags.json ? null : (content) => process.stdout.write(content),
  });

  if (result.forceWarning !== undefined && !flags.json) {
    process.stderr.write(`\nWARNING: ${result.forceWarning}\n`);
  }

  if (flags.json) {
    process.stdout.write(`${JSON.stringify(
      {
        path: result.path,
        bytes: result.bytes,
        content: result.content,
        deleted: result.deleted,
        reason: result.reason,
        existed: result.existed,
        empty: result.empty,
        rule: result.rule,
      },
      null,
      2
    )}\n`);
  } else {
    if (result.content !== null && result.content !== '' && !result.content.endsWith('\n')) {
      process.stdout.write('\n');
    }
    const stream = result.exit === EXIT.OK ? process.stdout : process.stderr;
    stream.write(`${result.exit === EXIT.OK ? '' : 'ERROR: '}${result.reason}\n`);
  }

  process.exit(result.exit);
}

if (require.main === module) main();

module.exports = { collectOutput, classifyForDeletion, allowedRoots, EXIT, DISPATCH_BASENAME };
