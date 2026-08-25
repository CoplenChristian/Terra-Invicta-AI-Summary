#!/usr/bin/env node
'use strict';

/*
 * check_lanes.js — probe and dispatch the external agent CLI lanes.
 *
 * Policy lives in dispatch-config.json beside this script, which the user owns
 * and this script never writes. It sits with the skill so it can be found. This file
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
const { collectOutput } = require('./collect_output.js');

const SKILL_DIR = __dirname;
// Resolved from the script's own location, never from process.cwd(): this is
// invoked from wherever a dispatch happens to be running, and a policy file that
// resolved differently per working directory would be a silent policy change.
const DEFAULT_CONFIG_PATH = path.resolve(SKILL_DIR, 'dispatch-config.json');

const VALID_MODES = ['auto', 'ask', 'reject'];

// Cursor's workspace-trust flags. A config value outside this table is REJECTED
// and never forwarded: this string becomes an element of an argv array handed to
// a CLI, and a policy file is not a place to accept an arbitrary flag.
//
// The three are NOT interchangeable, which is why the grant text is carried
// beside the flag instead of being inferred at the call site. Read from
// `cursor-agent --help` (payload 2026.08.11-e8db854) on 2026-08-25:
//   --trust      "Trust the current workspace without prompting"
//   -f, --force  "Force allow commands unless explicitly denied"
//   --yolo       "Alias for --force (Run Everything)"
// So --trust settles the directory-trust prompt and nothing else, while --yolo
// and -f additionally auto-approve the commands the agent then runs. That is a
// materially larger grant and the output has to say so out loud.
const TRUST_FLAGS = {
  '--trust': {
    grant: 'trusts this directory only; it does not auto-approve commands',
    autoApprovesEveryCommand: false,
  },
  '--yolo': {
    grant: 'AUTO-APPROVES EVERY COMMAND this agent runs, unless explicitly denied',
    autoApprovesEveryCommand: true,
  },
  '-f': {
    grant: 'AUTO-APPROVES EVERY COMMAND this agent runs, unless explicitly denied (same as --yolo)',
    autoApprovesEveryCommand: true,
  },
};

const VALID_TRUST_FLAGS = Object.keys(TRUST_FLAGS);

const EXIT = {
  OK: 0,
  APPROVAL_REQUIRED: 2,
  REFUSED_BY_CONFIG: 3,
  LANE_UNAVAILABLE: 4,
  USAGE_ERROR: 5,
  DISPATCH_FAILED: 6,
  SESSION_UNRESOLVABLE: 7,
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
    supportsTrustFlag: false, // opencode has no such flag; passing one would be a bad argument
    defaultModel: 'minimax-coding-plan/MiniMax-M3',
    costClass: 'plan-included',
    costNote: 'Unlimited weekly on the MiniMax coding plan; limited rolling 5-hour window.',
    routing: 'Reviewing and verification, not implementation. Slower but more powerful.',
    buildArgs: ({ model, prompt, resume }) => opencodeArgs(model, prompt, resume),
  },
  deepseek: {
    key: 'deepseek',
    label: 'DeepSeek v4 Flash',
    cli: 'opencode',
    binName: 'opencode',
    fallbackPath: 'C:\\Users\\cople\\.opencode\\bin\\opencode.exe',
    supportsModel: true,
    supportsTrustFlag: false, // opencode has no such flag; passing one would be a bad argument
    defaultModel: 'opencode-go/deepseek-v4-flash',
    costClass: 'metered',
    costNote: 'METERED — real money per call, billed to OpenCode Go.',
    routing: 'Backend implementation and review. NO VISION: never send a screenshot or a task needing one.',
    buildArgs: ({ model, prompt, resume }) => opencodeArgs(model, prompt, resume),
  },
  antigravity: {
    key: 'antigravity',
    label: 'Antigravity',
    cli: 'agy',
    binName: 'agy',
    fallbackPath: 'C:\\Users\\cople\\AppData\\Local\\agy\\bin\\agy.exe',
    supportsModel: true,
    supportsTrustFlag: false, // agy has no such flag; passing one would be a bad argument
    defaultModel: null, // uses the CLI's own configured default
    costClass: 'floor-per-call',
    costNote: '~16k input-token floor per call — a one-line question costs about what a long one does.',
    routing: 'Very fast. Frontend work.',
    buildArgs: ({ model, prompt, resume }) => {
      const args = ['-p', prompt, '--output-format', 'json'];
      if (model !== null) args.push('--model', model);
      if (resume.kind === 'last') args.push('--continue');
      else if (resume.kind === 'id') args.push('--conversation', resume.id);
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
    supportsTrustFlag: true,
    defaultModel: 'composer-2.5',
    costClass: 'shared-cursor-allowance',
    costNote: 'Shares one Cursor allowance with the grok lane.',
    routing: 'Long multi-file implementation runs. The only lane rated for long-horizon agentic work.',
    buildArgs: ({ model, prompt, resume, trustFlag }) => cursorArgs(model, prompt, resume, trustFlag),
  },
  grok: {
    key: 'grok',
    label: 'Grok 4.6',
    cli: 'cursor-agent',
    binName: 'cursor-agent',
    fallbackPath: 'C:\\Users\\cople\\AppData\\Local\\cursor-agent\\cursor-agent.cmd',
    supportsModel: true,
    supportsTrustFlag: true,
    defaultModel: 'cursor-grok-4.6-high',
    costClass: 'shared-cursor-allowance',
    costNote:
      'Shares one Cursor allowance with composer. Composer is the only lane rated for long multi-file agentic runs, so Grok spending comes directly out of a lane with no substitute.',
    routing: 'Analysis, research and single-shot code. Its agentic coding regressed against 4.5 — do not give it long autonomous runs.',
    buildArgs: ({ model, prompt, resume, trustFlag }) => cursorArgs(model, prompt, resume, trustFlag),
  },
  codex: {
    key: 'codex',
    label: 'Codex',
    cli: 'codex',
    binName: 'codex',
    fallbackPath: 'F:\\Apps\\codex',
    supportsModel: false,
    supportsTrustFlag: false, // codex has no such flag; its sandbox posture lives in ~/.codex/config.toml
    defaultModel: null, // taken from the user's ~/.codex/config.toml
    costClass: 'plan-included',
    costNote: 'Included in the ChatGPT plan.',
    routing: 'All-rounder — small model, punches above its size.',
    risk: 'HIGHEST RISK LANE. ~/.codex/config.toml sets sandbox_mode = "danger-full-access" and runs report approval: never, so this lane has full filesystem access with no prompts.',
    // stdin is closed rather than redirected from /dev/null: spawn() takes
    // stdio: ['ignore', ...], which is the portable form of `< /dev/null`.
    buildArgs: ({ prompt, resume, outputFile }) => codexArgs(prompt, resume, outputFile),
    // codex writes its final message to a file, which beats parsing stdout.
    wantsOutputFile: true,
  },
};

// --- per-lane argv builders -------------------------------------------------
//
// Resume is NOT a flag that can be appended uniformly. Three providers append a
// flag; codex restructures argv into a `resume` SUBCOMMAND with the session id
// as a POSITIONAL that precedes the prompt. Building argv per lane is what keeps
// the codex form well-formed.
//
// The same per-lane shape is why a trust flag cannot leak: only cursorArgs even
// accepts one. opencodeArgs and codexArgs have no parameter for it, so a
// misconfigured `trustFlag` on those lanes has nowhere to go structurally, on
// top of being rejected earlier by resolveTrustFlag.
//
// Verified 2026-08-24/25 against the installed CLIs.

function opencodeArgs(model, prompt, resume) {
  //   fresh : run -m <model> --format json <prompt>
  //   last  : run -m <model> --format json -c <prompt>
  //   id    : run -m <model> --format json -s <id> <prompt>
  const args = ['run', '-m', model, '--format', 'json'];
  if (resume.kind === 'last') args.push('--continue');
  else if (resume.kind === 'id') args.push('--session', resume.id);
  args.push(prompt);
  return args;
}

function cursorArgs(model, prompt, resume, trustFlag) {
  //   fresh : -p --output-format json --model <m> [trust] <prompt>
  //   last  : -p --output-format json --model <m> [trust] --continue <prompt>
  //   id    : -p --output-format json --model <m> [trust] --resume <id> <prompt>
  // `--resume [chatId]` takes an OPTIONAL value, so the id is always passed
  // explicitly — a bare `--resume` would swallow the prompt as its chatId.
  //
  // The trust flag is the ONLY value in this argv that came from the config
  // without being a model slug, so it is admitted only after resolveTrustFlag
  // matched it against TRUST_FLAGS. `null` here means no flag at all — the
  // absent case must not become an empty-string argv element.
  const args = ['-p', '--output-format', 'json', '--model', model];
  if (typeof trustFlag === 'string' && trustFlag !== '') args.push(trustFlag);
  if (resume.kind === 'last') args.push('--continue');
  else if (resume.kind === 'id') args.push('--resume', resume.id);
  args.push(prompt);
  return args;
}

function codexArgs(prompt, resume, outputFile) {
  //   fresh : exec --skip-git-repo-check [-o FILE] <prompt>
  //   last  : exec resume --last --skip-git-repo-check [-o FILE] <prompt>
  //   id    : exec resume --skip-git-repo-check [-o FILE] <id> <prompt>
  //
  // `codex exec resume [OPTIONS] [SESSION_ID] [PROMPT]` — the id is a positional
  // that comes BEFORE the prompt, so appending a flag would malform the command.
  // With `--last` and no id, the single positional binds to PROMPT: verified by
  // running `exec resume --last` with no positional, which answered "Reading
  // prompt from stdin..." rather than treating it as a missing session id.
  const args = ['exec'];
  if (resume.kind !== 'none') args.push('resume');
  if (resume.kind === 'last') args.push('--last');
  args.push('--skip-git-repo-check');
  if (outputFile !== null) args.push('--output-last-message', outputFile);
  if (resume.kind === 'id') args.push(resume.id);
  args.push(prompt);
  return args;
}

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
    resumeLast: false,
    resumeId: null,
    help: false,
    errors: [],
  };

  const needsValue = new Set(['--lane', '--prompt-file', '--config', '--cwd', '--timeout', '--resume']);

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
      else if (arg === '--resume') {
        if (value.trim() === '') out.errors.push('--resume requires a session id');
        else out.resumeId = value.trim();
      } else if (arg === '--timeout') {
        const ms = toFiniteNumber(value);
        if (ms === null || ms <= 0) out.errors.push(`--timeout must be a positive number of milliseconds, got "${value}"`);
        else out.timeoutMs = ms;
      }
      continue;
    }
    if (arg === '--json') out.json = true;
    else if (arg === '--dry-run') out.dryRun = true;
    else if (arg === '--approve') out.approve = true;
    else if (arg === '--resume-last') out.resumeLast = true;
    else if (arg === '--help' || arg === '-h') out.help = true;
    else out.errors.push(`unrecognised argument "${arg}"`);
  }

  // Mutually exclusive: "the most recent" and "this specific one" are different
  // instructions, and silently preferring one would resume a session the user
  // did not name.
  if (out.resumeLast && out.resumeId !== null) {
    out.errors.push(
      `--resume-last and --resume <id> are mutually exclusive. --resume-last continues that lane's most recent session; --resume names a specific one. Pass exactly one.`
    );
  }

  return out;
}

/** The resume instruction, as a value rather than two loose booleans. */
function resumeIntent(opts) {
  if (opts.resumeLast) return { kind: 'last', id: null, label: 'most recent session' };
  if (opts.resumeId !== null) return { kind: 'id', id: opts.resumeId, label: `session ${opts.resumeId}` };
  return { kind: 'none', id: null, label: 'new session' };
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

  Resume (works on every lane; resuming IS dispatching, so the same mode gating
  applies and a reject lane still refuses)
    --resume-last       continue that lane's most recent session
    --resume <id>       continue a specific session
      Mutually exclusive. An id that a provider's session store proves absent is
      a hard failure (exit ${EXIT.SESSION_UNRESOLVABLE}) — never a silent fresh start. Where a provider
      offers no way to check, the output says the session was NOT verified.

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
    ${EXIT.SESSION_UNRESOLVABLE}  session named for resume does not exist
`;

// ---------------------------------------------------------------------------
// Config
// ---------------------------------------------------------------------------

/**
 * Loads the policy file. Never invents policy:
 *   - file missing        -> hard error naming the expected path. There is no
 *                            implicit all-ask policy: an "ask" lane still
 *                            dispatches under --approve, so a missing file plus
 *                            --approve would otherwise run a lane the user never
 *                            configured.
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
    result.fatal =
      `No policy file at ${configPath}. ` +
      `Refusing to run under a policy the user never wrote — there are no built-in lane defaults to fall back to. ` +
      `Restore the file (it belongs beside check_lanes.js), or pass --config <path> to point at it. ` +
      `Every lane ships as "ask"; see .claude/skills/dispatch/SKILL.md.`;
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
    if (entry.trustFlag !== undefined && entry.trustFlag !== null && !LANES[key].supportsTrustFlag) {
      result.warnings.push(
        `Config sets trustFlag ${JSON.stringify(entry.trustFlag)} for lane "${key}", but only the Cursor lanes ` +
          `(${LANE_KEYS.filter((k) => LANES[k].supportsTrustFlag).join(', ')}) have such a flag. ` +
          `The ${LANES[key].cli} CLI would reject it as an unknown argument, so it is IGNORED and never reaches the command line.`
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

/**
 * Resolves the optional per-lane `trustFlag` and says exactly what it grants.
 *
 * This field exists because cursor-agent refuses to start in an untrusted
 * directory ("Workspace Trust Required"), and the fix is a flag that grants the
 * agent standing permission. That is precisely the kind of grant that must live
 * in the policy file the user owns rather than being hardcoded here, so it can
 * be revoked with an edit and no code change.
 *
 * Four outcomes, and the difference between the middle two is the point:
 *   - lane has no such flag -> null, ignored, with a warning from loadConfig.
 *     Nothing reaches argv, so a bad value here is harmless rather than fatal.
 *   - not configured        -> null. Absent stays absent; there is no default
 *                              grant and no implicit trust.
 *   - a value in TRUST_FLAGS -> that flag, plus the plain-words grant text.
 *   - anything else         -> a hard ERROR. An unrecognised string is never
 *                              forwarded: it is about to become an element of an
 *                              argv array passed to a CLI, and "pass it through
 *                              and let the CLI complain" is how a typo in a
 *                              policy file turns into an unintended argument.
 */
function resolveTrustFlag(laneKey, config) {
  const lane = LANES[laneKey];
  const entry = Object.prototype.hasOwnProperty.call(config.lanes, laneKey) ? config.lanes[laneKey] : null;
  const configured = entry === null ? undefined : entry.trustFlag;

  const none = {
    flag: null,
    configured: configured === undefined ? null : configured,
    grant: null,
    autoApprovesEveryCommand: false,
    source: 'not-configured',
    note: null,
    error: null,
  };

  if (configured === undefined || configured === null) return none;

  if (!lane.supportsTrustFlag) {
    // Ignored, not fatal: it never reaches the command line. loadConfig has
    // already warned about it by name.
    return Object.assign({}, none, {
      source: 'lane-takes-no-trust-flag',
      note:
        `Lane "${laneKey}" runs the ${lane.cli} CLI, which has no workspace-trust flag. ` +
        `The configured value ${JSON.stringify(configured)} is ignored and is NOT passed to the command line.`,
    });
  }

  if (typeof configured !== 'string' || !Object.prototype.hasOwnProperty.call(TRUST_FLAGS, configured)) {
    return Object.assign({}, none, {
      source: 'invalid-trust-flag-value',
      error:
        `Lane "${laneKey}" has trustFlag ${JSON.stringify(configured)}, which is not one of ` +
        `${VALID_TRUST_FLAGS.join(', ')}. Refusing to dispatch: this value would become an argument to ` +
        `${lane.cli}, and an unrecognised flag from a policy file is never passed through. ` +
        `Fix the value in ${config.path}, or remove the key to dispatch with no trust flag.`,
    });
  }

  const spec = TRUST_FLAGS[configured];
  return {
    flag: configured,
    configured,
    grant: spec.grant,
    autoApprovesEveryCommand: spec.autoApprovesEveryCommand,
    source: 'config',
    note: null,
    error: null,
  };
}

/** One short line naming the grant, for the previews the user approves from. */
function describeTrustFlag(trust) {
  if (trust.flag === null) return null;
  return `${trust.flag} — ${trust.grant}`;
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
// Session resolution
//
// Three-valued, like availability, and for the same reason:
//   verified === true   a session store confirmed this session exists
//   verified === false  a session store proved it does NOT  -> hard failure
//   verified === null   this provider exposes no way to check -> say so, proceed
//
// Why false is a hard failure rather than a warning: measured 2026-08-25,
// `codex exec resume --last` against a CODEX_HOME with no recorded sessions did
// NOT error. It went straight to a model call — i.e. it silently started a fresh
// conversation when asked to resume. That is this repo's most-repeated defect
// class (an absent value treated as a benign default) living inside a vendor
// CLI, so the check has to happen here, before dispatch.
// ---------------------------------------------------------------------------

const CODEX_CWD_SCAN_WINDOW = 50;

function codexSessionsRoot() {
  if (typeof process.env.CODEX_HOME === 'string' && process.env.CODEX_HOME.trim() !== '') {
    return path.join(process.env.CODEX_HOME.trim(), 'sessions');
  }
  const home = process.env.USERPROFILE || os.homedir();
  if (typeof home !== 'string' || home.trim() === '') return null;
  return path.join(home, '.codex', 'sessions');
}

/** Rollout files newest-first: ~/.codex/sessions/YYYY/MM/DD/rollout-<ts>-<uuid>.jsonl */
function listCodexRollouts() {
  const root = codexSessionsRoot();
  if (root === null) return { root: null, files: [], error: 'No home directory could be resolved.' };
  if (!dirExists(root)) return { root, files: [], error: null };
  let entries;
  try {
    entries = fs.readdirSync(root, { recursive: true });
  } catch (err) {
    return { root, files: [], error: `${root} could not be read: ${err.message}` };
  }
  const files = [];
  for (const rel of entries) {
    const name = path.basename(String(rel));
    if (!/^rollout-.*\.jsonl$/.test(name)) continue;
    const full = path.join(root, String(rel));
    let mtime = null;
    try {
      mtime = fs.statSync(full).mtimeMs;
    } catch (_) {
      continue;
    }
    const m = /([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})/i.exec(name);
    files.push({ path: full, mtime, id: m === null ? null : m[1].toLowerCase() });
  }
  files.sort((a, b) => b.mtime - a.mtime);
  return { root, files, error: null };
}

/** Reads only the session_meta line to recover the recorded cwd. */
function codexRolloutCwd(file) {
  let fd = null;
  try {
    fd = fs.openSync(file, 'r');
    const buf = Buffer.alloc(65536);
    const read = fs.readSync(fd, buf, 0, buf.length, 0);
    const firstLine = buf.slice(0, read).toString('utf8').split('\n')[0];
    const parsed = JSON.parse(firstLine);
    const cwd = parsed && parsed.payload ? parsed.payload.cwd : null;
    return typeof cwd === 'string' ? cwd : null;
  } catch (_) {
    return null;
  } finally {
    if (fd !== null) {
      try { fs.closeSync(fd); } catch (_) { /* ignore */ }
    }
  }
}

function verifyCodexSession(resume, cwd) {
  const { root, files, error } = listCodexRollouts();
  if (error !== null) {
    return { verified: null, reason: `The codex session store could not be read (${error}), so ${resume.label} was NOT verified.` };
  }

  if (resume.kind === 'id') {
    const wanted = resume.id.toLowerCase();
    const hit = files.find((f) => f.id === wanted);
    if (hit !== undefined) {
      return { verified: true, reason: null, detail: `Matched rollout ${path.basename(hit.path)}` };
    }
    return {
      verified: false,
      reason: `No codex session "${resume.id}" exists in ${root} (${files.length} recorded session(s) scanned). Not dispatching — a resume that cannot find its session must not fall back to a fresh conversation.`,
    };
  }

  // resume.kind === 'last'
  if (files.length === 0) {
    return {
      verified: false,
      reason: `There are no recorded codex sessions in ${root === null ? '(no session store)' : root}, so there is nothing to resume. Measured 2026-08-25: \`codex exec resume --last\` does NOT error in this situation — it silently starts a fresh conversation. Refusing to dispatch.`,
    };
  }

  const window = files.slice(0, CODEX_CWD_SCAN_WINDOW);
  const match = window.find((f) => {
    const recorded = codexRolloutCwd(f.path);
    return recorded !== null && path.resolve(recorded).toLowerCase() === path.resolve(cwd).toLowerCase();
  });
  if (match !== undefined) {
    return { verified: true, reason: null, detail: `Newest session for this directory: ${path.basename(match.path)}` };
  }
  return {
    verified: null,
    reason: `${files.length} codex session(s) exist, but none of the newest ${window.length} recorded a cwd matching ${cwd}. codex's \`--last\` filters by cwd by default, so it may find nothing here and start fresh instead. The session to be resumed was NOT verified.`,
  };
}

