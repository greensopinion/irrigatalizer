const scheduleService = require("../../app/schedule-service");

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

    const current = schedule.current
      ? entryToViewModel(schedule.current)
      : null;
    const next = schedule.next ? entryToViewModel(schedule.next) : null;

    let model = {
      title: "dashboard",
      status: {
        running: current != null,
        current,
        next,
      },
    };
    res.render("dashboard", model);
  } catch (e) {
    console.log(e.message, e);
    res.status(500).send(e);
  }
};
