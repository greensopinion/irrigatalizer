
let createTimes = () => {
    let times = [];
    for (let hour = 0; hour < 24; hour++) {
        var h12 = hour;
        var suffix = "am";
        if (hour > 12) {
            h12 = h12 - 12;
            suffix = "pm";
        }
        times.push({
            name: `${h12}:00 ${suffix}`,
            offset: hour*60
        });
        times.push({
            name: `${h12}:30`,
            offset: (hour*60)+30
        });
    }
    return times;
}

exports.handler = async (req, res) => {
    try {
        const scheduleModel = {
            "title": "schedule",
            "schedule": {
                "days": [
                    {
                        name: "Sunday",
                        offset: 0
                    },
                    {
                        name: "Monday",
                        offset: 1
                    },
                    {
                        name: "Tuesday",
                        offset: 2
                    },
                    {
                        name: "Wednesday",
                        offset: 3
                    },
                    {
                        name: "Thursday",
                        offset: 4
                    },
                    {
                        name: "Friday",
                        offset: 5
                    },
                    {
                        name: "Saturday",
                        offset: 6
                    }
                ]
            },
            "times": createTimes()
        };
    
        res.render("schedule",scheduleModel);
    } catch (e) {
        console.log(e.message, e);
        res.status(500).send(e);
    }
  };
  