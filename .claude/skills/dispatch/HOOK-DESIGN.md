# Dispatch approval hook — design

Written 2026-08-25 against `main` @ `3e9ab65`. Design for a `PreToolUse` hook
that makes the dispatch skill's `ask` mode genuinely enforced.

**Not yet implemented.** This is the spec.

---

## What this closes

`check_lanes.js` today has three modes and only one of them is real:

| mode | enforced by | actually enforced? |
| --- | --- | --- |
| `reject` | checked before the lane is contacted, no flag overrides it | **yes** |
| `ask` | refuses unless `--approve` is passed | **no** — `--approve` is a flag Claude types |
| `auto` | nothing, by design | n/a |

The script cannot tell *"the user said yes in chat"* from *"Claude decided to add
the flag."* Its own help text says `--approve` is "ONLY after the user says yes",
which is an instruction to Claude enforced by nothing.

A `PreToolUse` hook runs **outside Claude's control**, in the harness, before the
Bash call executes. That is what turns `ask` from a convention into a gate.

---

## The standing rule this enforces

**Every dispatch goes through `check_lanes.js`. There are no exceptions and no
workarounds.** Direct invocation of `opencode`, `agy`, `cursor-agent` or `codex`
is forbidden regardless of whether this hook is installed — see the rule at the
top of `SKILL.md`.

The hook exists because a rule Claude is asked to follow and a rule the harness
enforces are different things, and the gap between them is exactly where a
mistake becomes expensive. **The hook is the backstop, not the rule.** Nothing
below should be read as "direct calls are a supported path that happens to be
gated" — direct calls are a violation, and the hook's job is to catch one.

---

## The hole in the obvious design, and it is the important part

The naive hook watches for `check_lanes.js` and gates it. **That gates the
wrapper, not the capability.**

Every lane is reachable without the wrapper:

```
opencode run -m minimax-coding-plan/MiniMax-M3 --format json "..."
agy -p "..." --output-format json
cursor-agent -p --output-format json --model composer-2.5 "..."
codex exec --skip-git-repo-check "..."
```

Claude knows all four — they are documented in `SKILL.md` and in memory. A hook
that only watches the wrapper is a gate on the *front door of a building with no
walls*, and worse, it reads as protection while providing none.

**So the hook must recognise two families:**

1. **Wrapper calls** — `check_lanes.js` with `--lane <key>`. The lane is stated.
2. **Direct CLI calls** — `opencode run`, `agy -p`, `cursor-agent -p`,
   `codex exec`, however they are spelled (absolute path, `.cmd` shim, `node
   <path>/index.js`, wrapped in `cd X && ...`). The lane must be **inferred**
   from the binary plus the model slug.

Direct-call inference:

| observed | lane |
| --- | --- |
| `opencode … -m minimax-coding-plan/…` | `minimax` |
| `opencode … -m opencode-go/…` | `deepseek` |
| `agy` (any `-p`/`--print`/`--prompt`) | `antigravity` |
| `cursor-agent … --model composer-…` | `composer` |
| `cursor-agent … --model cursor-grok-…` | `grok` |
| `codex … exec` | `codex` |

**A recognised binary whose lane cannot be determined is not "allow".** An
`opencode run` with no `-m`, or a `cursor-agent -p` with no `--model`, uses that
tool's configured default and still spends budget. Treat it as the **strictest
mode among the lanes that binary can serve** — so an unmodelled `cursor-agent`
call inherits whichever of `composer`/`grok` is stricter.

---

## Decision table

Hook returns JSON on stdout with `hookSpecificOutput.permissionDecision`.

| situation | decision | why |
| --- | --- | --- |
| Not a dispatch command at all | **stay silent** (exit 0, no JSON) | not the hook's business |
| Wrapper or CLI, lane mode `auto` | **stay silent** | see below — *not* `"allow"` |
| Wrapper or CLI, lane mode `ask` | `"ask"` | the user decides, per call |
| Wrapper or CLI, lane mode `reject` | `"deny"` | matches the script |
| Config file missing or unparseable | `"deny"` | matches the script's exit 5 |
| Recognised binary, lane undeterminable | `"ask"` | unknown is not safe |
| `--dry-run` present | **stay silent** | executes nothing |
| Hook script itself errors | `"ask"` | fail closed, see below |

