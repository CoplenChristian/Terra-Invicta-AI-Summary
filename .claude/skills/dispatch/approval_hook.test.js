#!/usr/bin/env node
'use strict';

/*
 * approval_hook.test.js — the nine proofs from HOOK-DESIGN.md, plus supplements.
 *
 * Run:  node .claude/skills/dispatch/approval_hook.test.js
 *
 * Every case drives the hook the way the harness does: a PreToolUse payload on
 * stdin, a decision on stdout, an exit code. There is no way to trigger a real
 * approval dialog from here and this does not try — it asserts on the emitted
 * JSON, which is the entire contract the harness reads.
 *
 * Policy is supplied per-case through the hook's own `--config` argv, so no test
 * ever writes the user's dispatch-config.json. The harness passes no argv, so
 * that flag is inert in production.
 */

const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');

const HOOK = path.resolve(__dirname, 'approval_hook.js');
const LIVE_CONFIG = path.resolve(__dirname, 'dispatch-config.json');

const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'dispatch-hook-test-'));

// A policy with one lane at every mode, so each branch is reachable without
// touching the user's file. These modes are chosen to exercise the hook and say
// nothing about the user's real policy: codex sits at `reject` here because that
// is the hardest path to get right, not because it is or should be set that way
// in dispatch-config.json. Nothing in this file asserts what the user's policy
// ought to be — that file is theirs.
const FIXTURE_CONFIG = path.join(TMP, 'fixture-config.json');
fs.writeFileSync(
  FIXTURE_CONFIG,
  JSON.stringify(
    {
      version: 1,
      lanes: {
        minimax: { mode: 'auto', model: 'minimax-code/MiniMax-M3' },
        deepseek: { mode: 'ask', model: 'opencode-go/deepseek-v4-flash' },
        antigravity: { mode: 'ask' },
        composer: { mode: 'auto', model: 'composer-2.5' },
        grok: { mode: 'ask', model: 'cursor-grok-4.6-high' },
        codex: { mode: 'reject' },
      },
    },
    null,
    2
  )
);

const BROKEN_CONFIG = path.join(TMP, 'broken-config.json');
fs.writeFileSync(BROKEN_CONFIG, '{ "lanes": { "codex": ');

const MISSING_CONFIG = path.join(TMP, 'no-such-dir', 'dispatch-config.json');

const PROMPT_FILE = path.join(TMP, 'prompt.md').split(path.sep).join('/');
fs.writeFileSync(PROMPT_FILE, 'Review the diff and report defects.\n'.repeat(40));
const PROMPT_CHARS = fs.readFileSync(PROMPT_FILE, 'utf8').length;

// A copy of the hook with its command classifier replaced by a throw, to prove
// an internal fault gates rather than permits. Nothing in the shipped hook
// exists to support this — the fault is injected into a copy.
const FAULTED_HOOK = path.join(TMP, 'faulted_hook.js');
{
  const src = fs.readFileSync(HOOK, 'utf8');
  const marker = 'function classifyCommand(';
  if (!src.includes(marker)) {
    console.error(`Cannot inject a fault: "${marker}" not found in ${HOOK}.`);
    process.exit(1);
  }
  fs.writeFileSync(
    FAULTED_HOOK,
    src.replace(
      marker,
      "function classifyCommand() { throw new Error('injected fault for test 7'); }\nfunction classifyCommand_unused("
    )
  );
}

// ---------------------------------------------------------------------------

function runHook(command, { config = LIVE_CONFIG, hook = HOOK, toolName = 'Bash', raw = null } = {}) {
  const payload =
    raw !== null
      ? raw
      : JSON.stringify({
          session_id: 'test-session',
          cwd: path.resolve(__dirname, '..', '..', '..'),
          hook_event_name: 'PreToolUse',
          tool_name: toolName,
          tool_input: { command },
          tool_use_id: 'toolu_test',
        });

  const argv = config === null ? [hook] : [hook, '--config', config];
  const r = spawnSync(process.execPath, argv, { input: payload, encoding: 'utf8' });
  let parsed = null;
  let parseError = null;
  const out = (r.stdout || '').trim();
  if (out !== '') {
    try {
      parsed = JSON.parse(out);
    } catch (err) {
      parseError = err.message;
    }
  }
  return {
    status: r.status,
    stdout: r.stdout || '',
    stderr: r.stderr || '',
    json: parsed,
    parseError,
    decision:
      parsed && parsed.hookSpecificOutput ? parsed.hookSpecificOutput.permissionDecision : null,
    reason:
      parsed && parsed.hookSpecificOutput ? parsed.hookSpecificOutput.permissionDecisionReason : null,
  };
}

