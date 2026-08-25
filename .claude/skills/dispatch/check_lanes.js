#!/usr/bin/env node
'use strict';

/*
 * check_lanes.js — probe and dispatch the external agent CLI lanes.
 *
 * Policy lives in .claude/dispatch-config.json, which the user owns. This file
 * owns the invocations, the availability probes, and the safety rules that hold
 * whatever the config says.
 *
 * Two rules shape almost every decision below:
 *   - Absent stays null. Number(null) === 0, so nothing here coerces a missing
 *     measurement into a number. An unknown availability state is `null`, never
 *     `true`; a missing token count is `null`, never `0`.
 *   - Prompts arrive as FILES and are passed as one element of an argv array to
 *     spawn(). No shell is used anywhere in the dispatch path, so quotes,
 *     backticks, newlines and shell metacharacters in a prompt cannot be
 *     reinterpreted by cmd.exe or by a POSIX shell.
 *
 * Invocations verified 2026-08-24. Do not re-derive them from CLI help text.
 */

const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync, spawn } = require('child_process');

const SKILL_DIR = __dirname;
const DEFAULT_CONFIG_PATH = path.resolve(SKILL_DIR, '..', '..', 'dispatch-config.json');

const VALID_MODES = ['auto', 'ask', 'reject'];

const EXIT = {
  OK: 0,
  APPROVAL_REQUIRED: 2,
  REFUSED_BY_CONFIG: 3,
  LANE_UNAVAILABLE: 4,
  USAGE_ERROR: 5,
  DISPATCH_FAILED: 6,
};

const PROBE_TIMEOUT_MS = 90000;
const DEFAULT_DISPATCH_TIMEOUT_MS = 900000; // 15 minutes

// ---------------------------------------------------------------------------
// Lane registry — how each lane is invoked. Not user-editable on purpose.
// ---------------------------------------------------------------------------

const LANES = {
  minimax: {
    key: 'minimax',
    label: 'MiniMax M3',
    cli: 'opencode',
    binName: 'opencode',
    fallbackPath: 'C:\\Users\\cople\\.opencode\\bin\\opencode.exe',
    supportsModel: true,
    defaultModel: 'minimax-coding-plan/MiniMax-M3',
    costClass: 'plan-included',
    costNote: 'Unlimited weekly on the MiniMax coding plan; limited rolling 5-hour window.',
    routing: 'Reviewing and verification, not implementation. Slower but more powerful.',
    buildArgs: ({ model, prompt }) => ['run', '-m', model, '--format', 'json', prompt],
  },
  deepseek: {
    key: 'deepseek',
    label: 'DeepSeek v4 Flash',
    cli: 'opencode',
    binName: 'opencode',
    fallbackPath: 'C:\\Users\\cople\\.opencode\\bin\\opencode.exe',
    supportsModel: true,
    defaultModel: 'opencode-go/deepseek-v4-flash',
    costClass: 'metered',
    costNote: 'METERED — real money per call, billed to OpenCode Go.',
    routing: 'Backend implementation and review. NO VISION: never send a screenshot or a task needing one.',
    buildArgs: ({ model, prompt }) => ['run', '-m', model, '--format', 'json', prompt],
  },
  antigravity: {
    key: 'antigravity',
    label: 'Antigravity',
    cli: 'agy',
    binName: 'agy',
    fallbackPath: 'C:\\Users\\cople\\AppData\\Local\\agy\\bin\\agy.exe',
    supportsModel: true,
    defaultModel: null, // uses the CLI's own configured default
    costClass: 'floor-per-call',
    costNote: '~16k input-token floor per call — a one-line question costs about what a long one does.',
    routing: 'Very fast. Frontend work.',
    buildArgs: ({ model, prompt }) => {
      const args = ['-p', prompt, '--output-format', 'json'];
      if (model !== null) args.push('--model', model);
      return args;
    },
  },
  composer: {
    key: 'composer',
    label: 'Composer 2.5',
    cli: 'cursor-agent',
    binName: 'cursor-agent',
    fallbackPath: 'C:\\Users\\cople\\AppData\\Local\\cursor-agent\\cursor-agent.cmd',
    supportsModel: true,
    defaultModel: 'composer-2.5',
    costClass: 'shared-cursor-allowance',
    costNote: 'Shares one Cursor allowance with the grok lane.',
    routing: 'Long multi-file implementation runs. The only lane rated for long-horizon agentic work.',
    buildArgs: ({ model, prompt }) => ['-p', '--output-format', 'json', '--model', model, prompt],
  },
  grok: {
    key: 'grok',
    label: 'Grok 4.6',
    cli: 'cursor-agent',
    binName: 'cursor-agent',
    fallbackPath: 'C:\\Users\\cople\\AppData\\Local\\cursor-agent\\cursor-agent.cmd',
    supportsModel: true,
    defaultModel: 'cursor-grok-4.6-low',
    costClass: 'shared-cursor-allowance',
    costNote:
      'Shares one Cursor allowance with composer. Composer is the only lane rated for long multi-file agentic runs, so Grok spending comes directly out of a lane with no substitute.',
    routing: 'Analysis, research and single-shot code. Its agentic coding regressed against 4.5 — do not give it long autonomous runs.',
    buildArgs: ({ model, prompt }) => ['-p', '--output-format', 'json', '--model', model, prompt],
  },
  codex: {
    key: 'codex',
    label: 'Codex',
    cli: 'codex',
    binName: 'codex',
    fallbackPath: 'F:\\Apps\\codex',
    supportsModel: false,
    defaultModel: null, // taken from the user's ~/.codex/config.toml
    costClass: 'plan-included',
    costNote: 'Included in the ChatGPT plan.',
    routing: 'All-rounder — small model, punches above its size.',
    risk: 'HIGHEST RISK LANE. ~/.codex/config.toml sets sandbox_mode = "danger-full-access" and runs report approval: never, so this lane has full filesystem access with no prompts.',
    // stdin is closed rather than redirected from /dev/null: spawn() takes
    // stdio: ['ignore', ...], which is the portable form of `< /dev/null`.
    buildArgs: ({ prompt }) => ['exec', '--skip-git-repo-check', prompt],
  },
};

const LANE_KEYS = Object.keys(LANES);

// ---------------------------------------------------------------------------
// Small helpers. Every one of these returns null rather than a stand-in value.
// ---------------------------------------------------------------------------

