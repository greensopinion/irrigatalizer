# GPIO Driver

The backend controls relays through a `GpioDriver` interface. Domain and safety
logic (the `CircuitController`, scheduler, and watchdog) depend only on that
interface, so the concrete driver can change without touching tested logic.

The concrete design below is the result of extensive hardware characterization on
the target stack (Raspberry Pi 4, Debian 13 trixie, libgpiod v2.2.1, relay board
wired). The reasoning and evidence are in `docs/gpio-driver-decision.md`; the
reproducible probes are in `docs/manual-tests-gpio-hardware.md`.

## Chosen mechanism: `gpioset` (on) + `pinctrl` (off), no native addon

The production driver, `GpiodCliDriver`, shells out to the Raspberry Pi GPIO
command-line tools rather than binding a native addon. For an irrigation
controller — a handful of relay outputs switched minutes apart — the cost of
spawning a process per state change is irrelevant, and this avoids `node-gyp`, a
compiler on the Pi, and coupling to a specific Node ABI.

Two tools, each doing what it is reliable at on this stack:

- **On** = a long-lived `gpioset -c <chip> <pin>=1` process holding the line high.
  The relay is energized while the holder lives.
- **Off** = kill that holder, wait for it to exit (so the exclusively-reserved
  line is released), then drive the pad low with `pinctrl set <pin> op dl`.
- **Boot / safe-off / release** = `pinctrl set <pins> op dl` drives all pins low.

`setup()` drives every configured pin low as the initial state. `release()` (on
shutdown) kills all holders and drives every pin low, so the hardware is left
de-energized, not merely released.

### Why off is an explicit `pinctrl` drive-low, not a line release

The pivotal hardware finding: **on this stack, releasing a `gpioset` holder does
NOT drive the line low — the pad retains its last driven level (high), so the relay
stays on.** "Off = kill the holder" is therefore false and unsafe here. Off must
actively drive the pad low. `pinctrl set <pin> op dl` does this synchronously (it
returns after the level is set) and the low level is retained after it exits.

Killing the holder before driving low matters because in libgpiod v2 a held line
is exclusively reserved; `pinctrl` must not race a still-live holder. The driver
waits for the holder to exit (bounded by a timeout so de-energizing cannot hang on
a wedged holder) before the `pinctrl` drive-low.

### read() is advisory only — no read-back verify

There is **no reliable read-back** on this stack, so the controller does not read
pins back to verify the off-state before energizing:

- `gpioget` reports the pin's internal **pull resistor**, not its driven level
  (reading through libgpiod reconfigures the line to an input). Pull-up pins (BCM
  5, 6) read `1` even when driven low. This caused a boot-time crash-loop when the
  controller trusted it.
- `pinctrl get` reads the pad register accurately right after a `set` but can
  report stale latched state otherwise.

So `GpioDriver.read` is implemented via `pinctrl get` (parsing the `hi`/`lo` field)
and kept **advisory** — for diagnostics/logging only. The single-active invariant
rests on *driving* other lines low (synchronous, reliable) before energizing, not
on reading them back.

All arguments are passed as an argv array, never an interpolated shell string.

## Fail-safe scope (important)

Relay-off is guaranteed only while the controller process is alive to drive it:

- **Graceful stops are covered.** Safe-off on boot, exit, SIGINT/SIGTERM, uncaught
  exception, and watchdog trip all drive every pin low explicitly via `pinctrl`.
- **Ungraceful loss is NOT covered in software.** A hard kill (`kill -9`), kernel
  panic, or power loss while a circuit is energized leaves the pad high (relay on)
  until something drives it low. No userspace cleanup can cover this — the `gpioset`
  holder dies with the process, and a released line retains its last level.

Therefore the strict guarantee **"no live process / power loss ⇒ valve closed"
must come from hardware**: wire the valves/relays so an **un-driven or released
GPIO leaves the valve closed** (normally-closed valves + matching relay logic).
This is required for production; the software safe-off only covers graceful stops.

Note: the firmware `gpio=<pins>=op,dl` `config.txt` directive was tried as a
power-on default and is **ineffective on trixie** (verified: directive present and
rebooted, pins still not driven low), so it is not used. The app drives pins low
at startup via `pinctrl` in `setup()` instead, which covers the app-start case;
the ungraceful cases still need the hardware default above.

## Target and dependencies

Target: Raspberry Pi 4, 64-bit Debian 12 (bookworm) or later, with the GPIO
character device present (`/dev/gpiochip0`). Validated on Debian 13 (trixie) with
libgpiod v2.2.1 and the relay board wired: the `gpio` group owns `/dev/gpiochip0`
(group rw) and the service user is a member.

Two CLI tools are required on the Pi (both ship with Raspberry Pi OS; no compiler
or dev headers needed):

```
sudo apt install gpiod        # provides gpioset (libgpiod v2) — used for ON
sudo apt install raspi-utils  # provides pinctrl — used for OFF and boot safe-off
```

`provision.sh` installs `gpiod` and fails loudly if either `gpioset` or `pinctrl`
is missing. The 40-pin header is `gpiochip0`, the driver's default chip.

### Permissions

`/dev/gpiochip*` is owned `root:gpio`. The user that runs the service (e.g. the pm2
daemon user) must belong to the `gpio` group:

```
sudo usermod -aG gpio <service-user>
```

## libgpiod version

The driver targets **libgpiod v2** (bookworm and later) for `gpioset`. The older
v1.x CLI (positional chip argument, `gpioset --mode=signal`) is **not** supported.
Off/boot use `pinctrl`, which is Raspberry-Pi-specific. If a target ever ships only
v1 libgpiod or lacks `pinctrl`, the driver's command construction would need to
change, but this is an isolated change behind the `GpioDriver` interface, not an
ABI break.

The logic is covered by unit tests using an injected process runner, and the
on/off/boot behaviours were validated on real hardware with relays and water (see
`docs/manual-tests-gpio-hardware.md`). Energizing should still be confirmed on the
Pi with a manual `gpioset`/`pinctrl` spot check during deployment.
