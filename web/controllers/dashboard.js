const scheduleService = require("../../app/schedule-service");
const historyService = require("../../app/domain/history-service");

const entryToViewModel = (item) => {
  return {
    circuit: item.circuit,
    start: new Date(item.effectiveStartTime).toISOString(),
    end: new Date(item.effectiveEndTime).toISOString(),
  };
};

exports.handler = async (req, res) => {
  try {
    const schedule = await scheduleService.retrieve();
    const history = await historyService.readEntries();

    const current = schedule.current
      ? entryToViewModel(schedule.current)
      : null;
    const next = schedule.next ? entryToViewModel(schedule.next) : null;

    let model = {
      title: "dashboard",
      status: {
        running: !!current,
        current,
        next,
      },
      history: history.map((e) => {
        e.start = Date.parse(e.startTime);
        e.end = Date.parse(e.endTime);
        return e;
      }),
    };
    res.render("dashboard", model);
  } catch (e) {
    console.log(e.message, e);
    res.status(500).send(e);
  }
};
