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
  - Deferred: binding these into the live server (`index.ts` wiring with a real
    monotonic clock, `setInterval` timer, and `process` handlers around a concrete
    `CircuitController`) lands with the scheduler (Task 7) and API (Task 9), when a
    controller instance exists to wire. The safety machinery is complete and tested
    in isolation.

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

- [ ] **Task 9 — Express REST API (no WebSockets)**
  - Objective: REST endpoints for config CRUD (circuits/programs), status
    (current/next, enabled, override) for polling, history, manual run/test
    start-stop, and overrides. Applying config safely restarts the scheduler.
  - Guidance: Validate inputs. Manual run goes through the `CircuitController` so the
    invariant and watchdog apply. No WS/SSE.
  - Test: integration tests against the fake driver + temp store (manual run, status,
    apply config restarts scheduler).
  - Demo: Start a manual run via curl and poll `/api/status` for active circuit +
    remaining time.

- [ ] **Task 10 — Phone-first React SPA served by the backend; live via polling**
  - Objective: Vite React app served as static files by the backend. Dashboard
    (current/next with local countdown, running status, readable history/sparkline,
    log), schedule/program editor with named circuits, manual run controls, skip/pause
    controls. Live via local countdown + periodic `/api/status` polling.
  - Guidance: Consume REST from Task 9. Phone-first, works on desktop. No WebSockets.
  - Test: component tests for the schedule editor and dashboard status rendering;
    smoke test that the built SPA loads against the running backend.
  - Demo: On a phone viewport: live status, edit a program with named circuits,
    trigger a manual run, apply a skip.

- [ ] **Task 11 — Finalize wiring, deploy scripts, README**
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
