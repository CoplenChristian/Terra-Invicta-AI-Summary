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
 *   - Prompts arrive as FILES. Most lanes get the file's TEXT as one element of
 *     an argv array; the omp lane gets the FILE ITSELF, attached as `@<path>`.
 *     No shell is used anywhere in the dispatch path either way, so quotes,
 *     backticks, newlines and shell metacharacters in a prompt cannot be
 *     reinterpreted by cmd.exe or by a POSIX shell.
 *
 * Invocations verified 2026-08-24, and the omp lane 2026-08-25 against
 * omp/18.0.5. Do not re-derive them from CLI help text.
 */

const fs = require('fs');
const os = require('os');
const path = require('path');
const { randomUUID } = require('crypto');
const { spawnSync, spawn } = require('child_process');
const { collectOutput } = require('./collect_output.js');

const SKILL_DIR = __dirname;
// Resolved from the script's own location, never from process.cwd(): this is
// invoked from wherever a dispatch happens to be running, and a policy file that
// resolved differently per working directory would be a silent policy change.
const DEFAULT_CONFIG_PATH = path.resolve(SKILL_DIR, 'dispatch-config.json');
// The runtime config is deliberately resolved from the checkout containing this
// wrapper, not from the prospective worktree. config.json is local-only and is
// absent from a fresh worktree; only its save-path value is handed to the lane.
const MAIN_CHECKOUT_ROOT = path.resolve(SKILL_DIR, '..', '..', '..');
const MAIN_RUNTIME_CONFIG_PATH = path.join(MAIN_CHECKOUT_ROOT, 'config.json');

const VALID_MODES = ['auto', 'ask', 'reject'];

// Standing-permission flags, PER CLI. A config value outside the table for the
// lane it was set on is REJECTED and never forwarded: this string becomes an
// element of an argv array handed to a CLI, and a policy file is not a place to
// accept an arbitrary flag.
//
// The accepted literals are a property of the CLI, not of the mechanism. There
// is no global set: `--yolo` is meaningless to agy and
// `--dangerously-skip-permissions` is meaningless to cursor-agent, so a literal
// valid on one lane is rejected on another rather than being handed to a CLI
// that would treat it as an unknown argument. Validation is therefore always
// against the accepted set of the lane being dispatched.
//
// Within a CLI the values are NOT interchangeable either, which is why the grant
// text is carried beside each flag instead of being inferred at the call site.
//
// cursor-agent — read from `cursor-agent --help` (payload 2026.08.11-e8db854) on
// 2026-08-25:
//   --trust      "Trust the current workspace without prompting"
//   -f, --force  "Force allow commands unless explicitly denied"
//   --yolo       "Alias for --force (Run Everything)"
// So --trust settles the directory-trust prompt and nothing else, while --yolo
// and -f additionally auto-approve the commands the agent then runs. That is a
// materially larger grant and the output has to say so out loud.
//
// agy — read from `agy --help` (agy 1.1.20) on 2026-08-25:
//   --dangerously-skip-permissions  "Auto-approve all tool permission requests
//                                    without prompting"
// agy offers NO smaller grant: there is no directory-trust-only flag to fall back
// to, so unlike cursor-agent there is no `--trust` equivalent to recommend. The
// nearest neighbours in that help text are not substitutes — `--sandbox` ("Run in
// a sandbox with terminal restrictions enabled") restricts rather than grants,
// and `--mode accept-edits` covers edits only, not the tool permission requests
// that fail a headless run. Verified 2026-08-25 that agy accepts the flag
// (`agy --dangerously-skip-permissions models` exits 0).
//
// `autoApprovesEveryCommand` is the "this is the big grant" boolean, and it is
// true for anything that auto-approves the agent's own actions — commands on
// cursor-agent, every tool call on agy. The human-readable `grant` string carries
// the CLI-accurate wording; this flag only decides how loud to be.
const TRUST_FLAGS = {
  'cursor-agent': {
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
  },
  agy: {
    '--dangerously-skip-permissions': {
      grant: 'AUTO-APPROVES EVERY TOOL this agent runs, without prompting — not just directory trust',
      autoApprovesEveryCommand: true,
    },
  },
};

/** The trust-flag table a lane accepts, or null if its CLI has no such flag. */
function laneTrustFlags(lane) {
  return lane.trustFlags === undefined || lane.trustFlags === null ? null : lane.trustFlags;
}

function supportsTrustFlag(lane) {
  return laneTrustFlags(lane) !== null;
}

/** The literals THIS lane accepts. Empty for a lane whose CLI has no such flag. */
function acceptedTrustFlags(lane) {
  const table = laneTrustFlags(lane);
  return table === null ? [] : Object.keys(table);
}

/**
 * Every lane that accepts a literal, and what it accepts — for error text, so a
 * rejection can point at where the value the user typed would actually be valid
 * instead of only saying "not here".
 */
function trustFlagLaneSummary() {
  return LANE_KEYS
    .filter((k) => supportsTrustFlag(LANES[k]))
    .map((k) => `${k} (${LANES[k].cli}: ${acceptedTrustFlags(LANES[k]).join(', ')})`);
}

/** The CLIs, other than this lane's, that would accept this literal. */
function trustFlagAcceptedElsewhere(value, laneKey) {
  if (typeof value !== 'string') return [];
  return Object.keys(TRUST_FLAGS).filter(
    (cli) =>
      cli !== LANES[laneKey].cli && Object.prototype.hasOwnProperty.call(TRUST_FLAGS[cli], value)
  );
}

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
const WORKTREE_ROOT_RELATIVE = path.join('.claude', 'worktrees');
const WORKTREE_GIT_TIMEOUT_MS = 90000;
const WORKTREE_PREPARATION_TIMEOUT_MS = 900000; // 15 minutes
const WORKTREE_DEPENDENCIES_RELATIVE = 'node_modules';
const WORKTREE_BUNDLE_RELATIVE = path.join('public', 'v2', 'app', 'bundle.js');

// ---------------------------------------------------------------------------
// Lane registry — how each lane is invoked. Not user-editable on purpose.
// ---------------------------------------------------------------------------

