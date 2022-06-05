const status = require("./status");
const configuration = require("./configuration");
const nocache = require("nocache");

module.exports = {
  createRoutes(app) {
    app.use("/api/status", nocache(), status.router);
    app.use("/api/configuration", nocache(), configuration.router);
  },
};
