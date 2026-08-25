---
name: dispatch
description: Use when work should be handed to one of the external agent CLIs rather than done inline — delegating an implementation pass, farming out a long multi-file build, getting a second opinion or independent review of a plan or diff, running a fast frontend change, or asking another model to analyse something. Also covers continuing or resuming an earlier conversation with one of those tools, and collecting the output file a dispatch left behind. Covers the lanes minimax, deepseek, antigravity, composer, grok and codex, reached through opencode, agy, cursor-agent and codex. Also use when the user asks which tool should get a job, whether a lane is available or authenticated, what a dispatch would cost, or why a dispatch was refused. Not for work Claude should simply do itself.
version: 1.1.0
user-invocable: true
argument-hint: "[check | <lane> <what to delegate>]"
allowed-tools:
  - Bash(node .claude/skills/dispatch/check_lanes.js *)
  - Bash(node .claude/skills/dispatch/collect_output.js *)
---

This skill routes work to the external agent CLIs installed on this machine. Policy
is not in this file and not in the script — it is in `dispatch-config.json`, which
sits beside this skill at `.claude/skills/dispatch/dispatch-config.json`,
which the user owns and edits. Read that file's `_comment` before assuming anything
about what you are allowed to dispatch.

## THE RULE: the wrapper is the only way in. No workarounds.

**Every dispatch to every lane goes through `check_lanes.js`. Without exception.**

Do **not** invoke `opencode`, `agy`, `cursor-agent` or `codex` directly — not with
`Bash`, not through a shell script, not via a `cd … && …` chain, not by calling
their underlying `node index.js` payloads, not by asking another agent or another
session to run them, and not "just this once because the wrapper is in the way."

This is not a style preference. **The wrapper is where the user's policy lives.**
The modes in `dispatch-config.json`, the cost and risk warnings, the `-fast`
guard, the session pre-flight check, the refusal to run under a missing policy —
none of that exists in the CLIs themselves. A direct call is not a shortcut past
some boilerplate; it is a dispatch that the user never had the chance to
authorise, spending an allowance they are actively managing.

The lane commands documented in `## Notes on the plumbing` are there so the
wrapper's output can be **read and understood**, and so a human can run one
deliberately. They are not an alternative interface for Claude.

**If the wrapper blocks you, that is the system working.** The correct responses
are: tell the user what was refused and why, ask them to approve it, or ask them
to change the mode in the config. The incorrect response is to reach around it.

An approval hook enforces this at the harness level — see `HOOK-DESIGN.md` — but
the rule stands whether or not the hook is installed. Do not treat the absence of
enforcement as permission.

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

**If the config file is missing entirely, the script refuses to run at all**
(exit 5) and names the path it expected. It does not fall back to an implicit
all-ask policy, because `ask` plus `--approve` still dispatches — so a missing
file would otherwise let a lane run under a policy the user never wrote. If you
see that error, tell the user the file is gone rather than working around it with
`--config`.

**Do not edit `.claude/skills/dispatch/dispatch-config.json`.** If a lane is blocking work, say so
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
| 7 | the session named for resume does not exist | report it. Do NOT retry without the resume flag |

**4. After the user says yes to an `ask` lane**, re-run the identical command with
`--approve`. Never pass `--approve` in the same turn as the request — the approval
must come from the user in chat first. `--approve` never overrides `reject` and
never overrides an unavailable lane.

Use `--dry-run` whenever you want to show the user what would happen. It never
executes, whatever the mode says.

## Continuing an earlier conversation

**New task, new session. Resume is for follow-up feedback only.**

Start a fresh session for every new piece of work. Use `--resume` / `--resume-last`
**only** to give feedback on work that lane already has in flight — "you missed
two of the four verdicts", "the suite is red, here is the failure", "that claim
is wrong, here is the evidence".

Never pile an unrelated task onto a warm session just because resuming is cheap.
The accumulated context belongs to the previous task: it inflates the input
tokens of every later call, it drags the earlier task's framing into the new one,
and it destroys the session as a record of what was actually asked. A lane that
has just spent 140k tokens reviewing tests is not a good starting point for an
unrelated migration.


Every lane can resume instead of starting cold:

```bash
node .claude/skills/dispatch/check_lanes.js --lane grok --prompt-file p.md --resume-last
node .claude/skills/dispatch/check_lanes.js --lane codex --prompt-file p.md --resume <id>
```

The two are mutually exclusive — "the most recent" and "this specific one" are
different instructions, so passing both is an error rather than a silent
preference.

**Resuming is dispatching.** A `reject` lane still refuses, an `ask` lane still
needs approval, and an unavailable lane is still not dispatched. Nothing about
resume relaxes the gates.

**A named session that provably does not exist is a hard failure (exit 7), never
a fresh start.** Silently starting cold when the user asked to continue is the
absent-value-as-benign-default bug wearing a different hat, and it is not
hypothetical: measured 2026-08-25, `codex exec resume --last` against a session
store with no recorded sessions did **not** error — it went straight to a model
call. The script checks the session store before dispatching for exactly that
reason.

What can be checked differs by provider, and the output always says which:

