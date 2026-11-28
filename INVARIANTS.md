# ABYX Invariants

These rules apply to every agent, tool, service, and automation.

1. A model response, role label, UI state, or generated report is not evidence of completed work. Completion requires recorded independent verification.
2. Every tool call goes through the Tool Gateway with schema validation, policy evaluation, bounded output, audit events, timeout, and cancellation.
3. File mutations must remain inside the active approved workspace. Do not weaken path, symlink, `.git`, credential, or sensitive-path protections.
4. High-risk or destructive actions require the current approval contract. Approval is scoped to the reviewed action and expires after use.
5. A normal host folder is not a security sandbox. UI and logs must state the actual isolation tier.
6. Never write credentials to logs, task context, transcripts, events, test fixtures, or generated reports.
7. Do not silently overwrite user changes, discard dirty Git state, or replay destructive work during recovery.
8. Failed, blocked, cancelled, partial, and unverified are first-class outcomes. They must not be converted into success states.
9. Persistent state is append-oriented and recoverable. A restart must preserve enough state to make a safe resume decision.
10. Run `npm run validate` before reporting a repository change as verified.

## File size budget

- Root and module `AGENTS.md` files should stay below 200 lines.
- Each `.agents/skills/*/SKILL.md` should stay below 100 lines and link to detailed material instead of duplicating it.