const results = [];
let failures = 0;

function check(label, fn) {
  const problems = [];
  let detail = '';
  try {
    detail = fn((msg) => problems.push(msg)) || '';
  } catch (err) {
    problems.push(`threw: ${err.message}`);
  }
  const ok = problems.length === 0;
  if (!ok) failures += 1;
  results.push({ label, ok, problems, detail });
  const tag = ok ? 'PASS' : 'FAIL';
  console.log(`${tag}  ${label}`);
  if (detail) console.log(`      ${detail.split('\n').join('\n      ')}`);
  for (const p of problems) console.log(`      -> ${p}`);
}

function expectSilent(r, fail) {
  if (r.stdout.trim() !== '') fail(`expected NO stdout, got: ${r.stdout.trim().slice(0, 400)}`);
  if (r.status !== 0) fail(`expected exit 0, got ${r.status}`);
}

function expectDecision(r, want, fail) {
  if (r.parseError !== null) fail(`stdout was not JSON: ${r.parseError} (raw: ${r.stdout.slice(0, 200)})`);
  if (r.json === null) fail(`expected a decision JSON object, got empty stdout (exit ${r.status})`);
  if (r.json !== null) {
    const h = r.json.hookSpecificOutput;
    if (!h) fail('no hookSpecificOutput key');
    else {
      if (h.hookEventName !== 'PreToolUse') fail(`hookEventName was ${JSON.stringify(h.hookEventName)}`);
      if (h.permissionDecision !== want) fail(`permissionDecision was ${JSON.stringify(h.permissionDecision)}, wanted ${JSON.stringify(want)}`);
      if (typeof h.permissionDecisionReason !== 'string' || h.permissionDecisionReason.trim() === '') {
        fail('permissionDecisionReason missing or empty (required for deny and ask)');
      }
    }
  }
  if (r.status !== 0) fail(`expected exit 0 so the JSON decides, got ${r.status}`);
}

function firstLine(s) {
  return typeof s === 'string' ? s.split('\n')[0] : String(s);
}

console.log(`hook:    ${HOOK}`);
console.log(`fixture: ${FIXTURE_CONFIG}  (codex=reject, grok/deepseek/antigravity=ask, minimax/composer=auto)`);
console.log(`live:    ${LIVE_CONFIG}`);
console.log('');
console.log('=== the nine proofs from HOOK-DESIGN.md ===\n');

// 1 --------------------------------------------------------------------------
check('1. reject lane invoked DIRECTLY via its own CLI, no wrapper -> deny', (fail) => {
  const r = runHook(
    'codex exec --skip-git-repo-check "refactor the snapshot reducer"',
    { config: FIXTURE_CONFIG }
  );
  expectDecision(r, 'deny', fail);
  if (r.reason && !/codex/i.test(r.reason)) fail('reason does not name the codex lane');
  return `decision=${r.decision}  reason[0]=${firstLine(r.reason)}`;
});

// 2 --------------------------------------------------------------------------
check('2. ask lane invoked DIRECTLY via its own CLI -> ask', (fail) => {
  const r = runHook(
    'cursor-agent -p --output-format json --model cursor-grok-4.6-high "review this plan"',
    { config: FIXTURE_CONFIG }
  );
  expectDecision(r, 'ask', fail);
  if (r.reason && !/grok/i.test(r.reason)) fail('reason does not name the grok lane');
  return `decision=${r.decision}  reason[0]=${firstLine(r.reason)}`;
});

// 3 --------------------------------------------------------------------------
check('3. wrapper --lane grok --approve (Claude self-approving) -> STILL ask', (fail) => {
  const r = runHook(
    `node .claude/skills/dispatch/check_lanes.js --lane grok --prompt-file ${PROMPT_FILE} --approve`,
    { config: FIXTURE_CONFIG }
  );
  expectDecision(r, 'ask', fail);
  if (r.reason && !/--approve/.test(r.reason)) fail('reason does not disclose that --approve was passed');
  if (r.reason && !/--approve[^\n]*yes/i.test(r.reason)) fail('reason does not say --approve was YES');
  return `decision=${r.decision}  approve line=${(r.reason || '').split('\n').find((l) => /--approve/.test(l))}`;
});

