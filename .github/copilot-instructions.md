# Instructions for Copilot

- Read `README.md`, `ROADMAP.md` and `CONTRIBUTING.md` before making a change.
- Use simple, natural Australian English in code names, comments, game text,
  issues and documentation. Prefer clear words over jargon.
- Check for a related GitHub issue before starting a task. Keep changes
  focused, use Conventional Commits and make pull requests reviewable.
- Keep `README.md` and `ROADMAP.md` honest and current. Mark a feature as
  working only after it has been built and checked.
- Run project tools, install dependencies, build and test only inside Docker.
  Do not install Node.js, npm or project dependencies on the host.
- Run `docker compose run --rm app npm run lint` alongside unit tests and the
  build. Report the exact Docker commands and results in the pull request.
- Write or update a unit test for every code change. Add a regression test for
  each bug fix. A build or browser smoke check does not replace a unit test.
  Run the unit tests in Docker and do not call code complete until they pass.
- Give every new or changed export a short TSDoc comment in Australian
  English. Keep it in step with the code.
- Never claim a build or test passed unless it was actually run. Say when a
  check could not be run.
- Keep shared adventures deterministic across their supported generator and
  content versions. Do not silently change old shared codes or overwrite
  existing player saves.
- Include related tests and documentation with a change. Do not combine
  unrelated work or put the whole game into one pull request.
- Push and open a separate pull request after each completed logical step
  passes its checks. Use the repository template and link its issue. Do not
  accumulate later features into an existing pull request or merge without
  approval. Make dependencies clear and keep dependent diffs focused.
- Before opening a pull request, or when asked to review one, follow the
  `code-review` skill in `.github/skills/code-review/SKILL.md`. Reviews report
  findings only and never change code.
