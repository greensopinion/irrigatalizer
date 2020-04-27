const scheduleService = require("./schedule-service");
const circuitService = require("./circuit-service");

const start = async () => {
  await restart();
};

const turnAllCircuitsOff = async () => {
  await Promise.all(circuitService.allCircuits().map((c) => c.off()));
};

const shutdown = async () => {
  console.log("shutting down scheduler");
  await turnAllCircuitsOff();
  console.log("scheduler is shut down");
};

const logWakeUp = (ms) => {
  console.log(
    `scheduler waking up in ${ms / 1000}s at ${new Date(
      Date.now() + ms
    ).toString()}`
  );
};

var timer = null;
const restart = async () => {
  if (timer) {
    clearTimeout(timer);
    timer = null;
  }
  console.log("starting scheduler");

  const schedule = await scheduleService.retrieve();
  const now = Date.now();
  var circuitToStart = null;
  if (schedule.current && schedule.current.effectiveEndTime > now) {
    circuitToStart = schedule.current;
  } else if (schedule.next && schedule.next.effectiveStartTime <= now) {
    circuitToStart = schedule.next;
  }
  const onCircuits = circuitService.allCircuits().filter((c) => c.isOn);
  if (
    circuitToStart == null ||
    onCircuits.length > 1 ||
    (onCircuits.length > 0 && onCircuits[0].circuit !== circuitToStart.circuit)
  ) {
    await turnAllCircuitsOff();
  }
  if (circuitToStart) {
    const circuit = circuitService.circuit(circuitToStart.circuit);
    await circuit.on();
    const nextThingToDoTime = circuitToStart.effectiveEndTime - now;
    logWakeUp(nextThingToDoTime);
    timer = setTimeout(restart, nextThingToDoTime);
  } else if (schedule.next) {
    const nextThingToDoTime = schedule.next.effectiveStartTime - now;
    if (nextThingToDoTime <= 0) {
      nextThingToDoTime = 1000;
    }
    logWakeUp(nextThingToDoTime);
    timer = setTimeout(restart, nextThingToDoTime);
  } else {
    console.log("scheduler has nothing to do, shutting down");
  }
};

module.exports = {
  start,
  restart,
  shutdown,
};
