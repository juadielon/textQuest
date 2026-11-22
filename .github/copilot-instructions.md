# Instructions for Copilot

## Before starting
- Read `README.md`, `ROADMAP.md` and `CONTRIBUTING.md` before making a change.
- Check for a related GitHub issue before starting a task.

## Code style and game rules
- Use simple, natural Australian English in code names, comments, game text,
  issues and documentation. Prefer clear words over jargon.
- Give every new or changed export, class and public method a short TSDoc
  comment in Australian English, and add brief comments to non-obvious
  internal functions. Keep all comments in step with the code.
- Keep shared adventures deterministic across their supported generator and
  content versions. Do not silently change old shared codes or overwrite
  existing player saves.

## Docker, testing and checks
- Run project tools, install dependencies, build and test only inside Docker.
  Do not install Node.js, npm or project dependencies on the host.
- Write or update a unit test for every code change, and add a regression test
  for each bug fix. A build or browser smoke check does not replace a unit test.
- Run linting, unit tests and the build in Docker before calling code complete:
  - `docker compose run --rm app npm run lint`
  - `docker compose run --rm app npm test` *(adjust if your script name differs)*
  - `docker compose run --rm app npm run build`
- Never claim a build, check or test passed unless it was actually run. Say
  explicitly when a check could not be run, and report the exact Docker commands
  and results in the pull request.

## Documentation and pull requests
- Keep `README.md` and `ROADMAP.md` honest and current. Mark a feature as
  working only after it has been built and verified.
- Keep changes focused and reviewable, bundling related tests and docs with the
  code. Do not combine unrelated work or put the whole game into one pull
  request.
- Use Conventional Commits, follow the repository PR template and link the
  related issue.
- Push and open a separate pull request after each completed logical step
  passes its checks. Do not accumulate later features into an existing pull
  request or merge without approval. Make dependencies clear and keep dependent
  diffs focused.
- Before opening a pull request, or when asked to review one, follow the
  `code-review` skill in `.github/skills/code-review/SKILL.md`. Reviews report
  findings only and never change code.