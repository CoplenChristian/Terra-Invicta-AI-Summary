#!/usr/bin/env node
'use strict';

/*
 * approval_hook.js — PreToolUse gate for the dispatch skill.
 *
 * Wired from .claude/settings.json with matcher "Bash|PowerShell". The harness
 * pipes a PreToolUse payload on stdin and reads a decision from stdout:
 *
 *   { "hookSpecificOutput": { "hookEventName": "PreToolUse",
 *                             "permissionDecision": "allow"|"deny"|"ask",
 *                             "permissionDecisionReason": "..." } }
 *
 * Three rules shape everything below.
 *
 *  1. THE WRAPPER IS NOT THE CAPABILITY. Gating only check_lanes.js gates the
 *     front door of a building with no walls — every lane is reachable through
 *     `opencode run`, `agy -p`, `cursor-agent -p` and `codex exec`. Both
 *     families are detected here, and for a direct call the lane is INFERRED
 *     from the binary plus the model slug.
 *
 *  2. UNKNOWN IS NOT SAFE. A recognised binary whose lane cannot be determined
 *     inherits the strictest mode among the lanes that binary can serve. A
 *     command that cannot be parsed but is recognisably a dispatch asks. A
 *     missing or unparseable policy file denies, matching the script's exit 5.
 *     An internal fault asks, with the error in the reason. Nothing here treats
 *     "could not tell" as "let it run".
 *
 *  3. `auto` EMITS NOTHING. Not "allow" — "allow" bypasses the user's own
 *     permission rules, and this hook exists to ADD a gate, never to remove one.
 *     Silence hands the call back to the normal permission flow unchanged.
 *
 * Only fs and path are required, and only one small JSON file is read, so the
 * hook stays inside a tight timeout. check_lanes.js is deliberately NOT required:
 * it self-executes main() at load and exports nothing, so importing it would run
 * a dispatch tool instead of reading from it. The lane facts below are therefore
 * a deliberate, minimal duplicate — keep them in step with the LANES table in
 * check_lanes.js.
 *
 * Optional argv: --config <path>, used by approval_hook.test.js so no test ever
 * writes the user's policy file. The harness passes no argv, so it is inert in
 * production; anyone who can edit settings.json to add it can already edit the
 * policy itself.
 */

const fs = require('fs');
const path = require('path');

/**
 * Tool names this gate inspects. HOOK-DESIGN.md says matcher "Bash", but this
 * harness also exposes a separate PowerShell tool, and a Bash-only matcher would
 * leave `codex exec …` typed into PowerShell completely ungated — the same "gate
 * on a building with no walls" the design doc is about, one tool over. Both tools
 * carry the command under tool_input.command.
 */
const GATED_TOOLS = new Set(['Bash', 'PowerShell']);

const HOOK_DIR = __dirname;
// Resolved from this file's own location, never process.cwd(): a policy that
// resolved differently per working directory would be a silent policy change.
const DEFAULT_CONFIG_PATH = path.resolve(HOOK_DIR, 'dispatch-config.json');

const VALID_MODES = ['auto', 'ask', 'reject'];
const STRICTNESS = { auto: 0, ask: 1, reject: 2 };
const DECISION_FOR_MODE = { auto: 'silent', ask: 'ask', reject: 'deny' };

// ---------------------------------------------------------------------------
// Lane facts. Mirrors check_lanes.js LANES — see the header for why it is copied.
// ---------------------------------------------------------------------------

const LANES = {
  minimax: {
    label: 'MiniMax M3',
    binary: 'opencode',
    defaultModel: 'minimax-coding-plan/MiniMax-M3',
    cost: 'Plan-included: unlimited weekly, limited rolling 5-hour window.',
    risk: null,
  },
  deepseek: {
    label: 'DeepSeek v4 Flash',
    binary: 'opencode',
    defaultModel: 'opencode-go/deepseek-v4-flash',
    cost: 'METERED — real money per call, billed to OpenCode Go.',
    risk: null,
  },
  antigravity: {
    label: 'Antigravity',
    binary: 'agy',
    defaultModel: null,
    cost: '~16k input-token floor per call — a one-line question costs about what a long one does.',
    risk: null,
  },
  composer: {
    label: 'Composer 2.5',
    binary: 'cursor-agent',
    defaultModel: 'composer-2.5',
    cost: 'Shares one Cursor allowance with grok.',
    risk: null,
  },
  grok: {
    label: 'Grok 4.6',
    binary: 'cursor-agent',
    defaultModel: 'cursor-grok-4.6-high',
    cost: 'Shares one Cursor allowance with composer, the only lane rated for long multi-file runs.',
    risk: null,
  },
  codex: {
    label: 'Codex',
    binary: 'codex',
    defaultModel: null,
    cost: 'Included in the ChatGPT plan.',
    risk: 'UNSANDBOXED — ~/.codex/config.toml sets sandbox_mode = "danger-full-access" and runs report approval: never. Full filesystem access, no prompts. It can delete or rewrite anything this account can reach.',
  },
};