const LANES = {
  minimax: {
    key: 'minimax',
    label: 'MiniMax M3',
    cli: 'omp',
    binName: 'omp',
    // Installed to PATH by its own installer, but a shell started before that
    // install will not see it — hence the same PATH-then-known-location order
    // every other lane uses. Measured 2026-08-25: omp/18.0.5 at this path.
    fallbackPath: 'C:\\Users\\cople\\AppData\\Local\\omp\\omp.exe',
    supportsModel: true,
    trustFlags: null, // omp has --auto-approve/--approval-mode, but no run has needed one and granting a standing permission is the user's call, not this file's
    defaultModel: 'minimax-code/MiniMax-M3',
    // omp's `--model` is a FUZZY match, so a slug it does not recognise can
    // resolve to a DIFFERENT model rather than failing. That would run a model
    // the policy does not name, which is a policy bypass, so this lane requires
    // its configured slug to be an exact entry in the live `omp models` catalogue.
    requiresExactModelInCatalogue: true,
    // The prompt is ATTACHED with `@<path>` rather than inlined as an argv
    // element. Measured 2026-08-25: a missing or unreadable @file makes omp exit
    // 1 with "Error: File not found: <path>" BEFORE it resolves the model, so a
    // prompt can never be silently dropped from a dispatch.
    promptDelivery: 'attached-file',
    costClass: 'plan-included',
    costNote: 'Unlimited weekly on the MiniMax coding plan; limited rolling 5-hour window.',
    routing: 'Reviewing and verification, not implementation. Slower but more powerful.',
    buildArgs: ({ model, promptPath, resume, cwd }) => ompArgs(model, promptPath, resume, cwd),
  },
  deepseek: {
    key: 'deepseek',
    label: 'DeepSeek v4 Flash',
    cli: 'omp',
    binName: 'omp',
    fallbackPath: 'C:\\Users\\cople\\AppData\\Local\\omp\\omp.exe',
    supportsModel: true,
    trustFlags: null, // omp has --auto-approve/--approval-mode, but no run has needed one and granting a standing permission is the user's call, not this file's
    defaultModel: 'opencode-go/deepseek-v4-flash',
    // omp's `--model` is a FUZZY match, so a slug it does not recognise can
    // resolve to a DIFFERENT model rather than failing. That would run a model
    // the policy does not name, which is a policy bypass, so this lane requires
    // its configured slug to be an exact entry in the live `omp models` catalogue.
    requiresExactModelInCatalogue: true,
    // The prompt is ATTACHED with `@<path>` rather than inlined as an argv
    // element. The omp builder also carries the cwd and refuses bare --resume.
    promptDelivery: 'attached-file',
    costClass: 'metered',
    costNote: 'METERED — real money per call, billed to OpenCode Go.',
    routing: 'Backend implementation and review. The configured model has no vision: never send it a screenshot or a task needing one.',
    buildArgs: ({ model, promptPath, resume, cwd }) => ompArgs(model, promptPath, resume, cwd),
  },
  antigravity: {
    key: 'antigravity',
    label: 'Antigravity',
    cli: 'agy',
    binName: 'agy',
    fallbackPath: 'C:\\Users\\cople\\AppData\\Local\\agy\\bin\\agy.exe',
    supportsModel: true,
    trustFlags: TRUST_FLAGS.agy, // --dangerously-skip-permissions only; agy has no smaller grant
    defaultModel: null, // uses the CLI's own configured default
    costClass: 'floor-per-call',
    costNote: '~16k input-token floor per call — a one-line question costs about what a long one does.',
    routing: 'Very fast. Frontend work.',
    buildArgs: ({ model, prompt, resume, trustFlag, timeoutMs }) => agyArgs(model, prompt, resume, trustFlag, timeoutMs),
  },
  composer: {
    key: 'composer',
    label: 'Composer 2.5',
    cli: 'cursor-agent',
    binName: 'cursor-agent',
    fallbackPath: 'C:\\Users\\cople\\AppData\\Local\\cursor-agent\\cursor-agent.cmd',
    supportsModel: true,
    trustFlags: TRUST_FLAGS['cursor-agent'],
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
    trustFlags: TRUST_FLAGS['cursor-agent'],
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
    supportsModel: true,
    trustFlags: null, // codex has no such flag; its sandbox posture lives in ~/.codex/config.toml
    // PINNED TO LUNA — and pinned as a REFUSAL, not as a default.
    //
    // Until 2026-08-26 this lane declared supportsModel: false and built no `-m`
    // flag at all, so every dispatch inherited whatever `~/.codex/config.toml`
    // happened to hold. Measured that day, that file reads
    // `model = "gpt-5.6-sol"` with `model_reasoning_effort = "max"`, so
    // mechanical work was being handed to a large model at maximum effort: one
    // 618-line task ran 1,664 s and consumed the user's entire 5-hour quota.
    // The user's instruction is to only ever use Luna on this lane, so the model
    // is now named explicitly on EVERY dispatch, the `resume` subcommand
    // included, and cannot be silently inherited.
    //
    // `defaultModel` alone would only be a default: it loses to any value in the
    // policy file. `pinnedModel` is what makes a different configured model a
    // hard refusal instead — the same rule, enforced the same way, as trustFlag.
    // The two differ in which direction the failure falls, which is why the pin
    // is the stricter of the two: an unrecognised trust flag would at least fail
    // loudly as a bad argument to the CLI, whereas an unpinned model here would
    // be cheerfully ACCEPTED by codex and quietly spend the quota on the wrong
    // model. Verified 2026-08-26: "gpt-5.6-luna" appears 2,620 times across the
    // user's own ~/.codex/sessions, so it is a slug this install really runs.
    //
    // NOTE `-m` overrides the model ONLY. `model_reasoning_effort = "max"` in
    // that same config still applies, and nothing here changes it.
    defaultModel: 'gpt-5.6-luna',
    pinnedModel: 'gpt-5.6-luna',
    costClass: 'plan-included',
    costNote: 'Included in the ChatGPT plan. Pinned to gpt-5.6-luna; note that ~/.codex/config.toml still sets model_reasoning_effort = "max", which -m does not override.',
    routing: 'All-rounder — small model, punches above its size.',
    risk: 'HIGHEST RISK LANE. ~/.codex/config.toml sets sandbox_mode = "danger-full-access" and runs report approval: never, so this lane has full filesystem access with no prompts.',
    // stdin is closed rather than redirected from /dev/null: spawn() takes
    // stdio: ['ignore', ...], which is the portable form of `< /dev/null`.
    buildArgs: ({ model, prompt, resume, outputFile }) => codexArgs(model, prompt, resume, outputFile),
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
// The same per-lane shape is why a trust flag cannot leak: only cursorArgs and
// agyArgs accept one, and each pushes a literal its own CLI understands.
// opencodeArgs and codexArgs have no parameter for it, so a misconfigured
// `trustFlag` on those lanes has nowhere to go structurally, on top of being
// rejected earlier by resolveTrustFlag.
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

// The one-line message that rides alongside the attached brief. omp's shape is
// `omp [flags] [@files...] [messages...]`, and the verified 2026-08-25 run that
// produced correct work used exactly this pairing.
const OMP_PROMPT_INSTRUCTION = 'Complete the task described in the attached brief.';

function ompArgs(model, promptPath, resume, cwd) {
  //   fresh : -p --mode json --model <m> --cwd <dir> @<prompt> <instruction>
  //   last  : ... --continue ...
  //   id    : ... --resume <id> ...
  //
  // Three things here are load-bearing.
  //
  // 1. `-r/--resume` WITH NO VALUE OPENS AN INTERACTIVE PICKER (`omp --help`,
  //    18.0.5: "Resume a session (by ID prefix, path, or picker if omitted)").
  //    A dispatch runs with stdin closed and nobody watching, so a bare --resume
  //    must never be built. The id is required to be non-empty here rather than
  //    trusted from the caller: silently dropping the flag would start a fresh
  //    conversation under a resume instruction, which is the exact substitution
  //    the session pre-flight exists to prevent.
  // 2. `--cwd` is passed even though spawn() already sets the working directory,
  //    because omp AUTO-SWITCHES TO A TEMP DIR when started in ~ unless told
  //    otherwise (`--allow-home`). Naming the directory removes that surprise,
  //    and it matches the invocation verified on 2026-08-25.
  // 3. The prompt is ATTACHED, not inlined: `@<path>`. A missing file is a hard
  //    failure (exit 1, before model resolution), so the prompt cannot be
  //    silently omitted from the call.
  const args = ['-p', '--mode', 'json', '--model', model];
  if (typeof cwd === 'string' && cwd.trim() !== '') args.push('--cwd', cwd);
  if (resume.kind === 'last') {
    args.push('--continue');
  } else if (resume.kind === 'id') {
    const id = typeof resume.id === 'string' ? resume.id.trim() : '';
    if (id === '') {
      throw new Error(
        'Refusing to build an omp resume with an empty session id: `omp -r` with no value opens an INTERACTIVE PICKER, which a headless dispatch can never answer.'
      );
    }
    args.push('--resume', id);
  }
  if (typeof promptPath !== 'string' || promptPath.trim() === '') {
    throw new Error('Refusing to build an omp dispatch with no prompt file to attach.');
  }
  args.push(`@${promptPath}`);
  args.push(OMP_PROMPT_INSTRUCTION);
  return args;
}

function expandScientificDecimal(value) {
  const raw = String(value);
  if (!/[eE]/.test(raw)) return raw;
  const match = /^(-?)(\d+)(?:\.(\d+))?[eE]([+-]?\d+)$/.exec(raw);
  if (match === null) return raw;
  const sign = match[1];
  const integer = match[2];
  const fraction = match[3] || '';
  const digits = integer + fraction;
  const decimalAt = integer.length + Number(match[4]);
  if (decimalAt <= 0) return `${sign}0.${'0'.repeat(-decimalAt)}${digits}`;
  if (decimalAt >= digits.length) return `${sign}${digits}${'0'.repeat(decimalAt - digits.length)}`;
  return `${sign}${digits.slice(0, decimalAt)}.${digits.slice(decimalAt)}`;
}

function agyPrintTimeout(timeoutMs) {
  const outerMs = toFiniteNumber(timeoutMs);
  if (outerMs === null || outerMs <= 0) {
    throw new Error(
      `Refusing to build an agy dispatch with an invalid outer timeout ${JSON.stringify(timeoutMs)}.`
    );
  }
  const innerMs = outerMs > 15000 ? outerMs - 15000 : outerMs;
  return `${expandScientificDecimal(innerMs / 1000)}s`;
}

function agyArgs(model, prompt, resume, trustFlag, timeoutMs = DEFAULT_DISPATCH_TIMEOUT_MS) {
  //   fresh : -p <prompt> --output-format json [--model <m>] [trust] --print-timeout <duration>
  //   last  : ... --continue
  //   id    : ... --conversation <id>
  // `-p` takes the prompt as its VALUE, so the prompt is not a positional and the
  // flags that follow it still parse.
  //
  // Same rule as cursorArgs: this is the only argv element that came from the
  // config without being a model slug, so it is admitted only after
  // resolveTrustFlag matched it against THIS lane's table. `null` means no flag
  // at all — the absent case must not become an empty-string argv element.
  const args = ['-p', prompt, '--output-format', 'json'];
  if (model !== null) args.push('--model', model);
  if (typeof trustFlag === 'string' && trustFlag !== '') args.push(trustFlag);
  args.push('--print-timeout', agyPrintTimeout(timeoutMs));
  if (resume.kind === 'last') args.push('--continue');
  else if (resume.kind === 'id') args.push('--conversation', resume.id);
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
  // matched it against THIS lane's table — a literal agy accepts never reaches
  // here. `null` means no flag at all; the absent case must not become an
  // empty-string argv element.
  const args = ['-p', '--output-format', 'json', '--model', model];
  if (typeof trustFlag === 'string' && trustFlag !== '') {
    args.push(trustFlag);
    // cursor-agent's --trust settles workspace trust. It is a separate,
    // smaller grant from --yolo/-f, so a configured command-approval flag does
    // not implicitly settle the headless workspace-trust prompt. Do not add it
    // twice when the configured flag is already --trust.
    if (trustFlag !== '--trust') args.push('--trust');
  }
  if (resume.kind === 'last') args.push('--continue');
  else if (resume.kind === 'id') args.push('--resume', resume.id);
  args.push(prompt);
  return args;
}

function codexArgs(model, prompt, resume, outputFile) {
  //   fresh : exec -m <model> --skip-git-repo-check [-o FILE] <prompt>
  //   last  : exec resume -m <model> --last --skip-git-repo-check [-o FILE] <prompt>
  //   id    : exec resume -m <model> --skip-git-repo-check [-o FILE] <id> <prompt>
  //
  // `codex exec resume [OPTIONS] [SESSION_ID] [PROMPT]` — the id is a positional
  // that comes BEFORE the prompt, so appending a flag would malform the command.
  // With `--last` and no id, the single positional binds to PROMPT: verified by
  // running `exec resume --last` with no positional, which answered "Reading
  // prompt from stdin..." rather than treating it as a missing session id.
  const args = ['exec'];
  if (resume.kind !== 'none') args.push('resume');

  // The model is named on EVERY shape, pushed here — after the subcommand tokens
  // and before every option and both positionals — so it binds to whichever
  // subcommand was just built. Three things make this placement correct rather
  // than merely convenient, and the resume shape is the one that needed proving:
  //
  //   1. `codex exec resume` declares its OWN `-m, --model <MODEL>`. Read from
  //      `codex exec resume --help` on 2026-08-26, listed among its options
  //      alongside `--last` and `--skip-git-repo-check`. The flag therefore does
  //      NOT need hoisting onto `exec` ahead of the `resume` token, which is the
  //      shape that would have been required had resume not accepted it.
  //   2. `-m` takes exactly ONE value, so it consumes the slug and nothing else.
  //      It cannot swallow the SESSION_ID or PROMPT positionals that follow —
  //      the failure mode `--resume` has on cursor-agent, whose optional value
  //      would eat the prompt.
  //   3. Options precede positionals here, so the `[SESSION_ID] [PROMPT]`
  //      ordering the resume grammar requires is untouched by the insertion.
  //
  // assertPinnedModelPlumbing() re-checks all three shapes at module load, so a
  // future edit cannot quietly drop the flag from one of them.
  //
  // An absent model is a hard failure, never an omitted flag: dropping `-m`
  // would silently inherit whatever ~/.codex/config.toml holds, which is the
  // exact defect the pin exists to close. Absent stays absent — it does not
  // become "use the CLI's default".
  if (typeof model !== 'string' || model.trim() === '') {
    throw new Error(
      'Refusing to build a codex dispatch with no model. This lane is pinned, and omitting `-m` ' +
        'would silently inherit the model from ~/.codex/config.toml — the exact behaviour the pin ' +
        'exists to prevent, and how a mechanical task came to run on a large model at max reasoning effort.'
    );
  }
  args.push('-m', model.trim());

  if (resume.kind === 'last') args.push('--last');
  args.push('--skip-git-repo-check');
  if (outputFile !== null) args.push('--output-last-message', outputFile);
  if (resume.kind === 'id') args.push(resume.id);
  args.push(prompt);
  return args;
}

const LANE_KEYS = Object.keys(LANES);

/**
 * Startup integrity check on the trust-flag plumbing.
 *
 * A lane may only DECLARE a trust-flag table if its argv builder actually
 * threads one through. The failure this guards against is silent and the wrong
 * way round: the config would name a grant, the dry-run and approval card would
 * both announce it, the user would approve it — and the flag would never reach
 * the command line, so the dispatch would fail exactly as it did before while
 * every surface claimed the grant was in force. Declaring is cheap; the check
 * proves the declaration is wired.
 *
 * It runs at module load and throws, because the lane registry is code rather
 * than config: a mismatch can only be introduced by editing this file.
 */
function assertTrustFlagPlumbing() {
  const SENTINEL = '--dispatch-trust-flag-plumbing-probe';
  for (const key of LANE_KEYS) {
    const lane = LANES[key];
    const accepted = acceptedTrustFlags(lane);
    if (accepted.length === 0) continue;
    const argv = lane.buildArgs({
      model: lane.defaultModel,
      prompt: '<plumbing probe — never dispatched>',
      resume: { kind: 'none', id: null },
      outputFile: null,
      trustFlag: SENTINEL,
    });
    if (!argv.includes(SENTINEL)) {
      throw new Error(
        `Lane registry is inconsistent: lane "${key}" declares trust flags ` +
          `(${accepted.join(', ')}) but its buildArgs did not place the value in argv. ` +
          `A declared-but-unplumbed trust flag would be announced in the dry-run and the ` +
          `approval card and then never passed to ${lane.cli}. Thread trustFlag through that ` +
          `lane's argv builder, or set trustFlags: null on the lane.`
      );
    }
  }
}

assertTrustFlagPlumbing();

/**
 * Startup integrity check on agy's inner-timeout plumbing.
 *
 * The outer timeout is resolved by the wrapper, but agy has a second ceiling
 * inside print mode. Keep the derived value in the argv path and prove that no
 * other lane accidentally receives agy's CLI-specific flag.
 */
function assertAgyTimeoutPlumbing() {
  const SENTINEL_TIMEOUT_MS = 2400000;
  const expected = '2385s';
  const antigravityArgv = LANES.antigravity.buildArgs({
    model: LANES.antigravity.defaultModel,
    prompt: '<plumbing probe — never dispatched>',
    promptPath: '<plumbing probe — never dispatched>',
    resume: { kind: 'none', id: null },
    outputFile: null,
    trustFlag: null,
    cwd: null,
    timeoutMs: SENTINEL_TIMEOUT_MS,
  });
  const timeoutAt = antigravityArgv.indexOf('--print-timeout');
  if (timeoutAt === -1 || antigravityArgv[timeoutAt + 1] !== expected) {
    throw new Error(
      `Lane registry is inconsistent: antigravity must place --print-timeout ${expected} ` +
        `in argv for an outer timeout of ${SENTINEL_TIMEOUT_MS} ms. Built: ${JSON.stringify(antigravityArgv)}.`
    );
  }

  for (const key of LANE_KEYS) {
    if (key === 'antigravity') continue;
    const lane = LANES[key];
    const argv = lane.buildArgs({
      model: lane.defaultModel,
      prompt: '<plumbing probe — never dispatched>',
      promptPath: '<plumbing probe — never dispatched>',
      resume: { kind: 'none', id: null },
      outputFile: null,
      trustFlag: null,
      cwd: null,
      timeoutMs: SENTINEL_TIMEOUT_MS,
    });
    if (argv.includes('--print-timeout')) {
      throw new Error(
        `Lane registry is inconsistent: lane "${key}" received agy's --print-timeout flag. ` +
          `That option is only understood by agy and must not be invented for ${lane.cli}.`
      );
    }
  }
}

assertAgyTimeoutPlumbing();

/**
 * Startup integrity check on the pinned-model plumbing.
 *
 * The same silent, wrong-way-round failure assertTrustFlagPlumbing guards, and
 * this lane is the one that already suffered it: codex declared no model and
 * built no `-m`, so the CLI ran whatever its own config held while nothing on
 * any surface said so. A pin the argv builder forgets is indistinguishable from
 * a pin that works — the lane table would print the slug, the dry-run would
 * print the slug, the approval card would print the slug, and the dispatch
 * would still inherit a different model entirely.
 *
 * All three resume shapes are checked, not just the fresh one, because codex is
 * the lane whose argv is RESTRUCTURED for a resume: a `resume` subcommand with
 * the session id as a positional ahead of the prompt. "The flag is in argv" has
 * to hold three times there, not once, and it has to be in a position where the
 * flag actually binds — hence the check that the slug is preceded by -m/--model
 * rather than merely present somewhere in the array.
 *
 * It runs at module load and throws, because the lane registry is code rather
 * than config: a mismatch can only be introduced by editing this file.
 */
function assertPinnedModelPlumbing() {
  const SHAPES = [
    { kind: 'none', id: null },
    { kind: 'last', id: null },
    { kind: 'id', id: '00000000-0000-0000-0000-000000000000' },
  ];
  for (const key of LANE_KEYS) {
    const lane = LANES[key];
    const pin = lane.pinnedModel === undefined || lane.pinnedModel === null ? null : lane.pinnedModel;
    if (pin === null) continue;

    if (lane.supportsModel !== true) {
      throw new Error(
        `Lane registry is inconsistent: lane "${key}" pins model "${pin}" but declares supportsModel: false, ` +
          `so no model flag would ever be built and the pin would be decorative. Set supportsModel: true, or remove the pin.`
      );
    }
    if (lane.defaultModel !== pin) {
      throw new Error(
        `Lane registry is inconsistent: lane "${key}" pins model "${pin}" but its defaultModel is ` +
          `${JSON.stringify(lane.defaultModel)}. A lane the config does not mention falls back to defaultModel, ` +
          `so the two disagreeing means an unconfigured lane would dispatch a model the pin forbids.`
      );
    }

    for (const resume of SHAPES) {
      const argv = lane.buildArgs({
        model: pin,
        prompt: '<plumbing probe — never dispatched>',
        promptPath: '<plumbing probe — never dispatched>',
        resume,
        outputFile: null,
        trustFlag: null,
        cwd: null,
      });
      const at = argv.indexOf(pin);
      if (at < 1 || (argv[at - 1] !== '-m' && argv[at - 1] !== '--model')) {
        throw new Error(
          `Lane registry is inconsistent: lane "${key}" pins model "${pin}", but its buildArgs did not place ` +
            `that slug immediately after a -m/--model flag for resume kind "${resume.kind}". ` +
            `Built: ${JSON.stringify(argv)}. An unplumbed pin is invisible: every surface would name the model ` +
            `while ${lane.cli} silently used its own configured default.`
        );
      }
    }
  }
}

assertPinnedModelPlumbing();

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
    probeFlags: false,
    approve: false,
    noWorktree: false,
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
    else if (arg === '--probe-flags') out.probeFlags = true;
    else if (arg === '--approve') out.approve = true;
    else if (arg === '--no-worktree') out.noWorktree = true;
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

  if (out.probeFlags && out.promptFile !== null) {
    out.errors.push('--probe-flags cannot be combined with --prompt-file: flag probing never dispatches.');
  }

  return out;
}

/** The resume instruction, as a value rather than two loose booleans. */
function resumeIntent(opts) {
  if (opts.resumeLast) return { kind: 'last', id: null, label: 'most recent session' };
  if (opts.resumeId !== null) return { kind: 'id', id: opts.resumeId, label: `session ${opts.resumeId}` };
  return { kind: 'none', id: null, label: 'new session' };
}

/**
 * A fresh worktree and a resumed conversation are not interchangeable. The
 * provider session may be bound to the directory in which it was created, and
 * the old directory may contain the very edits the caller wants to continue.
 * Reusing one implicitly would also let this wrapper touch another process's
 * uncommitted work. The safe default is therefore an explicit refusal; the
 * caller can name the old directory with --no-worktree --cwd.
 */
function resumeWorktreePolicy(opts, resume) {
  if (resume.kind === 'none') {
    return opts.noWorktree
      ? `--no-worktree is active: a new session will run in ${path.resolve(opts.cwd)} and no worktree will be created.`
      : 'A new session will run in a fresh worktree created from the current HEAD.';
  }
  if (opts.noWorktree) {
    return `--no-worktree is active: ${resume.label} will stay in the requested directory ${path.resolve(opts.cwd)}; no worktree will be created.`;
  }
  return `RESUME REFUSED under default worktree isolation: ${resume.label} belongs to its earlier working directory, and this wrapper will not silently create or reuse a different directory. Re-run with --no-worktree --cwd <the prior worktree> after inspecting git worktree list.`;
}

const HELP = `
check_lanes.js — probe and dispatch external agent CLI lanes.

  node check_lanes.js
      Probe every lane. Prints a table. NEVER dispatches.

  node check_lanes.js --lane <key>
      Probe one lane only.

  node check_lanes.js --probe-flags [--lane <key>] [--json]
      Run the READY lane's CLI with --help and report timeout-ish and
      trust/approval-ish flags. Never dispatches. An unavailable or rejected
      lane is reported without running its binary.

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
    --no-worktree       explicit opt-out; run in --cwd with no isolation
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
    if (entry.trustFlag !== undefined && entry.trustFlag !== null && !supportsTrustFlag(LANES[key])) {
      result.warnings.push(
        `Config sets trustFlag ${JSON.stringify(entry.trustFlag)} for lane "${key}", but the ${LANES[key].cli} CLI ` +
          `has no standing-permission flag at all. Lanes that accept one: ${trustFlagLaneSummary().join('; ')}. ` +
          `${LANES[key].cli} would reject the value as an unknown argument, so it is IGNORED and never reaches the command line.`
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

/**
 * Resolves the model slug for one lane and reports where it came from.
 *
 * A lane may additionally be PINNED, which is a stronger thing than a default.
 * A default merely fills a gap and loses to any configured value; a pin means
 * the lane accepts exactly one model and REFUSES every other, the same way
 * resolveTrustFlag refuses a literal its lane does not accept. Both exist for
 * the same reason — the value is about to become an element of an argv array
 * handed to a CLI, and a policy file is not a place to accept an arbitrary one.
 *
 * The pin is the stricter of the two because its failure falls the other way.
 * An unrecognised trust flag would at least be rejected by the CLI as an unknown
 * argument. An unpinned model would be ACCEPTED, and the dispatch would run —
 * just on a model the user has forbidden, spending a quota they cannot get back.
 * "Forward it and let the CLI complain" does not work when the CLI will not.
 *
 * Note which way this fails safe: on a refusal the returned `model` is still the
 * PIN, not null and not the configured value. The dispatch path refuses before
 * building anything, so nothing runs — but if some future path ever reads this
 * without checking `error`, it gets the permitted model rather than a null that
 * would drop the flag and re-inherit the CLI's own default.
 */
function resolveModel(laneKey, config) {
  const lane = LANES[laneKey];
  if (!lane.supportsModel) {
    return { model: null, configured: null, source: 'lane-takes-no-model-flag', note: null, error: null };
  }

  const entry = Object.prototype.hasOwnProperty.call(config.lanes, laneKey) ? config.lanes[laneKey] : null;
  const configured = entry === null ? undefined : entry.model;
  const pin = lane.pinnedModel === undefined || lane.pinnedModel === null ? null : lane.pinnedModel;

  if (pin !== null) {
    if (configured === undefined || configured === null) {
      return {
        model: pin,
        configured: null,
        source: 'lane-pinned',
        note: `Lane "${laneKey}" is pinned to ${pin} in the lane registry, and passes it explicitly on every dispatch. It is not inherited from the CLI's own configuration.`,
        error: null,
      };
    }
    if (typeof configured === 'string' && configured.trim() === pin) {
      return { model: pin, configured, source: 'config-matches-pin', note: null, error: null };
    }
    return {
      model: pin,
      configured,
      source: 'refused-model-not-permitted',
      note: null,
      error:
        `Lane "${laneKey}" has model ${JSON.stringify(configured)} in ${config.path}, but that lane is PINNED to ` +
        `${JSON.stringify(pin)} and accepts no other model. Refusing to dispatch rather than forwarding it: ` +
        `${lane.cli} would ACCEPT the substitute and run it, so passing it through would spend the user's quota on ` +
        `a model the pin exists to forbid — it would not fail loudly the way a bad flag does. ` +
        `Set the value to ${JSON.stringify(pin)} in ${config.path}, or remove the key entirely to use the pin.`,
    };
  }

  if (typeof configured === 'string' && configured.trim() !== '') {
    return { model: configured.trim(), configured, source: 'config', note: null, error: null };
  }
  if (configured !== undefined && configured !== null) {
    return {
      model: lane.defaultModel,
      configured,
      source: 'built-in-default',
      note: `Config value ${JSON.stringify(configured)} is not a usable model slug; fell back to the built-in default.`,
      error: null,
    };
  }
  return {
    model: lane.defaultModel,
    configured: null,
    source: lane.defaultModel === null ? 'cli-default' : 'built-in-default',
    note: lane.defaultModel === null ? 'No model flag is passed; the CLI uses its own configured default.' : null,
    error: null,
  };
}

