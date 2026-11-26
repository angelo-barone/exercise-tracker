# PPL x2 Logbook

A phone gym logbook for a Push / Pull / Legs split run twice a week. It installs on a phone home screen like an app, works with no signal, and keeps every set on the device.

**Open it:** https://angelo-barone.github.io/exercise-tracker/

## What it does

- Logs weight, reps and an intensity score (1 to 10, by feel) for every set
- Drop sets: add extra lighter sets under any set, each with its own weight and reps
- Asks which gym you are at (Minto, Montpetit or Other) and shows the exercises for that gym. Other shows every exercise and is saved on each session. History is shared per exercise.
- Rename, reorder, add and delete any exercise
- Full Body: a fourth day, outside the weekly schedule, that reuses exercises from Push, Pull and Legs so history is shared. Its list comes from `program.json` only
- Machine groups: one exercise can have a dropdown of machines, best first (for example Closed Grip Row). Each machine keeps its own history, notes and targets. The card opens on the best machine the chosen gym has. Groups come from `program.json` only (`groups`, added in v2.6.0)
- Suggests next session's weight from progressive overload rules
- Notes per exercise (seat height, grip, form cues)
- History and Plan views
- Backup and Restore: save everything to a file, load it on a new phone
- Send a copy to Claude (optional, v2.5.0): after every save the phone sends a copy of its data to a small private server (`worker/`) so Claude can read training without a backup file. Off until a sync code is pasted in the Plan tab. The phone stays the master.
- Program file: the whole exercise program is `program.json`. When a new version is published the app shows what would change and applies it only when you tap. Logged history is never touched.

## Muscle headings (v2.8.0)
Each day is split by muscle: Today and the Plan tab show a heading (Chest, Back, Quads and so on) above that muscle's exercises. The name is an optional `muscle` field on each exercise, set by the program file or by the new Muscle dropdown in the add and edit form. Without it nothing changes. Full Body shows no headings. Hack Squat and Leg Press (the alternative, in a Machine dropdown) sit under Squat Movements since program version 6.

## Body tab (v2.7.0)
A fourth tab, Body. A daily protein counter with quick add buttons (+10 to +40, or type grams) against an editable target and floor (starts at 130 g and 95 g), Undo last, and the last 7 days. A bodyweight log (one weigh-in per date, lb) shown as weekly averages (Monday to Sunday) with a small line and the change per week. Calories are not tracked. The data lives in three new collections in the same phone store: `body`, `food`, `goals`. They travel in backups and in the copy sent to Claude. Nothing existing is changed or migrated.

## How it is built

One HTML file, plain JavaScript, no framework, no build step.

- `index.html` is the whole app
- `sw.js` is a service worker that caches the app so it opens offline. It tries the network first, so updates arrive as soon as the phone has signal.
- `program.json` is the exercise program and `PROGRAM.md` explains how to edit it
- `worker/` is the sync server: one Cloudflare Worker with a small key-value store (free tier). It contains no keys and no data. On its first visit to /setup it makes its own two keys (one to send, one to read) and then closes that door, so no key is ever typed or committed.
- `manifest.webmanifest` and `icons/` make it installable with a dumbbell icon
- Data lives in the phone's `localStorage` under one key. A small adapter gives the app a document store interface (collection, doc, get, set, delete), so the rest of the code does not care where data is kept.

The first version ran as a Claude artifact with cloud storage. That only works inside the Claude app, so v2 moved to a standalone hosted app with local storage and file backups.

## Data safety

Data is on the phone only. Use **Plan, Your data, Back up now** regularly and keep the file in iCloud Drive. The app reminds you after 14 days. A failed save shows a visible message instead of failing silently. Restoring keeps a safety copy of what was on the phone before.

## Tests

`tests/hosted.test.js` (67 checks): install files, restore, backup round trip, offline use, storage failures, exercise editing, drop sets, the Other gym, and the send-a-copy feature (run against the real Worker code with a stand-in store). `tests/worker.test.js` (29 checks): the Worker alone, keys, the one time setup, size limit, wipe protection. `tests/program.test.js` (56 checks): program updates, rename, add, remove, reorder, broken files, offline, the Full Body list and warm-up change.

`tests/muscle.test.js` (39 checks): muscle headings on Today, Plan and the add form, refused muscle names, program version 6 applied to the fake data, then version 7 (Ab Crunch removed, history untouched). `tests/program-v6.json` and `tests/program-v7.json` are frozen copies.

`tests/body.test.js` (34 checks): the Body tab (protein counter, weigh-ins, weekly trend, targets), old data left untouched, backup and restore of the Body data, phone width. `tests/program-v4.json` and `tests/program-v5.json` are the later programs.

`tests/groups.test.js` (65 checks): machine groups, refused group files, defaults per gym, logging on another machine, remembered pick, Full Body, Plan tab, move, delete, backup and restore. `tests/program-v1.json` and `tests/program-v2.json` are frozen copies of earlier programs that the tests start from; `tests/program-v3.json` is the program with machine groups.

```
SITE=. NODE_PATH=$(npm root -g) node tests/hosted.test.js
SITE=. NODE_PATH=$(npm root -g) node tests/program.test.js
SITE=. NODE_PATH=$(npm root -g) node tests/groups.test.js
SITE=. NODE_PATH=$(npm root -g) node tests/body.test.js
SITE=. NODE_PATH=$(npm root -g) node tests/muscle.test.js
node tests/worker.test.js
```

The tests no longer need a real backup. They use `tests/fake-test-data.json`, a clearly labelled FAKE backup (14 made-up workouts, 28 progress records, 21 notes, 14 added exercises) that exists only for testing and is not anyone's real workout data. Real backups are personal and are never committed to this repo. Setting `TRACKER_BACKUP` to another file still works, but it must have the same counts.

## How it was made

Built with Claude (Claude Code). Angelo Barone directs the features and tests it.

## License

MIT. See `LICENSE`.