function verifyOpencodeSession(resume, transport, cwd) {
  const res = runProbe(transport.command, transport.prefixArgs.concat(['session', 'list']), cwd);
  if (!res.ok || res.timedOut || res.status !== 0) {
    return {
      verified: null,
      reason: `\`opencode session list\` did not complete (${res.errorMessage || `exit ${res.status}`}), so ${resume.label} was NOT verified.`,
    };
  }
  const ids = [];
  for (const line of stripAnsi(res.stdout).split(/\r?\n/)) {
    const m = /^(ses_[A-Za-z0-9]+)\s/.exec(line.trim());
    if (m !== null) ids.push(m[1]);
  }
  if (ids.length === 0) {
    if (resume.kind === 'last') {
      return {
        verified: false,
        reason: '`opencode session list` reported no sessions, so there is nothing for --continue to resume. Refusing to dispatch rather than starting a fresh conversation.',
      };
    }
    return {
      verified: null,
      reason: `\`opencode session list\` returned no parseable session ids, so ${resume.label} was NOT verified.`,
    };
  }
  if (resume.kind === 'last') {
    return { verified: true, reason: null, detail: `Most recent of ${ids.length} session(s): ${ids[0]}` };
  }
  if (ids.includes(resume.id)) {
    return { verified: true, reason: null, detail: `Matched in \`opencode session list\` (${ids.length} session(s))` };
  }
  return {
    verified: false,
    reason: `Session "${resume.id}" is not in \`opencode session list\` (${ids.length} session(s) found). Not dispatching — a resume that cannot find its session must not fall back to a fresh conversation.`,
  };
}

