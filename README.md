# textQuest

textQuest is a planned text adventure game. It will build adventures from
authored stories and game rules, without using an LLM while you play.

This repository includes a Docker-run browser placeholder, the rules for
repeatable adventure settings and share words, a world model with a
winnability checker, and deterministic light fantasy world generation.
The game itself is not implemented.

## Version 1 authored content

[Issue #26](https://github.com/juadielon/textQuest/issues/26) adds a typed
content format in `src/content/v1/` and the light fantasy pack. It is not
connected to the browser. The generator uses its authored plans.

The pack has 24 places, motivated characters, items, clues, 12 required puzzle
templates across four families, optional discoveries, route choices and
endings. Three plots use different puzzle dependency graphs: restoring a
warning chain, finding a missing keeper and renewing a river pact. Their
authored length plans select 8 places and 4 steps for short adventures,
16 places and 8 steps for medium, or 24 places and 12 steps for long.

[Issue #33](https://github.com/juadielon/textQuest/issues/33) adds a science
fiction pack in the same format and sizes, set on a space station. Its three
plots guide an overdue supply ship home, wake a quiet station and honour the
station charter. It has the same kinds of checks and its own digest pin.

The content unit tests build the fixed plans as `AdventureWorld` fixtures
and check every plan and ending for winnability. They do not check commands
or puzzle answers.

Prose is an array of literal text and typed entity references. A later
renderer must resolve references to included entity names, never execute
text as code. Place descriptions stay true across puzzle states; clue text
is shown only after discovery. Puzzle prompts appear before completion,
and completion text only after its step.
Never expose `solution` as a hint or player-facing text.

After reaching the goal, choose the last matching ending from the plot's
ordered `endingIds`. A force consequence takes priority over a peaceful
choice if both were taken. Both shortcuts can be opened; version 1 does not
remove progress or make choices mutually exclusive. The force choice is a
non-graphic shove, not a combat system.

This is released data: changing version 1 IDs, prose, array order, selections,
conditions or effects after merge requires a new content version. A test pins
the complete pack's SHA-256 digest. Do not update that pin to hide a released
content change. Existing share words and player saves are unchanged.

## Version 1 world generation

[Issue #31](https://github.com/juadielon/textQuest/issues/31) adds
`generateAdventureWorld(settings)` in `src/generate-world.ts`. It accepts
valid version 1 settings whose seed chooses light fantasy. Cosy mystery and
science fiction settings throw a clear `RangeError` until the generator uses
their packs ([issue #40](https://github.com/juadielon/textQuest/issues/40));
invalid settings and a genre that does not match the seed are also rejected.
The existing genre and share-word rules are unchanged.

The first seeded draw chooses the genre, and the second chooses one of the
pack's three plots in authored order. Length selects that plot's fixed plan:
8 places and 4 required steps for short, 16 and 8 for medium, or 24 and 12
for long. Exits keep both selected endpoints; items and clues keep selected
initial places or no initial place. Optional steps at selected places remain
available. Plot dependencies are added to each step's local conditions, and
the goal requires **all** selected required steps as well as its authored
conditions.

The returned world contains engine data, not plot prose, character
descriptions or player progress. It is a detached copy: generation and callers
cannot change the pack through it. Unit tests cover all nine plot/length
combinations, optional routes and winnability, seed variation, share-word
round trips, and pinned complete worlds. Changes to these generator rules
require a new adventure version. This is not command handling, browser
rendering or a playable game.

## Adventure settings and share words

[Issue #3](https://github.com/juadielon/textQuest/issues/3) adds the code that
describes how an adventure starts. It is not yet connected to the page, and it
does not create stories on its own.

- A new adventure gets a random seed from the browser's cryptographic random
  numbers. The player chooses a short, medium or long adventure.
- The seed and version always choose the same genre: light fantasy, cosy
  mystery or science fiction.
- A share word, such as `silverlantern`, joins two words from fixed lists. It
  holds the seed and length, so it describes about 65,000 different starting
  adventures. It never includes player progress or save data.
- Share words ignore capitals, spaces and hyphens. Misspelt words, and words
  from newer versions such as `silverlantern2`, are rejected with a clear
  message.
- Version 1 must always give the same results. Changes that would alter them
  need a new version with its own word lists. Unit tests pin both complete
  ordered lists to fixed released fixtures, showing any changed words.

Seeded choices use exact integer maths for 1 to 4,294,967,295 options.
Version 1's three-genre choices and released share words are unchanged.

## World model and winnability

[Issue #12](https://github.com/juadielon/textQuest/issues/12) adds plain
TypeScript data for places, directed exits, items, clues, puzzle steps and a
goal. `AdventureWorld.version` describes this data format, separately from
the seed and content version used by share words. Puzzle conditions, effects
and the goal live in `solution`, separate from discoverable world data.
Future hints and suggestions must not expose this field directly.

`checkWinnability(world)` searches routes from the starting place without
changing the world. For a fully checked world it returns `winnable` and
`unreachableStepIds`, including optional steps that cannot be completed even
when the goal is reachable.
Invalid references, empty or repeated IDs, unsupported world versions and
unknown effects throw a `RangeError` rather than reporting a valid adventure.
It accepts typed world data, not untrusted save files.

Version 1 progress only grows: entering a place collects its items and clues;
steps can require held items, visited places, completed steps and revealed
clues. All conditions must hold. Steps happen at their named place, once,
and can unlock directed exits, give items or reveal clues. The goal requires
being at its named place with its conditions met. Items are not consumed,
and choices cannot remove progress or exclude other steps in this version.

The checker keeps each route's progress separate, including on one-way
paths. Places the player can walk to and back from are checked together as
one area, because visiting them all only adds progress. Choices between
one-way paths still create separate routes.

[Issue #16](https://github.com/juadielon/textQuest/issues/16) limits the
search to `MAX_SEARCH_STATES` (10,000) states, so a large world cannot freeze
the page. A world that needs more returns `{ winnable: false, tooLarge: true }`
instead. It must be treated as rejected, never as winnable. The same world
always gives the same result, whatever the time, locale or browser. Tests show
long worlds with 28 places and 14 required steps finish within the limit. The
limit is a cautious first value. Generator tests also check the authored
light fantasy worlds, including every long plot, within this limit.
There is no rendered story, player command handling or playable adventure.

## Project documents

- [Roadmap](ROADMAP.md): planned milestones and their current status.
- [Contributing](CONTRIBUTING.md): how to report work, make changes and open a
  pull request.

## Planned game

Players will be able to create an adventure, save and resume their progress,
and share a code so other people can start the same adventure. The shared
adventure will not include the creator's progress.

Each adventure will combine a setting, connected places, clues, puzzles and
choices. Some story details may repeat. The game will not use an LLM at
runtime.

## Development

You will need Docker with Linux containers and a web browser. Install
dependencies in a container the first time, then start the development server:

```sh
docker compose run --rm app npm ci
docker compose up app
```

Open <http://localhost:5173>. Run the checks in containers:

```sh
docker compose run --rm app npm test
docker compose run --rm app npm run lint
docker compose run --rm app npm run build
```

ESLint checks all TypeScript in `src/`, including tests, with
typescript-eslint's recommended rules. These are syntax-based checks, not
type-aware rules. The linter uses TypeScript 6 because typescript-eslint does
not yet support TypeScript 7. Builds still use TypeScript 7 through the
`typescript-native` package alias.

To serve the production build in a container, open <http://localhost:8080>:

```sh
docker compose --profile production up --build production
```

Stop a running service with `Ctrl+C`. Node.js, npm and project dependencies
do not need to be installed on the host.

Every code change must include a unit test for the behaviour it changes. A
build or browser smoke check does not replace that test. See
[Contributing](CONTRIBUTING.md) for the test and review rules.

## Building and hosting

textQuest builds to plain static files: HTML, CSS, JavaScript and an icon.
It needs no game server, database, API key or LLM, so any static web host
can serve it. The current build is the browser placeholder, not a playable
game.

### Build

```sh
docker compose run --rm app npm run build
```

This type-checks the code, then writes the site to `dist/`. Each build
replaces `dist/`, and Git ignores it. Upload everything inside `dist/`,
keeping the `assets/` folder next to `index.html`.

### Host on a sub-path

By default the build expects to be served from the site root, such as
`https://example.com/`. To serve it from a folder, such as
`https://example.com/textQuest/`, pass Vite's `--base` option with leading
and trailing slashes:

```sh
docker compose run --rm app npm run build -- --base=/textQuest/
```

The page then loads its files from `/textQuest/assets/`. Upload `dist/` to
that folder on the host.

### Preview the production build

To check a root build with the same nginx container used for production,
open <http://localhost:8080>:

```sh
docker compose --profile production up --build production
```

This builds a fresh copy inside the image, so it does not use your `dist/`.
It always serves from the root.

To preview the `dist/` you built, including a sub-path build, run Vite's
preview server. Use the same `--base` you built with, or leave it out for a
root build:

```sh
docker compose run --rm --service-ports app npx vite preview --host 0.0.0.0 --port 5173 --strictPort --base=/textQuest/
```

Open <http://localhost:5173/textQuest/>. Stop it with `Ctrl+C`; if the
container keeps running, find it with `docker ps` and remove it with
`docker rm -f <name>`.

## Planned features

The initial plan includes:

- Three settings: light fantasy, cosy mystery and science fiction.
- Short, medium and long adventures, with different amounts of places and
  required puzzles.
- Typed actions, with suggestions limited to things the player has found.
- Optional hints, save files, undo and recovery checkpoints.
- Choices that can change the story, including occasional non-graphic violence.
  There will be no turn-based combat system.

These are plans, not features in the current repository. See the
[roadmap](ROADMAP.md) for the order of work.

## Contributions

Start with a GitHub issue before making a change. Keep commits and pull
requests focused, and use clear descriptions of what changed. Read
[CONTRIBUTING.md](CONTRIBUTING.md) before contributing.