### Why `auto` stays silent rather than returning `"allow"`

`"allow"` **bypasses the normal permission system**. The hook's job is to *add* a
gate, never to remove one the user already has. If a lane is `auto` the hook
should decline to express an opinion and let Claude Code's own permission rules
apply as they would have. Returning `"allow"` would silently widen permissions
beyond what the user configured — the opposite of the point.

### Fail closed, deliberately

If the hook cannot parse the command, cannot read the config, or throws — it must
**not** fall through to permitting the call. Exit 0 with no JSON means "normal
flow", which for an allowlisted Bash pattern can mean it just runs.

- Unparseable but recognisably a dispatch → `"ask"`.
- Internal error → `"ask"`, with the error text in the reason.

Exit 2 (unconditional block) is reserved for the case where even producing JSON
failed, since exit 2 overrides everything.

This is the same rule the rest of this repo runs on: a check that cannot be
evaluated reports unknown, never "fine".

---

## Headless behaviour — know this before relying on it

In a headless session `"ask"` **cannot show a dialog and becomes a denial.**

That is the correct direction — it fails closed rather than silently dispatching
with nobody watching. But the consequence is real: **every `ask` lane is hard
blocked in a non-interactive run.** If autonomous overnight work is wanted, the
lanes it may use have to be set to `auto` deliberately, which is exactly the
decision that should be conscious rather than incidental.

---

## The reason string is the product

For `"ask"`, `permissionDecisionReason` is what the user reads at the moment of
deciding. It must carry enough to decide **without** going and reading the
config:

```
Lane: grok (Cursor Grok 4.6, cursor-grok-4.6-high)
Mode: ask  ·  Cost: shares one Cursor allowance with composer
Risk: —
Prompt: 4,812 chars from briefs/grok-review.md
Command: cursor-agent -p --output-format json --model cursor-grok-4.6-high …
Claude passed --approve: yes
```

That last line matters. It tells the user whether Claude believed it already had
approval — which is precisely the case this hook exists to catch.

For `codex`, the reason must lead with the risk: its own config sets
`sandbox_mode = "danger-full-access"` and runs report `approval: never`.

**Unverified:** the docs do not show the approval dialog, so whether a
multi-line reason renders in full is unconfirmed. Test it on the first real
prompt; if it truncates, put lane, mode and cost in the first line.

---

## Configuration

`.claude/settings.json` — project level, committable, versions with the skill.

**Not** `.claude/settings.local.json`, which is gitignored *and takes higher
precedence*, so a local file could silently override the shared gate. If the hook
lives only in the local file it disappears on a fresh clone and nobody notices.

```json
{
  "hooks": {
    "PreToolUse": [
      {
        "matcher": "Bash",
        "hooks": [
          {
            "type": "command",
            "command": "node \"${CLAUDE_PROJECT_DIR}/.claude/skills/dispatch/approval_hook.js\"",
            "timeout": 5,
            "statusMessage": "Checking dispatch policy"
          }
        ]
      }
    ]
  }
}
```

`matcher` filters on **tool name only**, so all lane detection happens inside the
script. Keep the timeout tight — the hook reads one small JSON file and does
string work; if it is slow, something is wrong.

---

## What must be proven before this is trusted

Every one of these red first, then green:

1. A `reject` lane invoked **directly via its CLI**, bypassing the wrapper → denied.
2. An `ask` lane invoked directly via its CLI → prompts.
3. `check_lanes.js --lane <ask lane> --approve` → **still prompts**. This is the
   whole point: Claude self-approving does not bypass the hook.
4. An `auto` lane → no prompt, and **no permission widening** — confirm the hook
   emitted no JSON rather than `"allow"`.
5. A non-dispatch Bash command (`ls`, `npm test`) → completely unaffected.
6. Config deleted → dispatch denied, not permitted.
7. Hook script made to throw → the call is gated, not permitted.
8. `--dry-run` → not prompted.
9. A quoting variant — `cd F:/x && node .claude/skills/dispatch/check_lanes.js --lane codex …` — still detected. The command arrives as one string; a naive `startsWith` misses this.

Test 3 and test 9 are the two that decide whether this is real. Test 1 is the one
the naive design fails.
