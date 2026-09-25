# Irrigatalizer Requirements

This document captures everything the current Irrigatalizer system does, plus the
agreed-upon requirements for a modernized rewrite. It is the reference for a full
codebase replacement in the same repository.

Each requirement is tagged to show its relationship to the existing system:

- **[preserve]** — behavior that exists today and must carry forward unchanged.
- **[change]** — behavior that exists today but will be redesigned or improved.
- **[new]** — capability that does not exist today.

Requirements are grouped into logical, independently actionable categories so we
can implement them in coherent increments.

---

## 0. Project Overview

Irrigatalizer runs on a Raspberry Pi (2020-era: Pi 4 or Zero 2 W class) on a
local-only home network. It drives relays that open and close valves to activate
irrigation circuits, and it provides a web UI for scheduling and monitoring.

The rewrite keeps the same core purpose and hardware model but modernizes the
stack, improves scheduling flexibility, adds named circuits, adds manual run and
skip/pause controls, and makes the dashboard far easier to read — all while
preserving the safety-critical guarantee that at most one circuit is ever active.

### Chosen technical direction (decisions)

- **[change]** Backend: TypeScript on Node, using **Express** (replaces the current
  JavaScript/Express + pug server-rendered app). A single Node process owns GPIO,
  the scheduler, persistence, and the API, and also serves the built SPA as static
  files.
- **[change]** Frontend: **React SPA built with Vite**, served as static files by
  the backend. Next.js was considered and rejected: on a 2020-era Pi its build is
  slow and RAM-hungry, and its request/response + serverless model fits poorly with
  a long-lived process that must exclusively own the GPIO hardware and scheduler.
- **[new]** **No WebSockets / SSE.** Live updates come from a client-side countdown
  computed from the current/next end times, plus periodic polling of `/api/status`.
- **[preserve]** Persistence: **JSON files** under `~/.irrigatalizer`. No database.
- **[new]** **Fresh start, no data migration.** Old schedule and history JSON are
  discarded; the new system starts with an empty configuration.
- **[preserve]** **Local-network only, no authentication.**
- **[change]** Primary target is **phone**; must also work well on desktop
  (responsive, phone-first layout).
- **[change]** Rigorous **local** testing process (unit tests especially for
  scheduler and safety logic). Test runner need not be Jest (Vitest is acceptable).
  No CI server; instead a scripted local verification flow.
- **[change]** Same repo; the old codebase is removed completely, including the
  Flutter `irrigatalizer_ui`. The pre-deletion state is preserved on a **local**
  `legacy` branch for reference. No remote git operations.

---

## 1. Hardware & Circuits

- **[preserve]** Support up to **8 circuits**, each driven by one relay via a GPIO
  output pin. Current fixed mapping (circuit → BCM pin):
  1→17, 2→27, 3→22, 4→5, 5→6, 6→13, 7→12, 8→16.
- **[preserve]** A circuit has two states: **on** (relay energized, valve open) and
  **off** (relay de-energized, valve closed).
- **[change]** Circuits are addressed today by **number only**. Add user-editable
  **names** for each circuit, used everywhere in the UI. Number/pin remains the
  stable internal identifier.
- **[new]** Circuit configuration (which circuits exist, their names, and their pin
  mapping) is part of the persisted configuration rather than hardcoded. The
  8-circuit ceiling and the default pin map remain the defaults. Pin mapping lives in
  the data model to allow a **future** UI-based remapping, but **no pin-editing UI is
  built now** — the model supports it without any UI investment.
- **[preserve]** GPIO output today uses the `onoff` library (sysfs). This is aging;
  the modern Linux path is the GPIO character device (libgpiod). The rewrite hides
  the driver behind a `GpioDriver` interface; the concrete library is selected via a
  short spike on the target Pi and must not leak into scheduler or safety logic.
- **[new]** **Wiring guidance (documentation only):** relays should be wired
  **normally-closed** so that a loss of power stops watering. This is captured in the
  README/setup docs, not enforced in code.

---

## 2. Safety / Fail-safe