function stripAnsi(s) {
  if (typeof s !== 'string') return '';
  // eslint-disable-next-line no-control-regex
  return s.replace(/\u001b\[[0-9;?]*[ -/]*[@-~]/g, '');
}

function firstLines(s, n) {
  const clean = stripAnsi(String(s === null || s === undefined ? '' : s)).trim();
  if (clean === '') return null;
  return clean.split(/\r?\n/).filter((l) => l.trim() !== '').slice(0, n).join(' | ') || null;
}

/** Finite numbers only. null, '', NaN, Infinity and objects all come back null. */
function toFiniteNumber(value) {
  if (value === null || value === undefined) return null;
  if (typeof value === 'number') return Number.isFinite(value) ? value : null;
  if (typeof value === 'string') {
    const trimmed = value.trim().replace(/,/g, '');
    if (trimmed === '') return null;
    const n = Number(trimmed);
    return Number.isFinite(n) ? n : null;
  }
  return null;
}

function fileExists(p) {
  try {
    return fs.statSync(p).isFile();
  } catch (_) {
    return false;
  }
}

function dirExists(p) {
  try {
    return fs.statSync(p).isDirectory();
  } catch (_) {
    return false;
  }
}

// ---------------------------------------------------------------------------
// Argument parsing
// ---------------------------------------------------------------------------

function parseArgs(argv) {
  const out = {
    lane: null,
    promptFile: null,
    json: false,
    dryRun: false,
    approve: false,
    configPath: DEFAULT_CONFIG_PATH,
    cwd: process.cwd(),
    timeoutMs: DEFAULT_DISPATCH_TIMEOUT_MS,
    help: false,
    errors: [],
  };

  const needsValue = new Set(['--lane', '--prompt-file', '--config', '--cwd', '--timeout']);

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (needsValue.has(arg)) {
      const value = argv[i + 1];
      if (value === undefined || value.startsWith('--')) {
        out.errors.push(`${arg} requires a value`);
        continue;
      }
      i += 1;
      if (arg === '--lane') out.lane = value;
      else if (arg === '--prompt-file') out.promptFile = value;
      else if (arg === '--config') out.configPath = path.resolve(value);
      else if (arg === '--cwd') out.cwd = path.resolve(value);
      else if (arg === '--timeout') {
        const ms = toFiniteNumber(value);
        if (ms === null || ms <= 0) out.errors.push(`--timeout must be a positive number of milliseconds, got "${value}"`);
        else out.timeoutMs = ms;
      }
      continue;
    }
    if (arg === '--json') out.json = true;
    else if (arg === '--dry-run') out.dryRun = true;
    else if (arg === '--approve') out.approve = true;
    else if (arg === '--help' || arg === '-h') out.help = true;
    else out.errors.push(`unrecognised argument "${arg}"`);
  }

  return out;
}

const HELP = `
check_lanes.js — probe and dispatch external agent CLI lanes.

  node check_lanes.js
      Probe every lane. Prints a table. NEVER dispatches.

  node check_lanes.js --lane <key>
      Probe one lane only.

  node check_lanes.js --lane <key> --prompt-file <path>
      Build the command for that lane from the config's mode:
        auto    run it and return the result
        ask     print the command, exit ${EXIT.APPROVAL_REQUIRED}, do not run
        reject  refuse, exit ${EXIT.REFUSED_BY_CONFIG}
      An unlisted lane is treated as ask.

  Flags
    --json              machine-readable output
    --dry-run           print the command, never execute, whatever the mode
    --approve           an ask lane may run. ONLY after the user says yes in chat.
                        Never overrides reject, and never overrides unavailable.
    --config <path>     policy file (default: ${DEFAULT_CONFIG_PATH})
    --cwd <path>        working directory for the dispatched process
    --timeout <ms>      dispatch timeout (default ${DEFAULT_DISPATCH_TIMEOUT_MS})

  Lanes: ${LANE_KEYS.join(', ')}

  Exit codes
    ${EXIT.OK}  ok          ${EXIT.APPROVAL_REQUIRED}  approval required   ${EXIT.REFUSED_BY_CONFIG}  refused by config
    ${EXIT.LANE_UNAVAILABLE}  unavailable ${EXIT.USAGE_ERROR}  usage/config error  ${EXIT.DISPATCH_FAILED}  dispatch failed
`;

// ---------------------------------------------------------------------------
// Config
// ---------------------------------------------------------------------------

/**
 * Loads the policy file. Never invents policy:
 *   - file missing        -> every lane ask, with a warning
 *   - file malformed      -> hard error, no guessing
 *   - lane unlisted       -> ask, and the reason says the config did not mention it
 *   - mode value invalid  -> ask, and the reason names the invalid value
 * There is deliberately no config key that makes an unlisted lane auto.
 */
function loadConfig(configPath) {
  const result = {
    path: configPath,
    found: false,
    raw: null,
    lanes: {},
    warnings: [],
    fatal: null,
  };

  if (!fileExists(configPath)) {
    result.warnings.push(
      `Config file not found at ${configPath}. Every lane is treated as "ask" until it exists.`
    );
    return result;
  }

  let text;
  try {
    text = fs.readFileSync(configPath, 'utf8');
  } catch (err) {
    result.fatal = `Config file at ${configPath} could not be read: ${err.message}`;
    return result;
  }

  try {
    result.raw = JSON.parse(text.replace(/^\uFEFF/, ''));
  } catch (err) {
    result.fatal = `Config file at ${configPath} is not valid JSON: ${err.message}. Refusing to guess a policy.`;
    return result;
  }

  result.found = true;

  const laneTable = result.raw && typeof result.raw.lanes === 'object' && result.raw.lanes !== null
    ? result.raw.lanes
    : null;

  if (laneTable === null) {
    result.warnings.push(
      `Config at ${configPath} has no "lanes" object. Every lane is treated as "ask".`
    );
    return result;
  }

  for (const key of Object.keys(laneTable)) {
    if (!Object.prototype.hasOwnProperty.call(LANES, key)) {
      result.warnings.push(`Config lists lane "${key}", which is not a known lane. Ignored.`);
      continue;
    }
    const entry = laneTable[key];
    if (entry === null || typeof entry !== 'object') {
      result.warnings.push(`Config entry for lane "${key}" is not an object. Treating that lane as "ask".`);
      continue;
    }
    result.lanes[key] = entry;
    if (entry.model !== undefined && !LANES[key].supportsModel) {
      result.warnings.push(
        `Config sets a model for lane "${key}", but that lane takes no model flag. The value is ignored.`
      );
    }
  }

  return result;
}

/** Resolves the effective mode for one lane, always with a stated reason. */
function resolveMode(laneKey, config) {
  const entry = Object.prototype.hasOwnProperty.call(config.lanes, laneKey) ? config.lanes[laneKey] : null;

  if (entry === null) {
    return {
      mode: 'ask',
      configured: null,
      source: config.found ? 'unlisted-in-config' : 'config-file-missing',
      reason: config.found
        ? `The config at ${config.path} did not mention lane "${laneKey}". An unlisted lane is treated as "ask"; it is not an implicit "auto".`
        : `No config file at ${config.path}, so lane "${laneKey}" is treated as "ask".`,
    };
  }

  const configured = entry.mode;
  if (typeof configured !== 'string' || !VALID_MODES.includes(configured)) {
    return {
      mode: 'ask',
      configured: configured === undefined ? null : configured,
      source: 'invalid-mode-value',
      reason: `Lane "${laneKey}" has mode ${JSON.stringify(configured)}, which is not one of ${VALID_MODES.join('/')}. Treated as "ask".`,
    };
  }

  return {
    mode: configured,
    configured,
    source: 'config',
    reason: `Config sets lane "${laneKey}" to "${configured}".`,
  };
}

/** Resolves the model slug for one lane and reports where it came from. */
function resolveModel(laneKey, config) {
  const lane = LANES[laneKey];
  if (!lane.supportsModel) {
    return {
      model: null,
      source: 'lane-takes-no-model-flag',
      note:
        laneKey === 'codex'
          ? 'codex uses the model in ~/.codex/config.toml. This script does not change that file.'
          : null,
    };
  }
  const entry = Object.prototype.hasOwnProperty.call(config.lanes, laneKey) ? config.lanes[laneKey] : null;
  const configured = entry === null ? undefined : entry.model;
  if (typeof configured === 'string' && configured.trim() !== '') {
    return { model: configured.trim(), source: 'config', note: null };
  }
  if (configured !== undefined && configured !== null) {
    return {
      model: lane.defaultModel,
      source: 'built-in-default',
      note: `Config value ${JSON.stringify(configured)} is not a usable model slug; fell back to the built-in default.`,
    };
  }
  return {
    model: lane.defaultModel,
    source: lane.defaultModel === null ? 'cli-default' : 'built-in-default',
    note: lane.defaultModel === null ? 'No model flag is passed; the CLI uses its own configured default.' : null,
  };
}

