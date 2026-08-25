---
name: dispatch
description: Use when work should be handed to one of the external agent CLIs rather than done inline — delegating an implementation pass, farming out a long multi-file build, getting a second opinion or independent review of a plan or diff, running a fast frontend change, or asking another model to analyse something. Covers the lanes minimax, deepseek, antigravity, composer, grok and codex, reached through opencode, agy, cursor-agent and codex. Also use when the user asks which tool should get a job, whether a lane is available or authenticated, what a dispatch would cost, or why a dispatch was refused. Not for work Claude should simply do itself.
version: 1.0.0
user-invocable: true
argument-hint: "[check | <lane> <what to delegate>]"
allowed-tools:
  - Bash(node .claude/skills/dispatch/check_lanes.js *)
---

This skill routes work to the external agent CLIs installed on this machine. Policy
is not in this file and not in the script — it is in `.claude/dispatch-config.json`,
which the user owns and edits. Read that file's `_comment` before assuming anything
about what you are allowed to dispatch.

## The three modes

Every lane in the config carries a `mode` of exactly `auto`, `ask` or `reject`.

| mode | what it means for you |
| --- | --- |
| `auto` | Dispatch without asking. The user wrote `auto` there; that IS the approval. |
| `ask` | Get explicit per-request approval in chat first, then re-run with `--approve`. |
| `reject` | Never dispatch. The script refuses and nothing overrides it. |

A lane the config does not mention is treated as `ask`, and the script says the
config did not mention it. There is no setting that makes an unlisted lane `auto`.
An unrecognised mode value is also treated as `ask`.

**Do not edit `.claude/dispatch-config.json`.** If a lane is blocking work, say so
and let the user change it. Changing policy on the user's behalf defeats the point
of the file.

## How to use it

**1. Check the lanes.** This never dispatches anything.

```bash
node .claude/skills/dispatch/check_lanes.js
node .claude/skills/dispatch/check_lanes.js --json          # you are the main consumer
node .claude/skills/dispatch/check_lanes.js --lane composer  # one lane
```

You get lane, mode, availability, state, cost class, model slug and the resolved
binary. Availability is three-valued: `yes`, `NO`, and `unknown`. **`unknown` is not
`yes`** — the script refuses to dispatch it, and so should you.

**2. Write the prompt to a file.** Never pass a prompt as a shell string.

```bash
# write the prompt with the Write tool, then:
node .claude/skills/dispatch/check_lanes.js --lane composer --prompt-file /path/to/prompt.md
```

Prompts are multi-paragraph and contain quotes, backticks and newlines. The script
reads the file and passes it as one element of an argv array with no shell involved,
so none of that can be reinterpreted. A prompt inlined into a command string will be
corrupted, and on Windows it can be partly *executed*.

**3. Respect what comes back.**

| exit | meaning | what you do |
| --- | --- | --- |
| 0 | ran, or dry-run, or probe | relay the result and the token usage |
| 2 | approval required (`ask`) | show the user the command and the cost, ask, wait |
| 3 | refused (`reject`) | tell the user the config forbids it. Do not work around it |
| 4 | lane unavailable | report the stated reason. Do not try another transport |
| 5 | usage or config error | fix the invocation, or report the config problem |
| 6 | dispatch failed | relay stderr and the exit status |

**4. After the user says yes to an `ask` lane**, re-run the identical command with
`--approve`. Never pass `--approve` in the same turn as the request — the approval
must come from the user in chat first. `--approve` never overrides `reject` and
never overrides an unavailable lane.

Use `--dry-run` whenever you want to show the user what would happen. It never
executes, whatever the mode says.

## Which lane gets the job

From the working agreement in `CLAUDE.md`:

| lane | speed | give it | do not give it |
| --- | --- | --- | --- |
| `antigravity` | very fast | frontend work | — |
| `deepseek` | fast | backend implementation **and** review | **anything visual — it has no vision** |
| `minimax` | slow | review, critique, verification | implementation |
| `composer` | moderate | **long multi-file implementation runs** | — |
| `grok` | moderate | analysis, research, single-shot code | long autonomous agent runs — its agentic coding regressed against 4.5 |
| `codex` | moderate | all-rounder; punches above its size | see the risk note below |