This is the highest-priority category. All guarantees below are enforced in the
backend, independent of the UI.

- **[preserve/strengthen]** **Single-active-circuit invariant:** at most one circuit
  is energized at any instant. Turning a circuit on must first turn all others off
  and **verify** the off-state before energizing the new circuit. If verification
  fails, leave **nothing** on.
- **[preserve]** **Never simultaneous execution:** even when a schedule/program
  enables multiple circuits, they run strictly **sequentially**, one at a time.
- **[new]** **Valve-settle gap between consecutive scheduled circuits:** when one
  scheduled circuit's run ends and the next begins back-to-back, insert a brief
  all-off pause (a fixed 2 seconds) before energizing the next circuit. This lets
  the closing valve's hydraulic transient (water hammer) damp out before the next
  opens, and gives the single-active "drive all others off" step room so an
  energize never races a de-energize on a shared supply. The gap is **taken from
  the start of the following run** — the run still ends at its planned slot
  boundary — so gaps **never accumulate** down a program and history records the
  clean planned start/end. The gap is a fixed constant (not user-configurable): it
  is a property of the plumbing, small enough that no run loses a meaningful amount
  of water. It applies to **scheduled sequencing only**; **manual runs are
  deliberately excluded** (they are operator-initiated and infrequent, so the
  water-hammer-prone automated back-to-back case does not apply). Realized in the
  pure timeline as a per-run `actualStart` (when the scheduler energizes) distinct
  from the planned `start` (what history and the UI show), so no blocking wait sits
  inside the `CircuitController`.
- **[new]** **Watchdog / max-runtime cap:** every circuit has a hard maximum on-time.
  If the scheduler stalls, hangs, or crashes, an independent watchdog forces all
  relays off once a circuit exceeds its cap or the scheduler stops heart-beating.
- **[preserve/strengthen]** **Safe state on process exit:** on shutdown, turn all
  circuits off, flush history, and release GPIO. (Exists today via exit cleanup.)
- **[new]** **Safe state on boot:** at process startup, drive **all relays off before
  anything else runs** (before scheduling begins).
- **[new]** **Safe state on crash:** register uncaught-exception / unhandled-rejection
  handlers that drive all relays off.
- **[change]** The `CircuitController` is the single authority for relay state; all
  callers (scheduler, manual run, API) go through it so the invariant and watchdog
  always apply.

---

## 3. Scheduling & Programs

- **[change]** **Redesigned scheduling model.** Today a single weekly schedule holds
  entries with a day-of-week, a 30-minute start slot, a shared per-circuit duration
  (5–30 min, step 5), and a set of enabled circuits that run back-to-back in circuit
  order. The rewrite generalizes this.
- **[new]** **Multiple programs.** Configuration holds several named programs, each
  with its own day selection, start time(s), and circuit list.
- **[new]** **Per-circuit durations within a program.** Each circuit in a program can
  run for a different length rather than sharing one duration.
- **[preserve]** **Sequential execution with defined ordering.** Circuits within a
  program run one at a time in a defined order (the invariant from §2).
- **[preserve]** **Master enable/disable** for the whole schedule (global on/off).
- **[preserve]** **Current / next computation.** The engine determines the currently
  running circuit (if any) and the next scheduled circuit with its start/end times.
- **[preserve]** **History written on transitions.** Each circuit run produces a
  history record (start/end) as circuits change, as the current scheduler does.
- **[preserve]** **Start-time granularity: 30-minute slots.** Each program has a
  single start time chosen from 30-minute slots (as today). No finer granularity is
  required.
- **[preserve]** The engine wakes at the next transition rather than polling
  continuously (timer-driven), and computes the schedule from configuration.

**Decided:** a program has a **single start time** (30-minute slot) with **ordered
per-circuit durations**, matching the sequential one-circuit-at-a-time model.
Multiple start times are intentionally **not** supported — that scenario is simply
expressed as two programs.

---

## 4. Manual & Override Controls (run / skip / pause)

