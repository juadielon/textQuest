# textQuest roadmap

This roadmap shows the intended order of work. It has no delivery dates.
Features stay marked as planned until they are built and checked.

## Goal

Make a text adventure game that builds replayable, shareable adventures from
authored content and game rules. It must work without an LLM at runtime, and
all development tools must run in Docker.

## Milestones

### 1. Project rules and overview

**Status:** Implemented on a branch; awaiting review —
[issue #1](https://github.com/juadielon/textQuest/issues/1).

**Outcome:** Contributors can understand the project, plan work through
issues, make small Conventional Commits and prepare focused pull requests.
The README and roadmap clearly separate plans from working features.

**Includes:** README, contribution guidance, Copilot instructions, issue
templates and pull request template.

### 2. Docker development setup

**Status:** Done — issue #2, pull request #5

**Outcome:** Contributors can install project dependencies, run the browser
placeholder, build it and run tests through Docker, without installing
Node.js or npm on the host.

**Depends on:** Milestone 1.

The Docker-based TypeScript and Vite shell, placeholder page, production
container and a small test are in place. The game is not implemented.

### 3. Repeatable adventures and sharing

**Status:** In progress — versioned settings and share words implemented:
[issue #3](https://github.com/juadielon/textQuest/issues/3)

**Outcome:** A shared game code recreates the same starting adventure. The
creator's personal progress stays in their own save.

**Depends on:** Milestone 2.

The first step provides versioned adventure settings (seed, length and genre) and
two-word share words such as `silverlantern`, with unit tests. Share words are
not yet shown in the browser, and adventures are not generated from them yet.

### 4. Stories, places and puzzles

**Status:** In progress — world model and winnability checker implemented on
a branch; awaiting review:
[issue #12](https://github.com/juadielon/textQuest/issues/12)

**Outcome:** Adventures have connected places, story goals, clues, items and
several kinds of solvable puzzles. The player can find optional details and
make choices that change routes or endings.

**Depends on:** Milestone 3.

The first step provides versioned plain data and a pure route search, checked
against hand-built worlds. Puzzle solutions are separate from discoverable
data. Genre content, generation, puzzle families, story choices and playable
adventures are not implemented. The current rules only add progress; later
choice rules will need their own checks.

### 5. Commands and recovery

**Status:** Planned

**Outcome:** Players can act through typed commands with suggestions, request
hints, undo actions and return to checkpoints. Occasional non-graphic violent
choices can change the story; there is no turn-based combat system.

**Depends on:** Milestones 3 and 4.

### 6. Saves

**Status:** Planned

**Outcome:** Players can save several adventures in their browser and export
or import save files. Invalid files and storage errors are reported clearly.

**Depends on:** Milestones 3 and 5.

### 7. Browser game

**Status:** Planned

**Outcome:** A responsive, accessible browser app brings together adventure
creation, play, clues, inventory, sharing and saves.

**Depends on:** Milestones 2–6.

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
