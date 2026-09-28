# Exercise Tracker

A single-page gym logbook built for a personal Push/Pull/Legs ×2 training split. Logs weight, reps, and RPE (intensity) per set, suggests next session's weight from progressive-overload rules, and keeps per-exercise notes editable in place.

**Live app:** https://claude.ai/code/artifact/05137c5c-7fcc-4a44-b790-5a5d67ba28c4

## Features

- **Per-set logging** — weight, reps, and RPE (1–10) for every set of every exercise
- **Progressive overload suggestions** — after each session, the app compares reps/RPE against the target range and recommends whether to add weight, hold, or deload before the next session
- **Editable notes per exercise** — seat height, grip, form cues; anything worth remembering between sessions
- **User-defined exercises** — add exercises the base program doesn't cover, and assign them to a specific day or leave them unsorted so they show up every day
- **History and Plan views** — full session history with working-volume totals, and a read-only view of the whole training split
- **Offline-first sync** — every change is written to `localStorage` immediately and queued for the cloud; a dropped connection at the gym (no wifi, phone locks, page reloads) never loses a logged set. The header shows sync status and retries automatically.

## How it's built

Single HTML file — vanilla JavaScript, no build step, no framework, no dependencies. Runs as a [Claude Artifact](https://claude.ai/code/artifacts), which provides:

- **Persistent storage** via a `db` capability (`window.claude.use("db")`) — a small document store scoped to the artifact, used here for `sessions`, `progress`, `notes`, and user-added `custom` exercises
- Everything else — layout, state, rendering, the local-outbox sync layer — is hand-written, with no external JS libraries

Because storage depends on the Artifacts runtime, **this file won't save data if opened as a plain static page** (e.g. via GitHub Pages) — it needs to run through the live link above. This repo exists for source control and portfolio purposes.

## Architecture notes

The interesting problem here was reliability on a flaky connection: gym wifi is unreliable, and a dropped write used to mean a lost workout. The fix is a local outbox pattern —

1. Every log/edit writes to `localStorage` synchronously, so a reload can never lose data that's already on the device.
2. The same write is queued and retried against the cloud store until it's confirmed.
3. Anything still in the outbox takes priority over what the cloud returns, so a stale cloud read can never overwrite an unconfirmed local write.

## License

Personal project, shared for portfolio purposes.