- **[new]** **Manual run / test:** from the UI, turn a chosen circuit on **now** for
  N minutes, then automatically off. Manual runs go through the `CircuitController`,
  so the single-active invariant and watchdog still apply. A manual run can be
  stopped early.
- **[new]** **Skip next run:** suppress the next scheduled run, then auto-resume.
- **[new]** **Skip 24h:** suppress all scheduled runs for 24 hours, then auto-resume.
  (Matches the "skip (24 hours?)" idea from `ideas.md`.)
- **[new]** **Rain delay N days:** suppress scheduled runs for a chosen number of
  days, then auto-resume.
- **[new]** Overrides are **time-bounded** state that the scheduler consults when
  deciding what to run next, and they **auto-resume** at expiry.
- **[preserve]** Overrides interoperate with the **master enable/disable**: a disabled
  schedule runs nothing regardless of overrides.
- **[new]** Overrides are **persisted** so they survive a restart within their window.

---

## 5. Observability & Dashboard

The underlying observability data is considered fine; the priority is making it
**easy to read and interpret** (the current UI is hard to use).

- **[preserve]** **Current status:** whether a circuit is running now, which one, and
  a **live countdown** of remaining time.
- **[preserve]** **Next status:** which circuit is next and when it starts (countdown
  to start).
- **[change]** **Run history visualization.** Keep the history data model (recent
  runs with start/end) and the sparkline concept, but present it clearly and legibly,
  using **circuit names**. The current dual SVG sparklines (36h / 72h) are hard to
  interpret and will be redesigned.
- **[preserve]** **Activity log view:** show recent log messages (the in-memory
  rolling log).
- **[change]** Live updates are achieved by **client-side countdown** plus periodic
  **polling of `/api/status`**, replacing the old full-page reload at transition.
- **[preserve]** **Schedule disabled** indication is shown clearly when the master
  toggle is off.

---

## 6. Persistence & Data

- **[preserve]** Store configuration and history as **JSON files** under
  `~/.irrigatalizer`. No database.
- **[change]** **Configuration model** expands to include: circuits (number, name,
  pin), programs (days, start time(s), ordered per-circuit durations), global
  enable, and override state.
- **[preserve]** **History model:** a list of run records (circuit, start, end) with a
  **retention cap** (currently 200 entries; retain a bounded rolling window).
- **[preserve]** **In-memory activity log** with a bounded size (currently the last 20
  messages).
- **[new]** **Fresh start, no migration.** Existing `configuration.json` /
  `history.json` from the old system are not migrated; the new system defaults to an
  empty configuration on first run.
- **[change]** Persistence is **typed** and validated on read/write; missing files
  default cleanly to empty state.

---

## 7. API

- **[change]** **REST only, no WebSockets/SSE.** Endpoints support polling.
- **[preserve]** **Status endpoint** (`/api/status`): current/next, running flag,
  enabled flag, override state, and timing — sufficient for the SPA to poll and
  compute a countdown locally.
- **[change]** **Configuration CRUD:** read and update circuits and programs.
  Applying configuration **safely restarts the scheduler** (as `PUT /api/configuration`
  does today).
- **[preserve]** **History endpoint:** return recent run records.
- **[new]** **Manual run endpoints:** start a manual run (circuit + minutes) and stop
  it.
- **[new]** **Override endpoints:** apply skip-next / skip-24h / rain-delay-N-days and
  clear overrides.
- **[change]** Inputs are **validated**; errors return clear messages (the current API
  returns `{ error }` with a 400 on bad input — preserve that shape/spirit).
- **[preserve]** The backend process is **authoritative over hardware**; the API never
  bypasses the `CircuitController`.

---

## 8. Web UI / UX

- **[change]** **Phone-first, responsive React SPA** (works well on desktop too),
  replacing the pug + Bootstrap server-rendered pages.
- **[preserve]** **Dashboard page:** current/next with live countdown, running-status
  indicator, history visualization, and activity log — but redesigned for clarity.
- **[change]** **Schedule / program editor:** replace the 7-day × 48-slot clickable
  grid + modal with an editor built around **programs and named circuits**. Editing a
  program sets its days, start time(s), and ordered per-circuit durations.
