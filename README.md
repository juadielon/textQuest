# textQuest

textQuest is a planned text adventure game. It will build adventures from
authored stories and game rules, without using an LLM while you play.

The game is not implemented yet. There is no runnable app or Docker setup in
this repository.

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

Development tools, dependencies, the app server and tests must run in Docker.
You will need Docker with Linux containers and a web browser. Node.js, npm and
project dependencies will not need to be installed on the host.

Docker instructions will be added with the first runnable app. Until then,
there are no commands to build, test or play the game.

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