const LANE_KEYS = Object.keys(LANES);

/** Which lanes each binary can serve. Used when the lane cannot be determined. */
const BINARY_LANES = {
  opencode: ['minimax', 'deepseek'],
  agy: ['antigravity'],
  'cursor-agent': ['composer', 'grok'],
  codex: ['codex'],
};

const BINARY_NAMES = Object.keys(BINARY_LANES);

/** Subcommands and flags that read metadata and never spend a token. */
const METADATA = {
  opencode: new Set(['auth', 'models', 'model', 'session', 'sessions', 'serve', 'upgrade', 'install', 'uninstall', 'completion', 'github', 'stats', 'help', 'version']),
  agy: new Set(['models', 'model', 'auth', 'login', 'logout', 'help', 'version', 'update', 'upgrade', 'mcp']),
  'cursor-agent': new Set(['login', 'logout', 'status', 'ls', 'list', 'update', 'upgrade', 'mcp', 'help', 'version']),
  codex: new Set(['login', 'logout', 'help', 'completion', 'mcp', 'mcp-server', 'app-server', 'version']),
};

const METADATA_FLAGS = new Set([
  '--version', '-v', '-V', '--help', '-h', '--list-models', '--print-logs',
]);

/** Flags that consume the next token, so a subcommand hunt does not eat a value. */
const VALUE_FLAGS = {
  opencode: new Set(['-m', '--model', '-s', '--session', '--format', '--agent', '--port', '--hostname', '--log-level', '--config']),
  agy: new Set(['--model', '-m', '--output-format', '--conversation', '--config']),
  'cursor-agent': new Set(['--model', '-m', '--output-format', '--resume', '--config', '--api-key', '--workdir']),
  codex: new Set(['-m', '--model', '-c', '--config', '-C', '--cd', '-s', '--sandbox', '-a', '--ask-for-approval', '--profile', '-i', '--image', '-o', '--output-last-message']),
};

/**
 * Recognisably-a-dispatch, for the degraded-parse safety net. Requires a
 * non-identifier character on both sides so `docs/codex-notes.md` and
 * `Terra-Invicta` do not match, while `codex.exe` and `check_lanes.js` do.
 */
const RAW_MARKER_RE = /(?:^|[^A-Za-z0-9_-])(opencode|cursor-agent|codex|agy|check_lanes)(?![A-Za-z0-9_-])/i;

// ---------------------------------------------------------------------------
// Lexer. The command arrives as ONE string and may be spelled many ways.
// ---------------------------------------------------------------------------

const OPERATOR_CHARS = '&|;';

/**
 * Splits a command string into shell segments of tokens, and collects any
 * command strings found inside $(...) or backticks for separate scanning.
 *
 * Returns { segments, nested, degraded }. `degraded` means a quote or a
 * substitution never closed — the caller must not read a clean parse into that.
 */
