const configurationService = require("./domain/configuration-service");
const MINUTE_IN_MILLIS = 60 * 1000;
const DAY_IN_MILLIS = 24 * 60 * MINUTE_IN_MILLIS;

const applyEffectiveTimes = (now, schedule) => {
  const date = new Date(now);
  date.setHours(0, 0, 0, 0);
  const dayOfWeek = date.getDay();
  for (let entry of schedule) {
    var entryDaysDifference = 0;
    if (entry.day.offset > dayOfWeek) {
      entryDaysDifference = entry.day.offset - dayOfWeek;
    } else if (entry.day.offset < dayOfWeek) {
      entryDaysDifference = entry.day.offset + 7 - dayOfWeek;
    }
    entry.effectiveTime =
      date.getTime() +
      entryDaysDifference * DAY_IN_MILLIS +
      entry.start.offset * MINUTE_IN_MILLIS;

    const circuitsEnabled = Object.values(entry.circuits).filter((c) => c)
      .length;
    entry.totalDuration = MINUTE_IN_MILLIS * entry.duration * circuitsEnabled;
  }
  return schedule;
};

const sortedSchedule = async (now) => {
  const configuration = await configurationService.retrieve();
  const schedule = applyEffectiveTimes(now, configuration.schedule || []);
  return schedule.sort((a, b) => {
    if (a.effectiveTime < b.effectiveTime) {
      return -1;
    } else if (a.effectiveTime === b.effectiveTime) {
      return 0;
    }
    return 1;
  });
};

const decomposeEntry = (entry) => {
  const perCircuitEntries = [];
  var index = 0;
  for (let [key, value] of Object.entries(entry.circuits)) {
    if (value) {
      const durationInMillis = entry.duration * MINUTE_IN_MILLIS;
      const effectiveStartTime = entry.effectiveTime + durationInMillis * index;
      const effectiveEndTime = effectiveStartTime + durationInMillis;
      perCircuitEntries.push({
        circuit: Number(key),
        effectiveStartTime,
        effectiveEndTime,
        duration: durationInMillis,
      });
      ++index;
    }
  }
  return perCircuitEntries;
};

const retrieve = async () => {
  const now = Date.now();

  const schedule = await sortedSchedule(now);

  const perCircuitSchedule = schedule.flatMap(decomposeEntry);

  const nextEntries = perCircuitSchedule.filter(
    (e) => e.effectiveEndTime > now
  );
  const current = nextEntries.find(
    (e) => e.effectiveStartTime <= now && e.effectiveEndTime > now
  );
  const next = nextEntries.find((e) => e.effectiveStartTime > now);
  const response = {
    current,
    next,
    schedule: nextEntries,
  };

  return response;
};

module.exports = {
  retrieve,
};