// ---------------------------------------------------------------------------
// Fast-slug check. Warn loudly, name the alternative, then proceed.
// ---------------------------------------------------------------------------

/**
 * Cursor's `-fast` variants consume the shared Cursor allowance
 * disproportionately. That allowance is shared between composer and grok, and
 * composer is the only lane rated for long multi-file agentic runs, so the
 * spending is not fungible. This warns; it does not block.
 */
function checkFastSlug(laneKey, model, liveModelCatalogue) {
  const notFast = { isFast: false, warning: null, alternative: null, alternativeVerified: null };
  if (typeof model !== 'string' || !/-fast/.test(model)) return notFast;

  // The constraint is Cursor's, so the warning is Cursor's. A "-fast" slug on a
  // non-Cursor lane is not a known concern, and inventing a warning for it
  // would be asserting a constraint nobody measured.
  if (LANES[laneKey].cli !== 'cursor-agent') {
    return Object.assign({}, notFast, {
      note: `Model "${model}" contains "-fast", but lane "${laneKey}" does not use the Cursor CLI, so the Cursor allowance warning does not apply. The slug is passed through as configured.`,
    });
  }

  const trailing = /-fast$/.test(model);
  const alternative = trailing ? model.replace(/-fast$/, '') : null;

  let alternativeVerified = null; // unknown until a live catalogue proves otherwise
  let verificationNote;
  if (alternative === null) {
    verificationNote = `"-fast" is not a trailing suffix of ${JSON.stringify(model)}, so the non-fast slug could not be derived.`;
  } else if (Array.isArray(liveModelCatalogue)) {
    alternativeVerified = liveModelCatalogue.includes(alternative);
    verificationNote = alternativeVerified
      ? `${alternative} was confirmed present in the live cursor-agent model list.`
      : `${alternative} was NOT found in the live cursor-agent model list — check the slug before switching.`;
  } else {
    verificationNote = `The live cursor-agent model list was not read, so it is unknown whether ${alternative} exists.`;
  }

  const lines = [
    `FAST SLUG WARNING — lane "${laneKey}" is configured with model "${model}".`,
    'Cursor "-fast" variants consume the shared Cursor allowance disproportionately.',
    'That allowance is shared between composer and grok, and composer is the only lane',
    'rated for long multi-file agentic runs, so this spending is not fungible.',
    alternative === null
      ? `Non-fast alternative: could not be derived. ${verificationNote}`
      : `Non-fast alternative: "${alternative}". ${verificationNote}`,
    'Proceeding anyway — it is your allowance to spend.',
  ];

  return { isFast: true, warning: lines.join('\n'), alternative, alternativeVerified, verificationNote };
}

// ---------------------------------------------------------------------------
// Binary resolution and transport
// ---------------------------------------------------------------------------

/** Every PATH hit for a name, in PATH order, .exe before shims within a dir. */
function collectOnPath(binName) {
  const pathVar = process.env.PATH || process.env.Path || '';
  if (pathVar === '') return [];
  const exts = process.platform === 'win32' ? ['.exe', '.com', '.cmd', '.bat', ''] : [''];
  const hits = [];
  const seen = new Set();
  for (const dir of pathVar.split(path.delimiter)) {
    if (dir.trim() === '') continue;
    for (const ext of exts) {
      const candidate = path.join(dir, binName + ext);
      const norm = candidate.toLowerCase();
      if (seen.has(norm)) continue;
      if (fileExists(candidate)) {
        seen.add(norm);
        hits.push(candidate);
      }
    }
  }
  return hits;
}

/**
 * Reads an npm-style .cmd shim and returns the real target it launches.
 *
 * PATH order is not a guarantee of a working install: F:\Apps\opencode.cmd sits
 * earlier in PATH than the real opencode and points at a node_modules payload
 * that no longer exists. Following the shim to its target — and finding the
 * target missing — is what lets the candidate loop keep looking instead of
 * declaring the lane dead.
 */
function parseShimTargets(shimPath) {
  let text;
  try {
    text = fs.readFileSync(shimPath, 'utf8');
  } catch (_) {
    return [];
  }
  const dir = path.dirname(shimPath);
  const targets = [];
  const re = /"([^"]*%~?dp0%?[^"]*)"/g;
  let m = re.exec(text);
  while (m !== null) {
    const raw = m[1].replace(/%~?dp0%?/gi, '').replace(/\\/g, path.sep).replace(/^[\\/]+/, '');
    if (raw.trim() !== '') targets.push(path.resolve(dir, raw));
    m = re.exec(text);
  }
  return targets;
}

/**
 * Ordered candidate entry points: a config override wins outright, otherwise
 * every PATH hit in order, then the known install location.
 */
function collectBinaryCandidates(laneKey, config) {
  const lane = LANES[laneKey];
  const entry = Object.prototype.hasOwnProperty.call(config.lanes, laneKey) ? config.lanes[laneKey] : null;
  const override = entry === null ? undefined : entry.binary;

  if (typeof override === 'string' && override.trim() !== '') {
    const resolved = path.resolve(override.trim());
    if (fileExists(resolved)) return { candidates: [{ path: resolved, source: 'config-binary-override' }], overrideError: null };
    return {
      candidates: [],
      overrideError: `Config sets binary "${override}" for lane "${laneKey}", but no file exists at ${resolved}. The config override is exclusive: PATH is not searched as a fallback.`,
    };
  }

  const candidates = collectOnPath(lane.binName).map((p) => ({ path: p, source: 'PATH' }));
  if (fileExists(lane.fallbackPath) && !candidates.some((c) => c.path.toLowerCase() === lane.fallbackPath.toLowerCase())) {
    candidates.push({ path: lane.fallbackPath, source: 'known-install-location' });
  }
  return { candidates, overrideError: null };
}

/** First candidate that yields a working transport wins; rejections are kept. */
function resolveExecution(laneKey, config) {
  const lane = LANES[laneKey];
  const { candidates, overrideError } = collectBinaryCandidates(laneKey, config);
  const rejected = [];

  if (overrideError !== null) {
    return { binaryPath: null, binarySource: 'config-binary-override', transport: null, rejected, error: overrideError };
  }

  for (const candidate of candidates) {
    const transport = resolveTransport(laneKey, candidate.path);
    if (transport.command !== null) {
      return { binaryPath: candidate.path, binarySource: candidate.source, transport, rejected, error: null };
    }
    rejected.push({ path: candidate.path, source: candidate.source, reason: transport.error });
  }

  const detail = rejected.length === 0
    ? `"${lane.binName}" is not on PATH and is not at the known install location ${lane.fallbackPath}.`
    : `No usable "${lane.binName}" entry point. Tried ${rejected.length}: ${rejected.map((r) => `${r.path} (${r.reason})`).join(' ;; ')}`;

  return { binaryPath: null, binarySource: null, transport: null, rejected, error: detail };
}

function parseCursorVersionDir(name) {
  // Mirrors cursor-agent.ps1: YYYY.M.D-commit or YYYY.M.D-HH-MM-SS-commit
  const m = /^(\d{4})\.(\d{1,2})\.(\d{1,2})(?:-\d{2}-\d{2}-\d{2})?-[a-f0-9]+$/.exec(name);
  if (m === null) return null;
  const n = Number(`${m[1]}${m[2].padStart(2, '0')}${m[3].padStart(2, '0')}`);
  return Number.isFinite(n) ? n : null;
}

