# Manual UI/UX Tests

Manual test walkthrough for the phone-first SPA (Task 10). These are real-world
use cases a person operating the irrigation controller would actually perform,
grouped by functional area. Run them by hand before committing.

## Setup

1. Start the app against the in-memory fake driver (no GPIO hardware or `gpiod`
   needed):

   ```
   npm run dev:fake
   ```

   This runs the backend plus the Vite dev server. Vite binds `0.0.0.0:5173` and
   proxies `/api` to the backend, so open `http://localhost:5173` (or the
   forwarded port from another machine).

2. Open the app in a mobile viewport first (phone-first is the primary target):
   in the browser dev tools, switch to a phone device profile (e.g. iPhone or
   Pixel width ~390px). Repeat the key flows once on a desktop width too.

3. Config and history persist to `~/.irrigatalizer`. To start from a clean slate,
   stop the app and remove that directory, then restart.

Notes while testing:
- Status polls every 5 seconds; countdowns tick locally every second between
  polls. Expect up to a ~5s lag before a backend change shows in status.
- All schedule times display in the schedule's configured timezone, not the
  browser's zone.

---

## 1. First-run setup (empty configuration)

Goal: a new user builds a working schedule from nothing.

1. Start with a clean `~/.irrigatalizer` (see Setup step 3). Load the app.
2. Confirm the Dashboard shows "Nothing running" and "Nothing scheduled", with no
   errors.
