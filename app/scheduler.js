const logger = require("./logger");
const scheduleService = require("./schedule-service");
const circuitService = require("./circuit-service");
const duration = require("./duration");


const turnAllCircuitsOff = async () => {
  await Promise.all(circuitService.allCircuits().map((c) => c.off()));
};

const logWakeUp = (ms) => {
  logger.log(
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
  logger.log("shutting down scheduler");
  await turnAllCircuitsOff();
  await Promise.all(circuitService.allCircuits().map((c) => c.close()));
  logger.log("scheduler is shut down");
};

const findStartCicruit = (schedule, time) => {
  if (schedule.current && schedule.current.effectiveEndTime > time) {
    return schedule.current;
  } else if (schedule.next && schedule.next.effectiveStartTime <= time) {
    return schedule.next;
  }
  return null;
};

const circuitAboutToChange = (circuitToStart) => {
  const onCircuits = circuitService.allCircuits().filter((c) => c.isOn);
  return onCircuits.length > 0 && (!circuitToStart || onCircuits[0].circuit !== circuitToStart.circuit);
};

const scheduleApply = async (wakeupDuration) => {
  const effectiveDuration = Math.max(wakeupDuration, 3000);
  logWakeUp(effectiveDuration);
  timer = setTimeout(applySchedule, effectiveDuration);
};

const applySchedule = async () => {
  clearTimer();

  const schedule = await scheduleService.retrieve();
  const now = Date.now();
  const circuitToStart = findStartCicruit(schedule, now);
  if (circuitAboutToChange(circuitToStart)) {
    await turnAllCircuitsOff();
  }
  if (circuitToStart) {
    const circuit = circuitService.circuit(circuitToStart.circuit);
    await circuit.on();
    scheduleApply(circuitToStart.effectiveEndTime - now);
  } else if (schedule.next) {
    scheduleApply(schedule.next.effectiveStartTime - now);
  } else {
    logger.log("scheduler has nothing to do, stopping");
  }
};

const start = async () => {
  clearTimer();
  logger.log("starting scheduler");
  await applySchedule();
};

const restart = async () => {
  await start();
};

module.exports = {
  start,
  restart,
  shutdown,
};
