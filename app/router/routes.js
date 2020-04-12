const status = require("./status");
const schedule = require("./schedule");

module.exports = {
  createRoutes(app) {
    app.use("/api/status", status.router);
    app.use("/api/schedule", schedule.router);
  }
};
