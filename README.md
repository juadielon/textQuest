# textQuest

textQuest is a text adventure game you play in a web browser. Choose how
long you want to play, explore by typing commands, find items and clues, and
solve puzzles. The game is still in development.

Adventures are built from written content and game rules. They do not use AI
to generate the story while you play.

## Playing

1. Choose a short, medium or long adventure and select
   **Start new adventure**. The game chooses a genre for you: light fantasy, cosy
   mystery or science fiction.
2. Type a command in **What do you do?** and press Enter. Try `look` to see
   where you are, `go` followed by a place's name to move, or `take`
   followed by an item's name to pick it up. Type `use` followed by an item
   you are carrying to try it. Use the names shown in the game.
3. Type `help` for more commands, `hint` for a nudge, `inventory` to see what
   you are carrying, or `undo` to go back a turn.

A short adventure has 8 places and 4 required puzzle steps. A medium one has
16 places and 8 steps; a long one has 24 places and 12 steps. There are also
optional discoveries. The screen shows your inventory, found clues and turn
count.

The screens have keyboard controls and announce new responses to screen
readers. They have not yet been checked with a real screen reader.

### What's unfinished

The game is playable, but the written story descriptions and names are not
shown yet. Places and items currently use simple names based on their
internal labels. Command suggestions and recovery checkpoints are also
planned. Hand-built world-format version 2 adventures support mutually
exclusive choices and winning endings, but released generators do not expose
them. Failure endings remain blocked until checkpoint recovery is available.
There is no turn-based combat.

## Sharing an adventure

Each adventure has a **Share word** and an **Adventure link**. Give either to
someone else and they can start the same adventure from the beginning. They
will get the same genre, length, places and puzzles, but not your progress.
Older share words still open their original starting adventures, and older
saves still resume their saved progress.

To open a word, enter it under **Open a shared adventure** on the start
screen. Capitals, spaces and hyphens are fine. To share a link, select
**Copy link** on the play screen, or copy it from the link field yourself.

The link uses the address where you opened the game. If you want someone on
another computer to use it, share a publicly hosted address: a `localhost`
link points to their own computer, not yours.

A share word or link never includes your save. To move your progress to
another browser or device, export a save file instead.

## Saving and resuming

Progress is not saved automatically. Before leaving or reloading:

1. Enter a name on the play screen and select **Save adventure**. Wait for
   the **Saved** message before leaving.
2. After playing further, save again. A save includes commands entered up to
   the moment you pressed **Save adventure**, not commands entered afterwards.
3. To continue later, open **Your saves** on the start screen and select
   **Resume**. Returning to the start screen ends the current play session;
   opening its share word starts again rather than resuming it.

Saves stay in that browser for that site; they are not uploaded to an
account. Clearing browser data can remove them. Use **Export** in
**Your saves** to download a `.json` file as a backup, and **Import save** to
add it to another browser. Importing creates a new save without replacing
existing ones. A save file contains your commands and progress, so share it
only if you want the recipient to see them. You can also delete a save from
this screen after confirming.

To keep tabs from overwriting one another, textQuest uses a browser feature
called Web Locks. If it is unavailable, every save creates a new copy and
the game cannot delete saves. For normal updates and deletion, use a browser
that supports Web Locks on an HTTPS address or on localhost. If another tab
changes or deletes a save you are playing, you will see a warning the next
time you try to save. The game will not overwrite the other tab's save; save
again to keep your progress as a new copy.

Very long adventures have a limit of 10,000 typed commands and a limit on
save size. If a command would exceed a limit, the game rejects it but lets
you save your existing progress. A shorter command may fit the size limit.

**Your saves** also shows **Last played** and **Last saved** times, with the
most recently played save first. Last played is stored separately from save
progress: Resume and commands update it without changing saved commands,
deletion checks or exported files. A later Last played time means the save was
resumed or played after its last save; it does not show whether that play was
saved. Older saves and saves with missing or damaged times show **Not
recorded**. If the browser cannot read the separate time, it is labelled
unavailable; Last saved is never used as a substitute. Tracking problems do
not stop play. Without Web Locks, play times are not recorded.

## How it works

