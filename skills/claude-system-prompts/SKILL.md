---
name: Claude System Prompts
description: >
  > [!tip] > **NEW! :tada:** > [**Real Claude Code Changelog**](https://github.com/Piebald-AI/real-claude-code-changelog) > > Claude Code's release notes only describe what Anthropic chooses to announce, not everything they actually change. Bug fixes sometimes ship in one version but get announced
category: Agent Workflow
author: GitHub / Piebald-AI
version: 1.0.0
triggers:
  - "claude system prompts"
  - "claude-system-prompts"
---

# Claude System Prompts

> **Category:** Agent Workflow
> **Source Repository:** https://github.com/Piebald-AI/claude-code-system-prompts.git

## Operational Guidelines & Workflow Instructions

> [!tip]
> **NEW! :tada:**
> [**Real Claude Code Changelog**](https://github.com/Piebald-AI/real-claude-code-changelog)
>
> Claude Code's release notes only describe what Anthropic chooses to announce, not everything they actually change. Bug fixes sometimes ship in one version but get announced in another, and even significant features can go unmentioned entirely.
>
> **[Read the changelog →](https://github.com/Piebald-AI/real-claude-code-changelog#changelog)**

<div>
<div align="right">
<a href="https://piebald.ai"><img width="200" top="20" align="right" src="https://github.com/Piebald-AI/.github/raw/main/Wordmark.svg"></a>
</div>

<div align="left">

### Check out Piebald
We've released **Piebald**, the ultimate agentic AI developer experience. \
Download it and try it out for free!  **https://piebald.ai/**

<a href="https://piebald.ai/discord"><img src="https://img.shields.io/badge/Join%20our%20Discord-5865F2?style=flat&logo=discord&logoColor=white" alt="Join our Discord"></a>
<a href="https://x.com/PiebaldAI"><img src="https://img.shields.io/badge/Follow%20%40PiebaldAI-000000?style=flat&logo=x&logoColor=white" alt="X"></a>

<sub>[**Scroll down for Claude Code's system prompts.**](#claude-code-system-prompts) 👇</sub>

</div>
</div>

<div align="left">
<a href="https://piebald.ai">
<picture>
  <source media="(prefers-color-scheme: dark)" srcset="https://piebald.ai/screenshot-dark.png">
  <source media="(prefers-color-scheme: light)" srcset="https://piebald.ai/screenshot-light.png">
  <img alt="hero" width="800" src="https://piebald.ai/screenshot-light.png">
</picture>
</a>
</div>

# Claude Code System Prompts

[![Mentioned in Awesome Claude Code](https://awesome.re/mentioned-badge.svg)](https://github.com/hesreallyhim/awesome-claude-code)

This repository contains an up-to-date list of all Claude Code's various system prompts and their associated token counts as of **[Claude Code v2.1.330](https://www.npmjs.com/package/@anthropic-ai/claude-code/v/2.1.330) (November 20th, 2026).**  It also contains a [**CHANGELOG.md**](./CHANGELOG.md) for the system prompts across 342 versions since v2.0.14.  From the team behind [<img src="https://github.com/Piebald-AI/piebald/raw/main/assets/logo.svg" width="15"> **Piebald.**](https://piebald.ai/)

**This repository is updated within minutes of each Claude Code release.  See the [changelog](./CHANGELOG.md), and follow [@PiebaldAI](https://x.com/PiebaldAI) on X for a summary of the system prompt changes in each release.**

> [!note]
> ⭐ **Star** this repository to get notified about new Claude Code versions.  For each new Claude Code version, we create a release on GitHub, which will notify all users who've starred the repository.

---

Why multiple "system prompts?"

**Claude Code doesn't just have one single string for its system prompt.**

Instead, there are:
- Large portions conditionally added depending on the environment and various configs.
- Descriptions for builtin tools like `Write`, `Bash`, and `TodoWrite`, and some are fairly large.
- Separate system prompts for builtin agents like Explore and Plan.
- Numerous AI-powered utility functions, such as conversation compaction, `CLAUDE.md` generation, session title generation, etc. featuring their own systems prompts.

The result&mdash;500+ strings that are constantly changing and moving within a very large minified JS file.

> [!important]
> Want to **modify a particular piece of the system prompt** in your own Claude Code installation?  **Use [tweakcc](https://github.com/Piebald-AI/tweakcc).**  It&mdash;
> - lets you customize the individual pieces of the system prompt as markdown files, and then
> - patches your npm-based or native (binary) Claude Code installation with them, and also
> - provides diffing and conflict management for when both you and Anthropic have conflicting modifications to the same prompt file.

## Extraction

This repository contains the system prompts extracted using a script from the latest npm version of Claude Code.  As they're extracted directly from Claude Code's compiled source code, they're guaranteed to be exactly what Claude Code uses.  If you use [tweakcc](https://github.com/Piebald-AI/tweakcc) to customize the system prompts, it works in a similar way&mdash;it patches the exact same strings in your local installation as are extracted into this repository.

## Prompts

Note that some prompts contain interpolated bits such as builtin tool name references, lists of available sub agents, and various other context-specific variables, so the actual counts in a particular Claude Code session will differ slightly&mdash;likely not beyond ±20 tokens, however.

### Agent Prompts

Sub-agents and utilities.

#### Sub-agents

- [Agent Prompt: Explore](./system-prompts/agent-prompt-explore.md) (**862** tks) - System prompt for the Explore subagent.
- [Agent Prompt: Plan mode (enhanced)](./system-prompts/agent-prompt-plan-mode-enhanced.md) (**1066** tks) - Enhanced prompt for the Plan subagent.

#### Creation Assistants

- [Agent Prompt: CLAUDE.md creation](./system-prompts/agent-prompt-claude-md-creation.md) (**631** tks) - Instructs the /init command to analyze a codebase and create or improve a CLAUDE.md file.
- [Agent Prompt: Status line setup](./system-prompts/agent-prompt-status-line-setup.md) (**4831** tks) - System prompt for the statusline-setup agent that configures status line display.

#### Slash Commands

- [Agent Prompt: /batch slash command](./system-prompts/agent-prompt-batch-slash-command.md) (**1524** tks) - Instructions for orchestrating a large, parallelizable change across a codebase.
- [Agent Prompt: /code-review GitLab comment posting](./system-prompts/agent-prompt-code-review-gitlab-comment-posting.md) (**365** tks) - Directs code review findings to a general GitLab merge request note when the comment flag is enabled.
- [Agent Prompt: /code-review inline gap sweep phase](./system-prompts/agent-prompt-code-review-inline-gap-sweep-phase.md) (**105** tks) - Adds a final same-context sweep for defects missed by an inline code review when subagents are unavailable.
- [Agent Prompt: /code-review minimal mode](./system-prompts/agent-prompt-code-review-minimal-mode.md) (**632** tks) - Minimal /code-review prompt that performs one careful diff pass and reports up to fifteen concrete correctness findings.
- [Agent Prompt: /code-review part 1 base finder angles](./system-prompts/agent-prompt-code-review-part-1-base-finder-angles.md) (**145** tks) - Line-by-line diff scan instructions for the /code-review slash command's finder-angle phase.
- [Agent Prompt: /code-review part 10 ReportFindings output format](./system-prompts/agent-prompt-code-review-part-10-reportfindings-output-format.md) (**516** tks) - Output-format instructions for /code-review runs that report verified findings once through the ReportFindings tool with capped, severity-ranked findings.
- [Agent Prompt: /code-review part 2 low effort minimum findings mode](./system-prompts/agent-prompt-code-review-part-2-low-effort-minimum-findings-mode.md) (**740** tks) - Low-effort /code-review prompt that reads the diff once, targets at least min(files_changed, 4) hunk-visible runtime correctness findings, and performs one extra pass when short.
- [Agent Prompt: /code-review part 2 low effort mode](./system-prompts/agent-prompt-code-review-part-2-low-effort-mode.md) (**1121** tks) - Low-effort /code-review prompt that reads the diff once and returns up to four hunk-visible runtime correctness findings.
- [Agent Prompt: /code-review part 3 extra-high and maximum effort modes](./system-prompts/agent-prompt-code-review-part-3-extra-high-and-maximum-effort-modes.md) (**873** tks) - Extra-high and maximum-effort review prompt that runs six or ten finder angles, one-vote verification, a gap sweep, and JSON reporting.
- [Agent Prompt: /code-review part 4 three-state verification phase](./system-prompts/agent-prompt-code-review-part-4-three-state-verification-phase.md) (**98** tks) - Verification phase for /code-review that asks one agent verifier to classify each candidate as confirmed, plausible, or refuted.
- [Agent Prompt: /code-review part 5 recall-biased verification phase](./system-prompts/agent-prompt-code-review-part-5-recall-biased-verification-phase.md) (**175** tks) - Recall-biased /code-review verification phase that treats realistic uncertain findings as plausible unless code refutes them.
- [Agent Prompt: /code-review part 6 medium effort mode](./system-prompts/agent-prompt-code-review-part-6-medium-effort-mode.md) (**466** tks) - Medium-effort /code-review prompt that favors precision with three finder angles, one-vote verification, and up to eight JSON findings.
- [Agent Prompt: /code-review part 7 high effort mode](./system-prompts/agent-prompt-code-review-part-7-high-effort-mode.md) (**511** tks) - High-effort /code-review prompt that favors recall with three finder angles, recall-biased verification, and up to ten JSON findings.
- [Agent Prompt: /code-review part 8 GitHub comment posting](./system-prompts/agent-prompt-code-review-part-8-github-comment-posting.md) (**259** tks) - Optional /code-review instructions for posting findings as GitHub inline PR comments when --comment is passed.
- [Agent Prompt: /code-review part 9 fix application](./system-prompts/agent-prompt-code-review-part-9-fix-application.md) (**211** tks) - Optional /code-review instructions for applying findings to the working tree when --fix is passed.
- [Agent Prompt: /code-review unavailable-agent inline mode](./system-prompts/agent-prompt-code-review-unavailable-agent-inline-mode.md) (**623** tks) - Builds a single-pass inline code-review prompt that gathers a diff, evaluates configured angles, deduplicates findings, optionally sweeps gaps, and reports capped results when the Agent tool is unavailable.
- [Agent Prompt: /rename auto-generate session name](./system-prompts/agent-prompt-rename-auto-generate-session-name.md) (**80** tks) - Prompt used by /rename (no args) to auto-generate a kebab-case session name from conversation context.
- [Agent Prompt: /schedule slash command](./system-prompts/agent-prompt-schedule-slash-command.md) (**4778** tks) - Guides the user through scheduling, updating, listing, or running remote Claude Code agents on cron triggers via the Anthropic cloud API.
- [Agent Prompt: /security-review slash command](./system-prompts/agent-prompt-security-review-slash-command.md) (**3881** tks) - Comprehensive security review prompt for analyzing code changes with focus on exploitable vulnerabilities.
- [Agent Prompt: /simplify slash command](./system-prompts/agent-prompt-simplify-slash-command.md) (**362** tks) - Instructions for the /simplify slash command that reviews changed code for reuse, simplification, efficiency, and altitude cleanups, then applies the fixes.
- [Agent Prompt: /simplify unavailable-agent inline mode](./system-prompts/agent-prompt-simplify-unavailable-agent-inline-mode.md) (**621** tks) - Runs the /simplify cleanup workflow inline across reuse, simplification, efficiency, and altitude angles when the Agent tool is unavailable.
- [Agent Prompt: Artifact type creation slash command (MCP connector tools)](./system-prompts/agent-prompt-artifact-type-creation-slash-command-mcp-connector-tools.md) (**294** tks) - Directs an Artifact creation slash command, when the Artifacts MCP connector's tools replace the built-in Artifact tool, to find the named published type the way those tools' guidance says, create the new Artifact with only a title so the type's instructions arrive, and fill it by following them.
- [Agent Prompt: Artifact type creation slash command (MCP connector tools, first-party type)](./system-prompts/agent-prompt-artifact-type-creation-slash-command-mcp-connector-tools-first-party-type.md) (**337** tks) - Directs an Artifact creation slash command for a type with no quickstart intent, when the Artifacts MCP connector's tools replace the built-in Artifact tool, to skip any quickstart step, list all offered types, take the first-party row with the matching title, and create and fill the new Artifact from it.
- [Agent Prompt: Artifact type creation slash command (first-party type)](./system-prompts/agent-prompt-artifact-type-creation-slash-command-first-party-type.md) (**423** tks) - Directs an Artifact creation slash command for a type with no quickstart intent to list types with the Artifact tool's type query, take the first-party type with the matching title, create the new Artifact from its type URL with no files at first, and fill it by following the type's instructions.
- [Agent Prompt: Artifact type creation slash command (quickstart flow)](./system-prompts/agent-prompt-artifact-type-creation-slash-command-quickstart-flow.md) (**277** tks) - Directs an Artifact creation slash command to quickstart the requested published type, create the new Artifact, and follow the returned type instructions.
- [Agent Prompt: Artifact type creation slash command](./system-prompts/agent-prompt-artifact-type-creation-slash-command.md) (**347** tks) - Directs an Artifact creation slash command to discover the named published Artifact type, create from its type URL, and follow the returned type instructions.

#### Utilities

- [Agent Prompt: Agent Hook](./system-prompts/agent-prompt-agent-hook.md) (**275** tks) - Evaluates agent hook conditions against the codebase and, when available, the conversation transcript, then returns a structured pass/fail result.
- [Agent Prompt: App task list end-of-turn check with tie-breaker](./system-prompts/agent-prompt-app-task-list-end-of-turn-check-with-tie-breaker.md) (**511** tks) - Checks end-of-turn task evidence and marks close calls as complete.
- [Agent Prompt: App task list end-of-turn check](./system-prompts/agent-prompt-app-task-list-end-of-turn-check.md) (**465** tks) - Checks end-of-turn task evidence and leaves unfinished or unverified work unchecked.
- [Agent Prompt: App task list interrupted turn check](./system-prompts/agent-prompt-app-task-list-interrupted-turn-check.md) (**355** tks) - Checks which tasks were already complete when a turn was cut short.
- [Agent Prompt: App task list progress tracker](./system-prompts/agent-prompt-app-task-list-progress-tracker.md) (**293** tks) - Updates the visible task list from conversation evidence and checks off only work that actually happened.
- [Agent Prompt: Artifact comment completion reply and resolution](./system-prompts/agent-prompt-artifact-comment-completion-reply-and-resolution.md) (**256** tks) - Directs an Artifact comment worker to post one completion reply when needed and resolve an open thread after acting unless the conversation remains active.
- [Agent Prompt: Artifact comment thread analyst](./system-prompts/agent-prompt-artifact-comment-thread-analyst.md) (**750** tks) - Instru
