# Implementation Tasks

Durable task breakdown for the Irrigatalizer revitalization. Drives implementation
alongside `requirements.md`. Check tasks off as they complete.

## Operating constraints

- **Local git only.** No `push`/`pull`/`fetch`/`clone`/PRs or remote branch
  operations unless explicitly authorized command-by-command.
- Confirm before destructive operations (file/branch deletion, resets).
- Do not run the Pi deploy (scp/ssh) without explicit authorization.
- Old code preserved on the local `legacy` branch for reference.

## Status legend

- `[ ]` not started · `[~]` in progress · `[x]` done

---

- [x] **Task 1 — Requirements doc (Phase 1)**
  - Objective: Categorized requirements under `docs/`, tagged preserve/change/new.
  - Result: `docs/requirements.md` authored and reviewed.

- [x] **Task 2 — Preserve old code on local `legacy` branch, delete old codebase**
  - Objective: Create local `legacy` branch capturing pre-rewrite state, then delete
    the old codebase on `main`: `app/`, `web/`, `irrigatalizer_ui/`, `index.js`,
    `process-cleanup.*`, old build/deploy scripts, `dev-site/`, old test/dev config,
    old `package.json`/lock, and the old GitHub Actions workflow.
  - Keep: `.git`, `.gitignore`, `.github/` dir, `.kiro/`, `.vscode/`, `docs/`,
    `LICENSE`, `README.md` (rewritten later).
  - Guidance: Local git only. Confirm before deleting. `legacy` branch already created
    at the pre-deletion commit.
  - Test: `legacy` holds old tree; `main` working tree free of old code.
  - Demo: Clean working tree ready for the new scaffold.
  - Result: `legacy` branch verified to hold the old tree; old codebase confirmed
    absent from `main` (working tree contains only the new scaffold). Note: no
    `.github/` directory is currently present on `main` — CI workflow creation is
    deferred to Task 11.

- [x] **Task 3 — Scaffold TS Express backend + Vite React SPA**
  - Objective: Establish `server/` (Express + TS) and `web-ui/` (Vite + React + TS)
    workspaces, Vitest, lint/format, and a `verify` script (typecheck + test + build)
    with one trivial passing test.
  - Guidance: Pin dependency versions.
  - Test: `verify` runs typecheck + a sample unit test green.
  - Demo: Verification script builds and tests the empty scaffold.
  - Sub-task — Correct dependency pins for the secure devcontainer (done):
    - The initial scaffold pinned several versions that had been published within
      the last 21 days, which the devcontainer's `min-release-age=21` rejected, so
      `npm install` failed. (The majors themselves are valid — the pins were just
      too new, not nonexistent.) Corrected each to the newest release older than 21
      days, keeping the ESLint 10.x and Vite 8 / Vitest 4 peer sets coherent and
      pinning `@types/node` to the 24.x line matching the Node 24 image:
      - root: `eslint` 10.9.1, `@types/node` 24.13.3, `eslint-plugin-react-refresh`
        0.5.5, `typescript-eslint` 8.69.0, `prettier` 3.9.6.
      - `server/`: `vitest` 4.1.11, `supertest` 7.2.2, `tsx` 4.23.13.
      - `web-ui/`: `vite` 8.2.2, `vitest` 4.1.11, `react`/`react-dom` 19.2.8,
        `@types/react` 19.2.18, `@types/react-dom` 19.2.5, `jsdom` 30.0.1.
    - `strict-allow-scripts=true` blocked esbuild's `postinstall`. Approved it via
      an `allowScripts` allowlist in the root `package.json` (`esbuild@0.27.7` from
      tsup, `esbuild@0.28.2` from vite) — the minimal carve-out; the strict default
      still blocks everything else.
  - Result: `npm install` completes clean and `npm run verify` (typecheck + lint +
    test + build) passes across both workspaces.

