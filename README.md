# textQuest

textQuest is a planned text adventure game. It will build adventures from
authored stories and game rules, without using an LLM while you play.

This repository includes a Docker-run browser placeholder; the game itself is
not implemented.

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
