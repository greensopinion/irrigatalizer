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

- An output is driven high by a long-lived `gpioset --mode=signal <chip> <pin>=1`
  process that holds the line until it is killed. Killing it releases the line,
  which drives it low.
- Read-back uses `gpioget <chip> <pin>`, which the controller relies on to verify
  the off-state before energizing another circuit.
- All arguments are passed as an argv array, never an interpolated shell string.

### Fail-safe property

Because each energized line is held by a child process, the relay state is tied to
process liveness: if the Node process dies, its `gpioset` children die with it and
the lines release (drive low). Combined with **normally-closed** relay wiring, loss
of the controlling process stops watering.

## Target and dependencies

Validated target assumption: Raspberry Pi 4, 64-bit Debian 11 (bullseye), kernel
5.15, with the GPIO character device present (`/dev/gpiochip0`).

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

## Future migration: libgpiod v2

Bullseye ships libgpiod v1.6, whose CLI syntax this driver targets. Debian 12
(bookworm) and later ship libgpiod v2, whose CLI invocation differs (for example
line values and hold semantics changed). Moving to a v2-based OS will require
updating the argument construction in `GpiodCliDriver` — an isolated, no-compiler
change behind the `GpioDriver` interface, not an ABI break.

The driver has not been validated against real hardware yet; the logic is covered
by tests using an injected process runner, and pin toggling should be confirmed on
the Pi (e.g. with `gpioget`/`gpioset` manually) during deployment.