- [x] **Task 4 — Fail-safe CircuitController with single-active invariant**
  - Objective: `CircuitController` over a `GpioDriver` interface guaranteeing at most
    one active circuit (turn all others off and verify before energizing) plus a
    safe-off-all operation. In-memory fake driver for tests. Resolve the real GPIO
    library via a short spike behind the interface.
  - Guidance: Enforce defensively — leave nothing on if verification fails. Keep the
    library choice isolated behind `GpioDriver`.
  - Test: single-active enforcement, safe-off, idempotent on/off, driver-failure.
  - Demo: Requesting B while A is on yields only B active; safe-off leaves none on.
  - Result: `GpioDriver` interface (`setup`/`write`/`read`/`release`) isolates the
    hardware; `CircuitController` energizes only after driving every other circuit
    low and verifying the off-state by read-back, and drives everything safe-off if
    verification or any write fails. A `FakeGpioDriver` (with fault injection) backs
    20 passing tests covering single-active enforcement, safe-off, idempotent
    on/off, and the read/write/verification failure paths.
  - GPIO driver decision (resolves the spike): rather than a native addon, the
    production `GpiodCliDriver` shells out to the libgpiod v1.x CLI (`gpioset`
    holds a line high until killed; `gpioget` reads back), avoiding node-gyp, a
    compiler, and Node-ABI coupling. Killing the holder de-energizes the line, so
    process death fails safe. Validated target: Pi 4, 64-bit bullseye, kernel 5.15,
    `/dev/gpiochip0` present; Pi-side dependency is `apt install gpiod`. Covered by
    tests via an injected process runner; not yet validated on hardware. See
    `docs/gpio-driver.md` (includes the libgpiod v2 CLI-migration note).

- [x] **Task 5 — Boot/exit/crash safe-state + watchdog max-runtime cap**
  - Objective: All relays off at startup before anything else; exit +
    uncaught-exception handlers safe-off; independent watchdog forces safe-off if a
    circuit exceeds its hard max on-time or the scheduler stops heart-beating.
  - Guidance: Safe-off is the first boot action; watchdog independent of scheduler
    timer.
  - Test: boot safe-off ordering, watchdog trip on exceeded max-runtime, safe-off on
    simulated crash.
  - Demo: A stuck-on circuit is forced off by the watchdog after its cap.
  - Result: `Watchdog` (`server/src/safety/watchdog.ts`) runs on its own injected
    clock + interval timer, independent of the scheduler; it trips a safe-off when
    the active circuit exceeds its hard max on-time or the scheduler heartbeat goes
    stale (either condition, including a stale heartbeat mid-run), and latches so it
    trips once. `safe-state.ts` provides `safeStateOnBoot` (drives all off as the
    first action) and `registerSafeStateHandlers` (SIGINT/SIGTERM/uncaughtException/
    unhandledRejection/beforeExit → safe-off then release GPIO, run at most once,
    releasing even if safe-off throws). Both depend on narrow interfaces and are
    covered by 15 tests with a manual clock/timer and a fake process/target.
  - Live wiring: now done in Task 9's `bootstrap()` (`index.ts`) — real monotonic
    clock, `setInterval`/`setTimeout` timers, and `process` handlers around the
    concrete `CircuitController`, with a `WatchedController` arming the max-runtime
    cap. The safety machinery remains independently tested in isolation.

- [x] **Task 6 — JSON persistence for config + history (fresh start, no migration)**
  - Objective: Typed config + history stores in `~/.irrigatalizer` (config: circuits
    with names + pins, programs, global enable, overrides; history: run records with
    retention cap). No migration of old files.
  - Guidance: Validate on read/write; default to empty config on first run.
  - Test: read/write round-trip, defaulting when files absent, history retention cap.
  - Demo: Config + history persist and reload across a restart.
  - Result: `zod` schemas (`persistence/schema.ts`) define circuits (number/name/
    pin), programs (days, single 30-minute start slot, ordered per-circuit steps),
    master `enabled`, and a minimal `override` (expanded in Task 8), plus history
    run records. A `JsonFileStore` validates on read and write, defaults to empty
    state when a file is absent, rejects malformed/invalid files with a
    `PersistenceValidationError`, and writes atomically (temp file + rename).
    `ConfigStore` and `HistoryStore` live under `~/.irrigatalizer` (directory
    injectable for tests); `HistoryStore` enforces a retention cap (default 200,
    keeping the newest). No migration of old files. 10 tests cover round-trip,
    default-on-absent, retention trimming, and validation rejection against a temp
    directory. Dependency: `zod` pinned at `4.5.4` (aged, no install scripts).

