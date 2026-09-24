# ADR: GPIO driver off-state and read-back on trixie / libgpiod v2

Status: **Decided and implemented.** Validated on hardware (Raspberry Pi 4, Debian
13 trixie, libgpiod v2.2.1, relay board wired, water supply on). Reproducible
evidence and the remaining production checklist are in
`docs/manual-tests-gpio-hardware.md`.

## Context

`CircuitController` enforces a single-active-circuit invariant: before energizing a
circuit it drives every other circuit off, and boot/safe-off drives all pins off.
The original `GpiodCliDriver` assumed a libgpiod v2 model where **on** = a held
`gpioset <pin>=1` process, **off** = killing that holder (releasing the line), and
**read-back** = `gpioget --numeric` (used to verify the off-state before
energizing).

Deploying to the target stack crash-looped at boot (`safeOffAll`: "pin 5 did not
reach the low state"). Diagnosing it on real hardware invalidated three of those
assumptions.

## Hardware findings (the decision drivers)

Verified on Pi 4 / trixie / libgpiod v2.2.1 with relays wired (see the manual-test
doc for the exact commands):

1. **Releasing a `gpioset` holder does NOT drive the line low.** The pad retains
   its last driven level (high), so a released line keeps the relay **on**. Off is
   only achieved by an *explicit* drive-low. This means process death does not fail
   safe by itself, and "off = release" is unsafe.
2. **`gpioget` cannot read the driven level.** Reading through libgpiod
   reconfigures the line to an input, so `gpioget` reports the pin's internal
   **pull resistor**, not its drive: pull-up pins (BCM 5, 6) read `1` even when
   driven low — which is what tripped the boot `verifyLow`. There is no trustworthy
   hardware read-back on this stack (`pinctrl get` reads the pad but can be stale).
3. **`pinctrl set <pin> op dl` drives the pad low synchronously and the low level
   is retained after it exits.** This is a reliable, race-free off. Driving one
   line low is not disturbed by a later `gpioset` on a different line, so the
   single-active invariant is stable.
4. **The firmware `config.txt gpio=…=op,dl` default is ineffective on trixie**
   (directive present, rebooted, pins still not driven low), though it works on
   bullseye. Not usable here as the power-on default.

## Decision

Rework `GpiodCliDriver` around two tools, each used for what it does reliably, and
remove the read-back verify:

- `write(high)` — held `gpioset -c <chip> <pin>=1`.
- `write(low)` — kill the holder, await its exit (bounded; a timeout **fails**, it
  is never treated as a successful off), then `pinctrl set <pin> op dl`.
- `setup(pins)` — `pinctrl set <pins> op dl` (initial safe state at startup).
- `release()` — kill all holders, then drive all pins low.
- `read()` — advisory only, via `pinctrl get`; **not** used to gate the invariant.
- `CircuitController` — dropped the read-back `verifyLow`. The single-active
  invariant rests on *driving* all others low before energizing (reliable and
  synchronous), not on reading them back (no trustworthy read exists).
- `registerSafeStateHandlers` — safe-off drives every pin low explicitly via the
  driver; no graceful path relies on release to de-energize.
- `provision.sh` — removed the ineffective `config.txt` directive; hard-fails if
  either `gpioset` or `pinctrl` is missing.

Rationale: it is the smallest change that fits the hardware, needs no native
dependency, and every leg rests on behaviour verified on the production stack.
Dropping the read-back is not a regression — a verify against an untrustworthy read
is worse than none (it produced the boot crash and would give false confidence).

## Alternatives rejected

- **Keep the read-back, just switch `gpioget` → `pinctrl get`.** Rejected:
  `pinctrl get` reports stale latched register state and does not reflect a
  release, so it is not a trustworthy live read either — it would relocate the
  false-read problem rather than fix it.
- **A native libgpiod v2 Node binding** (one persistent line request owning all
  pins, real reads/writes). This is architecturally the cleanest and could give a
  genuine read-back. Rejected *for now* only because it reintroduces a
  native/ABI-coupled dependency the CLI approach was chosen to avoid; kept as the
  fallback if a trustworthy hardware read-back is ever needed.
- **Firmware `config.txt` power-on default.** Ineffective on trixie (finding 4).
  The app drives pins low at startup via `pinctrl` instead.
- **One-shot `gpioset -t <dur>,0` for off.** Rejected: the toggle form pulses the
  pin to the opposite level first and does not survive interruption (a mid-run
  Ctrl-C leaves it high), so it is not a safe off primitive.

## Fail-safe scope — hardware backstop still required

Software covers all **graceful** stops (boot, exit, SIGINT/SIGTERM, uncaught
exception/rejection, watchdog trip, normal shutdown) by explicitly driving pins
low. It **cannot** cover **ungraceful** loss — `kill -9`, kernel panic, power loss
— while a circuit is energized: the holder dies, the line releases, and the pad
retains high (relay on). No userspace cleanup can close this.

Therefore the strict guarantee **"no live process / power loss ⇒ valve closed"
must come from hardware**: wire the valves/relays so an un-driven or released GPIO
leaves the valve **closed** (normally-closed valves + matching relay logic). This
is **blocking for production** and is the only thing that covers the ungraceful
cases.