/**
 * Resolves what a resume would actually continue, before anything is dispatched.
 */
function verifySession(laneKey, resume, transport, cwd) {
  if (resume.kind === 'none') return { verified: true, reason: null, detail: 'New session; nothing to resolve.' };

  const cli = LANES[laneKey].cli;

  if (cli === 'opencode') return verifyOpencodeSession(resume, transport, cwd);
  if (cli === 'codex') return verifyCodexSession(resume, cwd);

  if (cli === 'agy') {
    return {
      verified: null,
      reason: `agy exposes no non-interactive conversation-list command, so ${resume.label} could NOT be verified before dispatch. If the conversation does not exist, agy decides what happens — this script did not confirm it.`,
    };
  }
  if (cli === 'cursor-agent') {
    return {
      verified: null,
      reason: `cursor-agent's \`ls\` is an interactive TUI picker (it fails with "Raw mode is not supported" when stdin is closed), so ${resume.label} could NOT be verified before dispatch. If the chat does not exist, cursor-agent decides what happens — this script did not confirm it.`,
    };
  }
  return { verified: null, reason: `No session check is defined for cli "${cli}".` };
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

/** One line naming what a dispatch would continue, and how sure we are. */
function describeResume(resume) {
  if (resume.kind === 'none') return 'NEW session (no resume requested)';
  const what = resume.kind === 'last' ? 'CONTINUING the most recent session' : `CONTINUING session ${resume.id}`;
  if (resume.verified === true) return `${what} — verified. ${resume.detail || ''}`.trim();
  if (resume.verified === null) return `${what} — NOT VERIFIED (this provider offers no way to check).`;
  return `${what} — UNRESOLVABLE.`;
}

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
  const trustInfo = resolveTrustFlag(laneKey, config);
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
    trustFlag: trustInfo.flag,
    trustFlagConfigured: trustInfo.configured,
    trustFlagSource: trustInfo.source,
    trustFlagGrant: trustInfo.grant,
    trustFlagAutoApprovesEveryCommand: trustInfo.autoApprovesEveryCommand,
    trustFlagNote: trustInfo.note,
    trustFlagError: trustInfo.error,
    trustFlagDisplay: describeTrustFlag(trustInfo),
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
        if (l.trustFlagError !== null) notes.push(`TRUST FLAG INVALID: ${l.trustFlagError}`);
        if (l.trustFlagNote !== null) notes.push(`trust flag: ${l.trustFlagNote}`);
        if (l.trustFlagDisplay !== null) notes.push(`trust flag: ${l.trustFlagDisplay}`);
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

  // GATE 0.5 — the policy file's trust flag must be a value this script
  // recognises. Checked before the lane is probed or contacted, because a
  // malformed policy value is a config error rather than a lane problem, and
  // because it must fail identically under --dry-run: a preview that quietly
  // dropped an unrecognised flag would show the user a command that is not the
  // one a real run would build.
  const earlyTrust = resolveTrustFlag(opts.lane, config);
  if (earlyTrust.error !== null) {
    if (!opts.json) process.stderr.write(`Config error: ${earlyTrust.error}\n`);
    emit(
      {
        ok: false,
        action: 'invalid-trust-flag',
        lane: opts.lane,
        errors: [earlyTrust.error],
        trustFlag: null,
        trustFlagConfigured: earlyTrust.configured,
        trustFlagSource: earlyTrust.source,
        validTrustFlags: VALID_TRUST_FLAGS,
        configPath: config.path,
        configFound: config.found,
        promptFile: prompt.resolvedPath,
        promptChars: prompt.text.length,
        probed: false,
      },
      opts,
      EXIT.USAGE_ERROR
    );
  }

  const report = buildLaneReport(opts.lane, config, opts.cwd);
  const lane = LANES[opts.lane];
  const resume = resumeIntent(opts);

  const payload = {
    ok: false,
    action: null,
    lane: report.lane,
    mode: report.mode,
    modeSource: report.modeSource,
    modeReason: report.modeReason,
    model: report.model,
    modelSource: report.modelSource,
    trustFlag: report.trustFlag,
    trustFlagSource: report.trustFlagSource,
    trustFlagGrant: report.trustFlagGrant,
    trustFlagAutoApprovesEveryCommand: report.trustFlagAutoApprovesEveryCommand,
    trustFlagDisplay: report.trustFlagDisplay,
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

  // A trustFlag configured on a lane with no such flag grants nothing, but the
  // user should hear that their setting had no effect rather than assume it did.
  if (report.trustFlagNote !== null) {
    payload.warnings.push(report.trustFlagNote);
    complain(`\nTRUST FLAG IGNORED — ${report.trustFlagNote}\n`);
  }

  // GATE 1 — availability. Only a proven-ready lane may be dispatched.
  // available === null means the probe could not decide; unknown is not usable.
  if (report.available !== true) {
    payload.action = 'unavailable';
    payload.reason = `Lane "${opts.lane}" is ${report.available === false ? 'unavailable' : 'of UNKNOWN availability'} (state: ${report.state}). ${report.reason || 'No reason was recorded.'} Not dispatching.`;
    complain(`UNAVAILABLE: ${payload.reason}`);
    emit(payload, opts, EXIT.LANE_UNAVAILABLE);
  }

  // GATE 1.5 — session resolution. Runs before dry-run and before the ask gate,
  // because an unresolvable session is an error at every mode: there is no point
  // asking the user to approve a resume that cannot find its session, and a
  // dry-run should surface the problem too.
  const sessionCheck = verifySession(opts.lane, resume, report.transport, opts.cwd);
  payload.resume = {
    kind: resume.kind,
    id: resume.id,
    label: resume.label,
    verified: sessionCheck.verified,
    verifiedReason: sessionCheck.reason === undefined ? null : sessionCheck.reason,
    detail: sessionCheck.detail === undefined ? null : sessionCheck.detail,
  };

  if (sessionCheck.verified === false) {
    payload.action = 'session-unresolvable';
    payload.reason = sessionCheck.reason;
    complain(`SESSION UNRESOLVABLE — nothing was executed.`);
    complain(`  ${sessionCheck.reason}`);
    complain(`  Resuming was requested (${resume.label}); starting a fresh conversation instead would be a silent substitution, so this is a failure, not a fallback.`);
    emit(payload, opts, EXIT.SESSION_UNRESOLVABLE);
  }

  if (resume.kind !== 'none' && sessionCheck.verified === null) {
    payload.warnings.push(`Session NOT verified: ${sessionCheck.reason}`);
    complain(`\nSESSION NOT VERIFIED — ${sessionCheck.reason}\n`);
  }

  // codex writes its final message to a file, which is far more reliable than
  // scraping stdout. Only lanes that support it get one.
  const outputFile = lane.wantsOutputFile === true
    ? path.join(os.tmpdir(), `dispatch-${opts.lane}-${Date.now()}-${process.pid}.txt`)
    : null;
  payload.outputFile = outputFile;

  // Build the command. The prompt is one argv element; no shell is involved.
  const args = lane.buildArgs({
    model: report.model,
    prompt: prompt.text,
    resume,
    outputFile,
    trustFlag: report.trustFlag,
  });
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
    say(`  session   ${describeResume(payload.resume)}`);
    say(`  cost      ${report.costClass} — ${report.costNote}`);
    if (report.risk !== null) say(`  RISK      ${report.risk}`);
    if (report.trustFlagDisplay !== null) say(`  TRUST     ${report.trustFlagDisplay}`);
    say(`  command   ${payload.commandDisplay}`);
    say(`  argv      ${JSON.stringify(payload.command.args.map((a) => (a === prompt.text ? `<prompt: ${prompt.text.length} chars>` : a)))}`);
    say(`  would run without --dry-run: ${payload.wouldExecute ? 'YES' : `NO — mode is "${report.mode}" and --approve was not given`}`);
    emit(payload, opts, EXIT.OK);
  }

  // GATE 3 — ask. Requires the user's explicit per-request approval in chat.
  if (report.mode === 'ask' && !opts.approve) {
    payload.action = 'approval-required';
    payload.reason = `Lane "${opts.lane}" is "ask": ${report.modeReason} Explicit per-request approval is required before this runs.`;
    // The trust grant goes into the reason itself, not only the rendered argv.
    // Approving is approving the grant too, and a privilege escalation the
    // approval card does not name is worse than no card at all.
    if (report.trustFlagDisplay !== null) {
      payload.reason += ` This dispatch also passes ${report.trustFlagDisplay}.`;
    }
    complain(`APPROVAL REQUIRED — nothing was executed.`);
    complain(`  ${payload.reason}`);
    complain(`  session: ${describeResume(payload.resume)}`);
    complain(`  cost: ${report.costClass} — ${report.costNote}`);
    if (report.risk !== null) complain(`  RISK: ${report.risk}`);
    if (report.trustFlagDisplay !== null) complain(`  TRUST: ${report.trustFlagDisplay}`);
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

  // codex's --output-last-message file: a far more reliable final answer than
  // scraping stdout. Collected and cleaned up through the SAME implementation
  // the standalone collect_output.js exposes, so the read/delete rules — and the
  // refusal to delete anything outside a temp root — are not written twice.
  // Absent stays null: an unwritten file is not an empty reply.
  if (outputFile !== null) {
    const collected = collectOutput(outputFile, {});
    payload.lastMessage = collected.content;
    payload.lastMessageFile = collected.path;
    payload.lastMessageDeleted = collected.deleted;
    payload.lastMessageReason = collected.existed === false
      ? `${opts.lane} did not write ${outputFile}, so the final message is UNKNOWN (not empty). ${collected.reason}`
      : collected.reason;
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