/**
 * Turns a resolved entry point into something spawn() can run with NO SHELL.
 *
 * This matters more than it looks. cursor-agent and codex ship as .cmd shims.
 * Routing a prompt through `cmd.exe /c` means cmd re-parses the argument: `&`,
 * `|`, `^` and `%VAR%` become active and Node's `\"` escaping is not understood
 * by cmd, so any prompt containing a double quote is silently corrupted — or
 * worse, partly executed. Multi-paragraph prompts contain all of these. So each
 * shim is resolved down to its real payload and spawned directly. If that
 * cannot be done, the lane reports unavailable rather than risking the shell.
 */
function resolveTransport(laneKey, binaryPath) {
  const lane = LANES[laneKey];
  const dir = path.dirname(binaryPath);
  const ext = path.extname(binaryPath).toLowerCase();

  if (lane.cli === 'opencode' || lane.cli === 'agy') {
    if (ext === '.exe' || ext === '.com') return { command: binaryPath, prefixArgs: [], kind: 'direct-exe' };

    const sibling = `${binaryPath}.exe`;
    if (fileExists(sibling)) return { command: sibling, prefixArgs: [], kind: 'direct-exe' };

    if (ext === '.cmd' || ext === '.bat') {
      const targets = parseShimTargets(binaryPath);
      if (targets.length === 0) {
        return { command: null, error: `${binaryPath} is a .cmd shim whose target could not be parsed.` };
      }
      for (const target of targets) {
        if (!fileExists(target)) continue;
        const targetExt = path.extname(target).toLowerCase();
        if (targetExt === '.exe' || targetExt === '.com') {
          return { command: target, prefixArgs: [], kind: 'shim-resolved-exe', shim: binaryPath };
        }
        if (targetExt === '.js') {
          return { command: process.execPath, prefixArgs: [target], kind: 'shim-resolved-node-payload', shim: binaryPath };
        }
      }
      return {
        command: null,
        error: `${binaryPath} is a .cmd shim, but none of its targets exist: ${targets.join(', ')}. This install is stale.`,
      };
    }

    return {
      command: null,
      error: `Resolved ${binaryPath} for lane "${laneKey}", but it is not a directly spawnable executable and no sibling .exe was found.`,
    };
  }

  if (lane.cli === 'cursor-agent') {
    if (ext === '.exe') return { command: binaryPath, prefixArgs: [], kind: 'direct-exe' };

    // Branch 1 of cursor-agent.ps1: node.exe and index.js beside the shim.
    const localNode = path.join(dir, 'node.exe');
    const localIndex = path.join(dir, 'index.js');
    if (fileExists(localNode) && fileExists(localIndex)) {
      return { command: localNode, prefixArgs: [localIndex], kind: 'cursor-node-payload', payloadDir: dir };
    }

    // Branch 2: newest directory under versions/.
    const versionsDir = path.join(dir, 'versions');
    if (!dirExists(versionsDir)) {
      return {
        command: null,
        error: `cursor-agent shim at ${binaryPath} has no versions/ directory beside it, so its runtime payload could not be located. Refusing the cmd.exe shim transport: it would corrupt a multi-line prompt.`,
      };
    }
    let best = null;
    let bestScore = null;
    for (const name of fs.readdirSync(versionsDir)) {
      const score = parseCursorVersionDir(name);
      if (score === null) continue;
      const candidateDir = path.join(versionsDir, name);
      const nodeExe = path.join(candidateDir, 'node.exe');
      const indexJs = path.join(candidateDir, 'index.js');
      if (!fileExists(nodeExe) || !fileExists(indexJs)) continue;
      if (bestScore === null || score > bestScore) {
        bestScore = score;
        best = { nodeExe, indexJs, name, dir: candidateDir };
      }
    }
    if (best === null) {
      return {
        command: null,
        error: `No usable cursor-agent runtime found under ${versionsDir} (need a version directory containing both node.exe and index.js). Refusing the cmd.exe shim transport: it would corrupt a multi-line prompt.`,
      };
    }
    return {
      command: best.nodeExe,
      prefixArgs: [best.indexJs],
      kind: 'cursor-node-payload',
      payloadVersion: best.name,
      payloadDir: best.dir,
    };
  }

  if (lane.cli === 'codex') {
    if (ext === '.exe') return { command: binaryPath, prefixArgs: [], kind: 'direct-exe' };
    if (ext === '.js') return { command: process.execPath, prefixArgs: [binaryPath], kind: 'node-payload' };

    const candidates = [
      path.join(dir, 'codex-cli', 'node_modules', '@openai', 'codex', 'bin', 'codex.js'),
      path.join(dir, 'node_modules', '@openai', 'codex', 'bin', 'codex.js'),
    ];
    for (const candidate of candidates) {
      if (fileExists(candidate)) {
        return { command: process.execPath, prefixArgs: [candidate], kind: 'node-payload', payloadDir: path.dirname(candidate) };
      }
    }
    const siblingExe = path.join(dir, 'codex.exe');
    if (fileExists(siblingExe)) return { command: siblingExe, prefixArgs: [], kind: 'direct-exe' };
    return {
      command: null,
      error: `codex entry point at ${binaryPath} is a shell/cmd shim and its codex.js payload was not found at ${candidates.join(' or ')}. Refusing the cmd.exe shim transport: it would corrupt a multi-line prompt.`,
    };
  }

  return { command: null, error: `Lane "${laneKey}" has an unknown cli "${lane.cli}".` };
}

// ---------------------------------------------------------------------------
// Availability probing
//
// Three outcomes, never conflated:
//   available === true   probe proved the CLI runs AND credentials are present
//   available === false  probe proved something is wrong (named in `state`)
//   available === null   the probe could not decide. UNKNOWN IS NOT AVAILABLE.
// ---------------------------------------------------------------------------