For each new adventure, the game picks a random number called a seed. The
seed selects the genre and story plot. Your chosen length selects the plan
size: 8 places and 4 required puzzle steps for a short adventure, 16 places
and 8 steps for a medium one, or 24 places and 12 steps for a long one. The
seed also helps choose where some items and clues appear.

Each released version has 65,280 possible share words. They do not all make
unique adventures: version 1 has 27 generated worlds, and version 2 varies
item and clue locations, but stories and layouts can still repeat. A share
word records the version, seed and length so it can recreate the same
starting adventure.

The game tracks your commands, location and discoveries. A save holds the
starting details and the commands you entered. When you resume, the game
recreates the adventure and replays those commands to restore your progress.

World-format version 2 adds mutually exclusive choices and early endings to
the world rules. The play engine supports these choices and winning endings
in hand-built worlds; no released generator creates them. Choices appear only
when they are available, can be undone, and do not reveal hidden outcomes or
puzzle answers. Hints stay general because route hints do not yet model
choices. Worlds with failure endings are refused until checkpoint recovery
is available. See the roadmap for the related work and current limitations.
Released adventures, share words and saves remain unchanged.

The project is written in TypeScript. Vite turns it into the HTML, CSS and
JavaScript files used by the browser. The written content is in
`src/content/`, adventure generation is in `src/generate-world.ts`, and
command handling and play are in `src/engine/`. The browser screens and save
storage are also in `src/`. Docker supplies the development and build tools;
an optional production container serves the finished files with nginx.

## Run locally

You need Docker with Linux containers and Docker Compose, plus a web browser.
You need Git if you are cloning the repository. The first setup downloads
container images and dependencies, so it needs an internet connection.

If you do not already have a copy of the project, clone it:

```sh
git clone https://github.com/juadielon/textQuest.git
cd textQuest
```

From the project folder, install dependencies in Docker and start the
development server:

```sh
docker compose run --rm app npm ci
docker compose up app
```

Open <http://localhost:5173>. Stop the server with `Ctrl+C`. Run `npm ci`
again in Docker if the dependency files change. You do not need to install
Node.js, npm or the project dependencies on your computer.

### Checks

Run the project's tests, linter and build in Docker:

```sh
docker compose run --rm app npm test
docker compose run --rm app npm run lint
docker compose run --rm app npm run build
```

The linter checks all TypeScript in `src/`, including tests. It uses
TypeScript 6 because its rules do not yet support TypeScript 7; the build
uses TypeScript 7.

## Build and host

After installing dependencies as described above, build the site with:

```sh
docker compose run --rm app npm run build
```

The build checks the code and writes the site to `dist/`, replacing that
folder each time. Upload everything inside `dist/` to a static web host,
keeping `assets/` beside `index.html`. The game runs in the browser and
needs no game server, database, account or API key. Use HTTPS for the full
save experience when hosting it online.

By default, the same build can be hosted at the root of a site or in a folder
such as `https://example.com/textQuest/`. Serve `index.html` at that address
and keep `assets/` beside it. Shared links use the same page, so no special
redirect is needed. The host must serve the page even when its address
includes something like `?adventure=sunlitsaucer2`.

To build specifically for a folder, pass its path with a leading and
trailing slash:

```sh
docker compose run --rm app npm run build -- --base=/textQuest/
```

Upload `dist/` to that folder on the host. This build loads its assets from
`/textQuest/assets/`.

### Preview the build

To build and serve a fresh production image, run:

```sh
docker compose --profile production up --build production
```

Open <http://localhost:8080> and stop it with `Ctrl+C`. This builds a fresh
copy inside the image rather than using your `dist/`, and serves it from the
site root.

To preview the `dist/` you built at a sub-path, run:

```sh
docker compose run --rm --service-ports app npx vite preview --host 0.0.0.0 --port 5173 --strictPort --base=/textQuest/
```

Open <http://localhost:5173/textQuest/>. If you built for a particular folder,
use that same folder in the preview command. For a default build, leave out
`--base=/textQuest/` to preview at <http://localhost:5173/> instead.

Stop the preview with `Ctrl+C`. Stop the development server first if it is
already using port 5173. If the preview container keeps running, find its
name with `docker ps` and stop it with `docker stop <container-name>`.

## More information

See the [roadmap](ROADMAP.md) for what is planned, or
[contributing](CONTRIBUTING.md) to help improve textQuest.