- **[new]** **Manual run controls:** pick a circuit (by name) and a duration, start
  and stop.
- **[new]** **Skip / pause controls:** skip next, skip 24h, rain delay N days, with
  clear indication of an active override and when it resumes.
- **[preserve]** **Master enable/disable** toggle with clear disabled-state feedback.
- **[change]** Use **circuit names** everywhere instead of bare numbers.

---

## 9. Deployment & Ops

- **[preserve]** Runs under **pm2** as a daemon on the Pi.
- **[preserve]** **scp/ssh tarball deploy** (`create-release.sh` → `deploy.sh`). This
  is the user's own manual ops step; the deploy to the Pi must **not** be executed by
  tooling without explicit, command-by-command authorization.
- **[change]** Update the release/build scripts and pm2 config so the release tarball
  includes the **built SPA + compiled server**, and `npm install --omit=dev` works on
  the Pi.
- **[preserve]** **Port / networking:** app listens on a port (env `PORT`, default in
  the 8000/9000 range) with the Pi's iptables redirect from port 80. Local network
  only.
- **[change]** Rewrite `README.md` for the new architecture and Pi setup, including
  the **normally-closed wiring** note.

---

## 10. Non-functional / Testing / Repo

- **[change]** **TypeScript** throughout backend and frontend.
- **[change]** **Rigorous local testing**, prioritizing scheduler and safety logic:
  single-active enforcement, safe-off on boot/exit/crash, watchdog trips, timeline
  expansion, current/next selection, and no-overlap property tests. Vitest acceptable.
- **[new]** A scripted **local verification flow** (e.g. `verify` = typecheck + tests
  + build). No CI server.
- **[new]** **Fake `GpioDriver`** for tests so safety and scheduling logic are tested
  without real hardware.
- **[change]** **Same repo, old code removed completely** (including the Flutter
  `irrigatalizer_ui`). Pre-deletion state preserved on a **local `legacy` branch**.
- **[preserve/constraint]** **Local git only.** No `push`/`pull`/`fetch`/`clone`/PRs or
  any remote branch operations unless explicitly authorized command-by-command.
  Destructive local operations (file/branch deletion, resets) require confirmation.

---

## Appendix A — Current System Summary (as-is)

For reference, the existing implementation:

- `index.js`: Express with cors/helmet/compression/body-parser; mounts API routes and
  pug web routes; starts the scheduler; registers exit cleanup. Listens on `PORT` or
  9000.
- `app/scheduler.js`: single `setTimeout`-driven loop; computes current/next; turns
  all circuits off on change; writes history; minimum wake 3s; on shutdown turns all
  off, writes history, and unexports GPIO.
- `app/schedule-service.js`: expands the weekly schedule into per-circuit sequential
  entries with effective start/end times ("one circuit per entry"); ordering derived
  from circuit index.
- `app/circuit-service.js` + `app/gpio-circuit.js`: circuit registry with on/off/close;
  fixed circuit→pin map via `onoff`.
- `app/domain/*`: JSON config/history stores in `~/.irrigatalizer`; history capped at
  200; in-memory log capped at 20.
- `web/*`: pug + Bootstrap server-rendered dashboard (current/next countdown, two SVG
  sparklines, log) and a 7-day × 48-slot clickable schedule grid with a modal editor;
  talks to `/api/configuration`.
- API: `/api/status`, `/api/schedule` (GET), `/api/configuration` (GET/PUT; PUT
  restarts scheduler).
- Ops: pm2; port 8000/9000 with iptables redirect from 80; scp/ssh tarball deploy via
  `create-release.sh` and `deploy.sh`.
- `irrigatalizer_ui/`: a separate Flutter UI, out of scope and slated for removal.

## Appendix B — Feature ideas carried in (`ideas.md`)

- history and spark line — **partially exists; being redesigned for readability**.
- skip (24 hours?) — **adopted as skip-24h override**.
- configurable circuits — **adopted (circuit config in persisted model)**.
- circuit naming — **adopted (named circuits everywhere)**.
