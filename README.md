# PPL x2 Logbook

A phone gym logbook for a Push / Pull / Legs split run twice a week. It installs on a phone home screen like an app, works with no signal, and keeps every set on the device.

**Open it:** https://angelo-barone.github.io/exercise-tracker/

## What it does

- Logs weight, reps and an intensity score (1 to 10, by feel) for every set
- Drop sets: add extra lighter sets under any set, each with its own weight and reps
- Asks which gym you are at (Minto or Montpetit) and shows the exercises for that gym. History is shared per exercise.
- Rename, reorder, add and delete any exercise
- Suggests next session's weight from progressive overload rules
- Notes per exercise (seat height, grip, form cues)
- History and Plan views
- Backup and Restore: save everything to a file, load it on a new phone
- Program file: the whole exercise program is `program.json`. When a new version is published the app shows what would change and applies it only when you tap. Logged history is never touched.

## How it is built

One HTML file, plain JavaScript, no framework, no build step.

- `index.html` is the whole app
- `sw.js` is a service worker that caches the app so it opens offline. It tries the network first, so updates arrive as soon as the phone has signal.
- `program.json` is the exercise program and `PROGRAM.md` explains how to edit it
- `manifest.webmanifest` and `icons/` make it installable with a dumbbell icon
- Data lives in the phone's `localStorage` under one key. A small adapter gives the app a document store interface (collection, doc, get, set, delete), so the rest of the code does not care where data is kept.

The first version ran as a Claude artifact with cloud storage. That only works inside the Claude app, so v2 moved to a standalone hosted app with local storage and file backups.

## Data safety

Data is on the phone only. Use **Plan, Your data, Back up now** regularly and keep the file in iCloud Drive. The app reminds you after 14 days. A failed save shows a visible message instead of failing silently. Restoring keeps a safety copy of what was on the phone before.

## Tests

`tests/hosted.test.js` (45 checks): install files, restore, backup round trip, offline use, storage failures, exercise editing, drop sets. `tests/program.test.js` (33 checks): program updates, rename, add, remove, reorder, broken files, offline.

```
SITE=. NODE_PATH=$(npm root -g) node tests/hosted.test.js
SITE=. NODE_PATH=$(npm root -g) node tests/program.test.js
```

The tests no longer need a real backup. They use `tests/fake-test-data.json`, a clearly labelled FAKE backup (14 made-up workouts, 28 progress records, 21 notes, 14 added exercises) that exists only for testing and is not anyone's real workout data. Real backups are personal and are never committed to this repo. Setting `TRACKER_BACKUP` to another file still works, but it must have the same counts.

## License

Personal project, shared for portfolio purposes.