/**
 * Resolves the optional per-lane `trustFlag` and says exactly what it grants.
 *
 * This field exists because two of the CLIs refuse to do useful work headlessly
 * without a standing permission: cursor-agent will not start in an untrusted
 * directory ("Workspace Trust Required"), and agy auto-DENIES any tool
 * permission it cannot prompt for, returning no work done. The fix in both cases
 * is a flag that grants standing permission — precisely the kind of grant that
 * must live in the policy file the user owns rather than being hardcoded here,
 * so it can be revoked with an edit and no code change.
 *
 * Validation is against THIS LANE's accepted set, never a global union. The
 * literals are per-CLI, so a value valid on another lane is rejected here rather
 * than forwarded: handing `--yolo` to agy, or `--dangerously-skip-permissions`
 * to cursor-agent, would either fail as an unknown argument or — worse — be
 * treated as something else entirely.
 *
 * Four outcomes, and the difference between the middle two is the point:
 *   - lane's CLI has no such flag -> null, ignored, with a warning from
 *     loadConfig. Nothing reaches argv, so a bad value is harmless, not fatal.
 *   - not configured        -> null. Absent stays absent; there is no default
 *                              grant and no implicit trust.
 *   - a value this lane accepts -> that flag, plus the plain-words grant text.
 *   - anything else         -> a hard ERROR naming the set this lane accepts. An
 *                              unrecognised string is never forwarded: it is
 *                              about to become an element of an argv array
 *                              passed to a CLI, and "pass it through and let the
 *                              CLI complain" is how a typo in a policy file
 *                              turns into an unintended argument.
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

  const accepted = laneTrustFlags(lane);

  if (accepted === null) {
    // Ignored, not fatal: it never reaches the command line. loadConfig has
    // already warned about it by name.
    return Object.assign({}, none, {
      source: 'lane-takes-no-trust-flag',
      note:
        `Lane "${laneKey}" runs the ${lane.cli} CLI, which has no standing-permission flag. ` +
        `The configured value ${JSON.stringify(configured)} is ignored and is NOT passed to the command line.`,
    });
  }

  if (typeof configured !== 'string' || !Object.prototype.hasOwnProperty.call(accepted, configured)) {
    // The accepted literals are per-CLI, so "not accepted here" is the common
    // case for a value that is perfectly valid on another lane. Say which,
    // because "--yolo is not one of --dangerously-skip-permissions" reads like a
    // typo when it is actually a lane mix-up.
    const elsewhere = trustFlagAcceptedElsewhere(configured, laneKey);
    const misrouted =
      elsewhere.length === 0
        ? ''
        : ` That literal belongs to ${elsewhere.join(', ')}, not ${lane.cli}: trust flags are per-CLI ` +
          `and are never forwarded across lanes.`;
    return Object.assign({}, none, {
      source: 'invalid-trust-flag-value',
      error:
        `Lane "${laneKey}" has trustFlag ${JSON.stringify(configured)}, which lane "${laneKey}" does not accept. ` +
        `That lane runs ${lane.cli}, which accepts: ${acceptedTrustFlags(lane).join(', ')}.${misrouted} ` +
        `Refusing to dispatch: this value would become an argument to ${lane.cli}, and an unrecognised flag ` +
        `from a policy file is never passed through. ` +
        `Fix the value in ${config.path}, or remove the key to dispatch with no trust flag.`,
    });
  }

  const spec = accepted[configured];
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

/**
 * Names every standing grant that will reach a cursor-agent invocation.
 *
 * A command-approval flag such as --yolo does not settle cursor-agent's
 * separate workspace-trust prompt. When one is configured, cursorArgs adds
 * --trust as well, so the preview and approval text must disclose both grants.
 */
function effectiveTrustFlags(laneKey, trust) {
  if (trust.flag === null) return [];
  const flags = [trust.flag];
  if (LANES[laneKey].cli === 'cursor-agent' && trust.flag !== '--trust') flags.push('--trust');
  return flags;
}