// 4 --------------------------------------------------------------------------
check('4. auto lane -> NO JSON at all (not "allow"), exit 0', (fail) => {
  const r = runHook(
    `node .claude/skills/dispatch/check_lanes.js --lane composer --prompt-file ${PROMPT_FILE}`,
    { config: FIXTURE_CONFIG }
  );
  expectSilent(r, fail);
  if (/allow/.test(r.stdout)) fail('emitted "allow", which would widen permissions');
  return `stdout=${JSON.stringify(r.stdout)} exit=${r.status}`;
});

// 5 --------------------------------------------------------------------------
check('5. non-dispatch Bash commands are completely unaffected', (fail) => {
  const benign = [
    'ls',
    'ls -la .claude/skills/dispatch',
    'npm test',
    'npm run index',
    'git status --short',
    'node scripts/parse_save.js --latest --endpoint summary',
    'grep -rn "codex" docs/',
    'cat F:/Apps/codex/README.md',
    'echo "codex exec would be a dispatch"',
    'rg --files | head -20',
  ];
  const noisy = [];
  for (const c of benign) {
    const r = runHook(c, { config: FIXTURE_CONFIG });
    if (r.stdout.trim() !== '' || r.status !== 0) {
      noisy.push(`${c}  ->  exit ${r.status} ${r.stdout.trim().slice(0, 160)}`);
    }
  }
  if (noisy.length > 0) fail(`these were gated but should not be:\n${noisy.join('\n')}`);
  return `${benign.length} benign commands, all silent, all exit 0`;
});

// 6 --------------------------------------------------------------------------
check('6. config missing -> dispatch DENIED, not permitted', (fail) => {
  const r = runHook(
    `node .claude/skills/dispatch/check_lanes.js --lane minimax --prompt-file ${PROMPT_FILE}`,
    { config: MISSING_CONFIG }
  );
  expectDecision(r, 'deny', fail);
  return `decision=${r.decision}  reason[0]=${firstLine(r.reason)}`;
});

check('6b. config unparseable -> dispatch DENIED', (fail) => {
  const r = runHook('opencode run -m minimax-coding-plan/MiniMax-M3 --format json "hi"', {
    config: BROKEN_CONFIG,
  });
  expectDecision(r, 'deny', fail);
  return `decision=${r.decision}  reason[0]=${firstLine(r.reason)}`;
});

check('6c. config missing but command is NOT a dispatch -> still silent', (fail) => {
  const r = runHook('npm test', { config: MISSING_CONFIG });
  expectSilent(r, fail);
  return 'a broken policy file does not gate unrelated commands';
});

// 7 --------------------------------------------------------------------------
check('7. hook script throws internally -> gated (ask), never permitted', (fail) => {
  const r = runHook(
    `node .claude/skills/dispatch/check_lanes.js --lane grok --prompt-file ${PROMPT_FILE}`,
    { config: FIXTURE_CONFIG, hook: FAULTED_HOOK }
  );
  if (r.status === 2) {
    // exit 2 blocks unconditionally, which is also fail-closed.
    return 'exit 2 (unconditional block) — fail-closed';
  }
  expectDecision(r, 'ask', fail);
  if (r.reason && !/injected fault/.test(r.reason)) fail('reason does not carry the error text');
  return `decision=${r.decision}  reason[0]=${firstLine(r.reason)}`;
});

// 8 --------------------------------------------------------------------------
check('8. --dry-run -> not prompted', (fail) => {
  const r = runHook(
    `node .claude/skills/dispatch/check_lanes.js --lane codex --prompt-file ${PROMPT_FILE} --dry-run`,
    { config: FIXTURE_CONFIG }
  );
  expectSilent(r, fail);
  return 'silent even though codex is reject in the fixture — --dry-run executes nothing';
});

// 9 --------------------------------------------------------------------------
check('9. quoting variant: cd F:/x && node .../check_lanes.js --lane codex ... -> still detected', (fail) => {
  const r = runHook(
    `cd F:/Windsurf/Terra-Invicta-AI-Summary && node .claude/skills/dispatch/check_lanes.js --lane codex --prompt-file ${PROMPT_FILE}`,
    { config: FIXTURE_CONFIG }
  );
  expectDecision(r, 'deny', fail);
  if (r.reason && !/codex/i.test(r.reason)) fail('reason does not name the codex lane');
  return `decision=${r.decision}  reason[0]=${firstLine(r.reason)}`;
});

console.log('\n=== supplementary: the spellings a naive matcher misses ===\n');

