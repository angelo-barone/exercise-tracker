# Editing Angelo's workout program (for the Health and Wellness chat)

The whole exercise program lives in `program.json` in this folder. The gym tracker app reads it. You edit this one file, nothing else.

## How a change reaches his phone
1. Edit `program.json` (rules below). Bump `version` by 1 and set `updated` to today.
2. The change must be published to GitHub. If you have a shell here, commit and push `program.json` only, after Angelo says yes. If not, tell him: "Open Claude Code in the exercise-tracker folder and say: commit and push program.json."
3. About a minute later, when he opens the app online, a banner says a new program is ready. He opens Plan, reads exactly what changes, and taps Apply update. Nothing changes until he taps.

His logged sets, notes and history are never touched by an update.

## File format
```
{
 "format": 1,
 "version": 7,
 "updated": "2026-11-02",
 "note": "One line on what changed and why. Shown to him.",
 "removed": ["id_of_an_exercise_to_delete"],
 "fullBody": ["lg_press", "p_incline", "pl_pulldown"],
 "exercises": [
  { "id": "p_incline", "name": "Incline Bench Press", "day": "push", "sets": 3, "lo": 6, "hi": 10, "load": "upper", "gym": "both", "rest": 120, "warmup": 2, "gear": "...", "cue": "..." }
 ]
}
```
- `day`: push, pull, legs or any. `sets`: 1 to 10. `lo` and `hi`: rep range, lo <= hi.
- `load`: upper or lower (what kind of weight jumps the app suggests).
- `gym`: both (default), minto or montpetit. A gym tag hides the exercise at the other gym.
- `rest` seconds, `warmup` number of warm-up sets, `gear` and `cue` are optional text. Leave a field out to leave it as it is on the phone.
- The ORDER of exercises in the file, within each day, is the order in the app.
- `muscle` (optional text, up to 30 letters, for example "Back" or "Rear Delts"): the heading the exercise sits under on Today and in Plan. Keep exercises of one muscle next to each other in the file, because the app shows a new heading each time the muscle changes down the list. Machines of one group should share the same muscle. Exercises with no muscle show under "Other" once any exercise of that day has a muscle. Full Body shows no headings. Current muscles: Push (Chest, Shoulders, Triceps, Core), Pull (Back, Rear Delts, Biceps, Forearms), Legs (Squat Movements, Quads, Hamstrings, Hips, Calves). Main lift of a muscle goes first. Old apps ignore `muscle`, so push the app first (it is 2.8.0 or later).

## The Full Body tab
`fullBody` is the list for the Full Body tab: an ordered list of exercise ids, in the order he does them.
- Full Body is not a day and it is not part of the weekly split. It does not change the rest day, and the app never picks it on its own. Do not put `"fullbody"` in an exercise's `day`.
- It does not own any exercises. Each id must be an exercise that already lives on Push, Pull or Legs (listed in `exercises`, or already on his phone). The tab just points at them, so a Full Body workout uses the same exercise, the same sets and reps, and the same history as the Push, Pull or Legs version. Changing an exercise changes it everywhere.
- To add an exercise to Full Body, make sure it exists with a normal day, then add its id to `fullBody`. To take it off Full Body, delete its id from `fullBody` (the exercise stays on its own day).
- Leave the `fullBody` key out to leave the list as it is on the phone. An empty list `[]` empties it.
- An id that is not an exercise, an id twice in the list, or an id that is also in `removed` makes the app refuse the whole file.
- On the Full Body tab the app hides Delete, Move up, Move down and + Add exercise, so this list changes only through this file. Everything else on an exercise (sets, reps, notes) can still be edited there.
- Warm-up sets (`warmup`) belong to the exercise, so they show on Full Body too.

## Machine groups
`groups` puts several machines of one exercise behind one card with a Machine dropdown. Example: `{"id": "g_row", "name": "Closed Grip Row", "members": ["c_a", "c_b", "c_c"]}`.
- `members` are existing exercise ids, BEST FIRST. The position is the rank. The same order applies at every gym.
- Each machine stays its own exercise: own id, own history, notes, sets and reps. Nothing is merged. Never change a member's id.
- At least 2 members. All members on the same day (push, pull or legs, not any). An exercise is in one group only. A member cannot be in `removed`. The group `id` is unique and the `name` is plain text.
- Gym tags decide what shows. Each gym shows only the members that gym allows, opened on the best one. If only one member shows at a gym, it is a plain card. If none shows, the group is hidden. Other and All gyms list every member.
- `fullBody` may name at most ONE member of a group. The whole group then appears at that slot.
- Leave `groups` out to keep the phone's groups as they are. `[]` removes all groups (the exercises stay).
- Order in the file: list a group's members next to each other in `exercises`, best first, so the day shows them together.
- Old app versions ignore `groups`. Push the app first, wait for Angelo to confirm it on his phone, then push the program with `groups`.
- An error in any group makes the app refuse the whole file.

## Rules
- Never change an existing `id`. The id carries the exercise's history. Rename it by changing `name` only.
- New exercise: invent a new id like `x_kneeling_crunch`. Letters, numbers, underscore, dash, max 40 characters, never reused.
- Remove an exercise by deleting it from `exercises` AND adding its id to `removed`. An id in both lists is rejected. An exercise left out of both is KEPT on his phone (the update screen shows it as "only on this phone").
- Day names and the weekly split (Push, Pull, Legs, rest days) are not in this file. Do not change the split here. Only the Full Body list is (see above).
- If the JSON is broken or a field is invalid, the app refuses the whole file and tells him. Check the file parses before saying you are done.
- Do not invent exercises, weights or reps. Ask Angelo, and use what he told you about his back pain and gym equipment. Do not put logged workouts or backups in this repo.
- The current phone data may contain exercises he added in the app that are not in this file. Check the latest backup in `Personal\Health and Wellness\03 Exercise\tracker-backups` if you need to see them.
