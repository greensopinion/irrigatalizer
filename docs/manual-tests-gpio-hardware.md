# Manual GPIO Hardware Tests — trixie + libgpiod v2 + wired relays

Purpose: characterize the production GPIO stack and validate the driver's on/off
model on real hardware. Achieved by moving the **bench trixie micro-SD card** into
the **connected Pi** (relay board wired), so we get the one machine that combines
trixie + libgpiod v2 + real relays. The findings here drive the driver design in
`docs/gpio-driver-decision.md`.

Environment used: Raspberry Pi 4, Debian 13 (trixie), `gpioset (libgpiod) v2.2.1`,
`pinctrl` present, relay board wired, water supply on. Chip is `gpiochip0`.

## ⚠️ Safety

These commands switch **real relays and water**. Run steps deliberately, one
circuit at a time, keep runs short. Before relying on any run, stop the service so
it cannot fight you:

```bash
alias aspm2='sudo -u irrigatalizer env HOME=/var/lib/irrigatalizer pm2'
aspm2 stop irrigatalizer 2>/dev/null || true
```

`pinctrl set <pins> op dl` is the panic "all off" command.

## Pin map (`server/src/gpio/default-circuit-pins.ts`)

| Circuit | BCM pin | Internal pull |
|--------:|--------:|---------------|
| 1 | 17 | pull-down |
| 2 | 27 | pull-down |
| 3 | 22 | pull-down |
| 4 | 5  | pull-up |
| 5 | 6  | pull-up |
| 6 | 13 | pull-down |
| 7 | 12 | pull-down |
| 8 | 16 | pull-down |

## Verified findings

These were confirmed by hand on the stack above (relay LEDs + water flow).

1. **On = held `gpioset`.** `gpioset -c gpiochip0 <pin>=1` (held) energizes the
   relay; water flows. Correct polarity: high = on. Confirmed on BCM 17, 5, 12.
2. **Release ≠ off.** Killing the holder (Ctrl-C / exit) leaves the pad **high**;
   the relay stays on. Also true for the `gpioset -t <dur>,0` timed form if
   interrupted before it completes. So process death does NOT de-energize.
3. **Off = kill holder, then `pinctrl set <pin> op dl`.** `pinctrl` drives the pad
   low synchronously and the low level is **retained after `pinctrl` exits**
   (`pinctrl get` shows `op … lo`, no holder alive). Relay de-energizes; water
   stops.
4. **All-low in one call:** `pinctrl set 5,6,17,27,22,13,12,16 op dl` drives every
   relay pin low; all read `lo`, no holders.
5. **No cross-pin disturbance:** with pin 5 driven low via `pinctrl`, holding pin 6
   high with `gpioset` leaves pin 5 still `lo`. Energizing one line does not knock
   another pinctrl-low line off.
6. **`gpioget` is not a valid read-back:** it reports the pin's internal pull, not
   the driven level — with pins driven `lo` via pinctrl, `gpioget` returned `1 1 0`
   for BCM `5 6 17` (tracking pull-up/pull-up/pull-down). `pinctrl get` reports the
   true pad level.
7. **`config.txt gpio=…=op,dl` is ineffective on trixie:** directive present in
   `/boot/firmware/config.txt` and rebooted (boot time later than file mtime), yet
   pins were not driven low. Not used; the app drives pins low at startup via
   `pinctrl` instead.

### The exact verified sequences (what the driver does)

```bash
# ON (held):
gpioset -c gpiochip0 17=1 &         # relay on while this lives

# OFF (kill holder, then drive low):
kill "$!"; wait 2>/dev/null          # release (pad still retains high here!)
pinctrl set 17 op dl                 # drive low; relay off; stays off
pinctrl get 17                       # -> 17: op -- pd | lo

# ALL OFF (boot / safe-off / release):
pinctrl set 5,6,17,27,22,13,12,16 op dl
```

## Remaining validation checklist (run before trusting in production)

The on/off/all-low mechanics are proven. Still to confirm on the production Pi:

1. **Fail-safe (ungraceful):** `kill -9` the server while a circuit is on. Expected
   per the findings: the relay **stays on** (pad retains high) until something
   drives it low — this is why hardware normally-closed wiring is required. Confirm
   the behaviour and that the hardware wiring closes the valve when un-driven.
2. **Graceful safe-off:** `pm2 stop` / SIGTERM the running server while a circuit
   is on; confirm the relay goes off (the app drives every pin low on shutdown).
3. **Boot safe-off:** start the server (real driver, `GPIO_DRIVER` empty); confirm
   `setup()` drove all pins low and `/api/status` reports `"driver":"gpiod"` with
   no `SafetyViolationError` in the logs.
4. **End-to-end:** start a short manual run on one circuit; confirm the relay
   actuates and water flows, then that stop/expiry de-energizes it.

```bash
# 3 + 4:
aspm2 start /opt/irrigatalizer/ecosystem.config.cjs
aspm2 logs irrigatalizer --lines 40 --nostream       # no SafetyViolationError
curl -fsS http://localhost:9000/api/status | head -c 400; echo   # "driver":"gpiod"
```

## Restoring the cards afterward

Power down and swap the cards back so each Pi returns to its own OS. The trixie
card's config/history live at `/var/lib/irrigatalizer/.irrigatalizer` on that card
and travel with it.
