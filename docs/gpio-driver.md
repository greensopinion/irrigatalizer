# GPIO Driver

The backend controls relays through a `GpioDriver` interface. Domain and safety
logic (the `CircuitController`, scheduler, and watchdog) depend only on that
interface, so the concrete driver can change without touching tested logic.

## Chosen mechanism: libgpiod CLI (no native addon)

The production driver, `GpiodCliDriver`, shells out to the libgpiod command-line
tools rather than binding a native addon. For an irrigation controller — a handful
of relay outputs switched minutes apart, plus possible edge inputs — the cost of
spawning a process per state change is irrelevant, and this avoids `node-gyp`, a
compiler on the Pi, and coupling to a specific Node ABI.

The driver targets **libgpiod v2**, the version shipped by Raspberry Pi OS
bookworm (Debian 12) and later — validated on trixie (Debian 13), which ships
libgpiod v2.2.1. It does not support the v1.x CLI.

- An output is driven high by a long-lived `gpioset -c <chip> <pin>=1` process. In
  libgpiod v2 `gpioset` holds the requested value until the process exits (there
  is no `--mode` flag); killing it releases the line, which drives it low.
- Read-back uses `gpioget --numeric -c <chip> <pin>`, which the controller relies
  on to verify the off-state before energizing another circuit. `--numeric` makes
  v2 print `1`/`0` rather than `active`/`inactive`.
- The chip is passed with `-c` so lines are addressed by numeric offset rather
  than by name.
- All arguments are passed as an argv array, never an interpolated shell string.

### Fail-safe property

Because each energized line is held by a child process, the relay state is tied to
process liveness: if the Node process dies, its `gpioset` children die with it and
the lines release (drive low). Combined with **normally-closed** relay wiring, loss
of the controlling process stops watering.

## Target and dependencies

Target: Raspberry Pi 4, 64-bit Debian 12 (bookworm) or later, with the GPIO
character device present (`/dev/gpiochip0`) and libgpiod v2 CLI tools. Provisioned
and confirmed on Debian 13 (trixie) with libgpiod v2.2.1: the `gpio` group owns
`/dev/gpiochip0` (group rw) and the service user is a member.

Install the libgpiod tools on the Pi (no compiler or dev headers required):

```
sudo apt install gpiod
```

The 40-pin header is `gpiochip0`, which is the driver's default chip.

### Permissions

`/dev/gpiochip*` is owned `root:gpio`. The user that runs the service (e.g. the pm2
daemon user) must belong to the `gpio` group:

```
sudo usermod -aG gpio <service-user>
```

## libgpiod version

The driver targets **libgpiod v2** (bookworm and later). The older v1.x CLI —
which used a positional chip argument, `gpioset --mode=signal`, and `active`/
`inactive` read output — is **not** supported. If a target ever ships only v1,
the argument construction in `GpiodCliDriver` would need to change, but this is an
isolated, no-compiler change behind the `GpioDriver` interface, not an ABI break.

The driver has not been validated against real hardware yet; the logic is covered
by tests using an injected process runner, and pin toggling should be confirmed on
the Pi (e.g. with `gpioget`/`gpioset` manually) during deployment.
