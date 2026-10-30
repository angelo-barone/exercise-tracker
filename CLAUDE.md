# exercise-tracker (Claude reads this first)

Owner: Angelo Barone. No coding experience, does not read code. Explain every change in plain words before and after. Never assume he understands a technical term. Keep replies short, no dashes.

## What this is
A hosted phone app: PPL x2 gym logbook. Repo angelo-barone/exercise-tracker, branch master, served by GitHub Pages at https://angelo-barone.github.io/exercise-tracker/ . All paths are relative so it works under the repo subpath.

Files: index.html (whole app, plain JS), sw.js, manifest.webmanifest, icons/, .nojekyll, program.json (the exercise program), PROGRAM.md (rules for whoever edits it), tests/hosted.test.js and tests/program.test.js, README.md, HANDOFF.txt (plain language guide for Angelo).

The old Claude artifact "PPL x2 Logbook" still exists but is retired. It only saves inside the Claude app. Do not send him back to it.

## Rules
- Ask before deleting anything, and before any git commit or push.
- NEVER put his workout data in this repo. Backups live outside git (Personal\Health and Wellness\03 Exercise\tracker-backups\).
- Keep old exercise ids working (p_*, pl_*, lg_*, c_*). They carry history.
- Never invent workout data. The one exception, allowed by Angelo on Oct 29 2026: the labelled FAKE test file tests/fake-test-data.json, used only by the tests. Never use real data in tests.
- Update README.md and HANDOFF.txt when features change.
- program.json changes only when Angelo asks for a program change (usually through his Health and Wellness chat, following PROGRAM.md). Code sessions leave it alone.

## Architecture
- Storage: `localDb` adapter in index.html, localStorage key `pplx2:data:v1`. Same API shape the app always used: collection(...).orderBy().limit().get(), doc("col/id").get/set/delete. A failed save throws an Error with code "storage" and the header shows "not saved" with a retry.
- `window.claude.use("db")` is shimmed to return localDb, so the app code did not change.
- App cache keys `pplx2:v1` and `pplx2:outbox` are a read cache and a retry queue. The store is the truth. Restore clears them.
- Collections: custom (every exercise, built in ones seeded with ids), sessions (doc per date_day, has gym, log, names), progress, notes, meta/v2 (migration flag).
- Backup file: {app:"pplx2-logbook", format:1, exportedAt, appVersion, data:{custom,progress,notes,sessions,meta}}. Restore replaces everything, saves the old data to `pplx2:before-restore`, then reloads. Last backup time is `pplx2:lastBackup`.
- Gym tags: exercise.gym is "minto", "montpetit" or empty (empty = both). History is per exercise id, shared across gyms.
- Gym picker (added v2.3.0): Minto, Montpetit, Other, plus the link "Show every exercise". Other (`state.gym === "other"`) shows every exercise like "all" but is saved on the session as gym "other" and shown in History. "all" saves no gym. No exercise is ever tagged "other".

## Program file (added Oct 24 2026)
Angelo's Health and Wellness chat edits `program.json`. The app fetches it on every online open (`checkProgram`, never cached, sw.js skips it), compares `version` with `pplx2:programApplied`, and if it differs from the phone it shows a banner plus a Program update section in Plan listing added, changed, removed, new order and phone only exercises. Apply writes through `queue()`, keeps a safety copy in `pplx2:before-program`, and never touches sessions, notes or progress. Rules for the editor are in PROGRAM.md. A file that is invalid or lists an id in both `exercises` and `removed` is refused whole. After a push that changes program.json, nothing else is needed (no CACHE_VERSION bump).

Full Body (v2.4.0): `fullBody` in program.json is an ordered list of existing exercise ids. Apply stores it as a number `fb` on each of those exercise docs in `custom` (10, 20, ...), so there are no copies and the list travels with backups. The Full Body day (`state.day === "fullbody"`, session id `date_fullbody`) is not in `DAYS` or `WEEK`, so the schedule and rest day are untouched. On that tab Delete, Move up/down and + Add are hidden. Deleting an exercise on its own day also drops it from Full Body. Rules for the editor are in PROGRAM.md.

Release order matters when program.json depends on new app code: push the app first, confirm on the phone, then push program.json. An older app ignores `fullBody` but would still offer the warm-up changes, and Apply would then mark the version done without the list.

Tests start a throwaway python web server on a random port and stop it when they finish (tests/program-v1.json is the frozen starting program).

## Releasing a change
1. Edit index.html.
2. Bump APP_VERSION in index.html and CACHE_VERSION in sw.js. If CACHE_VERSION is not bumped, phones may keep an old copy.
3. Run tests/hosted.test.js and tests/program.test.js (see README; Node.js and Playwright must be installed). They use tests/fake-test-data.json, a labelled FAKE backup, so no real backup is needed. All checks must pass.
4. Ask Angelo, then commit and push to master. Pages redeploys in about a minute.
5. On his phone: open the app twice (first load fetches, second runs the new version).

## Open items
- Gym tags: equipment lists per gym are needed from Angelo before tagging exercises.
- Workout program revision waits on his back pain and tightness details.
- Real device check on iPhone (Add to Home Screen icon, standalone mode) is only confirmed by him.
