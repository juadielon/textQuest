# textQuest

textQuest is a planned text adventure game. It will build adventures from
authored stories and game rules, without using an LLM while you play.

This repository includes a Docker-run browser placeholder and the rules for
repeatable adventure settings and share words. The game itself is not
implemented.

## Adventure settings and share words

[Issue #3](https://github.com/juadielon/textQuest/issues/3) adds the code that
describes how an adventure starts. It is not yet connected to the page, and it
does not create stories.

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
  need a new version with its own word lists.

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
docker compose run --rm app npm run build
```

To serve the production build in a container, open <http://localhost:8080>:

```sh
docker compose --profile production up --build production
```

Stop a running service with `Ctrl+C`. Node.js, npm and project dependencies
do not need to be installed on the host.

Every code change must include a unit test for the behaviour it changes. A
build or browser smoke check does not replace that test. See
[Contributing](CONTRIBUTING.md) for the test and review rules.

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
