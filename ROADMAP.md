# textQuest roadmap

This roadmap shows the intended order of work. It has no delivery dates.
Features stay marked as planned until they are built and checked.

## Goal

Make a text adventure game that builds replayable, shareable adventures from
authored content and game rules. It must work without an LLM at runtime, and
all development tools must run in Docker.

## Milestones

### 1. Project rules and overview

**Status:** Done — [issue #1](https://github.com/juadielon/textQuest/issues/1),
[pull request #4](https://github.com/juadielon/textQuest/pull/4). A code review skill was added in
[pull request #7](https://github.com/juadielon/textQuest/pull/7).

**Outcome:** Contributors can understand the project, plan work through
issues, make small Conventional Commits and prepare focused pull requests.
The README and roadmap clearly separate plans from working features.

**Includes:** README, contribution guidance, Copilot instructions, issue
templates and pull request template.

### 2. Docker development setup

**Status:** Done — [issue #2](https://github.com/juadielon/textQuest/issues/2),
[pull request #5](https://github.com/juadielon/textQuest/pull/5). ESLint was added in
[pull request #24](https://github.com/juadielon/textQuest/pull/24).

**Outcome:** Contributors can install project dependencies, run the browser
placeholder, build it and run tests through Docker, without installing
Node.js or npm on the host.

**Depends on:** Milestone 1.

The Docker-based TypeScript and Vite shell, placeholder page, production
container and a small test are in place. The game is not implemented.

### 3. Repeatable adventures and sharing

**Status:** In progress — versioned settings and share words merged in
[pull request #11](https://github.com/juadielon/textQuest/pull/11)
([issue #3](https://github.com/juadielon/textQuest/issues/3)). Follow-up fixes merged:
exact large-count picks in [pull request #17](https://github.com/juadielon/textQuest/pull/17) and pinned
version 1 share-word lists in [pull request #18](https://github.com/juadielon/textQuest/pull/18).

**Outcome:** A shared game code recreates the same starting adventure. The
creator's personal progress stays in their own save.

**Depends on:** Milestone 2.

The first step provides versioned adventure settings (seed, length and genre) and
two-word share words such as `silverlantern`, with unit tests. The start
screen ([issue #41](https://github.com/juadielon/textQuest/issues/41)) shows
them in the browser, but does not generate worlds. Version 1 light fantasy settings generate
repeatable engine worlds ([issue #31](https://github.com/juadielon/textQuest/issues/31)),
implemented in [pull request #35](https://github.com/juadielon/textQuest/pull/35).
Generation for other genres remains planned.

### 4. Stories, places and puzzles

**Status:** In progress — world model and winnability checker merged in
[pull request #13](https://github.com/juadielon/textQuest/pull/13)
([issue #12](https://github.com/juadielon/textQuest/issues/12)). A search limit for large
worlds merged in [pull request #22](https://github.com/juadielon/textQuest/pull/22)
([issue #16](https://github.com/juadielon/textQuest/issues/16)). The version 1 content
format and light fantasy pack ([issue #26](https://github.com/juadielon/textQuest/issues/26)) are implemented in
[pull request #30](https://github.com/juadielon/textQuest/pull/30).

**Outcome:** Adventures have connected places, story goals, clues, items and
several kinds of solvable puzzles. The player can find optional details and
make choices that change routes or endings.

**Depends on:** Milestone 3.

The first step provides versioned plain data and a pure route search, checked
against hand-built worlds. Puzzle solutions are separate from discoverable
data. The version 1 content format and light fantasy pack are implemented
in [pull request #30](https://github.com/juadielon/textQuest/pull/30).
The pack includes three plot dependency graphs, four puzzle
families, short/medium/long selections, optional route choices and endings.
Unit tests check the authored plans against the world model and winnability
checker. Deterministic light fantasy world generation is implemented for
[issue #31](https://github.com/juadielon/textQuest/issues/31) in
[pull request #35](https://github.com/juadielon/textQuest/pull/35). The seed chooses a plot, and length selects
its fixed 8/16/24-place and 4/8/12-required-step plan. Tests cover all nine
plot/length combinations, optional routes, winnability and repeatability.
The world contains engine rules, not rendered story text or player progress.
This is not a playable adventure.
The science fiction pack ([issue #33](https://github.com/juadielon/textQuest/issues/33))
follows the same format and checks, but the generator still rejects science
fiction settings until [issue #40](https://github.com/juadielon/textQuest/issues/40)
connects it. Cosy mystery content, its generation and command handling remain
planned; unsupported settings are clearly rejected rather than replaced with
fantasy. The current rules only add progress; mutually exclusive
choices will need later rules and their own checks.

### 5. Commands and recovery

**Status:** In progress — pure typed command parser
([issue #27](https://github.com/juadielon/textQuest/issues/27)) is implemented in
[pull request #29](https://github.com/juadielon/textQuest/pull/29). Running parsed
commands against a world ([issue #36](https://github.com/juadielon/textQuest/issues/36)) builds on it
and awaits review.

**Outcome:** Players can act through typed commands with suggestions, request
hints, undo actions and return to checkpoints. Occasional non-graphic violent
choices can change the story; there is no turn-based combat system.

**Depends on:** Milestones 3 and 4.

The parser returns structured actions or clear errors using only discovered
names supplied by its caller. It handles the planned verbs and common short
forms without changing state. A pure play module runs those actions against a
world with turn counting, hints and undo, following the winnability checker's
rules. Suggestions and checkpoints are not implemented.

### 6. Saves

**Status:** Planned

**Outcome:** Players can save several adventures in their browser and export
or import save files. Invalid files and storage errors are reported clearly.

**Depends on:** Milestones 3 and 5.

### 7. Browser game

**Status:** In progress — a play screen
([issue #44](https://github.com/juadielon/textQuest/issues/44)) is built but not yet
reachable from the page. A start screen for new adventures and share words
([issue #41](https://github.com/juadielon/textQuest/issues/41)) is implemented
in [pull request #46](https://github.com/juadielon/textQuest/pull/46).
Connecting the screens and saves remain planned.

**Outcome:** A responsive, accessible browser app brings together adventure
creation, play, clues, inventory, sharing and saves.

**Depends on:** Milestones 2–6.

`renderPlayScreen` generates a world and plays typed commands with a response
log, inventory, found clues, help, hint, undo and an ending. It works by
keyboard, announces responses to screen readers and fits narrow and wide
screens. Connecting it to the start screen, content-pack names and prose,
and saves remain planned.

### 8. Release checks and hosting guide

**Status:** Planned

**Outcome:** Docker checks cover repeatable generation, puzzle solvability,
saves and main browser flows. The README explains how to run and host the
finished static app.

**Depends on:** Milestone 7.

## Out of scope for the first version

- LLM use while playing.
- Accounts, cloud saves or a game server.
- Turn-based combat, health bars or character levelling.
- A promise that every generated story uses wholly original wording.
- Automatic deployment.

## Keeping this roadmap current

Each milestone should have a clear result and its own issues. Link real issues
and pull requests when they exist. Update a milestone when its scope or
verified progress changes. Do not mark it complete until its outcome has been
checked.

Open a focused pull request after each completed logical step, rather than
one pull request for the whole milestone or game. Keep steps awaiting review
distinct from work that has been merged.