- [x] **Task 7 — Redesigned scheduling engine (sequential, multi-program)**
  - Objective: Expand programs (day selection, single 30-minute-slot start time,
    ordered per-circuit durations) into a sequential timeline; compute current/next;
    drive the controller one circuit at a time (never simultaneous). Master
    enable/disable retained. Write history on transitions.
  - Guidance: Separate pure computation (timeline/current/next) from the effectful
    timer loop for testability.
  - Test: timeline expansion, current/next at boundary times, sequential ordering,
    disabled state; property test that no two circuits overlap.
  - Demo: A two-program config reports correct current/next and drives sequentially.
  - Result: Split into a pure `timeline.ts` and an effectful `scheduler.ts`.
    `buildTimeline` expands each program's steps back-to-back from its 30-minute
    start slot across the current and next local day (matching days by weekday), and
    `currentAndNext` resolves the running/upcoming run for any instant; a disabled
    schedule yields an empty timeline. `Scheduler` is timer-driven (injected clock +
    one-shot timer): it wakes at each transition, drives at most one circuit through
    the controller, records a history run on each transition, heartbeats so the
    watchdog knows it is alive, caps idle sleep so heartbeats stay regular, and
    safely restarts on `apply(config)`. 18 tests cover expansion, boundary
    current/next, sequential switching one-at-a-time, disabled state, safe-off when
    idle, and a 200-iteration property test asserting no two runs overlap.
  - Overlap policy (decided): when multiple programs' runs would collide, candidate
    runs are sorted by intended start and any run that would begin before the prior
    one ends is pushed to start exactly when the prior ends, preserving each run's
    full duration. This guarantees the never-simultaneous invariant deterministically
    rather than dropping or truncating runs.

- [x] **Task 8 — Overrides: skip next, skip 24h, rain-delay N days (auto-resume)**
  - Objective: Time-bounded override state that suppresses scheduled runs and
    auto-resumes, integrated into current/next computation and persisted.
  - Guidance: Scheduler consults overrides when deciding what to run next;
    interoperates with disabled state.
  - Test: each override type, auto-resume at expiry, interaction with disabled state.
  - Demo: "Skip 24h" reports no runs until the window passes, then resumes.
  - Result: `overrides.ts` adds builders (`createSkipNext`, `createSkip24h`,
    `createRainDelay`) and a pure `applyOverride(timeline, override, now)` plus
    `effectiveTimeline(config, now)`, which the scheduler now uses in place of the
    raw timeline. `skip-24h` and `rain-delay` are time windows that drop every run
    starting before `expiresAt` and suppress nothing once expired (auto-resume);
    `skip-next` (no fixed expiry) drops the next whole session. The `Override`
    schema gained `createdAt` and a nullable `expiresAt`, persisted with the
    configuration. A disabled schedule yields nothing regardless of any override.
    11 tests cover each type, auto-resume after expiry, and the disabled
    interaction.
  - skip-next semantics (decided): it suppresses the next session that has not yet
    started (grouping back-to-back runs into sessions), skipping any session already
    in progress rather than truncating a circuit that is already watering.

- [x] **Task 9 — Express REST API (no WebSockets)**
  - Objective: REST endpoints for config CRUD (circuits/programs), status
    (current/next, enabled, override) for polling, history, manual run/test
    start-stop, and overrides. Applying config safely restarts the scheduler.
  - Guidance: Validate inputs. Manual run goes through the `CircuitController` so the
    invariant and watchdog apply. No WS/SSE.
  - Test: integration tests against the fake driver + temp store (manual run, status,
    apply config restarts scheduler).
  - Demo: Start a manual run via curl and poll `/api/status` for active circuit +
    remaining time.
  - Result: `api/app.ts` exposes `GET/PUT /api/configuration` (PUT validates with
    zod and calls `scheduler.apply` to restart), `GET /api/status` (now, enabled,
    override, active manual run, current/next from `effectiveTimeline`), `GET
/api/history`, `POST /api/manual-run` + `/api/manual-run/stop`, and `POST/DELETE
/api/override`. Invalid input returns 400 `{ error }`. `ManualRunController`
    runs a circuit for a fixed duration through the controller (invariant + watchdog
    apply), suspending the scheduler for the duration and resuming after (timeout or
    early stop). `createApp(deps)` takes injected dependencies; 10 supertest
    integration tests run against a real controller + `FakeGpioDriver` + temp-dir
    stores.
  - Live wiring (resolves the Task 5 deferral): `bootstrap()` in `index.ts` composes
    the `GpiodCliDriver`, `CircuitController`, stores, `Watchdog` (real monotonic
    clock + `setInterval`), `Scheduler` and `ManualRunController` (real `setTimeout`
    - `Date.now`), and a `WatchedController` decorator that arms the watchdog's
      max-runtime cap on every energize without coupling the scheduler to the
      watchdog. Boot drives safe-off first; SIGINT/SIGTERM/crash handlers safe-off and
      release GPIO; the watchdog trip drives safe-off. Not yet started against real
      hardware (needs the Pi + `gpiod`); all logic is covered by the fake driver.

