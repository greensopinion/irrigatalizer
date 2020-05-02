const configurationService = require("./domain/configuration-service");
const timeOfDay = require("./time-of-day");

const MINUTE_IN_MILLIS = 60 * 1000;

const getNow = () => new Date(Date.now());

const advanceToDayOfWeek = (start, dayOfWeek) => {
  const referenceDay = dayOfWeek % 7;
  const newDate = new Date(start);
  newDate.setHours(0, 0, 0, 0);
  do {
    newDate.setDate(newDate.getDate() + 1);
  } while (newDate.getDay() != referenceDay);
  return newDate.getTime();
};

const applyEffectiveTimes = (time, schedule) => {
  const date = new Date(time);
  date.setHours(0, 0, 0, 0);
  const timeOffset = time.getTime() - date.getTime();
  const dayOfWeek = date.getDay();
  for (let entry of schedule) {
    var entryDaysDifference = 0;
    if (entry.day.offset > dayOfWeek) {
      entryDaysDifference = entry.day.offset - dayOfWeek;
    } else if (entry.day.offset < dayOfWeek) {
      entryDaysDifference = entry.day.offset + 7 - dayOfWeek;
    } else if (
      (entry.start.offset + entry.duration) * MINUTE_IN_MILLIS <
      timeOffset
    ) {
      entryDaysDifference = 7;
    }
    let startDate = date;
    if (entryDaysDifference > 0) {
      startDate = new Date(
        advanceToDayOfWeek(date.getTime(), entry.day.offset)
      );
    }
    entry.effectiveStartTime =
      startDate.getTime() + entry.start.offset * MINUTE_IN_MILLIS;
    entry.effectiveEndTime =
      entry.effectiveStartTime + entry.duration * MINUTE_IN_MILLIS;

    const circuitsEnabled = Object.values(entry.circuits).filter((c) => c)
      .length;
    entry.totalDuration = MINUTE_IN_MILLIS * entry.duration * circuitsEnabled;
  }
  return schedule;
};

const sortedSchedule = (time, schedule) => {
  return schedule.sort((a, b) => {
    if (a.effectiveStartTime < b.effectiveStartTime) {
      return -1;
    } else if (a.effectiveStartTime === b.effectiveStartTime) {
      return 0;
    }
    return 1;
  });
};

const oneCircuitPerEntry = (entry) => {
  const perCircuitEntries = [];
  let index = 0;
  for (let [key, value] of Object.entries(entry.circuits)) {
    if (value) {
      let thisOffset = index++;
      let newEntry = JSON.parse(JSON.stringify(entry));
      newEntry.circuits = {};
      newEntry.circuits[key] = true;
      newEntry.start.offset =
        thisOffset * newEntry.duration + entry.start.offset;
      newEntry.start.name = timeOfDay(newEntry.start.offset);
      perCircuitEntries.push(newEntry);
    }
  }
  return perCircuitEntries;
};
const applyDurationToMillis = (entry) => {
  return {
    circuit: Number(Object.keys(entry.circuits)[0]),
    duration: entry.duration * MINUTE_IN_MILLIS,
    effectiveStartTime: entry.effectiveStartTime,
    effectiveEndTime: entry.effectiveEndTime,
  };
};

const retrieve = async () => {
  const now = getNow();
  const nowTime = now.getTime();

  const configuration = await configurationService.retrieve();
  const schedule = configuration.schedule || [];
  const simplifiedSchedule = applyEffectiveTimes(
    now,
    schedule.flatMap(oneCircuitPerEntry)
  );
  const perCircuitSchedule = sortedSchedule(now, simplifiedSchedule).map(
    applyDurationToMillis
  );

  const nextEntries = perCircuitSchedule.filter(
    (e) => e.effectiveEndTime > nowTime
  );
  const current = nextEntries.find(
    (e) => e.effectiveStartTime <= nowTime && e.effectiveEndTime > nowTime
  );
  const next = nextEntries.find((e) => e.effectiveStartTime > nowTime);
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
