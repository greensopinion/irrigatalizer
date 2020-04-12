const redirect = require("./redirect");
const views = require("./views");

module.exports = {
  createRoutes(app) {
    app.use("/", redirect.router);
    views.configure(app);
  }
};