const SPELLINGS = [
  ['absolute path + backslashes', 'node "F:\\Windsurf\\Terra-Invicta-AI-Summary\\.claude\\skills\\dispatch\\check_lanes.js" --lane codex --prompt-file p.md', 'deny'],
  ['single quotes', "node '.claude/skills/dispatch/check_lanes.js' --lane codex --prompt-file p.md", 'deny'],
  ['semicolon chain', 'cd /f/x ; node .claude/skills/dispatch/check_lanes.js --lane codex --prompt-file p.md', 'deny'],
  ['extra whitespace', 'node    .claude/skills/dispatch/check_lanes.js     --lane   codex   --prompt-file  p.md', 'deny'],
  ['--lane=codex form', 'node .claude/skills/dispatch/check_lanes.js --lane=codex --prompt-file=p.md', 'deny'],
  ['bash -c wrapping', 'bash -c "codex exec --skip-git-repo-check \'go\'"', 'deny'],
  ['sh -c with single quotes', "sh -c 'codex exec go'", 'deny'],
  ['cmd /c shim', 'cmd /c "codex exec go"', 'deny'],
  ['.cmd shim by name', 'cursor-agent.cmd -p --model cursor-grok-4.6-high "build it"', 'ask'],
  ['.exe absolute path', 'C:\\Users\\cople\\.opencode\\bin\\opencode.exe run -m opencode-go/deepseek-v4-flash --format json "hi"', 'ask'],
  ['node payload of a CLI', 'node "C:/Users/cople/AppData/Local/cursor-agent/versions/2026.08.01/index.js" -p --model cursor-grok-4.6-high "hi"', 'ask'],
  ['pipe chain', 'echo hi | codex exec --skip-git-repo-check "go"', 'deny'],
  ['command substitution', 'echo $(codex exec "go")', 'deny'],
  ['env prefix', 'FOO=bar codex exec "go"', 'deny'],
  ['npx prefix', 'npx -y codex exec "go"', 'deny'],
  ['agy direct', 'agy -p "make the panel" --output-format json', 'ask'],
  ['agy resume', 'agy -p "carry on" --continue', 'ask'],
  ['opencode deepseek (ask)', 'opencode run -m opencode-go/deepseek-v4-flash --format json "check this"', 'ask'],
  ['omp minimax (auto)', 'omp -p --mode json --model minimax-code/MiniMax-M3 @brief.md "go"', null],
  ['powershell -Command', 'powershell -Command "codex exec go"', 'deny'],
];

for (const [label, cmd, want] of SPELLINGS) {
  check(`spelling: ${label}`, (fail) => {
    const r = runHook(cmd, { config: FIXTURE_CONFIG });
    if (want === null) {
      expectSilent(r, fail);
      return 'silent (auto lane)';
    }
    expectDecision(r, want, fail);
    return `decision=${r.decision}  ${firstLine(r.reason)}`;
  });
}

console.log('\n=== supplementary: undeterminable lanes must not be "allow" ===\n');

check('cursor-agent -p with NO --model -> strictest of composer/grok (ask)', (fail) => {
  const r = runHook('cursor-agent -p --output-format json "do the thing"', { config: FIXTURE_CONFIG });
  expectDecision(r, 'ask', fail);
  if (r.reason && !/composer/i.test(r.reason)) fail('reason does not name the candidate lanes');
  return firstLine(r.reason);
});

check('opencode run with NO -m -> strictest of minimax/deepseek (ask)', (fail) => {
  const r = runHook('opencode run --format json "do the thing"', { config: FIXTURE_CONFIG });
  expectDecision(r, 'ask', fail);
  return firstLine(r.reason);
});

check('bare codex (interactive, danger-full-access) -> reject lane -> deny', (fail) => {
  const r = runHook('codex', { config: FIXTURE_CONFIG });
  expectDecision(r, 'deny', fail);
  return firstLine(r.reason);
});

check('unknown lane name in --lane -> ask, never silent', (fail) => {
  const r = runHook(
    `node .claude/skills/dispatch/check_lanes.js --lane gemini --prompt-file ${PROMPT_FILE}`,
    { config: FIXTURE_CONFIG }
  );
  expectDecision(r, 'ask', fail);
  return firstLine(r.reason);
});

check('lane unlisted in config -> ask (matches resolveMode)', (fail) => {
  const sparse = path.join(TMP, 'sparse.json');
  fs.writeFileSync(sparse, JSON.stringify({ version: 1, lanes: { minimax: { mode: 'auto' } } }));
  const r = runHook('agy -p "frontend tweak"', { config: sparse });
  expectDecision(r, 'ask', fail);
  return firstLine(r.reason);
});

