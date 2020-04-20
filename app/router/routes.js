const status = require("./status");
const schedule = require("./schedule");
const nocache = require("nocache");

module.exports = {
  createRoutes(app) {
    app.use("/api/status", nocache(), status.router);
    app.use("/api/schedule", nocache(), schedule.router);
  },
};