function runProbe(command, args, cwd) {
  try {
    const res = spawnSync(command, args, {
      cwd,
      timeout: PROBE_TIMEOUT_MS,
      encoding: 'utf8',
      windowsHide: true,
      shell: false,
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    if (res.error) {
      return { ok: false, timedOut: res.error.code === 'ETIMEDOUT', status: null, stdout: '', stderr: '', errorMessage: res.error.message };
    }
    return {
      ok: true,
      timedOut: res.signal === 'SIGTERM' && res.status === null,
      status: res.status,
      stdout: res.stdout === null || res.stdout === undefined ? '' : res.stdout,
      stderr: res.stderr === null || res.stderr === undefined ? '' : res.stderr,
      errorMessage: null,
    };
  } catch (err) {
    return { ok: false, timedOut: false, status: null, stdout: '', stderr: '', errorMessage: err.message };
  }
}

/**
 * Reads the KEYS of the opencode credential store. Values are never read,
 * never logged and never returned — only whether a provider id is present.
 */
function opencodeProviderPresence(providerId) {
  const bases = [];
  if (typeof process.env.XDG_DATA_HOME === 'string' && process.env.XDG_DATA_HOME.trim() !== '') {
    bases.push(path.join(process.env.XDG_DATA_HOME, 'opencode', 'auth.json'));
  }
  const home = process.env.USERPROFILE || os.homedir();
  if (typeof home === 'string' && home.trim() !== '') {
    bases.push(path.join(home, '.local', 'share', 'opencode', 'auth.json'));
  }

  for (const authPath of bases) {
    if (!fileExists(authPath)) continue;
    try {
      const parsed = JSON.parse(fs.readFileSync(authPath, 'utf8').replace(/^\uFEFF/, ''));
      if (parsed === null || typeof parsed !== 'object') {
        return { present: null, reason: `${authPath} did not parse to an object, so provider credentials are unknown.`, storePath: authPath };
      }
      const keys = Object.keys(parsed); // keys only — no credential values are touched
      return {
        present: keys.includes(providerId),
        reason: keys.includes(providerId) ? null : `Provider "${providerId}" has no entry in ${authPath}. Run: opencode auth login`,
        storePath: authPath,
        providerCount: keys.length,
      };
    } catch (err) {
      return { present: null, reason: `${authPath} could not be read (${err.message}), so provider credentials are unknown.`, storePath: authPath };
    }
  }

  return {
    present: null,
    reason: `No opencode credential store found at ${bases.join(' or ') || '(no home directory resolved)'}, so provider credentials are unknown.`,
    storePath: null,
  };
}

function probeLane(laneKey, config, cwd) {
  const lane = LANES[laneKey];
  const probe = {
    available: null,
    state: 'unknown',
    reason: null,
    evidence: null,
    binaryPath: null,
    binarySource: null,
    transport: null,
    modelCatalogue: null,
    rejectedCandidates: [],
  };

  const execution = resolveExecution(laneKey, config);
  probe.binaryPath = execution.binaryPath;
  probe.binarySource = execution.binarySource;
  probe.rejectedCandidates = execution.rejected;

  if (execution.transport === null) {
    probe.available = false;
    probe.state = execution.rejected.length === 0 ? 'not-installed' : 'transport-unresolved';
    probe.reason = execution.error;
    return probe;
  }

  const transport = execution.transport;
  probe.transport = {
    kind: transport.kind,
    command: transport.command,
    prefixArgs: transport.prefixArgs,
    payloadVersion: transport.payloadVersion === undefined ? null : transport.payloadVersion,
    shim: transport.shim === undefined ? null : transport.shim,
  };

  const run = (args) => runProbe(transport.command, transport.prefixArgs.concat(args), cwd);

  if (lane.cli === 'opencode') {
    const res = run(['auth', 'list']);
    if (!res.ok || res.timedOut) {
      probe.available = null;
      probe.state = res.timedOut ? 'probe-timeout' : 'probe-failed';
      probe.reason = `\`opencode auth list\` did not complete (${res.errorMessage || 'timed out'}), so credentials are UNKNOWN — not assumed present.`;
      return probe;
    }
    if (res.status !== 0) {
      probe.available = null;
      probe.state = 'probe-failed';
      probe.reason = `\`opencode auth list\` exited ${res.status}, so credentials are UNKNOWN.`;
      probe.evidence = firstLines(res.stderr || res.stdout, 3);
      return probe;
    }
    const providerId = String(lane.defaultModel || '').split('/')[0];
    const configuredModel = resolveModel(laneKey, config).model;
    const effectiveProvider = typeof configuredModel === 'string' && configuredModel.includes('/')
      ? configuredModel.split('/')[0]
      : providerId;
    const presence = opencodeProviderPresence(effectiveProvider);
    probe.evidence = `opencode auth list ok; credential store ${presence.storePath || '(not found)'}`;
    if (presence.present === true) {
      probe.available = true;
      probe.state = 'ready';
      probe.reason = null;
    } else if (presence.present === false) {
      probe.available = false;
      probe.state = 'unauthenticated';
      probe.reason = presence.reason;
    } else {
      probe.available = null;
      probe.state = 'auth-unknown';
      probe.reason = presence.reason;
    }
    return probe;
  }

  if (lane.cli === 'agy') {
    const res = run(['models']);
    if (!res.ok || res.timedOut) {
      probe.available = null;
      probe.state = res.timedOut ? 'probe-timeout' : 'probe-failed';
      probe.reason = `\`agy models\` did not complete (${res.errorMessage || 'timed out'}), so this lane is UNKNOWN — not assumed usable.`;
      return probe;
    }
    const combined = stripAnsi(`${res.stdout}\n${res.stderr}`);
    const slugs = [];
    for (const line of combined.split(/\r?\n/)) {
      const m = /^([A-Za-z0-9][A-Za-z0-9._-]*)\t/.exec(line);
      if (m !== null) slugs.push(m[1]);
    }
    if (res.status === 0 && slugs.length > 0) {
      probe.available = true;
      probe.state = 'ready';
      probe.modelCatalogue = slugs;
      probe.evidence = `agy models listed ${slugs.length} models`;
      return probe;
    }
    if (/\b(log ?in|sign ?in|unauthenticated|unauthorized|not authenticated|auth)\b/i.test(combined)) {
      probe.available = false;
      probe.state = 'unauthenticated';
      probe.reason = '`agy models` reported an authentication problem. Run `agy` once interactively to sign in.';
      probe.evidence = firstLines(combined, 3);
      return probe;
    }
    probe.available = null;
    probe.state = 'probe-failed';
    probe.reason = `\`agy models\` exited ${res.status} and listed no models, so this lane is UNKNOWN.`;
    probe.evidence = firstLines(combined, 3);
    return probe;
  }

  if (lane.cli === 'cursor-agent') {
    const res = run(['--list-models']);
    if (!res.ok || res.timedOut) {
      probe.available = null;
      probe.state = res.timedOut ? 'probe-timeout' : 'probe-failed';
      probe.reason = `\`cursor-agent --list-models\` did not complete (${res.errorMessage || 'timed out'}), so this lane is UNKNOWN — not assumed usable.`;
      return probe;
    }
    const combined = stripAnsi(`${res.stdout}\n${res.stderr}`);
    const slugs = [];
    for (const line of combined.split(/\r?\n/)) {
      const m = /^([A-Za-z0-9][A-Za-z0-9._-]*)\s+-\s+\S/.exec(line.trim());
      if (m !== null) slugs.push(m[1]);
    }
    if (res.status === 0 && slugs.length > 0) {
      probe.available = true;
      probe.state = 'ready';
      probe.modelCatalogue = slugs;
      probe.evidence = `cursor-agent --list-models listed ${slugs.length} models`;
      return probe;
    }
    if (/\b(log ?in|sign ?in|unauthenticated|unauthorized|not authenticated)\b/i.test(combined)) {
      probe.available = false;
      probe.state = 'unauthenticated';
      probe.reason = '`cursor-agent --list-models` reported an authentication problem. Run `cursor-agent login`.';
      probe.evidence = firstLines(combined, 3);
      return probe;
    }
    probe.available = null;
    probe.state = 'probe-failed';
    probe.reason = `\`cursor-agent --list-models\` exited ${res.status} and listed no models, so this lane is UNKNOWN.`;
    probe.evidence = firstLines(combined, 3);
    return probe;
  }

  if (lane.cli === 'codex') {
    const res = run(['login', 'status']);
    if (!res.ok || res.timedOut) {
      probe.available = null;
      probe.state = res.timedOut ? 'probe-timeout' : 'probe-failed';
      probe.reason = `\`codex login status\` did not complete (${res.errorMessage || 'timed out'}), so this lane is UNKNOWN — not assumed usable.`;
      return probe;
    }
    const combined = stripAnsi(`${res.stdout}\n${res.stderr}`);
    if (res.status === 0 && /logged in/i.test(combined) && !/not logged in/i.test(combined)) {
      probe.available = true;
      probe.state = 'ready';
      probe.evidence = firstLines(combined, 1);
      return probe;
    }
    if (/not logged in|please (run )?codex login|sign ?in/i.test(combined)) {
      probe.available = false;
      probe.state = 'unauthenticated';
      probe.reason = '`codex login status` says this account is not logged in. Run `codex login`.';
      probe.evidence = firstLines(combined, 2);
      return probe;
    }
    probe.available = null;
    probe.state = 'probe-failed';
    probe.reason = `\`codex login status\` exited ${res.status} and its output did not confirm a login, so this lane is UNKNOWN.`;
    probe.evidence = firstLines(combined, 2);
    return probe;
  }

  probe.available = null;
  probe.state = 'probe-failed';
  probe.reason = `No probe is defined for cli "${lane.cli}".`;
  return probe;
}

// ---------------------------------------------------------------------------
// Token usage parsing
//
// Shapes differ per CLI and have NOT been verified against a live dispatch
// (verifying would mean spending the user's budget). The parser is therefore
// tolerant AND self-reporting: when it finds nothing it returns null and says
// so. It never reports 0 tokens for an unmeasured call.
// ---------------------------------------------------------------------------

const USAGE_CONTAINER_KEYS = new Set(['usage', 'tokenUsage', 'token_usage', 'tokens', 'token_counts', 'tokenCounts']);

const USAGE_FIELDS = {
  inputTokens: ['input_tokens', 'inputTokens', 'prompt_tokens', 'promptTokens', 'input', 'prompt'],
  outputTokens: ['output_tokens', 'outputTokens', 'completion_tokens', 'completionTokens', 'output', 'completion'],
  totalTokens: ['total_tokens', 'totalTokens', 'total'],
  cacheReadTokens: ['cache_read_input_tokens', 'cacheReadInputTokens', 'cached_tokens', 'cachedTokens', 'cache_read', 'cacheRead'],
  cacheWriteTokens: ['cache_creation_input_tokens', 'cacheCreationInputTokens', 'cache_write', 'cacheWrite'],
  reasoningTokens: ['reasoning_tokens', 'reasoningTokens'],
  costUsd: ['cost', 'total_cost', 'totalCost', 'cost_usd', 'costUsd', 'costUSD'],
};

function parseJsonDocuments(stdout) {
  const docs = [];
  const text = String(stdout === null || stdout === undefined ? '' : stdout).trim();
  if (text === '') return docs;

  try {
    docs.push(JSON.parse(text));
    return docs;
  } catch (_) {
    // fall through to NDJSON / mixed output
  }

  for (const line of text.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (trimmed === '' || (trimmed[0] !== '{' && trimmed[0] !== '[')) continue;
    try {
      docs.push(JSON.parse(trimmed));
    } catch (_) {
      /* not a JSON line; ignore */
    }
  }
  return docs;
}

function readField(container, aliases) {
  for (const alias of aliases) {
    if (Object.prototype.hasOwnProperty.call(container, alias)) {
      const n = toFiniteNumber(container[alias]);
      if (n !== null) return { value: n, key: alias };
    }
  }
  return { value: null, key: null };
}

function findUsageContainers(doc) {
  const found = [];
  const queue = [{ node: doc, pathParts: [] }];
  let visited = 0;
  while (queue.length > 0 && visited < 5000) {
    const { node, pathParts } = queue.shift();
    visited += 1;
    if (node === null || typeof node !== 'object') continue;
    if (Array.isArray(node)) {
      node.forEach((child, i) => queue.push({ node: child, pathParts: pathParts.concat(`[${i}]`) }));
      continue;
    }
    for (const key of Object.keys(node)) {
      const child = node[key];
      if (USAGE_CONTAINER_KEYS.has(key) && child !== null && typeof child === 'object' && !Array.isArray(child)) {
        found.push({ container: child, path: pathParts.concat(key).join('.') });
      }
      queue.push({ node: child, pathParts: pathParts.concat(key) });
    }
  }
  return found;
}

function normaliseUsage(container, containerPath) {
  const usage = { path: containerPath, fieldsFound: [] };
  let anyFound = false;
  for (const [field, aliases] of Object.entries(USAGE_FIELDS)) {
    const hit = readField(container, aliases);
    usage[field] = hit.value; // null when absent — never 0
    if (hit.value !== null) {
      anyFound = true;
      usage.fieldsFound.push(`${containerPath}.${hit.key}`);
    }
  }
  if (!anyFound) return null;

  usage.totalDerived = false;
  if (usage.totalTokens === null && usage.inputTokens !== null && usage.outputTokens !== null) {
    usage.totalTokens = usage.inputTokens + usage.outputTokens;
    usage.totalDerived = true;
  }
  return usage;
}

function extractUsage(laneKey, stdout) {
  const docs = parseJsonDocuments(stdout);
  if (docs.length === 0) {
    const preview = firstLines(stdout, 1);
    return {
      usage: null,
      reason: `Lane "${laneKey}" produced no parseable JSON, so token usage is UNKNOWN (not zero).${preview === null ? ' Output was empty.' : ` First output line: ${preview.slice(0, 160)}`}`,
      documentsParsed: 0,
    };
  }

  // Later documents win: in stream-json output the final message carries the
  // cumulative totals.
  let best = null;
  docs.forEach((doc, index) => {
    for (const hit of findUsageContainers(doc)) {
      const normalised = normaliseUsage(hit.container, hit.path);
      if (normalised !== null) best = Object.assign(normalised, { documentIndex: index });
    }
  });

  if (best === null) {
    return {
      usage: null,
      reason: `Parsed ${docs.length} JSON document(s) from lane "${laneKey}", none containing a usage/token block. Token usage is UNKNOWN (not zero).`,
      documentsParsed: docs.length,
    };
  }

  return { usage: best, reason: null, documentsParsed: docs.length };
}

// ---------------------------------------------------------------------------
// Command building and dispatch
// ---------------------------------------------------------------------------

function readPromptFile(promptFile) {
  const resolved = path.resolve(promptFile);
  if (!fileExists(resolved)) return { text: null, error: `Prompt file not found: ${resolved}` };
  let text;
  try {
    text = fs.readFileSync(resolved, 'utf8');
  } catch (err) {
    return { text: null, error: `Prompt file ${resolved} could not be read: ${err.message}` };
  }
  text = text.replace(/^\uFEFF/, '');
  if (text.trim() === '') {
    return { text: null, error: `Prompt file ${resolved} is empty. Refusing to dispatch an empty prompt.` };
  }
  return { text, error: null, resolvedPath: resolved };
}

/**
 * A human-readable rendering of the command. The prompt argument is shown as a
 * file reference rather than inlined, because inlining it would suggest a shell
 * string that is NOT how the command is actually run — the prompt is passed as
 * one element of an argv array with no shell involved.
 */
function renderCommand(transport, args, promptText, promptPath) {
  return transport.prefixArgs
    .concat(args)
    .map((a) => (a === promptText ? `<prompt argv element — ${promptPath} (${promptText.length} chars)>` : a))
    .map((a) => (/\s/.test(a) ? `"${a}"` : a))
    .reduce((acc, a) => `${acc} ${a}`, transport.command);
}

function dispatch(transport, args, cwd, timeoutMs) {
  return new Promise((resolve) => {
    let child;
    try {
      child = spawn(transport.command, transport.prefixArgs.concat(args), {
        cwd,
        windowsHide: true,
        shell: false, // never a shell: the prompt must not be re-parsed
        stdio: ['ignore', 'pipe', 'pipe'], // portable form of `< /dev/null`
      });
    } catch (err) {
      resolve({ spawned: false, error: err.message, status: null, stdout: '', stderr: '', timedOut: false });
      return;
    }

    let stdout = '';
    let stderr = '';
    let timedOut = false;
    const timer = setTimeout(() => {
      timedOut = true;
      try { child.kill(); } catch (_) { /* already gone */ }
    }, timeoutMs);

    child.stdout.on('data', (d) => { stdout += d.toString('utf8'); });
    child.stderr.on('data', (d) => { stderr += d.toString('utf8'); });
    child.on('error', (err) => {
      clearTimeout(timer);
      resolve({ spawned: false, error: err.message, status: null, stdout, stderr, timedOut });
    });
    child.on('close', (status) => {
      clearTimeout(timer);
      resolve({ spawned: true, error: null, status, stdout, stderr, timedOut });
    });
  });
}

// ---------------------------------------------------------------------------
// Output
// ---------------------------------------------------------------------------

function availabilityLabel(available) {
  if (available === true) return 'yes';
  if (available === false) return 'NO';
  return 'unknown'; // never rendered as yes
}

function renderTable(rows) {
  const headers = ['LANE', 'MODE', 'AVAIL', 'STATE', 'COST', 'MODEL', 'BINARY'];
  const data = rows.map((r) => [
    r.lane,
    r.mode + (r.modeSource === 'config' ? '' : ' *'),
    availabilityLabel(r.available),
    r.state,
    r.costClass,
    r.model === null ? '(cli default)' : r.model,
    r.binaryPath === null ? '(unresolved)' : r.binaryPath,
  ]);
  const widths = headers.map((h, i) => Math.max(h.length, ...data.map((row) => row[i].length)));
  const line = (cells) => cells.map((c, i) => c.padEnd(widths[i])).join('  ').replace(/\s+$/, '');
  const out = [line(headers), widths.map((w) => '-'.repeat(w)).join('  ')];
  for (const row of data) out.push(line(row));
  return out.join('\n');
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

function buildLaneReport(laneKey, config, cwd) {
  const lane = LANES[laneKey];
  const modeInfo = resolveMode(laneKey, config);
  const modelInfo = resolveModel(laneKey, config);
  const probe = probeLane(laneKey, config, cwd);
  const fast = checkFastSlug(laneKey, modelInfo.model, probe.modelCatalogue);

  return {
    lane: laneKey,
    label: lane.label,
    cli: lane.cli,
    mode: modeInfo.mode,
    modeConfigured: modeInfo.configured,
    modeSource: modeInfo.source,
    modeReason: modeInfo.reason,
    model: modelInfo.model,
    modelSource: modelInfo.source,
    modelNote: modelInfo.note,
    available: probe.available,
    state: probe.state,
    reason: probe.reason,
    evidence: probe.evidence,
    binaryPath: probe.binaryPath,
    binarySource: probe.binarySource,
    transport: probe.transport,
    costClass: lane.costClass,
    costNote: lane.costNote,
    routing: lane.routing,
    risk: lane.risk === undefined ? null : lane.risk,
    fastSlug: fast,
  };
}

function emit(payload, opts, exitCode) {
  if (opts.json) {
    process.stdout.write(`${JSON.stringify(payload, null, 2)}\n`);
  }
  process.exit(exitCode);
}

async function main() {
  const opts = parseArgs(process.argv.slice(2));

  if (opts.help) {
    process.stdout.write(`${HELP}\n`);
    process.exit(EXIT.OK);
  }

  if (opts.errors.length > 0) {
    const payload = { ok: false, errors: opts.errors };
    if (!opts.json) {
      process.stderr.write(`Argument error:\n  ${opts.errors.join('\n  ')}\n${HELP}\n`);
    }
    emit(payload, opts, EXIT.USAGE_ERROR);
  }

  if (opts.lane !== null && !Object.prototype.hasOwnProperty.call(LANES, opts.lane)) {
    const message = `Unknown lane "${opts.lane}". Known lanes: ${LANE_KEYS.join(', ')}`;
    if (!opts.json) process.stderr.write(`${message}\n`);
    emit({ ok: false, errors: [message] }, opts, EXIT.USAGE_ERROR);
  }

  const config = loadConfig(opts.configPath);
  if (config.fatal !== null) {
    if (!opts.json) process.stderr.write(`Config error: ${config.fatal}\n`);
    emit({ ok: false, errors: [config.fatal], configPath: config.path }, opts, EXIT.USAGE_ERROR);
  }

  // ---- probe-only paths -------------------------------------------------
  if (opts.promptFile === null) {
    const keys = opts.lane === null ? LANE_KEYS : [opts.lane];
    const lanes = keys.map((k) => buildLaneReport(k, config, opts.cwd));
    const payload = {
      ok: true,
      action: 'probe',
      configPath: config.path,
      configFound: config.found,
      warnings: config.warnings,
      generatedAt: new Date().toISOString(),
      lanes,
    };

    if (!opts.json) {
      process.stdout.write(`Dispatch lanes — policy: ${config.path}${config.found ? '' : ' (NOT FOUND)'}\n\n`);
      process.stdout.write(`${renderTable(lanes)}\n\n`);
      process.stdout.write('* mode not taken verbatim from the config; see notes below.\n\n');
      for (const l of lanes) {
        const notes = [];
        if (l.modeSource !== 'config') notes.push(`mode: ${l.modeReason}`);
        if (l.available !== true) notes.push(`${l.available === false ? 'unavailable' : 'UNKNOWN'}: ${l.reason || 'no reason recorded'}`);
        if (l.modelNote !== null) notes.push(`model: ${l.modelNote}`);
        if (l.fastSlug.isFast) notes.push(l.fastSlug.warning);
        if (l.risk !== null) notes.push(`risk: ${l.risk}`);
        if (notes.length > 0) {
          process.stdout.write(`[${l.lane}]\n`);
          for (const n of notes) process.stdout.write(`  ${n.split('\n').join('\n  ')}\n`);
          process.stdout.write('\n');
        }
      }
      for (const w of config.warnings) process.stdout.write(`WARNING: ${w}\n`);
      process.stdout.write('\nThis command never dispatches. Add --prompt-file <path> to build a dispatch.\n');
    }
    emit(payload, opts, EXIT.OK);
  }

  // ---- dispatch path ----------------------------------------------------
  if (opts.lane === null) {
    const message = '--prompt-file requires --lane <key>. Refusing to guess which lane to spend.';
    if (!opts.json) process.stderr.write(`${message}\n`);
    emit({ ok: false, errors: [message] }, opts, EXIT.USAGE_ERROR);
  }

  const prompt = readPromptFile(opts.promptFile);
  if (prompt.text === null) {
    if (!opts.json) process.stderr.write(`${prompt.error}\n`);
    emit({ ok: false, errors: [prompt.error] }, opts, EXIT.USAGE_ERROR);
  }

  // GATE 0 — reject is checked before anything else, so a rejected lane is not
  // probed, not resolved and not touched. "Never dispatch" means never contacted.
  const earlyMode = resolveMode(opts.lane, config);
  if (earlyMode.mode === 'reject') {
    const reason = `Lane "${opts.lane}" is set to "reject" in ${config.path}. This config forbids dispatching it. The lane was not probed or contacted. Change the mode in that file if you want it enabled — no flag overrides a reject.`;
    if (!opts.json) process.stderr.write(`REFUSED: ${reason}\n`);
    emit(
      {
        ok: false,
        action: 'refused',
        lane: opts.lane,
        mode: 'reject',
        modeSource: earlyMode.source,
        reason,
        configPath: config.path,
        configFound: config.found,
        promptFile: prompt.resolvedPath,
        promptChars: prompt.text.length,
        probed: false,
      },
      opts,
      EXIT.REFUSED_BY_CONFIG
    );
  }

  const report = buildLaneReport(opts.lane, config, opts.cwd);
  const lane = LANES[opts.lane];

  const payload = {
    ok: false,
    action: null,
    lane: report.lane,
    mode: report.mode,
    modeSource: report.modeSource,
    modeReason: report.modeReason,
    model: report.model,
    modelSource: report.modelSource,
    available: report.available,
    state: report.state,
    reason: report.reason,
    costClass: report.costClass,
    costNote: report.costNote,
    risk: report.risk,
    fastSlug: report.fastSlug,
    promptFile: prompt.resolvedPath,
    promptChars: prompt.text.length,
    configPath: config.path,
    configFound: config.found,
    warnings: config.warnings.slice(),
    command: null,
    commandDisplay: null,
    generatedAt: new Date().toISOString(),
  };

  const say = (s) => { if (!opts.json) process.stdout.write(`${s}\n`); };
  const complain = (s) => { if (!opts.json) process.stderr.write(`${s}\n`); };

  // The fast-slug warning fires before any gate, so it is visible whatever
  // happens next. It warns; it never blocks.
  if (report.fastSlug.isFast) {
    payload.warnings.push(report.fastSlug.warning);
    complain(`\n${report.fastSlug.warning}\n`);
  }

  // GATE 1 — availability. Only a proven-ready lane may be dispatched.
  // available === null means the probe could not decide; unknown is not usable.
  if (report.available !== true) {
    payload.action = 'unavailable';
    payload.reason = `Lane "${opts.lane}" is ${report.available === false ? 'unavailable' : 'of UNKNOWN availability'} (state: ${report.state}). ${report.reason || 'No reason was recorded.'} Not dispatching.`;
    complain(`UNAVAILABLE: ${payload.reason}`);
    emit(payload, opts, EXIT.LANE_UNAVAILABLE);
  }

  // Build the command. The prompt is one argv element; no shell is involved.
  const args = lane.buildArgs({ model: report.model, prompt: prompt.text });
  payload.command = {
    file: report.transport.command,
    args: report.transport.prefixArgs.concat(args),
    promptArgIndex: report.transport.prefixArgs.length + args.indexOf(prompt.text),
    transport: report.transport.kind,
    shell: false,
    stdin: 'closed (portable equivalent of < /dev/null)',
    cwd: opts.cwd,
  };
  payload.commandDisplay = renderCommand(report.transport, args, prompt.text, prompt.resolvedPath);

  // GATE 2 — dry run. Never executes, whatever the mode says.
  if (opts.dryRun) {
    payload.ok = true;
    payload.action = 'dry-run';
    payload.wouldExecute = report.mode === 'auto' || opts.approve;
    say(`DRY RUN — nothing was executed.`);
    say(`  lane      ${opts.lane} (${report.label})`);
    say(`  mode      ${report.mode}  [${report.modeSource}]`);
    say(`  cost      ${report.costClass} — ${report.costNote}`);
    if (report.risk !== null) say(`  RISK      ${report.risk}`);
    say(`  command   ${payload.commandDisplay}`);
    say(`  argv      ${JSON.stringify(payload.command.args.map((a) => (a === prompt.text ? `<prompt: ${prompt.text.length} chars>` : a)))}`);
    say(`  would run without --dry-run: ${payload.wouldExecute ? 'YES' : `NO — mode is "${report.mode}" and --approve was not given`}`);
    emit(payload, opts, EXIT.OK);
  }

  // GATE 3 — ask. Requires the user's explicit per-request approval in chat.
  if (report.mode === 'ask' && !opts.approve) {
    payload.action = 'approval-required';
    payload.reason = `Lane "${opts.lane}" is "ask": ${report.modeReason} Explicit per-request approval is required before this runs.`;
    complain(`APPROVAL REQUIRED — nothing was executed.`);
    complain(`  ${payload.reason}`);
    complain(`  cost: ${report.costClass} — ${report.costNote}`);
    if (report.risk !== null) complain(`  RISK: ${report.risk}`);
    complain(`  command that would run:`);
    complain(`    ${payload.commandDisplay}`);
    complain(`  After the user says yes, re-run the same command with --approve.`);
    emit(payload, opts, EXIT.APPROVAL_REQUIRED);
  }

  // Execute.
  payload.approvalUsed = opts.approve && report.mode === 'ask';
  say(`Dispatching to ${opts.lane} (${report.label}) — mode ${report.mode}${payload.approvalUsed ? ', approved for this request' : ''}...`);
  const started = Date.now();
  const result = await dispatch(report.transport, args, opts.cwd, opts.timeoutMs);
  const elapsedMs = Date.now() - started;

  payload.action = 'dispatched';
  payload.elapsedMs = elapsedMs;
  payload.exitStatus = result.status;
  payload.timedOut = result.timedOut;
  payload.stdout = result.stdout;
  payload.stderr = result.stderr;

  if (!result.spawned) {
    payload.ok = false;
    payload.reason = `Lane "${opts.lane}" failed to start: ${result.error}`;
    complain(`DISPATCH FAILED: ${payload.reason}`);
    emit(payload, opts, EXIT.DISPATCH_FAILED);
  }

  const usage = extractUsage(opts.lane, result.stdout);
  payload.usage = usage.usage;
  payload.usageReason = usage.reason;
  payload.usageDocumentsParsed = usage.documentsParsed;

  payload.ok = result.status === 0 && !result.timedOut;

  if (!opts.json) {
    say(`\n--- ${opts.lane} stdout ---`);
    process.stdout.write(result.stdout.endsWith('\n') || result.stdout === '' ? result.stdout : `${result.stdout}\n`);
    if (result.stderr.trim() !== '') {
      say(`--- ${opts.lane} stderr ---`);
      process.stdout.write(result.stderr.endsWith('\n') ? result.stderr : `${result.stderr}\n`);
    }
    say(`--- ${opts.lane} result ---`);
    say(`  exit ${result.status}${result.timedOut ? ' (TIMED OUT)' : ''} in ${elapsedMs} ms`);
    if (payload.usage === null) {
      say(`  tokens: unknown — ${payload.usageReason}`);
    } else {
      const u = payload.usage;
      const fmt = (v) => (v === null ? 'unknown' : String(v));
      say(`  tokens: in ${fmt(u.inputTokens)} / out ${fmt(u.outputTokens)} / total ${fmt(u.totalTokens)}${u.totalDerived ? ' (derived from in+out)' : ''}`);
      if (u.cacheReadTokens !== null || u.cacheWriteTokens !== null) {
        say(`  cache:  read ${fmt(u.cacheReadTokens)} / write ${fmt(u.cacheWriteTokens)}`);
      }
      if (u.costUsd !== null) say(`  cost:   ${u.costUsd}`);
      say(`  usage read from: ${u.fieldsFound.join(', ')}`);
    }
  }

  emit(payload, opts, payload.ok ? EXIT.OK : EXIT.DISPATCH_FAILED);
}

main().catch((err) => {
  process.stderr.write(`check_lanes.js crashed: ${err && err.stack ? err.stack : err}\n`);
  process.exit(EXIT.USAGE_ERROR);
});
