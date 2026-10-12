# Contributing to textQuest

Thanks for helping with textQuest. Keep changes easy to understand and
straightforward to review.

## Before you start

1. Read the [roadmap](ROADMAP.md) to see what is planned.
2. Search the repository's issues for existing work.
3. Open or update an issue before starting a new task. Explain the problem or
   goal and how we will know it is done.
4. Link work to issues and note any issue it depends on.

Use the repository's bug, feature and task templates. Do not guess at missing
facts. Ask for them when they affect the work.

## Keep changes focused

- Make one clear change at a time. Include its related tests and documentation.
- Use a separate pull request for each logical change. Do not put the whole
  game into one pull request.
- Around 200–400 changed lines of hand-written code is a prompt to consider
  splitting a pull request. It is guidance, not a hard limit. Do not remove
  needed tests or make a broken change just to stay under it.
- Call out large content files and generated lockfiles so reviewers know what
  to focus on.
- Do not mix unrelated changes.

## Commit messages

Use [Conventional Commits 1.0.0](https://www.conventionalcommits.org/en/v1.0.0/):

```text
<type>[optional scope]: <clear description>
```

Use `feat` for a new feature and `fix` for a bug fix. Other useful types
include `docs`, `build`, `test`, `refactor`, `ci` and `chore`. Keep each commit
about one logical step, and say what changed in its description. Add a short
body when the reason or impact is not clear from the title.

Examples:

```text
docs: explain the planned game and current status
feat(sharing): recreate adventures from a versioned code
fix(saves): keep existing progress when an import is invalid
```

Reference related issues in the commit body, for example:

```text
Refs: #12
```

Use `Closes #12` only when the pull request fully completes that issue. Mark a
breaking change with `!` after the type or scope, or describe it in a
`BREAKING CHANGE:` footer.

Commit each coherent step after its relevant checks. Review what is staged
before committing. Do not amend or rewrite commits that have already been
shared.

## Docker-only development

Run project tools, dependency installation, app servers, builds and tests in
Docker. Do not install Node.js, npm or project dependencies on the host. Use
Docker volumes for downloaded packages and build caches where needed.

Install dependencies and run the checks in containers:

```sh
docker compose run --rm app npm ci
docker compose run --rm app npm run lint
docker compose run --rm app npm test
docker compose run --rm app npm run build
```

ESLint checks all TypeScript in `src/`, including tests. See the README for
the development server and the linter's TypeScript version requirements.
Report the exact commands and results in the pull request.

## Unit tests

Every code change must include a unit test that checks the behaviour it
changes. Add the test in the same change as the code.

For a bug fix, add a regression test that shows the bug before the fix and
passes after it. Update existing tests when behaviour changes. A successful
build, lint check or browser smoke test does not replace a unit test.

Run the unit tests in Docker. Do not mark a code change complete until its
unit tests pass. If you cannot write a unit test for a proposed code change,
stop and explain the problem before continuing.

## Code documentation

Give every new or changed export a short TSDoc comment (`/** ... */`) in
Australian English. Say what it is for, and note any parameters, return
value, errors and rules that must not change. Keep it brief and update it
when behaviour changes.

## Pull requests

Use the pull request template. A good pull request:

- Has one clear purpose and links the issue it works on.
- Explains what changed and why in plain language.
- Lists only checks that were actually run, including the Docker command and
  result.
- Includes the ESLint check: `docker compose run --rm app npm run lint`.
- Includes passing unit tests for every code change, or says `N/A` only when
  the pull request changes no code.
- Notes changes to README, roadmap, save formats, shared adventure
  compatibility or generated content when relevant.
- Includes screenshots for meaningful browser interface changes when useful.
- Says what remains unfinished rather than implying the whole roadmap is
  complete.

Push the branch and open a pull request when each logical step is complete
and its checks pass. This is the agreed project workflow; do not wait until
the whole game is finished. Keep later features in separate branches and
pull requests. Fixes needed for the same review belong in its existing pull
request.

Copilot agents must run the `code-review` skill in
`.github/skills/code-review/SKILL.md` before opening a pull request, and fix
or explain what it finds. It checks the change against these rules and reports
problems without editing anything. Its report helps the reviewer but does not
replace human approval.

If a step depends on an unmerged pull request, base it on that branch and
target that branch so reviewers see only the new step. State the dependency
clearly. Do not merge pull requests automatically; leave them for approval.

## Writing

Use simple, natural Australian English in documentation, issues, commits,
pull requests, game text and error messages. Prefer short sentences and
concrete words. Explain technical terms when readers need them. Avoid filler,
robotic phrasing and claims that the game does not yet support.

Keep the README and roadmap in step with the code. Clearly label planned,
in-progress and working features. Never expose a player's personal save or
private details in an issue.