Composer for the long build, Grok for the thinking. Routing them the other way round
is the mistake that table exists to prevent.

Hand *review* work to minimax or deepseek rather than implementation.

**At desk vs away changes the routing.** While the user is at their desk they drive
these tools themselves and want plans, not agent runs — dispatching duplicates what
they can do faster. When they are away, dispatching is the point.

## Cost and risk, per lane

- **`codex` is the highest-risk lane.** The user's `~/.codex/config.toml` sets
  `sandbox_mode = "danger-full-access"` and runs report `approval: never`, so it
  operates with full filesystem access and no prompts. It can delete or rewrite
  anything the account can reach. Treat a codex dispatch as consequential and say so
  when asking. **Never change that config** — not to make it safer, not for a single
  run. It is the user's setting.
- **`deepseek` is metered.** Real money per call. Say so before asking.
- **`antigravity` has a ~16k input-token floor per call.** There is no cheap `agy`
  call, so batch small questions rather than making several.
- **`composer` and `grok` share one Cursor allowance.** Composer is the only lane
  rated for long multi-file agentic runs, so Grok spending comes directly out of a
  lane with no substitute. Prefer Grok for analysis and single-shot reasoning, and
  keep the budget for Composer's long builds. This is routing judgement, not
  something the script enforces.
- **`minimax` is included** — unlimited weekly, but a limited rolling 5-hour window.

### `-fast` Cursor slugs

The model slug is a per-lane config field. The lanes default to `composer-2.5` and
`cursor-grok-4.6-low`. If the user configures a slug containing `-fast`, the script
prints a prominent warning naming the non-fast alternative and then **proceeds** —
it is the user's allowance to spend. Surface that warning to the user; do not
silently swallow it, and do not refuse the run over it.

## Token usage

Every lane returns JSON, and the script parses a usage block out of it and reports
input, output, total, cache and cost. Two things to know:

- **A field that was not reported reads `null`, never `0`.** `Number(null) === 0`, so
  a zero here would be a fabricated measurement. If you see `null`, say "not
  reported", not "zero".
- **The per-lane usage shapes have not been verified against a live dispatch**
  (verifying would mean spending the user's budget). The parser searches for a
  `usage` / `tokenUsage` / `tokens` block anywhere in the output and reports which
  field paths it read, under `usage.fieldsFound`. When it finds nothing it returns
  `usage: null` with a `usageReason` explaining why. If a real dispatch comes back
  with `usage: null` and the raw stdout clearly contains counts, the parser needs a
  new alias — report that rather than guessing a number.

## What the script guarantees regardless of the config

1. A lane whose probe is not `ready` is never dispatched — including `unknown`.
2. `--dry-run` never executes.
3. `reject` cannot be overridden by any flag.
4. The prompt is never passed through a shell.
5. It never edits the config, and never edits `~/.codex/config.toml`.

It does **not** downgrade or override any mode. The config is authoritative.

## Notes on the plumbing

Availability probing distinguishes *not installed* from *installed but
unauthenticated*, because they need different fixes: `opencode auth list` plus the
provider key in the opencode credential store (keys only — no credential values are
ever read), `agy models`, `cursor-agent --list-models`, `codex login status`. A probe
that cannot decide reports `unknown` and blocks the dispatch.

Probing does spawn each CLI, but only for those metadata commands. They consume no
tokens and cost nothing.

`cursor-agent` and `codex` ship as `.cmd` shims that Git Bash cannot resolve by bare
name. The script resolves each shim down to its real payload and spawns that directly
rather than going through `cmd.exe`, because `cmd.exe` re-parses the argument — `&`,
`|`, `^` and `%VAR%` become active and a prompt containing a double quote is silently
corrupted. If a shim's payload cannot be found, the lane reports unavailable rather
than falling back to the shell. PATH order is not trusted on its own: every candidate
is tried until one resolves, because a stale shim can sit earlier in PATH than the
real install.
