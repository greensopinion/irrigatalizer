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

- [~] **Task 2 — Preserve old code on local `legacy` branch, delete old codebase**
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

- [ ] **Task 3 — Scaffold TS Express backend + Vite React SPA**
  - Objective: Establish `server/` (Express + TS) and `web-ui/` (Vite + React + TS)
    workspaces, Vitest, lint/format, and a `verify` script (typecheck + test + build)
    with one trivial passing test.
  - Guidance: Pin dependency versions.
  - Test: `verify` runs typecheck + a sample unit test green.
  - Demo: Verification script builds and tests the empty scaffold.

- [ ] **Task 4 — Fail-safe CircuitController with single-active invariant**
  - Objective: `CircuitController` over a `GpioDriver` interface guaranteeing at most
    one active circuit (turn all others off and verify before energizing) plus a
    safe-off-all operation. In-memory fake driver for tests. Resolve the real GPIO
    library via a short spike behind the interface.
  - Guidance: Enforce defensively — leave nothing on if verification fails. Keep the
    library choice isolated behind `GpioDriver`.
  - Test: single-active enforcement, safe-off, idempotent on/off, driver-failure.
  - Demo: Requesting B while A is on yields only B active; safe-off leaves none on.

- [ ] **Task 5 — Boot/exit/crash safe-state + watchdog max-runtime cap**
  - Objective: All relays off at startup before anything else; exit +
    uncaught-exception handlers safe-off; independent watchdog forces safe-off if a
    circuit exceeds its hard max on-time or the scheduler stops heart-beating.
  - Guidance: Safe-off is the first boot action; watchdog independent of scheduler
    timer.
  - Test: boot safe-off ordering, watchdog trip on exceeded max-runtime, safe-off on
    simulated crash.
  - Demo: A stuck-on circuit is forced off by the watchdog after its cap.

- [ ] **Task 6 — JSON persistence for config + history (fresh start, no migration)**
  - Objective: Typed config + history stores in `~/.irrigatalizer` (config: circuits
    with names + pins, programs, global enable, overrides; history: run records with
    retention cap). No migration of old files.
  - Guidance: Validate on read/write; default to empty config on first run.
  - Test: read/write round-trip, defaulting when files absent, history retention cap.
  - Demo: Config + history persist and reload across a restart.

- [ ] **Task 7 — Redesigned scheduling engine (sequential, multi-program)**
  - Objective: Expand programs (day selection, single 30-minute-slot start time,
    ordered per-circuit durations) into a sequential timeline; compute current/next;
    drive the controller one circuit at a time (never simultaneous). Master
    enable/disable retained. Write history on transitions.
  - Guidance: Separate pure computation (timeline/current/next) from the effectful
    timer loop for testability.
  - Test: timeline expansion, current/next at boundary times, sequential ordering,
    disabled state; property test that no two circuits overlap.
  - Demo: A two-program config reports correct current/next and drives sequentially.

- [ ] **Task 8 — Overrides: skip next, skip 24h, rain-delay N days (auto-resume)**
  - Objective: Time-bounded override state that suppresses scheduled runs and
    auto-resumes, integrated into current/next computation and persisted.
  - Guidance: Scheduler consults overrides when deciding what to run next;
    interoperates with disabled state.
  - Test: each override type, auto-resume at expiry, interaction with disabled state.
  - Demo: "Skip 24h" reports no runs until the window passes, then resumes.

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