function lex(command) {
  const segments = [];
  const nested = [];
  let cur = [];
  let tok = '';
  let hasTok = false;
  let degraded = false;

  const pushTok = () => {
    if (hasTok) {
      cur.push(tok);
      tok = '';
      hasTok = false;
    }
  };
  const pushSeg = () => {
    pushTok();
    if (cur.length > 0) {
      segments.push(cur);
      cur = [];
    }
  };

  /** Finds the index just past a balanced closing paren, or -1. */
  const matchParen = (s, open) => {
    let depth = 1;
    let q = null;
    for (let j = open + 1; j < s.length; j += 1) {
      const ch = s[j];
      if (q !== null) {
        if (ch === q) q = null;
        continue;
      }
      if (ch === "'" || ch === '"') q = ch;
      else if (ch === '(') depth += 1;
      else if (ch === ')') {
        depth -= 1;
        if (depth === 0) return j;
      }
    }
    return -1;
  };

  let inSingle = false;
  let inDouble = false;
  let i = 0;

  while (i < command.length) {
    const c = command[i];

    if (inSingle) {
      if (c === "'") inSingle = false;
      else tok += c;
      i += 1;
      continue;
    }

    if (inDouble) {
      if (c === '\\') {
        const nxt = command[i + 1];
        if (nxt === undefined) { degraded = true; i += 1; continue; }
        if (nxt === '"' || nxt === '\\' || nxt === '$' || nxt === '`') { tok += nxt; i += 2; continue; }
        if (nxt === '\n') { i += 2; continue; }
        // A Windows path separator, not an escape. Keep it, or F:\Apps\codex
        // would become F:Appscodex and lose its basename.
        tok += c;
        i += 1;
        continue;
      }
      if (c === '"') { inDouble = false; i += 1; continue; }
      if (c === '$' && command[i + 1] === '(') {
        const end = matchParen(command, i + 1);
        if (end === -1) { degraded = true; nested.push(command.slice(i + 2)); i = command.length; continue; }
        nested.push(command.slice(i + 2, end));
        i = end + 1;
        continue;
      }
      if (c === '`') {
        const end = command.indexOf('`', i + 1);
        if (end === -1) { degraded = true; nested.push(command.slice(i + 1)); i = command.length; continue; }
        nested.push(command.slice(i + 1, end));
        i = end + 1;
        continue;
      }
      tok += c;
      i += 1;
      continue;
    }

    // --- unquoted ---
    if (c === "'") { inSingle = true; hasTok = true; i += 1; continue; }
    if (c === '"') { inDouble = true; hasTok = true; i += 1; continue; }

    if (c === '\\') {
      const nxt = command[i + 1];
      if (nxt === undefined) { degraded = true; i += 1; continue; }
      if (/[\s'"`$&|;<>()\\]/.test(nxt)) { tok += nxt; hasTok = true; i += 2; continue; }
      tok += c; hasTok = true; i += 1; continue;   // Windows path separator
    }

    if (c === '$' && command[i + 1] === '(') {
      const end = matchParen(command, i + 1);
      if (end === -1) { degraded = true; nested.push(command.slice(i + 2)); i = command.length; continue; }
      nested.push(command.slice(i + 2, end));
      i = end + 1;
      continue;
    }

    if (c === '`') {
      const end = command.indexOf('`', i + 1);
      if (end === -1) { degraded = true; nested.push(command.slice(i + 1)); i = command.length; continue; }
      nested.push(command.slice(i + 1, end));
      i = end + 1;
      continue;
    }

    if (c === '\n' || c === '\r') { pushSeg(); i += 1; continue; }
    if (c === ' ' || c === '\t') { pushTok(); i += 1; continue; }

    if (OPERATOR_CHARS.includes(c)) {
      pushSeg();
      while (i < command.length && OPERATOR_CHARS.includes(command[i])) i += 1;
      continue;
    }

    // A bare paren is a subshell or grouping boundary. Splitting on it also
    // surfaces the string literals inside a `node -e` payload as command words,
    // which is where a spawnSync('codex', ...) would otherwise hide.
    if (c === '(' || c === ')') { pushSeg(); i += 1; continue; }

    if (c === '<' || c === '>') {
      pushTok();
      while (i < command.length && '<>&'.includes(command[i])) i += 1;
      continue;
    }

    tok += c;
    hasTok = true;
    i += 1;
  }

  if (inSingle || inDouble) degraded = true;
  pushSeg();

  return { segments, nested, degraded };
}

// ---------------------------------------------------------------------------
// Command-word normalisation.
// ---------------------------------------------------------------------------

const EXE_SUFFIX_RE = /\.(exe|cmd|bat|ps1|sh)$/i;

function toPosix(p) {
  return String(p).split('\\').join('/');
}

function basenameOf(token) {
  const parts = toPosix(token).split('/');
  return parts[parts.length - 1] || '';
}

/** Lowercased basename with a Windows launcher suffix stripped. */
function commandWord(token) {
  return basenameOf(token).toLowerCase().replace(EXE_SUFFIX_RE, '');
}

/**
 * Looks for a CLI's own install directory inside a path, so a call to the
 * underlying payload (`node .../cursor-agent/versions/N/index.js`) is recognised
 * as that CLI rather than as an anonymous node script.
 */
function familyFromPath(token) {
  const segs = toPosix(token).toLowerCase().split('/');
  for (const seg of segs) {
    const clean = seg.replace(/^\.+/, '').replace(EXE_SUFFIX_RE, '');
    if (BINARY_NAMES.includes(clean)) return clean;
  }
  return null;
}

const SHELL_WRAPPERS = new Set(['bash', 'sh', 'zsh', 'dash', 'ksh', 'cmd', 'powershell', 'pwsh']);
const TRANSPARENT_PREFIXES = new Set(['time', 'nohup', 'nice', 'stdbuf', 'winpty', 'command', 'builtin', 'exec', 'sudo', 'doas', 'env']);
const NPX_PREFIXES = new Set(['npx', 'bunx', 'pnpx']);
// PowerShell evaluates a string as a command; its argument is another command.
const PS_EVAL = new Set(['iex', 'invoke-expression']);
const ENV_ASSIGN_RE = /^[A-Za-z_][A-Za-z0-9_]*=/;

/** Strips env assignments and transparent launcher prefixes off the front. */
function stripLeading(tokens) {
  let out = tokens.slice();
  for (let guard = 0; guard < 8; guard += 1) {
    while (out.length > 0 && ENV_ASSIGN_RE.test(out[0])) out = out.slice(1);
    if (out.length === 0) return out;
    const word = commandWord(out[0]);
    // Start-Process names its program in -FilePath, or as the first positional.
    // Hoisting it to the front lets the normal classifier see it.
    if (word === 'start-process') {
      const rest = out.slice(1);
      let program = null;
      for (let i = 0; i < rest.length; i += 1) {
        const lower = rest[i].toLowerCase();
        if ((lower === '-filepath' || lower === '-path') && i + 1 < rest.length) {
          program = rest[i + 1];
          break;
        }
      }
      if (program === null) program = rest.find((t) => !t.startsWith('-')) || null;
      if (program === null) return [];
      out = [program].concat(rest.filter((t) => t !== program));
      continue;
    }
    if (TRANSPARENT_PREFIXES.has(word)) {
      out = out.slice(1);
      while (out.length > 0 && (out[0] === '-i' || out[0] === '--ignore-environment')) out = out.slice(1);
      continue;
    }
    if (NPX_PREFIXES.has(word)) {
      out = out.slice(1);
      while (out.length > 0 && out[0].startsWith('-')) {
        const flag = out[0];
        out = out.slice(1);
        if ((flag === '-p' || flag === '--package') && out.length > 0) out = out.slice(1);
      }
      continue;
    }
    return out;
  }
  return out;
}

// ---------------------------------------------------------------------------
// Argument readers. Both `--flag value` and `--flag=value` are accepted, because
// the hook must recognise a dispatch the script itself would reject as a usage
// error — an argument mistake is not an exemption from the gate.
// ---------------------------------------------------------------------------

function readFlagValue(tokens, names) {
  for (let i = 0; i < tokens.length; i += 1) {
    const t = tokens[i];
    for (const name of names) {
      if (t === name) return i + 1 < tokens.length ? tokens[i + 1] : '';
      if (t.startsWith(`${name}=`)) return t.slice(name.length + 1);
    }
  }
  return null;
}

function hasFlag(tokens, names) {
  return tokens.some((t) => names.includes(t) || names.some((n) => t.startsWith(`${n}=`)));
}

/** First positional token, skipping flags and the values they consume. */
function firstSubcommand(tokens, valueFlags) {
  for (let i = 0; i < tokens.length; i += 1) {
    const t = tokens[i];
    if (t.startsWith('-')) {
      if (valueFlags.has(t) && !t.includes('=')) i += 1;
      continue;
    }
    return t;
  }
  return null;
}

// ---------------------------------------------------------------------------
// Classification.
// ---------------------------------------------------------------------------

/** Which lane a model slug names, or null when it names none of ours. */
function laneFromModel(binary, slug) {
  if (typeof slug !== 'string' || slug.trim() === '') return null;
  const s = slug.toLowerCase();
  if (binary === 'opencode') {
    if (s.includes('minimax')) return 'minimax';
    if (s.includes('opencode-go') || s.includes('deepseek')) return 'deepseek';
    return null;
  }
  if (binary === 'cursor-agent') {
    if (s.includes('composer')) return 'composer';
    if (s.includes('grok')) return 'grok';
    return null;
  }
  return null;
}

function joinDisplay(tokens) {
  return tokens
    .map((t) => (/[\s"']/.test(t) ? `"${t.split('"').join('\\"')}"` : t))
    .join(' ');
}

/**
 * Classifies one lexed segment.
 *
 * Returns null (not our business), { nested: [strings] } (unwrap and rescan), or
 * a detection object. `dispatch: false` marks a recognised binary invoked for
 * metadata only — a probe costs nothing and is not gated.
 */
function classifySegment(rawTokens) {
  const tokens = stripLeading(rawTokens);
  if (tokens.length === 0) return null;

  const head = tokens[0];
  const word = commandWord(head);

  // --- Invoke-Expression: its argument is itself a command -------------------
  if (PS_EVAL.has(word)) {
    return tokens.length > 1 ? { nested: [tokens.slice(1).join(' ')] } : null;
  }

  // --- shell-in-a-shell: unwrap and rescan the inner command string ----------
  if (SHELL_WRAPPERS.has(word)) {
    const isWindowsShell = word === 'cmd' || word === 'powershell' || word === 'pwsh';
    const rest = tokens.slice(1);
    const out = [];
    for (let i = 0; i < rest.length; i += 1) {
      const lower = rest[i].toLowerCase();
      // PowerShell takes -Command / -c; cmd takes /c and /k; POSIX shells -c.
      if (lower === '-c' || lower === '-command' || lower === '--command' || lower === '/c' || lower === '/k') {
        // cmd.exe and PowerShell take the REST of the line as the command;
        // a POSIX shell takes exactly one argument.
        if (isWindowsShell) {
          if (rest.length > i + 1) out.push(rest.slice(i + 1).join(' '));
        } else if (rest.length > i + 1) {
          out.push(rest[i + 1]);
        }
        break;
      }
      // Base64 only ever means a command on PowerShell. `bash -e` is errexit,
      // and decoding its neighbour would be nonsense.
      if (isWindowsShell && (lower === '-encodedcommand' || lower === '-enc' || lower === '-ec' || lower === '-e')) {
        if (rest.length > i + 1) {
          let decoded = null;
          try {
            decoded = Buffer.from(rest[i + 1], 'base64').toString('utf16le');
          } catch (_) {
            decoded = null;
          }
          out.push(decoded !== null && decoded !== '' ? decoded : rest[i + 1]);
        }
        break;
      }
    }
    return out.length > 0 ? { nested: out } : null;
  }

  // --- node <script> --------------------------------------------------------
  if (word === 'node' || word === 'nodejs') {
    const nodeValueFlags = new Set(['-r', '--require', '--import', '--loader', '--experimental-loader', '--conditions', '--max-old-space-size']);
    let script = null;
    const nestedOut = [];
    let idx = 1;
    for (; idx < tokens.length; idx += 1) {
      const t = tokens[idx];
      if (!t.startsWith('-')) { script = t; idx += 1; break; }
      if (t === '-e' || t === '--eval' || t === '-p' || t === '--print') {
        if (tokens.length > idx + 1) nestedOut.push(tokens[idx + 1]);
        idx += 1;
        continue;
      }
      if (nodeValueFlags.has(t) && !t.includes('=')) idx += 1;
    }
    if (script !== null) {
      const scriptBase = basenameOf(script).toLowerCase();
      const args = tokens.slice(idx);
      if (scriptBase === 'check_lanes.js' || scriptBase === 'check_lanes') {
        return classifyWrapper(args, tokens);
      }
      const fam = familyFromPath(script);
      if (fam !== null) return classifyDirect(fam, args, tokens, 'node payload');
    }
    return nestedOut.length > 0 ? { nested: nestedOut } : null;
  }

  // --- the wrapper invoked as a script path ---------------------------------
  if (basenameOf(head).toLowerCase() === 'check_lanes.js') {
    return classifyWrapper(tokens.slice(1), tokens);
  }

  // --- a recognised CLI, by name or by absolute path -------------------------
  const fam = BINARY_LANES[word] !== undefined ? word : familyFromPath(head);
  if (fam !== null && BINARY_LANES[fam] !== undefined) {
    return classifyDirect(fam, tokens.slice(1), tokens, 'direct call');
  }

  return null;
}

function classifyWrapper(args, wholeSegment) {
  const laneRaw = readFlagValue(args, ['--lane']);
  const promptFile = readFlagValue(args, ['--prompt-file']);
  const configOverride = readFlagValue(args, ['--config']);
  const dryRun = hasFlag(args, ['--dry-run']);
  const approve = hasFlag(args, ['--approve']);
  const resumeLast = hasFlag(args, ['--resume-last']);
  const resumeId = readFlagValue(args, ['--resume']);

  // Without --prompt-file the script takes its probe-only path and never
  // dispatches (verified in check_lanes.js main()). A probe is not a spend.
  if (promptFile === null) {
    return { family: 'wrapper', dispatch: false, display: joinDisplay(wholeSegment) };
  }

  const laneKnown = typeof laneRaw === 'string' && Object.prototype.hasOwnProperty.call(LANES, laneRaw);

  return {
    family: 'wrapper',
    binary: null,
    dispatch: true,
    route: 'through check_lanes.js (the sanctioned path)',
    lane: laneKnown ? laneRaw : null,
    laneRaw: laneRaw === null ? null : String(laneRaw),
    // No candidates: unlike a direct CLI call, the wrapper is not tied to one
    // binary, so there is no set of lanes to take the strictest of. An
    // unresolvable lane here falls to "ask" — never silent, and never borrowing
    // some other lane's "reject", which would misreport why it was blocked.
    laneCandidates: laneKnown ? [laneRaw] : [],
    laneUnknownReason: laneKnown
      ? null
      : laneRaw === null
        ? '--lane was not given, so no lane could be read from the command'
        : `--lane "${laneRaw}" is not one of ${LANE_KEYS.join(', ')}`,
    model: null,
    promptFile,
    dryRun,
    approve,
    configOverride,
    resume: resumeLast ? 'most recent session' : resumeId !== null ? `session ${resumeId}` : null,
    display: joinDisplay(wholeSegment),
  };
}

function classifyDirect(binary, args, wholeSegment, how) {
  const sub = firstSubcommand(args, VALUE_FLAGS[binary] || new Set());
  const subLower = sub === null ? null : sub.toLowerCase();
  const metadataOnly =
    (subLower !== null && METADATA[binary].has(subLower)) ||
    args.some((t) => METADATA_FLAGS.has(t.toLowerCase()));

  if (metadataOnly) {
    return { family: binary, dispatch: false, display: joinDisplay(wholeSegment) };
  }

  const model = readFlagValue(args, ['--model', '-m']);
  const lane = laneFromModel(binary, model);
  const candidates = BINARY_LANES[binary];
  const single = candidates.length === 1 ? candidates[0] : null;

  // Whether this spelling is the documented dispatch form. When it is not, the
  // call is still gated — an unrecognised invocation of a spending binary is
  // exactly the "unknown is not safe" case, not an exemption.
  let recognisedForm = false;
  if (binary === 'opencode') recognisedForm = subLower === 'run';
  else if (binary === 'codex') recognisedForm = subLower === 'exec' || subLower === 'e';
  else if (binary === 'cursor-agent') recognisedForm = hasFlag(args, ['-p', '--print']);
  else if (binary === 'agy') recognisedForm = hasFlag(args, ['-p', '--print', '--prompt']);

  const resolvedLane = lane !== null ? lane : single;

  return {
    family: binary,
    binary,
    dispatch: true,
    route: `DIRECT ${binary} call (${how}) — bypasses check_lanes.js, which is where the user's policy lives`,
    lane: resolvedLane,
    laneRaw: null,
    laneCandidates: resolvedLane !== null ? [resolvedLane] : candidates,
    laneUnknownReason:
      resolvedLane !== null
        ? null
        : model === null
          ? `no model slug was given, so ${binary} would use its own configured default — which lane that spends cannot be read from the command`
          : `model slug "${model}" does not name a lane in this policy`,
    model: model === null ? null : String(model),
    promptFile: null,
    dryRun: false,
    approve: false,
    configOverride: null,
    resume: hasFlag(args, ['--continue', '-c']) ? 'most recent session' : null,
    recognisedForm,
    display: joinDisplay(wholeSegment),
  };
}

/**
 * Walks a command string and everything nested inside it.
 * Returns { detections, degraded }.
 */
function classifyCommand(command, depth) {
  const detections = [];
  const { segments, nested, degraded } = lex(command);
  let anyDegraded = degraded;

  const queue = nested.slice();

  for (const seg of segments) {
    let result;
    try {
      result = classifySegment(seg);
    } catch (err) {
      // A segment that could not be classified is not thereby harmless.
      anyDegraded = true;
      continue;
    }
    if (result === null) continue;
    if (result.nested !== undefined) {
      for (const n of result.nested) queue.push(n);
      continue;
    }
    detections.push(result);
  }

  if (depth < 4) {
    for (const inner of queue) {
      const sub = classifyCommand(inner, depth + 1);
      for (const d of sub.detections) detections.push(d);
      if (sub.degraded) anyDegraded = true;
    }
  } else if (queue.length > 0) {
    anyDegraded = true;
  }

  return { detections, degraded: anyDegraded };
}

// ---------------------------------------------------------------------------
// Policy.
// ---------------------------------------------------------------------------

function loadPolicy(configPath) {
  let text;
  try {
    text = fs.readFileSync(configPath, 'utf8');
  } catch (err) {
    return {
      path: configPath,
      lanes: null,
      fatal:
        err.code === 'ENOENT'
          ? `No policy file at ${configPath}. check_lanes.js refuses to run without one (exit 5) and this gate refuses to let a dispatch past one. Restore the file rather than working around it.`
          : `Policy file at ${configPath} could not be read: ${err.message}`,
    };
  }
  let raw;
  try {
    raw = JSON.parse(text.replace(/^\uFEFF/, ''));
  } catch (err) {
    return {
      path: configPath,
      lanes: null,
      fatal: `Policy file at ${configPath} is not valid JSON: ${err.message}. Refusing to guess a policy.`,
    };
  }
  const lanes = raw !== null && typeof raw === 'object' && raw.lanes !== null && typeof raw.lanes === 'object' ? raw.lanes : {};
  return { path: configPath, lanes, fatal: null };
}

/** Mirrors resolveMode() in check_lanes.js: unlisted and invalid both mean ask. */
function resolveMode(laneKey, policy) {
  const entry = Object.prototype.hasOwnProperty.call(policy.lanes, laneKey) ? policy.lanes[laneKey] : null;
  if (entry === null || typeof entry !== 'object') {
    return { mode: 'ask', reason: `the policy does not list lane "${laneKey}", and an unlisted lane is "ask" — there is no setting that makes it "auto"` };
  }
  const configured = entry.mode;
  if (typeof configured !== 'string' || !VALID_MODES.includes(configured)) {
    return { mode: 'ask', reason: `lane "${laneKey}" has mode ${JSON.stringify(configured)}, which is not one of ${VALID_MODES.join('/')} — treated as "ask"` };
  }
  return { mode: configured, reason: `the policy sets lane "${laneKey}" to "${configured}"` };
}

function strictest(modes) {
  let best = modes[0];
  for (const m of modes) if (STRICTNESS[m.mode] > STRICTNESS[best.mode]) best = m;
  return best;
}

// ---------------------------------------------------------------------------
// Reason rendering. This string is what the user reads at the moment of
// deciding, so it must carry enough to decide WITHOUT opening the config.
// Line one is self-sufficient in case a multi-line reason is truncated.
// ---------------------------------------------------------------------------

function truncate(s, n) {
  return s.length <= n ? s : `${s.slice(0, n - 1)}…`;
}

function promptSummary(promptFile, cwd) {
  if (promptFile === null) return 'no --prompt-file (the prompt is inline in the command — the wrapper never does this)';
  let resolved = promptFile;
  try {
    resolved = path.isAbsolute(promptFile) ? promptFile : path.resolve(cwd || process.cwd(), promptFile);
  } catch (_) { /* keep the raw value */ }
  try {
    const st = fs.statSync(resolved);
    if (st.size > 1024 * 1024) return `${st.size.toLocaleString('en-US')} bytes from ${promptFile} (too large to count characters)`;
    const chars = fs.readFileSync(resolved, 'utf8').length;
    return `${chars.toLocaleString('en-US')} chars from ${promptFile}`;
  } catch (err) {
    // Absent stays absent: do not report "0 chars".
    return `${promptFile} — NOT READABLE from here (${err.code || err.message}); its size is unknown, not zero`;
  }
}

function renderDetection(det, resolved, policy, cwd) {
  const lines = [];
  const laneKey = resolved.laneKey;
  const meta = laneKey === null ? null : LANES[laneKey];

  if (laneKey !== null) {
    const model = det.model !== null ? det.model : meta.defaultModel;
    lines.push(`Lane:     ${laneKey} (${meta.label}${model ? `, ${model}` : ''})`);
  } else {
    lines.push(`Lane:     UNDETERMINED — ${det.laneUnknownReason}`);
    if (det.laneCandidates.length > 0) {
      lines.push(`          Candidates: ${det.laneCandidates.join(', ')}. Taking the strictest of them; unknown is not "allow".`);
    }
  }
  lines.push(`Mode:     ${resolved.mode} — ${resolved.reason}`);
  if (meta !== null) lines.push(`Cost:     ${meta.cost}`);
  lines.push(`Risk:     ${meta !== null && meta.risk !== null ? meta.risk : '—'}`);
  lines.push(`Route:    ${det.route}`);
  if (det.recognisedForm === false) {
    lines.push(`          NOTE: this is not the documented invocation form for ${det.binary}, so what it would do could not be read from the command. Gated rather than guessed.`);
  }
  if (det.resume !== null && det.resume !== undefined) lines.push(`Session:  resuming ${det.resume} — resuming is dispatching`);
  lines.push(`Prompt:   ${promptSummary(det.promptFile, cwd)}`);
  lines.push(`Command:  ${truncate(det.display, 320)}`);
  if (det.family === 'wrapper') {
    lines.push(`Claude passed --approve: ${det.approve ? 'YES — Claude believed it already had your approval. This gate does not accept that; only you do.' : 'no'}`);
  } else {
    lines.push('Claude passed --approve: n/a — there is no approval flag outside the wrapper, which is part of why a direct call is a violation.');
  }
  if (det.configOverride !== null && det.configOverride !== undefined) {
    lines.push(`Policy:   ${policy.path} — but the command passes --config ${det.configOverride}, so the policy actually in force would be that other file. Escalated.`);
  } else {
    lines.push(`Policy:   ${policy.path}`);
  }
  return lines.join('\n');
}

function headline(decision, resolvedList) {
  const first = resolvedList[0];
  const laneName =
    first.laneKey !== null
      ? `${first.laneKey} (${LANES[first.laneKey].label})`
      : `UNDETERMINED — ${first.det.family === 'wrapper' ? 'check_lanes.js was given no usable --lane' : `an ${first.det.family} call whose lane could not be read`}`;
  const risk = first.laneKey === 'codex' ? ' · UNSANDBOXED, danger-full-access, approval never' : '';
  const cost = first.laneKey !== null ? ` · ${truncate(LANES[first.laneKey].cost, 70)}` : '';
  const verb = decision === 'deny' ? 'DISPATCH BLOCKED' : 'DISPATCH NEEDS YOUR APPROVAL';
  const extra = resolvedList.length > 1 ? ` (+${resolvedList.length - 1} more dispatch${resolvedList.length > 2 ? 'es' : ''} in this command)` : '';
  return `${verb} — lane ${laneName} · mode ${first.mode}${risk}${cost}${extra}`;
}

// ---------------------------------------------------------------------------
// Emission.
// ---------------------------------------------------------------------------

function emit(decision, reason) {
  if (decision === 'silent') process.exit(0);
  process.stdout.write(
    `${JSON.stringify({
      hookSpecificOutput: {
        hookEventName: 'PreToolUse',
        permissionDecision: decision,
        permissionDecisionReason: reason,
      },
    })}\n`
  );
  process.exit(0);
}

// ---------------------------------------------------------------------------
// Main.
// ---------------------------------------------------------------------------

function main() {
  const argv = process.argv.slice(2);
  const ci = argv.indexOf('--config');
  const configPath = ci !== -1 && argv[ci + 1] !== undefined ? path.resolve(argv[ci + 1]) : DEFAULT_CONFIG_PATH;

  let payload;
  try {
    payload = JSON.parse(fs.readFileSync(0, 'utf8'));
  } catch (err) {
    emit(
      'ask',
      `Dispatch gate could not read its PreToolUse input (${err.message}). It cannot tell whether this command is a dispatch, and an unreadable check reports unknown rather than "fine". Approve only if you know what this command does.`
    );
    return;
  }

  const toolName = payload && typeof payload.tool_name === 'string' ? payload.tool_name : null;
  if (toolName !== null && !GATED_TOOLS.has(toolName)) process.exit(0);

  const command =
    payload && payload.tool_input && typeof payload.tool_input.command === 'string'
      ? payload.tool_input.command
      : null;

  if (command === null) {
    emit(
      'ask',
      `Dispatch gate received a ${toolName === null ? 'PreToolUse payload with no tool_name' : `${toolName} call`} with no readable tool_input.command, so it could not check the command against the dispatch policy. Unknown is not safe.`
    );
    return;
  }

  const cwd = payload && typeof payload.cwd === 'string' ? payload.cwd : process.cwd();

  const { detections, degraded } = classifyCommand(command, 0);
  const dispatches = detections.filter((d) => d.dispatch === true);

  // Nothing recognised. Before going silent, check whether the command was
  // recognisably a dispatch that simply could not be parsed.
  if (dispatches.length === 0) {
    if (degraded && RAW_MARKER_RE.test(command)) {
      emit(
        'ask',
        `DISPATCH NEEDS YOUR APPROVAL — unparseable command that names a dispatch tool\n\n` +
          `This command could not be parsed (an unterminated quote or substitution), but it mentions one of the dispatch CLIs. ` +
          `The gate will not read an unparseable command as harmless.\n\n` +
          `Command:  ${truncate(command, 320)}\n` +
          `Policy:   ${configPath}`
      );
      return;
    }
    process.exit(0);
  }

  // --dry-run executes nothing, whatever the mode says — but only through the
  // wrapper, which is the only thing that implements it. It is not a flag on the
  // CLIs, so it never exempts a direct call.
  const live = dispatches.filter((d) => !(d.family === 'wrapper' && d.dryRun === true));
  if (live.length === 0) process.exit(0);

  const policy = loadPolicy(configPath);

  if (policy.fatal !== null) {
    const names = live
      .map((d) => (d.lane !== null ? d.lane : `${d.family} (lane undetermined)`))
      .join(', ');
    emit(
      'deny',
      `DISPATCH BLOCKED — no usable dispatch policy\n\n` +
        `${policy.fatal}\n\n` +
        `Would have dispatched: ${names}\n` +
        `Command:  ${truncate(live[0].display, 320)}\n\n` +
        `check_lanes.js exits 5 rather than falling back to an implicit all-ask policy, because "ask" plus --approve still dispatches. This gate matches it: no policy, no dispatch.`
    );
    return;
  }

  const resolvedList = live.map((det) => {
    const candidates = det.laneCandidates;
    const laneKey = det.lane !== null && det.lane !== undefined ? det.lane : null;

    let pick;
    if (candidates.length === 0) {
      // Nothing to take the strictest of. Unknown is not safe, so this asks.
      pick = { mode: 'ask', reason: `${det.laneUnknownReason} — an unresolvable lane is "ask", never silent`, laneKey: null };
    } else {
      pick = strictest(
        candidates.map((k) => {
          const r = resolveMode(k, policy);
          return { mode: r.mode, reason: r.reason, laneKey: k };
        })
      );
    }

    let mode = pick.mode;
    let reason = pick.reason;

    if (laneKey === null && candidates.length > 1) {
      reason = `strictest of ${candidates.join('/')} — ${pick.reason}`;
    }

    // A wrapper call pointed at some other policy file is not governed by the
    // policy just read, so it may never resolve below "ask".
    if (det.configOverride !== null && det.configOverride !== undefined) {
      const overrideResolved = path.resolve(cwd, det.configOverride);
      if (overrideResolved !== policy.path) {
        if (STRICTNESS[mode] < STRICTNESS.ask) {
          mode = 'ask';
          reason = `${pick.reason}, but the command redirects --config to another file, so the policy actually in force is unknown — escalated to "ask"`;
        }
      }
    }

    return { det, mode, reason, laneKey };
  });

  resolvedList.sort((a, b) => STRICTNESS[b.mode] - STRICTNESS[a.mode]);
  const worst = resolvedList[0];
  const decision = DECISION_FOR_MODE[worst.mode];

  if (decision === 'silent') process.exit(0);

  const blocks = resolvedList
    .filter((r) => DECISION_FOR_MODE[r.mode] !== 'silent')
    .map((r) => renderDetection(r.det, r, policy, cwd));

  const tail =
    decision === 'deny'
      ? `\nNothing overrides a "reject": not --approve, not a direct CLI call, not a rewrite of the command. If this lane should be usable, the user changes its mode in ${policy.path}. Claude does not edit that file.`
      : `\nApproving here approves THIS call only. Denying is the safe answer if anything above is unexpected — the standing rule is that every dispatch goes through check_lanes.js, so a DIRECT call in the Route line is itself a violation worth questioning.`;

  emit(decision, `${headline(decision, resolvedList)}\n\n${blocks.join('\n\n')}\n${tail}`);
}

// Fail closed. An internal fault must never become a silent permit; if even
// producing JSON fails, exit 2, which blocks unconditionally.
try {
  main();
} catch (err) {
  try {
    emit(
      'ask',
      `Dispatch gate failed internally and cannot say whether this command is a dispatch: ${err && err.message ? err.message : String(err)}\n\n` +
        `A check that cannot be evaluated reports unknown, never "fine". Approve only if you are sure what this command does, and report the fault.`
    );
  } catch (_) {
    process.exit(2);
  }
}