check('invalid mode value -> ask, never auto', (fail) => {
  const bad = path.join(TMP, 'badmode.json');
  fs.writeFileSync(bad, JSON.stringify({ version: 1, lanes: { minimax: { mode: 'yes-please' } } }));
  const r = runHook('opencode run -m minimax-coding-plan/MiniMax-M3 "go"', { config: bad });
  expectDecision(r, 'ask', fail);
  return firstLine(r.reason);
});

check('wrapper pointed at a DIFFERENT --config -> escalated, never auto', (fail) => {
  const r = runHook(
    `node .claude/skills/dispatch/check_lanes.js --lane composer --prompt-file ${PROMPT_FILE} --config ${path.join(TMP, 'elsewhere.json').split(path.sep).join('/')}`,
    { config: FIXTURE_CONFIG }
  );
  expectDecision(r, 'ask', fail);
  return firstLine(r.reason);
});

check('strictest wins across a chain of two dispatches', (fail) => {
  const r = runHook(
    `node .claude/skills/dispatch/check_lanes.js --lane composer --prompt-file ${PROMPT_FILE} && codex exec "go"`,
    { config: FIXTURE_CONFIG }
  );
  expectDecision(r, 'deny', fail);
  return firstLine(r.reason);
});

console.log('\n=== supplementary: probes and metadata are not dispatches ===\n');

for (const [label, cmd] of [
  ['bare wrapper probe', 'node .claude/skills/dispatch/check_lanes.js'],
  ['wrapper --json probe', 'node .claude/skills/dispatch/check_lanes.js --json'],
  ['wrapper one-lane probe (reject lane)', 'node .claude/skills/dispatch/check_lanes.js --lane codex'],
  ['wrapper --help', 'node .claude/skills/dispatch/check_lanes.js --help'],
  ['collect_output', 'node .claude/skills/dispatch/collect_output.js /tmp/dispatch-out.txt'],
  ['opencode auth list', 'opencode auth list'],
  ['cursor-agent --list-models', 'cursor-agent --list-models'],
  ['codex login status', 'codex login status'],
  ['agy models', 'agy models'],
]) {
  check(`not a dispatch: ${label}`, (fail) => {
    const r = runHook(cmd, { config: FIXTURE_CONFIG });
    expectSilent(r, fail);
    return 'silent';
  });
}

console.log('\n=== supplementary: the PowerShell tool is a second front door ===\n');

// This harness exposes a PowerShell tool alongside Bash. A Bash-only matcher
// would leave every one of these ungated, which is the design doc's own failure
// mode one tool over.
for (const [label, cmd, want] of [
  ['bare codex under PowerShell', 'codex exec --skip-git-repo-check "go"', 'deny'],
  ['& call operator', '& "F:\\Apps\\codex\\codex.exe" exec "go"', 'deny'],
  ['Start-Process -FilePath', 'Start-Process -FilePath codex -ArgumentList exec', 'deny'],
  ['Start-Process positional', 'Start-Process codex -ArgumentList exec', 'deny'],
  ['Invoke-Expression', 'iex "codex exec go"', 'deny'],
  ['semicolon chain', 'Set-Location F:/x ; cursor-agent -p --model cursor-grok-4.6-high "go"', 'ask'],
  ['benign PowerShell is untouched', 'Get-ChildItem -Recurse .claude | Select-Object -First 5', null],
  ['benign npm under PowerShell', 'npm test', null],
]) {
  check(`PowerShell tool: ${label}`, (fail) => {
    const r = runHook(cmd, { config: FIXTURE_CONFIG, toolName: 'PowerShell' });
    if (want === null) {
      expectSilent(r, fail);
      return 'silent';
    }
    expectDecision(r, want, fail);
    return firstLine(r.reason);
  });
}

console.log('\n=== supplementary: malformed harness input fails closed ===\n');

check('unparseable stdin -> ask, never silent', (fail) => {
  const r = runHook(null, { config: FIXTURE_CONFIG, raw: 'this is not json' });
  if (r.status === 2) return 'exit 2 (unconditional block) — fail-closed';
  expectDecision(r, 'ask', fail);
  return firstLine(r.reason);
});