| lane | resume-last | resume-id | verifiable? |
| --- | --- | --- | --- |
| minimax, deepseek | `--continue` | `--session <id>` | yes — `opencode session list` |
| codex | `resume --last` | `resume <id>` | yes — `~/.codex/sessions` |
| antigravity | `--continue` | `--conversation <ID>` | **no** — no list command |
| composer, grok | `--continue` | `--resume <id>` | **no** — `ls` is an interactive TUI |

For the unverifiable lanes the output says the session was **NOT VERIFIED**.
Relay that wording; do not upgrade it to "resumed" when reporting to the user.

Both `--dry-run` and the `ask` output print a `session` line naming what would be
continued, so a resume is never mistaken for a fresh start.

Note that codex resume restructures the command into a `resume` **subcommand**
with the id as a positional before the prompt — it is not a flag. The script
builds argv per lane for that reason; do not hand-assemble these commands.

## Collecting a dispatch's output file

`codex` is run with `--output-last-message`, which writes its final answer to a
file — much more reliable than scraping stdout. When the script dispatches codex
itself it collects and deletes that file automatically, leaving nothing behind.

When a lane is `ask`, **the user runs the printed command themselves**, so the
file lands wherever that command put it. Collect it with:

```bash
node .claude/skills/dispatch/collect_output.js <path> [--keep] [--json] [--force]
```

It prints the contents, then deletes the file — but only after a successful read,
and only when the path is one it can plausibly own (under a temp/scratch root, or
with a dispatch-output basename). Anything else is printed and **not** deleted,
with the failed rule named; `--force` overrides and warns. Directories and
symlinks are never deleted.

Keep these states apart when reporting:

- **missing file** (exit 1) — a failure. It is not "the agent replied with
  nothing"; an agent that said nothing would leave an empty file, not no file.
- **empty file** (exit 0) — a real, empty result. It is deleted.
- **refused to delete** (exit 4) — the contents *were* printed; only cleanup was
  skipped. Say so, and name the file so the user can remove it.
- **delete failed** (exit 3) — contents printed, and **the file still exists**.
  Never report cleanup that did not happen.

## Which lane gets the job

From the working agreement in `CLAUDE.md`:

| lane | speed | give it | do not give it |
| --- | --- | --- | --- |
| `antigravity` | very fast | frontend work | — |
| `deepseek` | fast | backend implementation **and** review | **anything visual — it has no vision** |
| `minimax` | slow | review, critique, verification | implementation |
| `composer` | moderate | **long multi-file implementation runs** | — |
| `grok` | moderate | analysis, research, single-shot code (defaults to `cursor-grok-4.6-high`) | long autonomous agent runs — its agentic coding regressed against 4.5 |
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
`cursor-grok-4.6-high`. Only slugs ending in `-fast` warn: the 4.6 family runs
`low`, `medium`, `high`, `xhigh` and a `-fast` variant of each, and the four
non-fast ones are silent. If the user configures a slug containing `-fast`, the script
prints a prominent warning naming the non-fast alternative and then **proceeds** —
it is the user's allowance to spend. Surface that warning to the user; do not
silently swallow it, and do not refuse the run over it.

### Workspace trust on the Cursor lanes (`trustFlag`)

`cursor-agent` refuses to start in a directory it has not been told to trust, and
it cannot prompt when run non-interactively — the dispatch fails immediately with
`Workspace Trust Required`. The fix is an **optional per-lane config field**,
`trustFlag`, on the Cursor lanes only.

It is deliberately not hardcoded. This grants a privilege, so it lives in the
file the user owns and can be revoked by deleting one line, with no code change.

| value | what it grants |
| --- | --- |
| *(omitted, or `null`)* | nothing — no flag is passed |
| `"--trust"` | trusts that directory **only**; every command is still approved individually |
| `"--yolo"` | alias for `--force`, "Run Everything" — **auto-approves every command the agent runs**, unless explicitly denied |
| `"-f"` | short form of `--force`. The same grant as `--yolo` |

Read from `cursor-agent --help` (payload `2026.08.11-e8db854`) on 2026-08-25.
`--trust` is the *smallest* grant that clears the error; `--yolo` and `-f` are
materially larger, because the agent then executes shell commands with no
per-command approval.

**Shipped state:** `composer` is set to `"--yolo"` (approved 2026-08-25, for long
unattended builds). `grok` has **no** `trustFlag` — untested there and not
approved. If a grok dispatch hits the trust error, **ask the user** rather than
adding one; `"--trust"` is the smaller grant to offer.

Three behaviours to rely on:

- **Any flag in force is named, with what it grants, in the `--dry-run` preview
  and the `ask` approval message** — on its own `TRUST:` line and inside the
  reason text. Relay it when you ask for approval. Approving the dispatch is
  approving the grant, and an escalation the user did not see named is worse than
  no approval card at all.
- **An unrecognised value is rejected, never forwarded** (exit 5), naming the
  value and the three accepted ones. That string would otherwise become an
  argument to a CLI. Note `"--force"` itself is *not* accepted — use `"--yolo"`
  or `"-f"`.
- **Set on a non-Cursor lane it is ignored with a warning** and never reaches the
  command line. `opencode`, `agy` and `codex` have no such flag and would reject
  it as an unknown argument.

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
6. A `trustFlag` value it does not recognise fails the dispatch (exit 5) instead
   of being passed to the CLI, and any flag it does accept is named — with what
   it grants — in every preview the user approves from.

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
