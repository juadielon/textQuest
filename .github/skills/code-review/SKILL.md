---
name: code-review
description: 'Review a textQuest pull request, branch or diff against the project rules and report real problems in plain English. Use when asked to "review this", "review my PR", "check this change", "code review" or "/code-review". Checks correctness, unit tests, focused scope, Docker-only tooling, deterministic adventures, save and share-code compatibility, spoiler-free hints, accessibility and honest documentation. Reports findings only and never edits, commits or merges.'
---

# Code review

Review a change the way a careful teammate would before approving it. Find
problems that matter, explain them simply and suggest a fix. Do not change
anything.

Adapted for textQuest from the Awesome Copilot `security-review` and
`review-and-refactor` skills.

## When to use this skill

- Someone asks to review a pull request, branch, commit or local diff.
- An agent has finished a logical step and wants a check before opening its
  pull request.
- Someone runs `/code-review` or `/code-review <path or PR number>`.

## Rules

- Report only. Never edit files, commit, push, approve or merge.
- Only report issues you are confident about. Skip style nitpicks that a
  formatter or the existing code already settles.
- Never say a check passed unless you ran it. Run project tools only in
  Docker, as described in `README.md`. Never install anything on the host.
- Write in simple, natural Australian English.

## Steps

Follow these steps in order.

### 1. Work out the scope

- For a pull request, read its description, linked issue and full diff, for
  example with `gh pr view <number>` and `gh pr diff <number>`.
- For a branch, compare it with its base: `git diff <base>...HEAD`.
- With no target given, review uncommitted changes, then the current branch
  against `main`.
- Read `.github/copilot-instructions.md`, `CONTRIBUTING.md`, `README.md` and
  `ROADMAP.md`. These are the rules the change must follow.

### 2. Read the connected code

Do not review the diff alone. Open the callers, types and tests around each
changed part so you can judge whether the change actually works.

### 3. Check the change

**Correctness**

- Does the code do what the issue and pull request say?
- Are edge cases handled, such as empty input, unknown commands, the first
  and last location, and loading an old or damaged save?
- Could a player get stuck with no way to finish, undo or recover?

**Unit tests**

- Every code change needs a new or updated unit test. Every bug fix needs a
  regression test that would fail without the fix.
- Tests must check behaviour, not just run the code. A build or browser
  smoke check does not count as a unit test.
- If you can, run the tests in Docker and report the exact command and
  result. Otherwise say they were not run.

**Focused scope**

- The pull request should do one logical thing and link its issue.
- About 200–400 changed hand-written lines is a warning sign, not a hard
  limit. Point out unrelated changes or parts that should be a separate pull
  request.
- Commits should follow Conventional Commits with clear descriptions.

**Docker-only tooling**

- New scripts, dependencies and instructions must run in Docker. Flag any
  step that expects Node.js or npm on the host.
- Check new dependencies are needed and come from a trusted source. Flag
  missing lockfile updates.
- Run `docker compose run --rm app npm run lint` and report its result.
  Check that ESLint covers all TypeScript in `src/`, including tests.

**Deterministic adventures**

- The same share code, generator version and content version must always
  create the same starting adventure.
- Flag `Math.random()`, the current date or time, object key order that may
  vary, or any other hidden source of change inside generation.
- Changing generated output for an existing version breaks old share codes.
  It needs a new generator or content version and a note in the pull request.

**Saves and share codes**

- Old saves must still load, or fail with a clear message. Never overwrite a
  player's save without warning.
- Imported saves and share codes are untrusted input. Check they are
  validated before use and cannot inject HTML into the page.

**Fair play**

- Autocomplete and hints must not reveal unseen places, items or puzzle
  answers.
- Every generated adventure must stay winnable.

**Interface and accessibility**

- Text and controls should work with a keyboard and screen reader and have
  readable contrast.
- Game text and error messages should be clear and friendly.

**Documentation**

- `README.md` and `ROADMAP.md` must stay honest. A feature is "working" only
  after it is built and tested.
- The pull request should follow `.github/pull_request_template.md` and list
  only checks that were really run.

### 4. Check each finding again

For each possible problem, reread the code and ask:

1. Is this really a problem, or is it handled somewhere I missed?
2. What would a player, reviewer or maintainer actually notice?
3. How sure am I?

Drop anything that does not hold up.

### 5. Write the report

Start with a one-line verdict: **Ready to approve**, **Approve after small
fixes** or **Needs changes**.

Then list findings, most serious first:

| # | Severity | File | Lines | Problem | Confidence |
|---|----------|------|-------|---------|------------|

Use these severity levels:

| Severity | Meaning |
|----------|---------|
| 🔴 Blocking | Breaks the game, saves, share codes or security, or code changed without unit tests. |
| 🟠 Should fix | A real bug or rule breach that is less likely or easy to work around. |
| 🟡 Consider | A worthwhile improvement that does not block approval. |

For each finding, explain:

- What breaks and why it matters, in one or two short sentences.
- A suggested fix, with a short code snippet when it helps.

Finish with the checks you ran and their results, and anything you could not
check. If you find nothing, say so and list what you reviewed.

End with: "Nothing has been changed. Review each suggestion before applying
it."
