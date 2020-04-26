const scheduleService = require("../../app/domain/configuration-service");
const timeOfDay = require("../../app/time-of-day");

let createTimes = () => {
  let times = [];
  for (let hour = 0; hour < 24; hour++) {
    let offset = hour * 60;
    times.push({
      name: timeOfDay(offset),
      offset,
    });
    offset += 30;
    times.push({
      name: timeOfDay(offset),
      offset
    });
  }
  return times;
};

exports.handler = async (req, res) => {
  try {
    const scheduleModel = {
      title: "schedule",
      schedule: await scheduleService.retrieve(),
      days: [
        {
          name: "Sunday",
          offset: 0,
        },
        {
          name: "Monday",
          offset: 1,
        },
        {
          name: "Tuesday",
          offset: 2,
        },
        {
          name: "Wednesday",
          offset: 3,
        },
        {
          name: "Thursday",
          offset: 4,
        },
        {
          name: "Friday",
          offset: 5,
        },
        {
          name: "Saturday",
          offset: 6,
        },
      ],
      times: createTimes(),
    };

    res.render("schedule", scheduleModel);
  } catch (e) {
    console.log(e.message, e);
    res.status(500).send(e);
  }
};
