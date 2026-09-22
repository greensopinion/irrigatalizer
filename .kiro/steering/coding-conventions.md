# Coding Conventions

These conventions apply to all code in this repository.

## Separation of concerns

- Keep modules focused on a single responsibility. Business/domain logic, I/O
  (filesystem, GPIO, network), and presentation stay in separate layers.
- Hardware access sits behind an interface so domain and scheduling logic never
  depend on a concrete driver or library.
- Push side effects to the edges; keep core logic pure and independently testable.

## Naming

- Use semantic, intention-revealing names for functions and variables. A name should
  say what something is or does, not how it is implemented.
- Prefer clear, longer names over cryptic abbreviations. Avoid single-letter names
  except for trivial, conventional loop indices.
- Functions are verbs or verb phrases; booleans read as predicates (e.g. `isRunning`,
  `hasOverride`).

## Readable code over comments

- Prefer readable code to comments. Most comments are unnecessary — express intent
  through good names and small, well-structured functions instead.
- Do not add comments that restate what the code already says.
- Reserve comments for genuine non-obvious context: why a decision was made, an
  external constraint, a subtle safety invariant, or a workaround. Comment the "why",
  not the "what".
- Comments, if provided at all, should follow the single-responsibility principle; they should address the concerns of the code in the immediate locality, not repeat information that belongs elsewhere.

## Tests

- All production code has tests. New or changed production code ships with tests.
- Tests must always pass. Do not leave failing, skipped, or commented-out tests.
- Prioritize thorough testing of safety-critical logic (single-active-circuit
  invariant, safe-off behavior, watchdog, scheduler timeline/current-next).
- Use test doubles (e.g. a fake GPIO driver) so logic is tested without real hardware.
- Test behavior and outcomes, not implementation details.
- When modifying existing tests, prefer to make minimal changes rather than rewrite.

## General

- Prefer small, composable functions with clear inputs and outputs.
- Fail safely and explicitly; make invalid states hard to represent.
- Keep the local verification flow (typecheck + tests + build) green before
  considering a change complete.