3. Go to the Schedule tab. Confirm it loads (not stuck on "Loading
   configuration…"), circuits list is empty with the prompt to add one, and there
   are no programs.
4. Set the timezone to your local IANA zone from the picker. Confirm the hint text
   explains times apply to both the controller and the app.
5. Add three circuits with "Add circuit". Confirm each gets a default name
   (`Circuit 1`…) and shows a read-only `GPIO <pin>` value.
6. Rename the circuits to something real ("Front lawn", "Back beds", "Garden").
7. Confirm "Enabled" is on.
8. Click "Save changes". Confirm the button disables while saving and then shows
   "All changes saved", and the "Unsaved changes" indicator clears.
9. Reload the page. Confirm the circuits and names survived the round-trip.

## 2. Building and editing programs

Goal: schedule sequential watering across circuits on specific days.

1. On the Schedule tab, click "Add program". Confirm a program card appears with a
   default name and no days selected.
2. Name it "Morning". Toggle Mon/Wed/Fri on. Set the start time to an early slot
   (e.g. 06:00) from the 30-minute-slot dropdown.
3. Add three steps ("Add step"), one per circuit, and set durations (e.g. 10, 15,
   5 minutes). Confirm each step's circuit dropdown lists the named circuits.
4. Reorder steps with the ↑/↓ buttons. Confirm the first step's ↑ and the last
   step's ↓ are disabled, and the order visibly changes.
5. Remove a step with ✕ and confirm it disappears and the remaining steps
   renumber.
6. Save. Reload and confirm the program, days, start time, and step order/durations
   all persisted.
7. Add a second program ("Evening") on a different day/time and save. Confirm both
   programs coexist.

## 3. Live dashboard and countdowns

Goal: at a glance, see what is running and what is next, updating live.

1. Ensure at least one enabled program has a "Next" run coming up. On the
   Dashboard, confirm the "Next" card shows the circuit name, the start time (in
   the configured zone), and a countdown in parentheses.
2. Watch the countdown for ~10 seconds. Confirm it ticks down every second without
   needing a manual refresh.
3. Trigger a run so something is active (easiest via a manual run, section 5, or
   wait for a scheduled start). Confirm the "Now" card shows the circuit with a
   live "remaining" countdown and the pulsing status dot.
4. When the active run ends, confirm "Now" returns to "Nothing running" within a
   poll cycle (~5s).

## 4. History and activity log

Goal: review what has watered recently.

1. After one or more runs have completed (scheduled or manual), on the Dashboard
   find the "History" timeline. Confirm each configured circuit has its own row,
   and completed runs render as bars positioned by time.
2. Hover a bar (desktop) and confirm the tooltip shows the circuit name and the
   start–end times in the configured zone.
3. While a run is active, confirm its bar shows as "active" (styled differently)
   and extends to "now".
4. Check the "Activity" log below. Confirm it lists newest-first "turned on" /
   "turned off" entries with timestamps in the configured zone, and that an
   in-progress run shows only "turned on" (no premature "turned off").

## 5. Manual run

Goal: water a circuit right now, on demand.

1. Go to the Controls tab. In "Manual run", pick a circuit by name and set a
   duration (e.g. 2 minutes).
2. Click "Start". Confirm the control switches to the active view showing the
   circuit name and a live "left" countdown, with a "Stop" button.
3. Switch to the Dashboard. Confirm "Now" shows the same circuit tagged "manual"
   with a matching countdown.
4. Return to Controls and click "Stop" before the timer expires. Confirm it
   returns to the start form and the Dashboard clears within a poll cycle.
5. Start another manual run and this time let it expire on its own. Confirm it
   ends automatically and the Dashboard returns to idle.
6. On the Dashboard, confirm both manual runs appear in History/Activity, and the
   early-stopped one shows its true (shorter) duration.

## 6. Single-active-circuit behavior

Goal: confirm the UI reflects that only one circuit runs at a time.

1. Start a manual run on circuit A for a few minutes.
2. Without stopping it, start a manual run on circuit B.
3. Confirm the Dashboard "Now" shows only circuit B running (A is off), never both
   at once.

## 7. Skip and pause overrides

Goal: temporarily suppress scheduled watering (e.g. it is raining).

1. Ensure an enabled program has an upcoming "Next" run.
2. On Controls, in "Skip & pause", click "Skip next run". Confirm the control
   switches to the active-override view describing the skip, with a "Clear"
   button, and the Dashboard shows an override banner.
3. Confirm the Dashboard "Next" reflects the skip (the next occurrence moves past
   the skipped run).
4. Click "Clear". Confirm the override is removed and "Next" returns to the
   original upcoming run.
5. Click "Skip 24 hours". Confirm the active view and Dashboard banner state a
   resume time (in the configured zone) about 24 hours out.
6. Clear it, then set a "Rain delay" of 3 days and click Apply. Confirm the resume
   time is ~3 days out. Confirm you cannot enter a delay below 1 day.
7. Clear the override and confirm scheduling resumes.

## 8. Master enable / disable

Goal: turn the whole schedule off without deleting programs.

1. On the Schedule tab, toggle "Enabled" off and save.
2. On the Dashboard, confirm the "Schedule disabled" banner appears and "Next"
   shows "Nothing scheduled", even though programs still exist.
3. Confirm a manual run still works while disabled (manual is independent of the
   schedule).
4. Re-enable on the Schedule tab and save. Confirm "Next" repopulates.

## 9. Timezone correctness

Goal: schedule times are unambiguous regardless of the viewer's browser zone.

1. On the Schedule tab, note a program's start time and change the timezone to a
   very different zone (e.g. from America/New_York to Asia/Tokyo). Save.
2. Confirm the Dashboard "Next" start time and the History/Activity timestamps all
   render in the newly chosen zone, consistently.
3. (Optional) Change your browser/OS timezone and reload. Confirm displayed
   schedule times do not shift — the config's zone is authoritative, not the
   browser's.

## 10. Editing safety and unsaved-changes feedback

Goal: the editor communicates state clearly and does not lose or misapply edits.

1. On the Schedule tab, make a change (rename a circuit). Confirm the "Unsaved
   changes" indicator appears and "Save changes" becomes enabled.
2. Without saving, switch to another tab and back. Confirm the draft edit is still
   present (or, if it resets from a reload, that behavior is consistent and not
   silently half-applied).
3. Make an edit and save. Confirm "All changes saved" shows and "Save changes"
   disables until the next edit.
4. Remove a circuit that is referenced by a program step, then save. Confirm the
   circuit is gone and the program no longer references it (no dangling step).

## 11. Resilience / error handling

Goal: the UI degrades gracefully when the backend is unreachable.

1. With the app open on the Dashboard, stop the backend process (leave the browser
   open).
2. Within a poll cycle, confirm a "Connection issue" banner appears and the last
   known status is still shown (the page does not go blank or crash).
3. Restart the backend. Confirm the banner clears on the next successful poll and
   live status resumes.
4. Try saving a schedule change while the backend is down. Confirm an inline error
   message appears rather than a silent failure.

## 12. Phone-first layout and accessibility

Goal: the app is comfortable to use on a phone.

1. In a phone viewport, walk the three tabs. Confirm no horizontal scrolling,
   tap targets (buttons, toggles, selects) are comfortably sized, and text is
   readable without zooming.
2. Confirm the tab bar clearly indicates the active tab.
3. Rotate to landscape (or widen to desktop). Confirm the layout adapts without
   breaking.
4. Tab through the controls with the keyboard. Confirm focus order is sensible and
   interactive elements are reachable and operable.
