const scheduleService = require("./schedule-service");
const circuitService = require("./circuit-service");
const duration = require("./duration");

const start = async () => {
  await restart();
};

const turnAllCircuitsOff = async () => {
  await Promise.all(circuitService.allCircuits().map((c) => c.off()));
};

const logWakeUp = (ms) => {
  console.log(
    `scheduler waking up in ${duration(ms)} at ${new Date(
      Date.now() + ms
    ).toString()}`
  );
};

var timer = null;
const clearTimer = () => {
  if (timer) {
    clearTimeout(timer);
    timer = null;
  }
};

const shutdown = async () => {
  clearTimer();
  console.log("shutting down scheduler");
  await turnAllCircuitsOff();
  await Promise.all(circuitService.allCircuits().forEach((c) => c.close()));
  console.log("scheduler is shut down");
};

const applySchedule = async () => {
  clearTimer();

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
    console.log("scheduler has nothing to do, stopping");
  }
};

const restart = async () => {
  clearTimer();
  console.log("starting scheduler");
  await applySchedule();
};

module.exports = {
  start,
  restart,
  shutdown,
};