- [x] **Task 10 — Phone-first React SPA served by the backend; live via polling**
  - Objective: Vite React app served as static files by the backend. Dashboard
    (current/next with local countdown, running status, readable history/sparkline,
    log), schedule/program editor with named circuits, manual run controls, skip/pause
    controls. Live via local countdown + periodic `/api/status` polling.
  - Guidance: Consume REST from Task 9. Phone-first, works on desktop. No WebSockets.
  - Test: component tests for the schedule editor and dashboard status rendering;
    smoke test that the built SPA loads against the running backend.
  - Demo: On a phone viewport: live status, edit a program with named circuits,
    trigger a manual run, apply a skip.
  - Result: A phone-first React SPA under `web-ui/src`. A typed `api/client.ts`
    (with `ApiError`) wraps the Task 9 REST endpoints; `useStatus` polls
    `/api/status` every 5s (aborting on unmount) and derives a server/client clock
    offset, and `useNow` ticks a 1s local clock so countdowns update between polls
    without WebSockets. Three tabs: Dashboard (running/manual circuit with live
    countdown, next run, a redesigned per-circuit history timeline replacing the old
    dual sparklines, and an activity log reconstructed from history transitions —
    the backend exposes no log endpoint; disabled and override banners included),
    Schedule editor (named-circuit inputs plus programs with day toggles, a
    30-minute start-slot select, and ordered per-circuit-duration steps, saved in
    one PUT that safely restarts the scheduler), and Controls (manual run + skip
    next / skip 24h / rain-delay-N-days, all through the backend so the invariant
    and watchdog apply). The Express app now serves the built SPA statically with an
    `index.html` fallback for client routes and a JSON 404 for unknown `/api/*`;
    `staticDir` is injectable (`WEB_UI_DIST` or resolved beside the compiled server).
    Tests: 16 web-ui component tests (Dashboard status rendering, ScheduleEditor
    editing/save via `@testing-library/user-event`) and 6 server SPA tests including
    a build-dependent smoke test that boots the API against the real `web-ui/dist`
    and asserts the shell + injected module load. Full `npm run verify` (typecheck +
    lint + 116 tests + build across both workspaces) is green.
  - Testing-library note: added `@testing-library/user-event@14.6.6` (chosen as the
    better tool for realistic interaction over the lower-level `fireEvent`; pinned to
    the newest release older than the devcontainer's 21-day min-release-age).
  - React-rules note: the SPA editor resets its draft from a changed prop via the
    documented "store previous prop in state, adjust during render" pattern, and the
    mount data-fetch is an explicit async effect — both to satisfy the strict
    `react-hooks` lint rules without disabling them.
  - Local dev flow (fake driver): `npm run dev:fake` runs the backend and the Vite
    dev server together (via `concurrently`), with the backend selecting the
    in-memory `FakeGpioDriver` through `GPIO_DRIVER=fake` so the whole UI is
    exercisable on a machine with no GPIO hardware or `gpiod` CLI. `bootstrap()`
    resolves the driver from `GPIO_DRIVER` (default: real `GpiodCliDriver`) and also
    accepts an injected `driver`. Vite binds all interfaces on a fixed `5173`
    (`host: true`, `strictPort`) and proxies `/api` to the backend, so only port
    5173 needs forwarding to reach it from another machine. (`npm run dev` uses the
    real driver and needs `gpiod` present.)
  - UI gap fixed post-review: the schedule editor now has an "Add circuit"
    affordance (adds the next free circuit number 1..8 with a default name and its
    default BCM pin) and per-circuit "Remove" (which also drops any program steps
    referencing the removed circuit), so a fresh empty configuration can be built up
    entirely from the UI. The per-program button that appends a step was renamed
    "Add step" to disambiguate it from "Add circuit". Each circuit row also shows its
    read-only BCM GPIO pin (fixed by circuit number, matching legacy 1→17…8→16).
  - Configurable timezone (post-review): the schedule now has a single canonical
    IANA timezone stored in the configuration (`timezone`, validated against
    `Intl.supportedValuesOf('timeZone')`, defaulting to the system zone). The
    backend expands programs in that zone and the UI both edits (a timezone picker
    on the Schedule tab) and displays all times in it, so scheduling is unambiguous
    regardless of the server's system clock or any viewer's browser zone — resolving
    the "which browser wins" question by making the config authoritative. This
    matches legacy's implicit model (schedule in the Pi's local time) but makes the
    zone explicit and editable. `timeline.ts` now uses **Luxon** for all day/slot
    math: it anchors each run to its wall-clock time on the calendar day in the
    configured zone (`DateTime.set({hour,minute})`, not a minute-duration added to
    midnight — the latter lands on the wrong wall-clock time across a DST change),
    while durations accumulate in absolute milliseconds. Covered by DST-transition
    tests (America/New_York spring-forward). Dependency: `luxon` 3.7.1 + types.
  - Scheduling bug fixed (post-review): `buildTimeline` previously expanded only the
    reference day plus one, so a weekly program more than a day out never appeared
    under "Next" (a Tuesday-only program showed nothing for the rest of Tuesday and
    all week until it silently reappeared). The horizon is now eight days, which
    guarantees the next occurrence of any weekly program is always found, including
    the just-missed-today case whose next run is a full seven days out.
  - Manual-run history fixed (post-review): manual runs went through the
    `CircuitController` (so the invariant/watchdog applied) but were never recorded,
    so a completed manual run left no trace in the dashboard's History or Activity.
    `ManualRunController` now records the run and shows up like a scheduled run.
    Refined after a follow-up: rather than writing a completed record at finish
    (which made an in-progress run invisible and surfaced the *previous* run's
    "turned off" as if it were the new run's), the run is recorded **at start with
    a null end** and that open record is **closed with the actual end at finish**
    (an early stop records its true, shorter duration; starting a replacement run
    closes any still-open record first). `HistoryStore.closeOpenRun(end)` sets the
    end on the newest open record; `ManualRunController` depends on a narrow
    `ManualRunHistory` (append + closeOpenRun). The UI already handled open records
    (activity shows only "turned on"; the sparkline draws an active bar to now).
    Covered by API tests (open-at-start, closed-on-complete with no duplicate,
    early-stop) and `HistoryStore.closeOpenRun` unit tests.

- [~] **Task 11 — Finalize wiring, deploy scripts, README**
  - Objective: New server is the single entrypoint serving SPA + API; update
    release/deploy scripts and pm2 config for the new build; rewrite `README.md` for
    the new architecture and Pi setup (including the normally-closed wiring note).
  - Guidance: Release tarball includes the built SPA + compiled server; verify
    `npm install --omit=dev`. Do NOT execute the scp/ssh deploy or any remote git
    operation without explicit, command-by-command authorization.
  - Test: full local verification (typecheck + unit + integration + SPA smoke);
    dry-run release packaging locally.
  - Demo: A single built artifact starts the server, serves the SPA, controls the
    fake (or real) driver end-to-end; old code absent from `main`.
  - Deploy IaC (done): SSH-driven infrastructure-as-code under `infra/` provisions
    and deploys to a bare Raspberry Pi OS Lite (arm64) install (bookworm or later;
    provisioned and confirmed on Debian 13 trixie with libgpiod v2.2.1).
    `provision.sh` does one-time system setup (installs the libgpiod v2 `gpiod`
    CLI, Node via NodeSource, and pm2; creates an unprivileged service user in the
    `gpio` group with its home at the data dir; makes the app/data dirs; adds a
    persistent port `80 -> APP_PORT` iptables redirect; registers pm2's boot
    service). `package.sh` runs `npm run verify` and assembles a release tarball
    (compiled `server/dist` + built `web-ui/dist` + the pm2 `ecosystem.config.cjs`
    + a generated runtime `package.json` carrying only the server's production
    deps, so `npm install --omit=dev` resolves express/luxon/zod). `deploy.sh`
    ships the tarball, extracts it into `APP_DIR`, installs runtime deps, writes
    the runtime env, and `pm2 reload`/`start` + `pm2 save`. Connection/install
    settings live in `infra/config.env` (git-ignored; `.example` committed).
    Persisted config/history live at `<DATA_DIR>/.irrigatalizer` (the pm2 config
    points `HOME` there) so they survive the wholesale `APP_DIR` replacement on
    each deploy. `package.sh` verified locally (build green, tarball layout
    correct); the remote `provision.sh`/`deploy.sh` have not been run against a Pi
    (requires explicit authorization) and the GPIO driver is not yet
    hardware-validated. Added an ESLint override for `infra/**/*.cjs` (CommonJS
    globals) so the repo-wide `verify` lint accepts the pm2 config.
  - GPIO driver on libgpiod v2 (done): `GpiodCliDriver` now targets the libgpiod
    v2 CLI (bookworm and later) — `gpioset -c <chip> <pin>=1` holding until the
    process is killed, and `gpioget --numeric -c <chip> <pin>` for read-back — and
    no longer supports the v1.x syntax. `docs/gpio-driver.md` updated accordingly.
    Release race fixed: in v2 a held line is exclusively reserved, and killing the
    holding `gpioset` is asynchronous, so a read-back immediately after releasing
    would report the line busy. Driving a line low now awaits the holder's actual
    exit (bounded by a `releaseTimeoutMs`, default 2s, so de-energizing cannot hang
    on a wedged holder — a holder that outlives the timeout leaves the line high,
    which the controller's verify-low correctly rejects). Confirmed against the Pi
    that reading a released/never-held line returns cleanly; the manual `gpioget`
    "busy" only occurs when reading a still-held line, which the controller never
    does.
  - Deploy hardening (done, after a bring-up on real hardware): three fixes from
    diagnosing a stuck first deploy on Debian 13 trixie. (a) `deploy.sh` runs all
    `pm2`/`npm` commands as the service user from `APP_DIR` via an `as_service`
    helper — pm2 spawns its daemon inheriting the cwd, and launching from a dir the
    service user cannot enter (the login user's `0700` home) failed with `spawn
    node EACCES`. (b) pm2 log capture fixed: the ecosystem config writes explicit
    `out_file`/`error_file` under `<DATA_DIR>/logs` (service-user-owned, created by
    both provision and deploy) instead of the default `$HOME/.pm2` logs, which came
    up empty/root-owned and hid the failure; `.pm2` and `logs` are now created and
    owned by the service user up front. (c) `deploy.sh` polls
    `http://localhost:$APP_PORT/api/status` after start and fails the deploy
    (dumping recent logs) if the app never answers — pm2 "online" only means the
    process is alive, not that it bound the port. Correspondingly, `bootstrap()`
    failure in `index.ts` now `process.exit(1)`s instead of only setting
    `exitCode`, so a failed boot dies visibly (leftover watchdog timers were
    keeping a failed process alive-but-not-listening). App verified serving under
    pm2 with the fake driver (`GPIO_DRIVER=fake`) on the Pi.
  - Simulated-driver banner (done): `/api/status` now reports the active GPIO
    driver (`driver: "fake" | "gpiod"`, derived in `bootstrap` from the same
    env-driven branch that selects the driver, not by `instanceof`), and the
    Dashboard shows a banner when it is `"fake"` so a UI running against the
    in-memory driver is never mistaken for one switching real relays. Covered by
    API and Dashboard tests.
  - Shutdown-exit fix (done): the SIGINT/SIGTERM handlers ran safe-off + release
    but never exited, so registering the handler overrode Node's default
    termination and the still-alive HTTP server + watchdog interval kept the
    process running — `^C` printed "safe-state shutdown" but did not stop it, and
    pm2 stop/restart had to wait out `kill_timeout` then SIGKILL (a major source of
    stale/half-running processes during bring-up). `registerSafeStateHandlers` now
    exits after the safe-off sequence: code 0 for SIGINT/SIGTERM, code 1 for
    uncaught-exception/unhandled-rejection; `beforeExit` still does not exit (the
    runtime is already leaving). `exit` is injectable for tests. Covered by
    safe-state tests asserting the exit code per trigger.
  - History ordering (done): the dashboard history timeline now orders circuit rows
    alphabetically by display name (numeric tiebreaker) to match the name-first UI.
  - Deploy update aligned to pm2's recommendation (done): `deploy.sh` now uses
    `pm2 startOrRestart ecosystem.config.cjs --update-env` (pm2's idempotent
    start-or-refresh, passing the ecosystem file so updated `env:` values are
    actually applied — CLI env is otherwise conservative) instead of a hand-rolled
    describe/reload/start branch. This avoids the stale/duplicate process
    definitions that caused the wrong (or no) `GPIO_DRIVER` env during bring-up.
    Fork mode is single-owner, so `reload` gives no zero-downtime benefit over
    `restart`; the brief restart is accepted. The health check now requires the
    `driver` field in `/api/status` (present only in current builds) so a stale or
    stray process squatting the port cannot pass as a successful deploy, and on
    failure it reports what is listening on the port rather than auto-killing it.
  - Remaining: rewrite `README.md` for the new architecture (the current file still
    documents the legacy Node 12 / `index.js` / old pm2 flow below the "Related"
    heading) and confirm the deploy end-to-end on a Pi with real hardware.
