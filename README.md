# PPL×2 Logbook

Source code for my gym exercise tracker — a Push/Pull/Legs ×2 split logbook built as a single-page app.

**Live app:** https://claude.ai/code/artifact/05137c5c-7fcc-4a44-b790-5a5d67ba28c4

## What it does

- Logs weight, reps, and RPE (intensity) for every set, per exercise
- Suggests next session's weight based on last session's performance (progressive overload)
- Editable notes per exercise (seat height, grip, cues — anything worth remembering)
- Add your own exercises to any day, or leave them "Unsorted" to show up every day
- History tab shows every past session; Plan tab shows the full split and standing rules
- Saves changes locally first, then syncs to the cloud, so a dropped connection at the gym never loses a logged set

## Important: this file won't run standalone

`pplx2-logbook.html` is published and used through **Claude Artifacts**, not as a plain static page. It calls `window.claude.use("db")` to save and load workout data — that API only exists inside the Claude Artifacts runtime. Opening this file directly in a browser (or hosting it on GitHub Pages) will render the layout, but logging a set won't save anywhere.

This repo exists to version-control the source and keep a backup — to actually use the tracker, open the live link above.

## Editing

Changes are made by editing `pplx2-logbook.html` and republishing through Claude to the same artifact URL, which keeps all previously logged workout data intact.