check('missing tool_input.command -> ask, never silent', (fail) => {
  const r = runHook(null, {
    config: FIXTURE_CONFIG,
    raw: JSON.stringify({ hook_event_name: 'PreToolUse', tool_name: 'Bash', tool_input: {} }),
  });
  expectDecision(r, 'ask', fail);
  return firstLine(r.reason);
});

check('a non-Bash tool -> silent (not this hook\'s business)', (fail) => {
  const r = runHook('anything', { config: FIXTURE_CONFIG, toolName: 'Read' });
  expectSilent(r, fail);
  return 'silent';
});

console.log('\n=== live policy (the user\'s real dispatch-config.json) ===\n');

// These cases assert the BINDING between the config and the decision — never a
// particular policy. dispatch-config.json is user-owned data whose entire purpose
// is to be changed, so hard-coding "codex is auto" here would fail the moment the
// user exercised that control, and would enshrine whatever mode happened to be
// set the day the test was written as the expected state. Worse, for codex that
// mode governs a lane running danger-full-access with approval: never.
//
// So: read the mode, then assert the decision that mode requires. This still
// catches a hook that ignores the config, and it survives any policy the user
// sets — including one that lists no lanes at all.
const LIVE_LANE_COMMANDS = {
  minimax: 'omp -p --mode json --model minimax-code/MiniMax-M3 @brief.md "go"',
  deepseek: 'opencode run -m opencode-go/deepseek-v4-flash --format json "go"',
  antigravity: 'agy -p "go"',
  composer: `node .claude/skills/dispatch/check_lanes.js --lane composer --prompt-file ${PROMPT_FILE}`,
  grok: 'cursor-agent -p --model cursor-grok-4.6-high "go"',
  codex: 'codex exec --skip-git-repo-check "go"',
};

const WANT_FOR_MODE = { auto: null, ask: 'ask', reject: 'deny' };

let livePolicyLanes = null;
let livePolicyError = null;
try {
  const parsed = JSON.parse(fs.readFileSync(LIVE_CONFIG, 'utf8').replace(/^\uFEFF/, ''));
  livePolicyLanes = parsed !== null && typeof parsed.lanes === 'object' && parsed.lanes !== null ? parsed.lanes : {};
} catch (err) {
  livePolicyError = err.message;
}

/** The same resolution the hook uses: unlisted and invalid both mean ask. */
function liveModeOf(lane) {
  const entry =
    livePolicyLanes !== null && Object.prototype.hasOwnProperty.call(livePolicyLanes, lane)
      ? livePolicyLanes[lane]
      : null;
  if (entry === null || typeof entry !== 'object') return { mode: 'ask', why: 'not listed in the config' };
  const m = entry.mode;
  if (typeof m !== 'string' || !['auto', 'ask', 'reject'].includes(m)) {
    return { mode: 'ask', why: `mode ${JSON.stringify(m)} is not auto/ask/reject` };
  }
  return { mode: m, why: 'set in the config' };
}

for (const lane of Object.keys(LIVE_LANE_COMMANDS)) {
  check(`live config: ${lane} — decision tracks whatever mode is configured`, (fail) => {
    const r = runHook(LIVE_LANE_COMMANDS[lane], { config: LIVE_CONFIG });
    if (livePolicyError !== null) {
      // An unreadable policy file must deny, never permit.
      expectDecision(r, 'deny', fail);
      return `live config unreadable (${livePolicyError}) -> deny`;
    }
    const { mode, why } = liveModeOf(lane);
    const want = WANT_FOR_MODE[mode];
    if (want === null) {
      expectSilent(r, fail);
      return `mode "${mode}" (${why}) -> silent`;
    }
    expectDecision(r, want, fail);
    return `mode "${mode}" (${why}) -> ${want}`;
  });
}

console.log('\n=== the reason string a user would actually read ===\n');
{
  const r = runHook(
    `node .claude/skills/dispatch/check_lanes.js --lane grok --prompt-file ${PROMPT_FILE} --approve`,
    { config: FIXTURE_CONFIG }
  );
  console.log(r.reason || '(none)');
  console.log('');
  const r2 = runHook('codex exec --skip-git-repo-check "rewrite everything"', { config: FIXTURE_CONFIG });
  console.log(r2.reason || '(none)');
  console.log(`\n(prompt file used above was ${PROMPT_CHARS} chars)`);
}

console.log('');
console.log(`${results.length - failures}/${results.length} passed, ${failures} failed.`);
try {
  fs.rmSync(TMP, { recursive: true, force: true });
} catch (_) {
  /* best effort */
}
process.exit(failures === 0 ? 0 : 1);