function describeTrustFlags(laneKey, trust) {
  if (trust.flag === null) return null;
  const displays = [describeTrustFlag(trust)];
  if (LANES[laneKey].cli === 'cursor-agent' && trust.flag !== '--trust') {
    displays.push(describeTrustFlag({
      flag: '--trust',
      grant: TRUST_FLAGS['cursor-agent']['--trust'].grant,
    }));
  }
  return displays.join('; ');
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

  // omp ships as a single .exe (152 MB, measured 2026-08-25) and needs no shim
  // resolution, but it shares this branch so a future .cmd-shimmed install is
  // followed to its payload rather than routed through cmd.exe.
  if (lane.cli === 'opencode' || lane.cli === 'agy' || lane.cli === 'omp') {
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

// ---------------------------------------------------------------------------
// Dispatch worktrees
//
// A dispatch is deliberately based on the repository's committed HEAD, not on
// the caller's uncommitted working tree. Every check below is read-only until
// the one explicit `git worktree add` that starts an approved dispatch. Any
// state that cannot be established is a refusal; falling back to opts.cwd
// would recreate the shared-working-tree bug this wrapper exists to prevent.
// ---------------------------------------------------------------------------

function runGit(args, cwd) {
  try {
    const res = spawnSync('git', args, {
      cwd,
      timeout: WORKTREE_GIT_TIMEOUT_MS,
      encoding: 'utf8',
      windowsHide: true,
      shell: false,
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    if (res.error) {
      return {
        status: null,
        stdout: '',
        stderr: '',
        errorMessage: res.error.message,
      };
    }
    return {
      status: res.status,
      stdout: res.stdout === null || res.stdout === undefined ? '' : res.stdout,
      stderr: res.stderr === null || res.stderr === undefined ? '' : res.stderr,
      errorMessage: null,
    };
  } catch (err) {
    return { status: null, stdout: '', stderr: '', errorMessage: err.message };
  }
}

function runCommand(command, args, cwd, timeoutMs, shell = false) {
  const startedAt = Date.now();
  try {
    const res = spawnSync(command, args, {
      cwd,
      timeout: timeoutMs,
      encoding: 'utf8',
      windowsHide: true,
      shell,
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    const errorMessage = res.error && res.error.message ? res.error.message : null;
    const timedOut = Boolean(res.error && res.error.code === 'ETIMEDOUT');
    return {
      command,
      args,
      cwd,
      shell,
      spawned: res.error ? timedOut : true,
      status: res.status,
      stdout: res.stdout === null || res.stdout === undefined ? '' : res.stdout,
      stderr: res.stderr === null || res.stderr === undefined ? '' : res.stderr,
      timedOut,
      errorMessage,
      elapsedMs: Date.now() - startedAt,
    };
  } catch (err) {
    return {
      command,
      args,
      cwd,
      shell,
      spawned: false,
      status: null,
      stdout: '',
      stderr: '',
      timedOut: false,
      errorMessage: err && err.message ? err.message : String(err),
      elapsedMs: Date.now() - startedAt,
    };
  }
}

function commandReport(result) {
  return {
    command: result.command,
    args: result.args,
    cwd: result.cwd,
    shell: result.shell,
    spawned: result.spawned,
    status: result.status,
    timedOut: result.timedOut,
    elapsedMs: result.elapsedMs,
    stdoutPreview: firstLines(result.stdout, 3),
    stderrPreview: firstLines(result.stderr, 3),
    error: result.errorMessage,
  };
}

function formatByteSize(bytes) {
  if (!Number.isFinite(bytes)) return 'UNKNOWN';
  const mib = bytes / (1024 * 1024);
  const mb = bytes / 1000000;
  return `${mib.toFixed(1)} MiB (${mb.toFixed(1)} MB)`;
}

function formatElapsed(ms) {
  if (!Number.isFinite(ms)) return 'UNKNOWN';
  return `${ms} ms (${(ms / 1000).toFixed(1)} s)`;
}

/**
 * Measures a dependency tree without following symlinks. A size that cannot
 * be measured is UNKNOWN, not zero; cleanup must not claim to have freed a
 * number it could not establish.
 */
function measureDirectoryBytes(target) {
  const initial = inspectPath(target);
  if (initial.exists === null) {
    return { known: false, exists: null, bytes: null, reason: `The dependency directory ${target} could not be inspected (${initial.error}).` };
  }
  if (initial.exists === false) return { known: true, exists: false, bytes: 0, reason: null };
  if (initial.isDirectory !== true) {
    return { known: false, exists: true, bytes: null, reason: `The dependency path ${target} exists but is not a directory.` };
  }

  let bytes = 0;
  const pending = [target];
  try {
    while (pending.length > 0) {
      const current = pending.pop();
      for (const entry of fs.readdirSync(current, { withFileTypes: true })) {
        const entryPath = path.join(current, entry.name);
        const stat = fs.lstatSync(entryPath);
        if (stat.isDirectory() && !stat.isSymbolicLink()) pending.push(entryPath);
        else bytes += stat.size;
      }
    }
  } catch (err) {
    return {
      known: false,
      exists: true,
      bytes: null,
      reason: `The dependency directory ${target} could not be fully measured (${err.message}).`,
    };
  }
  return { known: true, exists: true, bytes, reason: null };
}

function dependencyInstallPlan(worktreePath) {
  // npm gives npm-shrinkwrap.json precedence when both lock formats exist.
  for (const filename of ['npm-shrinkwrap.json', 'package-lock.json']) {
    const lockPath = path.join(worktreePath, filename);
    const state = inspectPath(lockPath);
    if (state.exists === null) {
      return {
        known: false,
        method: null,
        lockfile: lockPath,
        reason: `The lockfile candidate ${lockPath} could not be inspected (${state.error}).`,
      };
    }
    if (state.exists === true && state.isFile !== true) {
      return {
        known: false,
        method: null,
        lockfile: lockPath,
        reason: `${lockPath} exists but is not a regular file; refusing to guess whether npm ci is safe.`,
      };
    }
    if (state.exists === true) {
      return { known: true, method: 'ci', lockfile: lockPath, reason: null };
    }
  }
  return { known: true, method: 'install', lockfile: null, reason: null };
}

function resolveNpmInvocation() {
  if (process.platform !== 'win32') return { command: 'npm', prefixArgs: [], shell: false };

  // Windows cannot spawn a .cmd file with shell:false on this installation
  // (it returns EINVAL). Invoke npm's CLI JS directly with the running Node
  // executable, preserving the no-shell property for all package arguments.
  const nodeDir = path.dirname(process.execPath);
  const candidates = [
    path.join(nodeDir, 'node_modules', 'npm', 'bin', 'npm-cli.js'),
    path.join(nodeDir, 'npm', 'bin', 'npm-cli.js'),
  ];
  const pathValue = process.env.PATH || process.env.Path || '';
  for (const rawDir of pathValue.split(path.delimiter)) {
    if (rawDir.trim() === '') continue;
    const dir = rawDir.trim();
    candidates.push(path.join(dir, 'node_modules', 'npm', 'bin', 'npm-cli.js'));
  }
  for (const npmCli of candidates) {
    if (fileExists(npmCli)) return { command: process.execPath, prefixArgs: [npmCli], shell: false };
  }

  // This fallback is still limited to npm.cmd and generated, non-prompt
  // arguments. If the direct CLI could not be located, shell execution gives
  // the install a chance to produce a useful error instead of assuming npm is
  // available; a failure is still a hard preparation refusal.
  return { command: 'npm.cmd', prefixArgs: [], shell: true };
}

function inspectSavePathTarget(resolvedPath) {
  const target = inspectPath(resolvedPath);
  if (target.exists === null) {
    return {
      state: 'unknown',
      reason: `The configured save path ${resolvedPath} could not be inspected (${target.error}).`,
    };
  }
  if (target.exists === true) {
    return {
      state: target.isDirectory === true ? 'directory' : target.isFile === true ? 'file' : 'present',
      reason: null,
    };
  }

  const parent = inspectPath(path.dirname(resolvedPath));
  if (parent.exists === null) {
    return {
      state: 'unknown',
      reason: `The configured save path ${resolvedPath} is absent and its parent could not be inspected (${parent.error}).`,
    };
  }
  if (parent.exists === true && parent.isDirectory === true) {
    return {
      state: 'parent-directory',
      reason: `The configured save path ${resolvedPath} is not present, but its parent directory exists.`,
    };
  }
  return {
    state: 'missing',
    reason: `The configured save path ${resolvedPath} and its parent directory are not present.`,
  };
}

function savePathResultForValue(value, source, configNote = null) {
  const trimmed = typeof value === 'string' ? value.trim() : '';
  if (trimmed === '') return null;

  let resolvedPath;
  try {
    // A relative path in the main config must not become relative to the
    // isolated worktree when SaveParser later calls path.resolve().
    resolvedPath = path.isAbsolute(trimmed)
      ? path.normalize(trimmed)
      : path.resolve(MAIN_CHECKOUT_ROOT, trimmed);
  } catch (err) {
    return {
      state: 'unknown',
      source,
      configPath: MAIN_RUNTIME_CONFIG_PATH,
      path: null,
      passedToChild: false,
      targetState: null,
      reason: `${source} contained a save path that could not be resolved (${err.message}).`,
    };
  }

  const target = inspectSavePathTarget(resolvedPath);
  const reasons = [];
  if (configNote !== null) reasons.push(configNote);
  if (target.reason !== null) reasons.push(target.reason);
  return {
    state: target.state === 'unknown' ? 'unknown' : target.state === 'missing' ? 'unavailable' : 'resolved',
    source,
    configPath: MAIN_RUNTIME_CONFIG_PATH,
    path: resolvedPath,
    // A configured path is useful information even when the target is not
    // present yet; the server can give the lane the authoritative error.
    passedToChild: true,
    targetState: target.state,
    reason: reasons.length === 0 ? null : reasons.join(' '),
  };
}

function unresolvedSavePathResult(state, reason) {
  return {
    state,
    source: 'main config.json',
    configPath: MAIN_RUNTIME_CONFIG_PATH,
    path: null,
    passedToChild: false,
    targetState: null,
    reason,
  };
}

/**
 * Read only paths.savePath / legacy SavePath from the main checkout's local
 * config. No other config values are returned or copied into the worktree.
 * An absent or unreadable save path is a warning, not a dispatch refusal.
 */
function resolveDispatchSavePath() {
  const existingEnvironment = typeof process.env.TI_SAVE_PATH === 'string'
    ? process.env.TI_SAVE_PATH.trim()
    : '';
  const configState = inspectPath(MAIN_RUNTIME_CONFIG_PATH);
  let configIssue = null;
  let configIssueState = 'unavailable';
  let configuredValue;
  let source = null;

  if (configState.exists === null) {
    configIssueState = 'unknown';
    configIssue = `The main ${MAIN_RUNTIME_CONFIG_PATH} could not be inspected (${configState.error}).`;
  } else if (configState.exists === false) {
    configIssue = `The main ${MAIN_RUNTIME_CONFIG_PATH} is not present.`;
  } else if (configState.isFile !== true) {
    configIssueState = 'unknown';
    configIssue = `The main ${MAIN_RUNTIME_CONFIG_PATH} exists but is not a regular file.`;
  } else {
    try {
      const parsed = JSON.parse(fs.readFileSync(MAIN_RUNTIME_CONFIG_PATH, 'utf8').replace(/^\uFEFF/, ''));
      if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) {
        configIssueState = 'unknown';
        configIssue = `The main ${MAIN_RUNTIME_CONFIG_PATH} did not contain a JSON object.`;
      } else {
        const pathsConfig = parsed.paths;
        if (pathsConfig !== null && typeof pathsConfig === 'object' && !Array.isArray(pathsConfig) && Object.prototype.hasOwnProperty.call(pathsConfig, 'savePath')) {
          configuredValue = pathsConfig.savePath;
          source = 'main config.json paths.savePath';
        } else if (Object.prototype.hasOwnProperty.call(parsed, 'SavePath')) {
          configuredValue = parsed.SavePath;
          source = 'main config.json legacy SavePath';
        }

        if (typeof configuredValue === 'string' && configuredValue.trim() !== '') {
          const configuredResult = savePathResultForValue(configuredValue, source);
          if (configuredResult !== null) return configuredResult;
        } else if (configuredValue !== undefined) {
          configIssue = `The main ${MAIN_RUNTIME_CONFIG_PATH} save path is not a non-empty string.`;
        } else {
          configIssue = `The main ${MAIN_RUNTIME_CONFIG_PATH} has neither paths.savePath nor legacy SavePath.`;
        }
      }
    } catch (err) {
      configIssueState = 'unknown';
      configIssue = `The main ${MAIN_RUNTIME_CONFIG_PATH} could not be parsed (${err.message}).`;
    }
  }

  // Preserve an explicitly supplied environment value as a useful fallback,
  // but normalize a relative value against the main checkout so it does not
  // silently point into the fresh worktree.
  if (existingEnvironment !== '') {
    const fallback = savePathResultForValue(
      existingEnvironment,
      'existing TI_SAVE_PATH environment',
      configIssue === null ? null : `${configIssue} Using the existing environment value.`
    );
    if (fallback !== null) return fallback;
  }

  return unresolvedSavePathResult(
    configIssueState,
    `${configIssue || `No save path was found in ${MAIN_RUNTIME_CONFIG_PATH}.`} Continuing without a TI_SAVE_PATH override; pure-JS work may still run, while save-dependent checks may report their own configuration error.`
  );
}

function buildDispatchEnvironment(savePath) {
  const environment = { ...process.env };
  if (savePath !== null && savePath.passedToChild === true && savePath.path !== null) {
    environment.TI_SAVE_PATH = savePath.path;
  }
  return environment;
}

function savePathHumanLine(savePath, action = 'passes') {
  if (savePath === null) return 'save path: NOT CHECKED — no environment handoff was prepared.';
  if (savePath.passedToChild === true) {
    const state = savePath.state.toUpperCase();
    const reason = savePath.reason === null ? '' : ` — ${savePath.reason}`;
    return `save path: ${state} — ${action} TI_SAVE_PATH=${savePath.path} to the lane (source: ${savePath.source}; config.json was not copied; no other config keys or secrets were propagated)${reason}`;
  }
  return `save path: ${savePath.state.toUpperCase()} — ${savePath.reason} No TI_SAVE_PATH override was ${action === 'passes' ? 'passed' : 'planned'}; continuing without refusing the dispatch.`;
}

function baseWorktreePreparation(plan) {
  return {
    state: 'not-started',
    ok: null,
    known: null,
    installMethod: null,
    lockfile: null,
    install: null,
    build: null,
    nodeModulesPath: plan.path === null ? null : path.join(plan.path, WORKTREE_DEPENDENCIES_RELATIVE),
    nodeModulesPresent: null,
    nodeModulesBytes: null,
    nodeModulesSize: null,
    bundlePath: plan.path === null ? null : path.join(plan.path, WORKTREE_BUNDLE_RELATIVE),
    bundleVerified: null,
    savePath: plan.savePath === undefined ? null : plan.savePath,
    totalElapsedMs: null,
    reason: null,
  };
}

function prepareWorktree(plan) {
  const startedAt = Date.now();
  const preparation = baseWorktreePreparation(plan);
  const fail = (state, known, reason) => {
    preparation.state = state;
    preparation.ok = false;
    preparation.known = known;
    preparation.totalElapsedMs = Date.now() - startedAt;
    preparation.reason = reason;
    plan.preparation = preparation;
    return { ok: false, known, reason, preparation };
  };

  if (plan.mode !== 'isolated' || plan.created !== true) {
    return fail('not-applicable', false, 'Dependencies can only be prepared in a created isolated worktree.');
  }

  const installPlan = dependencyInstallPlan(plan.path);
  if (!installPlan.known) return fail('preparation-unknown', false, installPlan.reason);
  preparation.installMethod = installPlan.method;
  preparation.lockfile = installPlan.lockfile;

  const npm = resolveNpmInvocation();
  const installArgs = [installPlan.method];
  const installResult = runCommand(
    npm.command,
    npm.prefixArgs.concat(installArgs),
    plan.path,
    WORKTREE_PREPARATION_TIMEOUT_MS,
    npm.shell
  );
  preparation.install = commandReport(installResult);
  if (installResult.timedOut || installResult.status === null) {
    const detail = installResult.timedOut
      ? `npm ${installPlan.method} timed out after ${formatElapsed(installResult.elapsedMs)}`
      : `npm ${installPlan.method} could not be verified (${installResult.errorMessage || 'no exit status'})`;
    return fail('preparation-unknown', false, `${detail}. Dependency installation is UNKNOWN; the worktree is retained.`);
  }
  if (installResult.status !== 0) {
    return fail(
      'install-failed',
      true,
      `npm ${installPlan.method} exited ${installResult.status} after ${formatElapsed(installResult.elapsedMs)}. ` +
        `${firstLines(installResult.stderr || installResult.stdout, 3) || 'No npm failure detail was emitted.'}`
    );
  }

  const nodeModulesPath = preparation.nodeModulesPath;
  const afterInstall = inspectPath(nodeModulesPath);
  if (afterInstall.exists === null) {
    return fail('preparation-unknown', false, `npm ${installPlan.method} exited 0, but ${nodeModulesPath} could not be inspected (${afterInstall.error}).`);
  }
  if (afterInstall.exists !== true || afterInstall.isDirectory !== true) {
    preparation.nodeModulesPresent = false;
    return fail('install-failed', true, `npm ${installPlan.method} exited 0, but ${nodeModulesPath} is not an installed dependency directory.`);
  }
  const size = measureDirectoryBytes(nodeModulesPath);
  preparation.nodeModulesPresent = size.exists;
  if (!size.known) return fail('preparation-unknown', false, size.reason);
  preparation.nodeModulesBytes = size.bytes;
  preparation.nodeModulesSize = formatByteSize(size.bytes);

  const buildResult = runCommand(
    npm.command,
    npm.prefixArgs.concat(['run', 'build']),
    plan.path,
    WORKTREE_PREPARATION_TIMEOUT_MS,
    npm.shell
  );
  preparation.build = commandReport(buildResult);
  if (buildResult.timedOut || buildResult.status === null) {
    const detail = buildResult.timedOut
      ? `npm run build timed out after ${formatElapsed(buildResult.elapsedMs)}`
      : `npm run build could not be verified (${buildResult.errorMessage || 'no exit status'})`;
    return fail('preparation-unknown', false, `${detail}. Build success is UNKNOWN; the worktree is retained.`);
  }
  if (buildResult.status !== 0) {
    return fail(
      'build-failed',
      true,
      `npm run build exited ${buildResult.status} after ${formatElapsed(buildResult.elapsedMs)}. ` +
        `${firstLines(buildResult.stderr || buildResult.stdout, 3) || 'No build failure detail was emitted.'}`
    );
  }

  const bundleState = inspectPath(preparation.bundlePath);
  if (bundleState.exists === null) {
    return fail('preparation-unknown', false, `npm run build exited 0, but the required bundle ${preparation.bundlePath} could not be inspected (${bundleState.error}).`);
  }
  if (bundleState.exists !== true || bundleState.isFile !== true) {
    preparation.bundleVerified = false;
    return fail('build-failed', true, `npm run build exited 0, but the required bundle ${preparation.bundlePath} was not produced.`);
  }
  preparation.bundleVerified = true;

  const afterBuild = inspectPath(nodeModulesPath);
  if (afterBuild.exists === null) return fail('preparation-unknown', false, `The prepared dependency directory ${nodeModulesPath} could not be rechecked after the build (${afterBuild.error}).`);
  if (afterBuild.exists !== true || afterBuild.isDirectory !== true) {
    preparation.nodeModulesPresent = false;
    return fail('build-failed', true, `The build completed, but ${nodeModulesPath} is no longer present; refusing to dispatch into an unprepared tree.`);
  }

  preparation.state = 'ready';
  preparation.ok = true;
  preparation.known = true;
  preparation.totalElapsedMs = Date.now() - startedAt;
  plan.preparation = preparation;
  plan.prepared = true;
  return { ok: true, known: true, reason: null, preparation };
}

function preparationCommandOutcome(report) {
  if (report === null || report === undefined) return 'not run';
  if (report.timedOut) return `TIMED OUT after ${formatElapsed(report.elapsedMs)}`;
  if (report.status === null) return `UNKNOWN (${report.error || 'no exit status'}) after ${formatElapsed(report.elapsedMs)}`;
  return `exit ${report.status} in ${formatElapsed(report.elapsedMs)}`;
}

function preparationHumanLines(preparation) {
  const lines = [];
  lines.push(savePathHumanLine(preparation.savePath));
  if (preparation.install !== null) {
    const lock = preparation.lockfile === null ? 'no lockfile — npm install' : `lockfile ${preparation.lockfile} — npm ci`;
    lines.push(`dependencies: ${lock}; ${preparationCommandOutcome(preparation.install)}`);
  } else {
    lines.push('dependencies: not run — lockfile/install decision was not reached');
  }
  if (preparation.nodeModulesPresent === true) {
    lines.push(`node_modules: ${preparation.nodeModulesSize || 'UNKNOWN size'}`);
  } else if (preparation.nodeModulesPresent === false) {
    lines.push('node_modules: NOT PRESENT');
  }
  if (preparation.build !== null) {
    lines.push(`build: npm run build; ${preparationCommandOutcome(preparation.build)}`);
  } else {
    lines.push('build: not run');
  }
  if (preparation.bundleVerified === true) lines.push(`bundle: verified at ${preparation.bundlePath}`);
  else if (preparation.bundleVerified === false) lines.push(`bundle: NOT VERIFIED at ${preparation.bundlePath}`);
  lines.push(`preparation total: ${formatElapsed(preparation.totalElapsedMs)}`);
  return lines;
}

function dependencyCleanupHumanLine(cleanup) {
  if (cleanup === null || cleanup === undefined) return null;
  if (cleanup.removed) {
    return `DEPENDENCIES REMOVED: ${cleanup.target} — ${formatByteSize(cleanup.bytesFreed)} freed in ${formatElapsed(cleanup.elapsedMs)}`;
  }
  if (cleanup.alreadyAbsent) return `DEPENDENCIES ALREADY ABSENT: ${cleanup.target}`;
  return `DEPENDENCY CLEANUP UNKNOWN: ${cleanup.target} — ${cleanup.reason}`;
}

function gitFailureDetail(result) {
  if (result.errorMessage !== null && result.errorMessage !== undefined) return result.errorMessage;
  const output = `${result.stderr || ''}\n${result.stdout || ''}`.trim();
  if (output !== '') return firstLines(output, 3).replace(/\r?\n/g, ' | ');
  return result.status === null ? 'no exit status' : `exit ${result.status}`;
}

function inspectPath(target) {
  try {
    const stat = fs.lstatSync(target);
    return { exists: true, isDirectory: stat.isDirectory(), isFile: stat.isFile(), error: null };
  } catch (err) {
    if (err && err.code === 'ENOENT') return { exists: false, isDirectory: false, isFile: false, error: null };
    return { exists: null, isDirectory: null, isFile: null, error: err && err.message ? err.message : String(err) };
  }
}

function samePath(left, right) {
  return path.resolve(left).toLowerCase() === path.resolve(right).toLowerCase();
}

function isPathWithin(parent, candidate) {
  const relative = path.relative(path.resolve(parent), path.resolve(candidate));
  return relative !== '' && relative !== '..' && !relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative);
}

function listGitWorktrees(repoRoot) {
  const result = runGit(['worktree', 'list', '--porcelain'], repoRoot);
  if (result.status !== 0) {
    return {
      known: false,
      paths: [],
      reason: `git worktree list --porcelain could not be read (${gitFailureDetail(result)}).`,
    };
  }

  const paths = [];
  for (const line of String(result.stdout).split(/\r?\n/)) {
    if (!line.startsWith('worktree ')) continue;
    const raw = line.slice('worktree '.length).trim();
    if (raw !== '') paths.push(path.resolve(raw));
  }
  if (paths.length === 0) {
    return {
      known: false,
      paths: [],
      reason: 'git worktree list --porcelain returned no parseable worktree paths.',
    };
  }
  return { known: true, paths, reason: null };
}

function checkGitIgnored(repoRoot, target) {
  const relative = path.relative(repoRoot, target);
  const result = runGit(['check-ignore', '--no-index', '--quiet', '--', relative], repoRoot);
  if (result.status === 0) {
    return { known: true, ignored: true, reason: null };
  }
  if (result.status === 1) {
    return { known: true, ignored: false, reason: `${target} is not git-ignored.` };
  }
  return {
    known: false,
    ignored: null,
    reason: `git check-ignore could not verify ${target} (${gitFailureDetail(result)}).`,
  };
}

function emptyWorktreePlan(requestedCwd, reason) {
  return {
    ok: false,
    mode: 'isolated',
    requestedCwd,
    effectiveCwd: null,
    repoRoot: null,
    worktreeRoot: null,
    path: null,
    head: null,
    ignored: null,
    existingWorktreeCount: null,
    existingNestedWorktreeCount: null,
    created: false,
    prepared: false,
    preparation: null,
    reason,
  };
}

/** Read-only preflight for the worktree that an approved dispatch will use. */
function planWorktree(laneKey, requestedCwd, noWorktree) {
  const resolvedCwd = path.resolve(requestedCwd);
  if (noWorktree) {
    return {
      ok: true,
      mode: 'no-worktree',
      requestedCwd: resolvedCwd,
      effectiveCwd: resolvedCwd,
      repoRoot: null,
      worktreeRoot: null,
      path: null,
      head: null,
      ignored: null,
      existingWorktreeCount: null,
      existingNestedWorktreeCount: null,
      created: false,
      prepared: false,
      preparation: null,
      reason: 'Explicit --no-worktree opt-out; the dispatch will run in the requested directory.',
    };
  }

  const cwdState = inspectPath(resolvedCwd);
  if (cwdState.exists !== true || cwdState.isDirectory !== true) {
    return emptyWorktreePlan(
      resolvedCwd,
      cwdState.exists === null
        ? `The requested cwd ${resolvedCwd} could not be inspected (${cwdState.error}).`
        : `The requested cwd ${resolvedCwd} is not an existing directory.`
    );
  }

  const rootResult = runGit(['rev-parse', '--show-toplevel'], resolvedCwd);
  if (rootResult.status !== 0 || String(rootResult.stdout).trim() === '') {
    return emptyWorktreePlan(
      resolvedCwd,
      `Could not resolve a Git repository from ${resolvedCwd} (${gitFailureDetail(rootResult)}). Refusing to dispatch without an isolated repository.`
    );
  }
  const repoRoot = path.resolve(String(rootResult.stdout).trim());
  const worktreeRoot = path.join(repoRoot, WORKTREE_ROOT_RELATIVE);
  const rootState = inspectPath(worktreeRoot);
  if (rootState.exists !== true || rootState.isDirectory !== true) {
    return {
      ...emptyWorktreePlan(
        resolvedCwd,
        rootState.exists === null
          ? `The worktree root ${worktreeRoot} could not be inspected (${rootState.error}).`
          : `The required worktree root ${worktreeRoot} is not an existing directory. Refusing to create a worktree elsewhere.`
      ),
      repoRoot,
      worktreeRoot,
    };
  }

  const headResult = runGit(['rev-parse', '--verify', 'HEAD'], repoRoot);
  const head = String(headResult.stdout).trim();
  if (headResult.status !== 0 || head === '') {
    return {
      ...emptyWorktreePlan(
        resolvedCwd,
        `Could not determine the repository HEAD from ${repoRoot} (${gitFailureDetail(headResult)}). Refusing to create an unpinned worktree.`
      ),
      repoRoot,
      worktreeRoot,
    };
  }

  // A staged change means the index is not a stable source state. Do not ask
  // git worktree to proceed and do not silently treat that state as clean.
  const indexResult = runGit(['diff', '--cached', '--quiet'], repoRoot);
  if (indexResult.status !== 0) {
    return {
      ...emptyWorktreePlan(
        resolvedCwd,
        indexResult.status === 1
          ? `The repository index at ${repoRoot} has staged changes. Refusing the dispatch rather than creating from a dirty index.`
          : `The repository index at ${repoRoot} could not be checked (${gitFailureDetail(indexResult)}). Refusing to assume it is clean.`
      ),
      repoRoot,
      worktreeRoot,
      head,
    };
  }

  const inventory = listGitWorktrees(repoRoot);
  if (!inventory.known) {
    return {
      ...emptyWorktreePlan(resolvedCwd, `${inventory.reason} Refusing to create a worktree without a collision-safe inventory.`),
      repoRoot,
      worktreeRoot,
      head,
    };
  }

  const rootIgnored = checkGitIgnored(repoRoot, worktreeRoot);
  if (rootIgnored.ignored !== true) {
    return {
      ...emptyWorktreePlan(
        resolvedCwd,
        `${rootIgnored.reason} Refusing to create a worktree where its files could appear in git status.`
      ),
      repoRoot,
      worktreeRoot,
      head,
      existingWorktreeCount: inventory.paths.length,
      existingNestedWorktreeCount: inventory.paths.filter((p) => isPathWithin(worktreeRoot, p)).length,
    };
  }

  let name;
  try {
    name = `${laneKey}-${Date.now()}-${process.pid}-${randomUUID()}`;
  } catch (err) {
    return {
      ...emptyWorktreePlan(resolvedCwd, `Could not allocate a unique worktree name (${err.message}). Refusing to reuse a name.`),
      repoRoot,
      worktreeRoot,
      head,
      ignored: true,
      existingWorktreeCount: inventory.paths.length,
      existingNestedWorktreeCount: inventory.paths.filter((p) => isPathWithin(worktreeRoot, p)).length,
    };
  }
  const worktreePath = path.join(worktreeRoot, name);

  const targetIgnored = checkGitIgnored(repoRoot, worktreePath);
  if (targetIgnored.ignored !== true) {
    return {
      ...emptyWorktreePlan(
        resolvedCwd,
        `${targetIgnored.reason} Refusing to create the candidate worktree path.`
      ),
      repoRoot,
      worktreeRoot,
      path: worktreePath,
      effectiveCwd: worktreePath,
      head,
      ignored: targetIgnored.ignored,
      existingWorktreeCount: inventory.paths.length,
      existingNestedWorktreeCount: inventory.paths.filter((p) => isPathWithin(worktreeRoot, p)).length,
    };
  }

  const targetState = inspectPath(worktreePath);
  if (targetState.exists !== false) {
    return {
      ...emptyWorktreePlan(
        resolvedCwd,
        targetState.exists === null
          ? `The candidate worktree path ${worktreePath} could not be inspected (${targetState.error}). Refusing to assume it is unused.`
          : `The candidate worktree path ${worktreePath} already exists. Refusing a name collision; no existing worktree will be reused.`
      ),
      repoRoot,
      worktreeRoot,
      path: worktreePath,
      effectiveCwd: worktreePath,
      head,
      ignored: true,
      existingWorktreeCount: inventory.paths.length,
      existingNestedWorktreeCount: inventory.paths.filter((p) => isPathWithin(worktreeRoot, p)).length,
    };
  }
  if (inventory.paths.some((p) => samePath(p, worktreePath))) {
    return {
      ...emptyWorktreePlan(
        resolvedCwd,
        `git worktree list already contains ${worktreePath}. Refusing a name collision; no existing worktree will be reused.`
      ),
      repoRoot,
      worktreeRoot,
      path: worktreePath,
      effectiveCwd: worktreePath,
      head,
      ignored: true,
      existingWorktreeCount: inventory.paths.length,
      existingNestedWorktreeCount: inventory.paths.filter((p) => isPathWithin(worktreeRoot, p)).length,
    };
  }

  return {
    ok: true,
    mode: 'isolated',
    requestedCwd: resolvedCwd,
    effectiveCwd: worktreePath,
    repoRoot,
    worktreeRoot,
    path: worktreePath,
    head,
    ignored: true,
    existingWorktreeCount: inventory.paths.length,
    existingNestedWorktreeCount: inventory.paths.filter((p) => isPathWithin(worktreeRoot, p)).length,
    created: false,
    prepared: false,
    preparation: null,
    reason: null,
  };
}

function readWorktreeStatus(worktreePath, repoRoot) {
  const result = runGit(['-C', worktreePath, 'status', '--short'], repoRoot);
  if (result.status !== 0) {
    return {
      known: false,
      changed: null,
      short: null,
      reason: `git -C ${worktreePath} status --short could not be read (${gitFailureDetail(result)}).`,
    };
  }
  const short = String(result.stdout).replace(/\r\n/g, '\n').replace(/\r/g, '\n').trimEnd();
  return { known: true, changed: short !== '', short, reason: null };
}

function statusSummary(short) {
  if (typeof short !== 'string' || short === '') return '(clean)';
  return short.split('\n').filter((line) => line !== '').join(' | ');
}

function createWorktree(plan) {
  const result = runGit(['worktree', 'add', '--detach', plan.path, plan.head], plan.repoRoot);
  if (result.status !== 0) {
    const pathState = inspectPath(plan.path);
    return {
      ok: false,
      reason: `git worktree add failed (${gitFailureDetail(result)}). Refusing the dispatch and never falling back to ${plan.requestedCwd}.`,
      pathState,
    };
  }

  plan.created = true;

  const headResult = runGit(['-C', plan.path, 'rev-parse', '--verify', 'HEAD'], plan.repoRoot);
  const createdHead = String(headResult.stdout).trim();
  if (headResult.status !== 0 || createdHead === '') {
    return {
      ok: false,
      reason: `The new worktree's HEAD could not be verified (${gitFailureDetail(headResult)}). It will be kept for inspection; no main-tree fallback is allowed.`,
    };
  }
  if (createdHead.toLowerCase() !== plan.head.toLowerCase()) {
    return {
      ok: false,
      reason: `The new worktree resolved HEAD ${createdHead}, not the planned current HEAD ${plan.head}. It will be kept; no dispatch ran.`,
    };
  }

  const baseline = readWorktreeStatus(plan.path, plan.repoRoot);
  if (!baseline.known) {
    return { ok: false, reason: `The new worktree could not be proven clean before dispatch (${baseline.reason}). It will be kept; no dispatch ran.` };
  }
  if (baseline.changed) {
    return {
      ok: false,
      reason: `The new worktree was not clean immediately after creation (${statusSummary(baseline.short)}). It will be kept; no dispatch ran.`,
    };
  }
  return { ok: true, reason: null };
}

function cleanupNodeModules(plan) {
  const startedAt = Date.now();
  const target = path.join(plan.path, WORKTREE_DEPENDENCIES_RELATIVE);
  const base = {
    target,
    attempted: false,
    known: false,
    removed: false,
    alreadyAbsent: false,
    bytesFreed: null,
    elapsedMs: null,
    reason: null,
  };
  const fail = (reason) => ({ ...base, elapsedMs: Date.now() - startedAt, reason });

  if (!isPathWithin(plan.path, target) || path.basename(target) !== WORKTREE_DEPENDENCIES_RELATIVE) {
    return fail(`Refusing dependency cleanup because the target ${target} is not a child of the created worktree.`);
  }

  const state = inspectPath(target);
  if (state.exists === null) return fail(`The dependency directory ${target} could not be inspected (${state.error}).`);
  if (state.exists === false) {
    return {
      ...base,
      attempted: true,
      known: true,
      removed: false,
      alreadyAbsent: true,
      bytesFreed: 0,
      elapsedMs: Date.now() - startedAt,
      reason: 'node_modules was already absent.',
    };
  }
  if (state.isDirectory !== true) return fail(`${target} exists but is not a directory; it was not removed.`);

  // The dependency tree is expected to be disposable, but never delete it if
  // this repository actually tracks files there. That would turn cleanup into
  // data loss for a repository whose layout differs from the usual npm one.
  const tracked = runGit(['-C', plan.path, 'ls-files', '--', WORKTREE_DEPENDENCIES_RELATIVE], plan.repoRoot);
  if (tracked.status !== 0) return fail(`Could not determine whether ${target} contains tracked files (${gitFailureDetail(tracked)}).`);
  if (String(tracked.stdout).trim() !== '') return fail(`${target} contains tracked files; dependency cleanup was refused to preserve uncommitted work.`);

  const size = measureDirectoryBytes(target);
  if (!size.known) return fail(size.reason);
  base.bytesFreed = size.bytes;
  base.attempted = true;
  try {
    fs.rmSync(target, { recursive: true, force: true });
  } catch (err) {
    return fail(`Removing ${target} failed (${err.message}); the dependency tree was retained.`);
  }

  const after = inspectPath(target);
  if (after.exists === null) return fail(`The dependency cleanup ran, but ${target} could not be rechecked (${after.error}).`);
  if (after.exists === true) return fail(`The dependency cleanup ran, but ${target} still exists; removal is UNKNOWN.`);
  return {
    ...base,
    known: true,
    removed: true,
    elapsedMs: Date.now() - startedAt,
    reason: `Removed node_modules after measuring ${formatByteSize(size.bytes)}.`,
  };
}

function finishWorktree(plan) {
  if (plan.mode !== 'isolated') {
    return {
      state: 'not-applicable',
      known: true,
      removed: false,
      dependenciesRemoved: false,
      dependencyCleanup: null,
      statusShort: null,
      summary: 'No worktree was requested (--no-worktree).',
      reason: null,
    };
  }
  if (plan.created !== true) {
    return {
      state: 'not-created',
      known: true,
      removed: false,
      dependenciesRemoved: false,
      dependencyCleanup: null,
      statusShort: null,
      summary: 'No worktree was created.',
      reason: plan.reason || 'Worktree creation did not complete.',
    };
  }
  if (plan.prepared !== true) {
    return {
      state: 'not-prepared-kept',
      known: false,
      removed: false,
      dependenciesRemoved: false,
      dependencyCleanup: null,
      statusShort: null,
      summary: 'Preparation did not complete; worktree retained.',
      reason: 'The worktree was not cleaned because dependency/build preparation did not complete.',
    };
  }

  const status = readWorktreeStatus(plan.path, plan.repoRoot);
  if (!status.known) {
    return {
      state: 'unknown-kept',
      known: false,
      removed: false,
      dependenciesRemoved: false,
      dependencyCleanup: null,
      statusShort: null,
      summary: 'UNKNOWN — worktree retained for safety.',
      reason: status.reason,
    };
  }
  if (status.changed) {
    const dependencyCleanup = cleanupNodeModules(plan);
    return {
      state: dependencyCleanup.known ? 'kept-changes-dependencies-removed' : 'kept-changes-dependency-cleanup-unknown',
      known: dependencyCleanup.known,
      removed: false,
      dependenciesRemoved: dependencyCleanup.removed,
      dependencyCleanup,
      statusShort: status.short,
      summary: statusSummary(status.short),
      reason: dependencyCleanup.known
        ? `Changes detected by git -C ${plan.path} status --short; node_modules was removed and the caller must harvest this worktree.`
        : `Changes detected by git -C ${plan.path} status --short, but dependency cleanup is UNKNOWN; the worktree was retained. ${dependencyCleanup.reason}`,
    };
  }

  // There is no user work to preserve, so the whole unchanged worktree can be
  // removed. Remove node_modules first so the output records the explicit
  // space-reclamation decision and a failed/unknown cleanup never gets hidden
  // behind a successful-looking worktree removal.
  const dependencyCleanup = cleanupNodeModules(plan);
  if (!dependencyCleanup.known) {
    return {
      state: 'cleanup-unknown-kept',
      known: false,
      removed: false,
      dependenciesRemoved: dependencyCleanup.removed,
      dependencyCleanup,
      statusShort: status.short,
      summary: 'CLEAN STATUS, BUT dependency cleanup is UNKNOWN — worktree retained.',
      reason: dependencyCleanup.reason,
    };
  }
  const remove = runGit(['worktree', 'remove', '--force', plan.path], plan.repoRoot);
  if (remove.status !== 0) {
    return {
      state: 'cleanup-unknown-kept',
      known: false,
      removed: false,
      dependenciesRemoved: dependencyCleanup.removed,
      dependencyCleanup,
      statusShort: '',
      summary: 'CLEAN STATUS, BUT worktree removal failed — worktree retained.',
      reason: `git worktree remove failed (${gitFailureDetail(remove)}). The worktree was not assumed removed.`,
    };
  }

  const pathAfterRemove = inspectPath(plan.path);
  if (pathAfterRemove.exists === null) {
    return {
      state: 'cleanup-unknown-kept',
      known: false,
      removed: false,
      dependenciesRemoved: dependencyCleanup.removed,
      dependencyCleanup,
      statusShort: '',
      summary: 'CLEAN STATUS, BUT worktree removal cannot be verified.',
      reason: `git worktree remove exited 0, but ${plan.path} could not be inspected (${pathAfterRemove.error}).`,
    };
  }
  if (pathAfterRemove.exists === true) {
    return {
      state: 'cleanup-unknown-kept',
      known: false,
      removed: false,
      dependenciesRemoved: dependencyCleanup.removed,
      dependencyCleanup,
      statusShort: '',
      summary: 'CLEAN STATUS, BUT worktree path still exists — retained.',
      reason: `git worktree remove exited 0, but ${plan.path} still exists.`,
    };
  }
  const inventory = listGitWorktrees(plan.repoRoot);
  if (!inventory.known) {
    return {
      state: 'cleanup-unknown-kept',
      known: false,
      removed: false,
      dependenciesRemoved: dependencyCleanup.removed,
      dependencyCleanup,
      statusShort: '',
      summary: 'CLEAN STATUS, BUT worktree registration cannot be verified.',
      reason: `git worktree remove exited 0 and the path is gone, but the remaining worktree inventory is UNKNOWN (${inventory.reason}).`,
    };
  }
  if (inventory.paths.some((p) => samePath(p, plan.path))) {
    return {
      state: 'cleanup-unknown-kept',
      known: false,
      removed: false,
      dependenciesRemoved: dependencyCleanup.removed,
      dependencyCleanup,
      statusShort: '',
      summary: 'CLEAN STATUS, BUT worktree remains registered — cleanup UNKNOWN.',
      reason: `git worktree remove exited 0 and the path is gone, but git worktree list still reports ${plan.path}.`,
    };
  }
  return {
    state: 'removed-unchanged',
    known: true,
    removed: true,
    dependenciesRemoved: dependencyCleanup.removed,
    dependencyCleanup,
    statusShort: '',
    summary: '(clean)',
    reason: 'The worktree was unchanged, node_modules was removed, and the worktree removal was verified.',
  };
}

function worktreeInfo(plan, lifecycle) {
  return {
    mode: plan.mode,
    path: plan.path,
    requestedCwd: plan.requestedCwd,
    dispatchCwd: plan.effectiveCwd,
    repositoryRoot: plan.repoRoot,
    worktreeRoot: plan.worktreeRoot,
    sourceHead: plan.head,
    gitIgnoreVerified: plan.ignored,
    preExistingWorktreeCount: plan.existingWorktreeCount,
    preExistingNestedWorktreeCount: plan.existingNestedWorktreeCount,
    created: plan.created === true,
    prepared: plan.prepared === true,
    preparation: plan.preparation,
    savePath: plan.savePath === undefined ? null : plan.savePath,
    lifecycle,
    reason: plan.reason || null,
  };
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

  if (lane.cli === 'omp') {
    // `omp models --json` reads the local catalogue (~1.0 s, measured
    // 2026-08-25) and lists only the providers this install can actually reach.
    // That separates the two states cleanly: NOT INSTALLED is already handled
    // above by transport resolution, and INSTALLED BUT UNAUTHENTICATED shows up
    // here as a binary that runs and returns an empty catalogue.
    const res = run(['models', '--json']);
    if (!res.ok || res.timedOut) {
      probe.available = null;
      probe.state = res.timedOut ? 'probe-timeout' : 'probe-failed';
      probe.reason = `\`omp models --json\` did not complete (${res.errorMessage || 'timed out'}), so this lane is UNKNOWN — not assumed usable.`;
      return probe;
    }

    const combined = stripAnsi(`${res.stdout}\n${res.stderr}`);
    let catalogue = null;
    try {
      const parsed = JSON.parse(stripAnsi(res.stdout).replace(/^\uFEFF/, ''));
      if (parsed !== null && typeof parsed === 'object' && Array.isArray(parsed.models)) catalogue = parsed.models;
    } catch (_) {
      catalogue = null;
    }

    if (res.status !== 0 || catalogue === null) {
      if (/\b(log ?in|sign ?in|unauthenticated|unauthorized|not authenticated|no api key|api key)\b/i.test(combined)) {
        probe.available = false;
        probe.state = 'unauthenticated';
        probe.reason = '`omp models --json` reported an authentication problem. Sign in with `omp auth-broker login <provider>`, or set that provider\'s API key environment variable.';
        probe.evidence = firstLines(combined, 3);
        return probe;
      }
      probe.available = null;
      probe.state = 'probe-failed';
      probe.reason = `\`omp models --json\` exited ${res.status} and did not return a parseable {"models":[…]} catalogue, so this lane is UNKNOWN.`;
      probe.evidence = firstLines(combined, 3);
      return probe;
    }

    // Both spellings `--model` accepts as an exact name: the provider/model
    // selector and the bare model id. Shape measured 2026-08-25:
    //   {"models":[{"provider":"minimax-code","id":"MiniMax-M3",
    //               "selector":"minimax-code/MiniMax-M3", …}]}
    const slugs = [];
    for (const m of catalogue) {
      if (m === null || typeof m !== 'object') continue;
      if (typeof m.selector === 'string' && m.selector !== '') slugs.push(m.selector);
      if (typeof m.id === 'string' && m.id !== '') slugs.push(m.id);
    }
    probe.modelCatalogue = slugs;
    probe.evidence = `omp models --json listed ${catalogue.length} model(s)`;

    if (catalogue.length === 0) {
      probe.available = false;
      probe.state = 'unauthenticated';
      probe.reason =
        'omp is installed and runs, but `omp models --json` returned an EMPTY catalogue: no provider is reachable, so nothing can be dispatched. ' +
        'Sign in with `omp auth-broker login <provider>`, or set that provider\'s API key environment variable, then re-probe.';
      return probe;
    }

    // omp's `--model` is a FUZZY match ("opus", "gpt-5.2", or an explicit
    // provider/model), so a slug it does not recognise does NOT necessarily
    // fail — it can resolve to a different model. A dispatch that silently runs
    // a model the config does not name is a policy bypass, so the configured
    // slug must be an EXACT catalogue entry. This is deliberately stricter than
    // omp itself: refusing here costs nothing, and refusing after the fact is
    // not possible.
    if (lane.requiresExactModelInCatalogue === true) {
      const configuredModel = resolveModel(laneKey, config).model;
      if (typeof configuredModel === 'string' && configuredModel.trim() !== '') {
        const wanted = configuredModel.trim().toLowerCase();
        if (!slugs.some((s) => s.toLowerCase() === wanted)) {
          const near = slugs.filter((s) => s.toLowerCase().includes(wanted) || wanted.includes(s.toLowerCase()));
          probe.available = false;
          probe.state = 'model-not-in-catalogue';
          probe.reason =
            `Lane "${laneKey}" is configured with model ${JSON.stringify(configuredModel)}, which is not an exact entry in omp's live catalogue ` +
            `(${catalogue.length} model(s) listed). omp's \`--model\` is a fuzzy match, so dispatching this would not reliably fail — it could ` +
            `resolve to a different model than the policy names, which is a policy bypass. Refusing to dispatch. ` +
            (near.length > 0
              ? `Closest catalogue entries: ${near.slice(0, 6).join(', ')}.`
              : 'Run `omp models --json` to see what this install can reach.');
          return probe;
        }
      }
    }

    probe.available = true;
    probe.state = 'ready';
    probe.reason = null;
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

// --- omp session store ------------------------------------------------------
//
// omp has NO non-interactive list command. `omp -r` with no value opens a
// PICKER (`omp --help`, 18.0.5: "Resume a session (by ID prefix, path, or
// picker if omitted)"), which a dispatch running with stdin closed can never
// answer, so there is nothing to shell out to. Reading the store directly is
// the only way to check a resume target before spending anything.
//
// Layout, read from a real session written 2026-08-25:
//   <agent dir>/sessions/<mangled cwd>/<ISO timestamp>_<uuid>.jsonl
// and the file's second record is
//   {"type":"session","version":3,"id":"<uuid>","timestamp":…,"cwd":"F:\\…"}
//
// The recorded `cwd` is read rather than the directory name, because the
// mangling ("--F--Windsurf-Terra-Invicta-AI-Summary--") is undocumented and
// reconstructing it would be a guess. The agent dir is PI_CODING_AGENT_DIR or
// ~/.omp/agent. `--session-dir` would move the store wholesale, but this script
// never passes it, so the default location is the one a dispatch would use.

function ompSessionsRoot() {
  const explicit = process.env.PI_CODING_AGENT_DIR;
  if (typeof explicit === 'string' && explicit.trim() !== '') {
    return path.join(explicit.trim(), 'sessions');
  }
  const home = process.env.USERPROFILE || os.homedir();
  if (typeof home !== 'string' || home.trim() === '') return null;
  return path.join(home, '.omp', 'agent', 'sessions');
}

/** Reads only the session_meta record, for the id and the recorded cwd. */
function ompSessionMeta(file) {
  let fd = null;
  try {
    fd = fs.openSync(file, 'r');
    const buf = Buffer.alloc(65536);
    const read = fs.readSync(fd, buf, 0, buf.length, 0);
    for (const line of buf.slice(0, read).toString('utf8').split('\n')) {
      const trimmed = line.trim();
      if (trimmed === '' || trimmed[0] !== '{') continue;
      let parsed;
      try {
        parsed = JSON.parse(trimmed);
      } catch (_) {
        continue; // the window may have cut a line in half
      }
      if (parsed !== null && typeof parsed === 'object' && parsed.type === 'session') {
        return {
          id: typeof parsed.id === 'string' && parsed.id !== '' ? parsed.id : null,
          cwd: typeof parsed.cwd === 'string' && parsed.cwd !== '' ? parsed.cwd : null,
        };
      }
    }
  } catch (_) {
    /* unreadable: absent stays null, never a stand-in id */
  } finally {
    if (fd !== null) {
      try { fs.closeSync(fd); } catch (_) { /* ignore */ }
    }
  }
  return { id: null, cwd: null };
}

/** Every recorded session, newest first. */
function listOmpSessions() {
  const root = ompSessionsRoot();
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
    if (!/\.jsonl$/i.test(name)) continue;
    const full = path.join(root, String(rel));
    let mtime = null;
    try {
      const st = fs.statSync(full);
      if (!st.isFile()) continue;
      mtime = st.mtimeMs;
    } catch (_) {
      continue;
    }
    const meta = ompSessionMeta(full);
    files.push({ path: full, mtime, id: meta.id, cwd: meta.cwd });
  }
  files.sort((a, b) => b.mtime - a.mtime);
  return { root, files, error: null };
}

function verifyOmpSession(resume, cwd) {
  const { root, files, error } = listOmpSessions();
  if (error !== null) {
    return { verified: null, reason: `The omp session store could not be read (${error}), so ${resume.label} was NOT verified.` };
  }

  if (resume.kind === 'id') {
    const wanted = resume.id.toLowerCase();
    // omp accepts an ID PREFIX as well as a full id, so a prefix matching
    // exactly one recorded session is a real hit — and a prefix matching
    // several is unknown, not a hit: this script cannot say which one omp
    // would pick, so it declines to claim the resume was checked.
    const exact = files.filter((f) => f.id !== null && f.id.toLowerCase() === wanted);
    if (exact.length > 0) {
      return { verified: true, reason: null, detail: `Matched ${path.basename(exact[0].path)}` };
    }
    const prefix = files.filter((f) => f.id !== null && f.id.toLowerCase().startsWith(wanted));
    if (prefix.length === 1) {
      return { verified: true, reason: null, detail: `Id prefix matched exactly one session: ${prefix[0].id}` };
    }
    if (prefix.length > 1) {
      return {
        verified: null,
        reason:
          `Id prefix "${resume.id}" matches ${prefix.length} recorded omp sessions (${prefix.slice(0, 4).map((f) => f.id).join(', ')}). ` +
          `omp would pick one of them and this script cannot say which, so ${resume.label} was NOT verified. Pass the full session id.`,
      };
    }
    return {
      verified: false,
      reason:
        `No omp session "${resume.id}" exists in ${root} (${files.length} recorded session(s) scanned, by full id and by id prefix). ` +
        `Not dispatching — a resume that cannot find its session must not fall back to a fresh conversation.`,
    };
  }

  // resume.kind === 'last'
  if (files.length === 0) {
    return {
      verified: false,
      reason:
        `There are no recorded omp sessions in ${root === null ? '(no session store)' : root}, so there is nothing for --continue to resume. ` +
        `Refusing to dispatch rather than starting a fresh conversation under a resume instruction.`,
    };
  }
  const match = files.find(
    (f) => f.cwd !== null && path.resolve(f.cwd).toLowerCase() === path.resolve(cwd).toLowerCase()
  );
  if (match !== undefined) {
    return { verified: true, reason: null, detail: `Newest session recorded for this directory: ${match.id || path.basename(match.path)}` };
  }
  return {
    verified: null,
    reason:
      `${files.length} omp session(s) exist, but none records a cwd matching ${cwd}. omp stores sessions per working directory, so \`--continue\` ` +
      `may find nothing here and start fresh instead. The session to be resumed was NOT verified.`,
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
  if (cli === 'omp') return verifyOmpSession(resume, cwd);

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
// Shapes differ per CLI. For most lanes they have NOT been verified against a
// live dispatch (verifying would mean spending the user's budget). The parser
// is therefore tolerant AND self-reporting: when it finds nothing it returns
// null and says so. It never reports 0 tokens for an unmeasured call.
//
// The exception is omp, whose `usage` object was read from a REAL session
// record on disk (2026-08-25) — see USAGE_NESTED_FIELDS. What that measurement
// does NOT establish is that `omp -p --mode json` prints the same object to
// stdout, which is what this parser actually reads. If a real omp dispatch
// comes back with usage: null while its stdout plainly contains counts, the
// aliases need extending — report it rather than inventing a number.
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

/**
 * Fields that some providers nest one level down.
 *
 * omp reports cost as an OBJECT, not a number. Measured 2026-08-25 from a real
 * omp session record:
 *
 *   "usage":{"input":215,"output":939,"cacheRead":107319,"cacheWrite":0,
 *            "totalTokens":108473,"reasoningTokens":22,
 *            "cost":{"input":0,"output":0,"cacheRead":0,"cacheWrite":0,"total":0}}
 *
 * toFiniteNumber correctly refuses that object rather than coercing it, so
 * without this pass the cost would read "unknown" while the number sat one
 * level down. Every token field in that shape — input / output / cacheRead /
 * cacheWrite / totalTokens / reasoningTokens — is already an alias above, so
 * nothing else about omp needed a new field name.
 */
const USAGE_NESTED_FIELDS = {
  costUsd: [['cost', 'total'], ['cost', 'total_cost'], ['cost', 'totalCost'], ['cost', 'usd']],
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

  // Second pass, only for fields the flat pass left null: a value nested one
  // level down. A field the flat pass already read is never overwritten.
  for (const [field, paths] of Object.entries(USAGE_NESTED_FIELDS)) {
    if (usage[field] !== null && usage[field] !== undefined) continue;
    for (const parts of paths) {
      let node = container;
      let reachable = true;
      for (const part of parts) {
        if (node === null || typeof node !== 'object' || !Object.prototype.hasOwnProperty.call(node, part)) {
          reachable = false;
          break;
        }
        node = node[part];
      }
      if (!reachable) continue;
      const n = toFiniteNumber(node);
      if (n === null) continue; // absent or unparseable stays null, never 0
      usage[field] = n;
      anyFound = true;
      usage.fieldsFound.push(`${containerPath}.${parts.join('.')}`);
      break;
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

function dispatch(transport, args, cwd, timeoutMs, environment = process.env) {
  return new Promise((resolve) => {
    let child;
    try {
      child = spawn(transport.command, transport.prefixArgs.concat(args), {
        cwd,
        env: environment,
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

/** How the prompt reaches the CLI, so a preview never leaves it ambiguous. */
function describePromptDelivery(command, prompt) {
  if (command.promptDelivery === 'attached-file') {
    return `ATTACHED as @${command.promptPath} (${prompt.text.length} chars). A missing @file makes omp exit 1 before it resolves the model, so the prompt cannot be silently omitted.`;
  }
  return `one argv element, ${prompt.text.length} chars from ${command.promptPath} (no shell, so nothing in it is reinterpreted)`;
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

function buildLaneReport(laneKey, config, cwd, suppliedProbe) {
  const lane = LANES[laneKey];
  const modeInfo = resolveMode(laneKey, config);
  const modelInfo = resolveModel(laneKey, config);
  const trustInfo = resolveTrustFlag(laneKey, config);
  const probe = suppliedProbe === undefined ? probeLane(laneKey, config, cwd) : suppliedProbe;
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
    modelConfigured: modelInfo.configured,
    modelSource: modelInfo.source,
    modelNote: modelInfo.note,
    modelError: modelInfo.error,
    modelPinned: lane.pinnedModel === undefined ? null : lane.pinnedModel,
    trustFlag: trustInfo.flag,
    trustFlagConfigured: trustInfo.configured,
    trustFlagSource: trustInfo.source,
    trustFlagGrant: trustInfo.grant,
    trustFlagAutoApprovesEveryCommand: trustInfo.autoApprovesEveryCommand,
    trustFlagNote: trustInfo.note,
    trustFlagError: trustInfo.error,
    trustFlagDisplay: describeTrustFlags(laneKey, trustInfo),
    trustFlagsInForce: effectiveTrustFlags(laneKey, trustInfo),
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

/**
 * Extracts only the help entries relevant to timeout or trust/approval
 * discovery. A readable help page with no matching entries is different from
 * a help command that failed or returned nothing, so callers can keep those
 * states separate instead of calling both "none found".
 */
function parseFlagHelp(helpText) {
  const clean = stripAnsi(String(helpText === null || helpText === undefined ? '' : helpText));
  if (clean.trim() === '') {
    return { readable: false, entries: [] };
  }

  const entries = new Map();
  let sawOption = false;
  for (const rawLine of clean.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (line === '') continue;

    const flags = [];
    const flagPattern = /(^|[\s,(])(-{1,2}[A-Za-z][A-Za-z0-9-]*)\b/g;
    let match = flagPattern.exec(line);
    while (match !== null) {
      if (!flags.includes(match[2])) flags.push(match[2]);
      match = flagPattern.exec(line);
    }
    if (flags.length > 0) sawOption = true;

    const categories = [];
    const lower = line.toLowerCase();
    if (/timeout|time-out|timed out/.test(lower)) categories.push('timeout');
    if (/\b(?:trust|permissions?|approvals?|approve(?:s|d)?|force|yolo)\b/.test(lower)) categories.push('trust');
    if (categories.length === 0) continue;

    for (const flag of flags) {
      const existing = entries.get(flag);
      if (existing === undefined) {
        entries.set(flag, { flag, categories: categories.slice(), helpLine: line });
      } else {
        for (const category of categories) {
          if (!existing.categories.includes(category)) existing.categories.push(category);
        }
      }
    }
  }

  return { readable: sawOption, entries: Array.from(entries.values()) };
}

function probeHelpCommand(transport, cwd) {
  const args = transport.prefixArgs.concat(['--help']);
  const result = runProbe(transport.command, args, cwd);
  const helpText = `${result.stdout || ''}\n${result.stderr || ''}`;
  const base = {
    attempted: true,
    state: null,
    readable: false,
    command: {
      file: transport.command,
      args,
      cwd,
      shell: false,
    },
    status: result.status,
    timedOut: result.timedOut,
    flags: null,
    timeoutFlags: null,
    trustFlags: null,
    evidence: firstLines(helpText, 3),
    reason: null,
  };

  if (!result.ok || result.timedOut || result.status !== 0 || helpText.trim() === '') {
    base.state = result.timedOut ? 'help-timeout' : 'help-unreadable';
    base.reason =
      `Could not read and parse ${transport.command} --help ` +
      `(${result.errorMessage || (result.status === null ? 'no exit status' : `exit ${result.status}`)}). ` +
      'Timeout-ish and trust/approval-ish flags are UNKNOWN; no absence was inferred.';
    return base;
  }

  const parsed = parseFlagHelp(helpText);
  if (!parsed.readable) {
    base.state = 'help-unreadable';
    base.reason =
      `Could not read and parse ${transport.command} --help. ` +
      'Timeout-ish and trust/approval-ish flags are UNKNOWN; no absence was inferred.';
    return base;
  }

  base.state = 'ready';
  base.readable = true;
  base.flags = parsed.entries;
  base.timeoutFlags = parsed.entries.filter((entry) => entry.categories.includes('timeout'));
  base.trustFlags = parsed.entries.filter((entry) => entry.categories.includes('trust'));
  return base;
}

function rejectedProbeForLane(laneKey, config) {
  return {
    available: false,
    state: 'rejected',
    reason: `Lane "${laneKey}" is set to "reject" in ${config.path}. The config forbids the lane; its binary was not run.`,
    evidence: null,
    binaryPath: null,
    binarySource: null,
    transport: null,
    modelCatalogue: null,
    rejectedCandidates: [],
  };
}

function probeFlagsForLane(laneKey, config, cwd) {
  const modeInfo = resolveMode(laneKey, config);
  if (modeInfo.mode === 'reject') {
    const report = buildLaneReport(laneKey, config, cwd, rejectedProbeForLane(laneKey, config));
    report.flagProbe = {
      attempted: false,
      state: 'rejected',
      readable: null,
      command: null,
      status: null,
      timedOut: null,
      flags: null,
      timeoutFlags: null,
      trustFlags: null,
      evidence: null,
      reason: report.reason,
    };
    return report;
  }

  const report = buildLaneReport(laneKey, config, cwd);
  if (report.available !== true || report.transport === null) {
    report.flagProbe = {
      attempted: false,
      state: 'not-run-unavailable',
      readable: null,
      command: null,
      status: null,
      timedOut: null,
      flags: null,
      timeoutFlags: null,
      trustFlags: null,
      evidence: report.reason,
      reason:
        `The availability probe for lane "${laneKey}" was not READY ` +
        `(state: ${report.state}); ${report.cli} --help was not run. ` +
        'Flag presence is unavailable/unknown, not "none found".',
    };
    return report;
  }

  report.flagProbe = probeHelpCommand(report.transport, cwd);
  return report;
}

function renderFlagEntries(entries) {
  if (entries === null) return 'UNKNOWN — the --help output could not be read or parsed';
  if (entries.length === 0) return '(none found in readable --help output)';
  return entries.map((entry) => `    ${entry.flag} — ${entry.helpLine}`).join('\n');
}

function renderFlagProbeReport(report) {
  const flagProbe = report.flagProbe;
  const lines = [`[${report.lane}] ${report.cli} — availability ${availabilityLabel(report.available)}, state ${report.state}`];
  if (flagProbe.state === 'rejected') {
    lines.push(`  rejected: ${flagProbe.reason}`);
    return lines.join('\n');
  }
  if (!flagProbe.attempted) {
    lines.push(`  unavailable: ${flagProbe.reason}`);
    return lines.join('\n');
  }
  lines.push(`  help: ${flagProbe.state}${flagProbe.command === null ? '' : ` — ${flagProbe.command.file} ${flagProbe.command.args.join(' ')}`}`);
  if (flagProbe.readable === true) {
    lines.push('  timeout-ish flags:');
    lines.push(renderFlagEntries(flagProbe.timeoutFlags));
    lines.push('  trust/approval-ish flags:');
    lines.push(renderFlagEntries(flagProbe.trustFlags));
  } else {
    lines.push(`  flags: ${flagProbe.reason}`);
  }
  return lines.join('\n');
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

  // ---- flag-probe-only path --------------------------------------------
  // This is deliberately separate from the dispatch path. It has no prompt,
  // never builds a dispatch command, and checks the existing availability
  // probe before it invokes any CLI with --help.
  if (opts.probeFlags) {
    const keys = opts.lane === null ? LANE_KEYS : [opts.lane];
    const lanes = keys.map((k) => probeFlagsForLane(k, config, opts.cwd));
    const payload = {
      ok: true,
      action: 'probe-flags',
      configPath: config.path,
      configFound: config.found,
      warnings: config.warnings,
      generatedAt: new Date().toISOString(),
      lanes,
    };

    if (!opts.json) {
      process.stdout.write(`Dispatch CLI flag probes — policy: ${config.path}\n\n`);
      for (const report of lanes) {
        process.stdout.write(`${renderFlagProbeReport(report)}\n\n`);
      }
      process.stdout.write('This command never dispatches. It only runs --help after a lane is READY.\n');
    }
    emit(payload, opts, EXIT.OK);
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
        if (l.modelError !== null) notes.push(`MODEL REFUSED: ${l.modelError}`);
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
        // Lane-scoped, not a global union: the payload names one lane, and the
        // set that lane accepts is the only set that could have made it valid.
        validTrustFlags: acceptedTrustFlags(LANES[opts.lane]),
        validTrustFlagsByLane: trustFlagLaneSummary(),
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

  // GATE 0.6 — a PINNED lane's model must be the pinned one. Same place in the
  // order, same exit code and same reasoning as the trust-flag gate above: a
  // malformed policy value is a config error rather than a lane problem, so it
  // is settled before the lane is probed or contacted, and it must fail
  // identically under --dry-run — a preview that quietly swapped in the pinned
  // model would show the user a command that is not the one a real run builds.
  //
  // This gate is what makes the pin a pin. Without it, `defaultModel` would only
  // fill a gap and any configured model would win, which is the inheritance this
  // whole change exists to close — just relocated from ~/.codex/config.toml to
  // the policy file.
  const earlyModel = resolveModel(opts.lane, config);
  if (earlyModel.error !== null) {
    if (!opts.json) process.stderr.write(`Config error: ${earlyModel.error}\n`);
    emit(
      {
        ok: false,
        action: 'model-not-permitted',
        lane: opts.lane,
        errors: [earlyModel.error],
        model: null,
        modelConfigured: earlyModel.configured,
        modelSource: earlyModel.source,
        modelPinned: LANES[opts.lane].pinnedModel,
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
  const resumePolicy = resumeWorktreePolicy(opts, resume);

  const payload = {
    ok: false,
    action: null,
    lane: report.lane,
    mode: report.mode,
    modeSource: report.modeSource,
    modeReason: report.modeReason,
    model: report.model,
    modelSource: report.modelSource,
    modelPinned: report.modelPinned,
    trustFlag: report.trustFlag,
    trustFlagSource: report.trustFlagSource,
    trustFlagGrant: report.trustFlagGrant,
    trustFlagAutoApprovesEveryCommand: report.trustFlagAutoApprovesEveryCommand,
    trustFlagDisplay: report.trustFlagDisplay,
    trustFlagsInForce: report.trustFlagsInForce,
    available: report.available,
    state: report.state,
    reason: report.reason,
    costClass: report.costClass,
    costNote: report.costNote,
    risk: report.risk,
    fastSlug: report.fastSlug,
    promptFile: prompt.resolvedPath,
    promptChars: prompt.text.length,
    requestedCwd: path.resolve(opts.cwd),
    noWorktree: opts.noWorktree,
    worktreePath: null,
    savePath: null,
    worktree: null,
    worktreePreparation: null,
    worktreeLifecycle: null,
    resume: {
      kind: resume.kind,
      id: resume.id,
      label: resume.label,
      worktreePolicy: resumePolicy,
      verified: null,
      verifiedReason: null,
      detail: null,
    },
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

  // A resumed provider session belongs to the directory in which it started.
  // Creating a fresh worktree here would be a silent cwd change; reusing one
  // would touch another process's uncommitted work. Make the safe choice
  // explicit and leave the --no-worktree escape for a caller that has located
  // the old worktree and can name it with --cwd.
  if (resume.kind !== 'none' && !opts.noWorktree) {
    const refusedPlan = emptyWorktreePlan(path.resolve(opts.cwd), resumePolicy);
    payload.action = 'resume-worktree-refused';
    payload.reason = `${resumePolicy} Nothing was executed.`;
    payload.resume.verifiedReason = 'Session verification was skipped because isolated resume is refused.';
    payload.worktree = worktreeInfo(refusedPlan, {
      state: 'not-created',
      known: true,
      removed: false,
      statusShort: null,
      summary: 'No worktree was created.',
      reason: payload.reason,
    });
    if (!opts.json) {
      process.stderr.write(`RESUME REFUSED — ${payload.reason}\n`);
      process.stderr.write('  Use --no-worktree --cwd <the prior worktree> after inspecting git worktree list.\n');
    }
    emit(payload, opts, EXIT.USAGE_ERROR);
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
    worktreePolicy: resumePolicy,
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

  // Plan the destination after all non-spending gates. Planning is read-only;
  // the actual `git worktree add` waits until after the dry-run and approval
  // gates below. The effective cwd is the worktree root, and is passed to both
  // spawn() and any lane builder (notably omp's explicit --cwd flag).
  const worktreePlan = planWorktree(opts.lane, opts.cwd, opts.noWorktree);
  const savePath = worktreePlan.mode === 'isolated' ? resolveDispatchSavePath() : null;
  worktreePlan.savePath = savePath;
  payload.savePath = savePath;
  if (savePath !== null && savePath.reason !== null) payload.warnings.push(`Save-path handoff: ${savePath.reason}`);
  payload.worktreePath = worktreePlan.path;
  payload.worktree = worktreeInfo(
    worktreePlan,
    worktreePlan.ok
      ? {
          state: 'planned',
          known: true,
          removed: false,
          statusShort: null,
          summary: worktreePlan.mode === 'isolated'
            ? 'Fresh worktree planned; no worktree has been created yet.'
            : 'No worktree will be created (--no-worktree).',
          reason: null,
        }
      : {
          state: 'refused-before-creation',
          known: false,
          removed: false,
          statusShort: null,
          summary: 'Worktree creation was refused; no fallback cwd is allowed.',
          reason: worktreePlan.reason,
        }
  );

  if (!worktreePlan.ok) {
    payload.action = 'worktree-refused';
    payload.reason = `Refusing to dispatch: ${worktreePlan.reason}`;
    if (!opts.json) {
      process.stderr.write(`WORKTREE REFUSED — ${payload.reason}\n`);
      process.stderr.write('  No fallback to the main/requested working tree was attempted.\n');
    }
    emit(payload, opts, EXIT.DISPATCH_FAILED);
  }
  const dispatchCwd = worktreePlan.effectiveCwd;

  // codex writes its final message to a file, which is far more reliable than
  // scraping stdout. Only lanes that support it get one.
  const outputFile = lane.wantsOutputFile === true
    ? path.join(os.tmpdir(), `dispatch-${opts.lane}-${Date.now()}-${process.pid}.txt`)
    : null;
  payload.outputFile = outputFile;

  // Build the command. No shell is involved either way. Most lanes take the
  // prompt as one argv element; omp takes it as an ATTACHED FILE (`@<path>`),
  // so promptArgIndex is null there rather than a bogus index — absent stays
  // absent, and args.indexOf() returning -1 must not be reported as a position.
  let args;
  try {
    args = lane.buildArgs({
      model: report.model,
      prompt: prompt.text,
      promptPath: prompt.resolvedPath,
      resume,
      outputFile,
      trustFlag: report.trustFlag,
      cwd: dispatchCwd,
      timeoutMs: opts.timeoutMs,
    });
  } catch (err) {
    const message = `Lane "${opts.lane}" could not build a command: ${err && err.message ? err.message : String(err)}`;
    payload.action = 'command-unbuildable';
    payload.reason = message;
    payload.errors = [message];
    complain(`DISPATCH NOT BUILT: ${message}`);
    emit(payload, opts, EXIT.USAGE_ERROR);
  }

  const promptArgIndex = args.indexOf(prompt.text);
  payload.command = {
    file: report.transport.command,
    args: report.transport.prefixArgs.concat(args),
    promptArgIndex: promptArgIndex === -1 ? null : report.transport.prefixArgs.length + promptArgIndex,
    promptDelivery: lane.promptDelivery === 'attached-file' ? 'attached-file' : 'argv-element',
    promptPath: prompt.resolvedPath,
    transport: report.transport.kind,
    shell: false,
    stdin: 'closed (portable equivalent of < /dev/null)',
    cwd: dispatchCwd,
    environmentOverrides: savePath === null
      ? null
      : {
          TI_SAVE_PATH: savePath.passedToChild === true ? savePath.path : null,
          configCopied: false,
          note: 'Only TI_SAVE_PATH is derived from the main config; the local config.json and all other config keys remain out of the worktree.',
        },
  };
  payload.commandDisplay = renderCommand(report.transport, args, prompt.text, prompt.resolvedPath);

  // GATE 2 — dry run. Never executes, whatever the mode says.
  if (opts.dryRun) {
    payload.ok = true;
    payload.action = 'dry-run';
    payload.wouldExecute = report.mode === 'auto' || opts.approve;
    payload.worktree.lifecycle = {
      state: 'not-created-dry-run',
      known: true,
      removed: false,
      statusShort: null,
      summary: worktreePlan.mode === 'isolated'
        ? 'No worktree was created; dry-run never creates one.'
        : 'No worktree was created (--no-worktree).',
      reason: null,
    };
    payload.worktreeLifecycle = payload.worktree.lifecycle;
    say(`DRY RUN — nothing was executed.`);
    say(`  lane      ${opts.lane} (${report.label})`);
    say(`  mode      ${report.mode}  [${report.modeSource}]`);
    if (worktreePlan.mode === 'isolated') {
      say(`  WORKTREE  NOT CREATED (dry-run) — would create fresh from HEAD ${worktreePlan.head}: ${worktreePlan.path}`);
      say(`  git-ignore VERIFIED — ${worktreePlan.worktreeRoot}`);
      say(`  pre-existing worktrees left untouched: ${worktreePlan.existingWorktreeCount} registered (${worktreePlan.existingNestedWorktreeCount} under ${worktreePlan.worktreeRoot})`);
    } else {
      say(`  WORKTREE  DISABLED (--no-worktree) — no worktree will be created; cwd ${worktreePlan.effectiveCwd}`);
    }
    say(`  dispatch cwd / --cwd: ${worktreePlan.effectiveCwd}`);
    say(`  ${savePathHumanLine(savePath, 'would pass')} (dry-run: no environment was changed)`);
    // The model is shown on its own line, not left to be spotted inside the
    // argv dump. This lane's defect was an unnamed model, and a preview that
    // only implies which model runs is how that went unnoticed for so long.
    say(`  model     ${report.model === null ? '(none passed — the CLI uses its own configured default)' : report.model}  [${report.modelSource}]${report.modelPinned === null ? '' : ` — PINNED, no other model is accepted on this lane`}`);
    say(`  session   ${describeResume(payload.resume)}`);
    say(`  cost      ${report.costClass} — ${report.costNote}`);
    if (report.risk !== null) say(`  RISK      ${report.risk}`);
    if (report.trustFlagDisplay !== null) say(`  TRUST     ${report.trustFlagDisplay}`);
    say(`  prompt    ${describePromptDelivery(payload.command, prompt)}`);
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
    complain(`  model: ${report.model === null ? '(none passed — the CLI uses its own configured default)' : report.model}${report.modelPinned === null ? '' : ' (PINNED)'}`);
    complain(`  session: ${describeResume(payload.resume)}`);
    complain(`  cost: ${report.costClass} — ${report.costNote}`);
    if (report.risk !== null) complain(`  RISK: ${report.risk}`);
    if (report.trustFlagDisplay !== null) complain(`  TRUST: ${report.trustFlagDisplay}`);
    if (worktreePlan.mode === 'isolated') {
      complain(`  WORKTREE: would create fresh from HEAD ${worktreePlan.head} at ${worktreePlan.path}; nothing created pending approval.`);
      complain(`  git-ignore: VERIFIED — ${worktreePlan.worktreeRoot}`);
      complain(`  pre-existing worktrees left untouched: ${worktreePlan.existingWorktreeCount} registered (${worktreePlan.existingNestedWorktreeCount} under ${worktreePlan.worktreeRoot})`);
    } else {
      complain(`  WORKTREE: DISABLED (--no-worktree); no worktree will be created; cwd ${worktreePlan.effectiveCwd}`);
    }
    complain(`  dispatch cwd / --cwd: ${worktreePlan.effectiveCwd}`);
    complain(`  ${savePathHumanLine(savePath, 'would pass')}`);
    complain(`  prompt: ${describePromptDelivery(payload.command, prompt)}`);
    complain(`  command that would run:`);
    complain(`    ${payload.commandDisplay}`);
    complain(`  After the user says yes, re-run the same command with --approve.`);
    emit(payload, opts, EXIT.APPROVAL_REQUIRED);
  }

  // GATE 4 — create and prepare the isolated checkout only now. Ask and
  // dry-run paths above never reach this block. A failed add, post-add
  // verification, dependency install, or build is a hard refusal; the
  // requested cwd is never used as a fallback.
  if (worktreePlan.mode === 'isolated') {
    const creation = createWorktree(worktreePlan);
    if (!creation.ok) {
      worktreePlan.reason = creation.reason;
      const lifecycle = {
        state: worktreePlan.created ? 'creation-failed-kept' : 'creation-failed',
        known: false,
        removed: false,
        statusShort: null,
        summary: worktreePlan.created
          ? 'Worktree creation/verification failed; the path was retained for inspection.'
          : 'Worktree creation did not complete; no path was assumed safe to remove.',
        reason: creation.reason,
      };
      payload.action = 'worktree-creation-failed';
      payload.reason = `Refusing to dispatch: ${creation.reason}`;
      payload.worktree = worktreeInfo(worktreePlan, lifecycle);
      payload.worktreeLifecycle = lifecycle;
      if (!opts.json) {
        process.stderr.write(`WORKTREE CREATION FAILED — ${payload.reason}\n`);
        process.stderr.write(`  candidate path: ${worktreePlan.path}\n`);
        process.stderr.write('  No fallback to the main/requested working tree was attempted.\n');
        if (worktreePlan.created) process.stderr.write('  The partially-created worktree was kept; inspect it before any cleanup.\n');
      }
      emit(payload, opts, EXIT.DISPATCH_FAILED);
    }
    payload.worktree = worktreeInfo(worktreePlan, {
      state: 'created',
      known: true,
      removed: false,
      statusShort: '',
      summary: 'Fresh worktree created and verified at the planned HEAD.',
      reason: null,
    });
    say(`WORKTREE CREATED: ${worktreePlan.path}`);
    say(`  source HEAD: ${worktreePlan.head}`);
    say(`  git-ignore VERIFIED: ${worktreePlan.worktreeRoot}`);
    say(`  dispatch cwd / --cwd: ${worktreePlan.effectiveCwd}`);
    say(`  pre-existing worktrees left untouched: ${worktreePlan.existingWorktreeCount} registered (${worktreePlan.existingNestedWorktreeCount} under ${worktreePlan.worktreeRoot})`);
    say(`PREPARING WORKTREE: installing dependencies and building the suite entrypoint...`);
    const preparationResult = prepareWorktree(worktreePlan);
    payload.worktreePreparation = preparationResult.preparation;
    if (!preparationResult.ok) {
      worktreePlan.reason = preparationResult.reason;
      const lifecycle = {
        state: preparationResult.known ? 'preparation-failed-kept' : 'preparation-unknown-kept',
        known: true,
        removed: false,
        dependenciesRemoved: false,
        dependencyCleanup: null,
        statusShort: null,
        summary: 'Dependency/build preparation did not complete; worktree retained for diagnosis.',
        reason: preparationResult.reason,
      };
      payload.action = 'worktree-preparation-failed';
      payload.reason = `Refusing to dispatch: ${preparationResult.reason}`;
      payload.worktree = worktreeInfo(worktreePlan, lifecycle);
      payload.worktreeLifecycle = lifecycle;
      if (!opts.json) {
        process.stderr.write(`WORKTREE PREPARATION FAILED — ${payload.reason}\n`);
        for (const line of preparationHumanLines(preparationResult.preparation)) process.stderr.write(`  ${line}\n`);
        process.stderr.write(`  WORKTREE KEPT for diagnosis: ${worktreePlan.path}\n`);
        process.stderr.write('  Nothing was dispatched and no cleanup was attempted.\n');
      }
      emit(payload, opts, EXIT.DISPATCH_FAILED);
    }
    payload.worktree = worktreeInfo(worktreePlan, {
      state: 'prepared',
      known: true,
      removed: false,
      dependenciesRemoved: false,
      dependencyCleanup: null,
      statusShort: '',
      summary: 'Dependencies installed and the required build artifact was verified.',
      reason: null,
    });
    payload.worktreeLifecycle = payload.worktree.lifecycle;
    say(`WORKTREE PREPARED: ${worktreePlan.path}`);
    for (const line of preparationHumanLines(preparationResult.preparation)) say(`  ${line}`);
  } else {
    worktreePlan.preparation = {
      state: 'not-applicable',
      ok: null,
      known: true,
      installMethod: null,
      lockfile: null,
      install: null,
      build: null,
      nodeModulesPath: null,
      nodeModulesPresent: null,
      nodeModulesBytes: null,
      nodeModulesSize: null,
      bundlePath: null,
      bundleVerified: null,
      savePath,
      totalElapsedMs: 0,
      reason: 'Explicit --no-worktree opt-out; dependency/build preparation is skipped.',
    };
    payload.worktreePreparation = worktreePlan.preparation;
    payload.worktree = worktreeInfo(worktreePlan, payload.worktree.lifecycle);
    payload.worktreeLifecycle = payload.worktree.lifecycle;
    say(`WORKTREE DISABLED (--no-worktree): no worktree created; dispatch cwd ${worktreePlan.effectiveCwd}`);
    say('  dependency/build preparation skipped');
  }

  // Execute.
  payload.approvalUsed = opts.approve && report.mode === 'ask';
  say(`Dispatching to ${opts.lane} (${report.label}) — mode ${report.mode}${payload.approvalUsed ? ', approved for this request' : ''}...`);
  const started = Date.now();
  const result = await dispatch(
    report.transport,
    args,
    dispatchCwd,
    opts.timeoutMs,
    savePath === null ? process.env : buildDispatchEnvironment(savePath)
  );
  const elapsedMs = Date.now() - started;

  payload.action = 'dispatched';
  payload.elapsedMs = elapsedMs;
  payload.exitStatus = result.status;
  payload.timedOut = result.timedOut;
  payload.stdout = result.stdout;
  payload.stderr = result.stderr;

  if (!result.spawned) {
    payload.reason = `Lane "${opts.lane}" failed to start: ${result.error}`;
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

  const lifecycle = finishWorktree(worktreePlan);
  payload.worktree = worktreeInfo(worktreePlan, lifecycle);
  payload.worktreeLifecycle = lifecycle;

  if (result.spawned && result.timedOut) {
    payload.reason = `Lane "${opts.lane}" timed out after ${elapsedMs} ms.`;
  } else if (result.spawned && result.status !== 0) {
    payload.reason = `Lane "${opts.lane}" exited with status ${result.status}.`;
  }
  if (lifecycle.known !== true) {
    const lifecycleReason = `Worktree lifecycle is UNKNOWN and the worktree was retained: ${lifecycle.reason}`;
    payload.reason = payload.reason === null ? lifecycleReason : `${payload.reason} ${lifecycleReason}`;
  }

  // A successful lane with changes is still a successful dispatch: the
  // changed worktree is the caller's harvestable result. An unknown lifecycle,
  // however, is never treated as a clean removal.
  payload.ok = result.spawned && result.status === 0 && !result.timedOut && lifecycle.known === true;

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

    if (worktreePlan.mode === 'isolated') {
      if (lifecycle.state === 'removed-unchanged') {
        const cleanupLine = dependencyCleanupHumanLine(lifecycle.dependencyCleanup);
        if (cleanupLine !== null) say(cleanupLine);
        say(`WORKTREE REMOVED — unchanged: ${worktreePlan.path}`);
      } else if (lifecycle.state.startsWith('kept-changes')) {
        say(`WORKTREE KEPT — CHANGES DETECTED: ${worktreePlan.path}`);
        say(`  git -C ${worktreePlan.path} status --short: ${lifecycle.summary}`);
        const cleanupLine = dependencyCleanupHumanLine(lifecycle.dependencyCleanup);
        if (cleanupLine !== null) {
          if (lifecycle.dependencyCleanup.known) say(`  ${cleanupLine}`);
          else complain(`  ${cleanupLine}`);
        }
        say('  Harvest this worktree manually; nothing was merged, rebased, or copied back.');
      } else {
        complain(`WORKTREE LIFECYCLE UNKNOWN — retained for safety: ${worktreePlan.path}`);
        complain(`  ${lifecycle.reason}`);
        const cleanupLine = dependencyCleanupHumanLine(lifecycle.dependencyCleanup);
        if (cleanupLine !== null) complain(`  ${cleanupLine}`);
      }
    } else {
      say(`WORKTREE DISABLED (--no-worktree) — no lifecycle cleanup; cwd was ${worktreePlan.effectiveCwd}`);
    }
  }

  emit(payload, opts, payload.ok ? EXIT.OK : EXIT.DISPATCH_FAILED);
}

main().catch((err) => {
  process.stderr.write(`check_lanes.js crashed: ${err && err.stack ? err.stack : err}\n`);
  process.exit(EXIT.USAGE_ERROR);
});
