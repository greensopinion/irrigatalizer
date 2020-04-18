exports.handler = async (req, res) => {
  try {
    let now = Date.now();
    let model = {
      title: "dashboard",
      status: {
        running: true,
        current: {
          circuit: 3,
          start: new Date(now - 60 * 1000 * 5).toISOString(),
          end: new Date(now + 60 * 1000 * 25).toISOString(),
        },
        next: {
          circuit: 3,
          start: new Date(now + 60 * 1000 * 25).toISOString(),
          end: new Date(now + 60 * 1000 * 55).toISOString(),
        },
      },
    };
    res.render("dashboard", model);
  } catch (e) {
    console.log(e.message, e);
    res.status(500).send(e);
  }
};
