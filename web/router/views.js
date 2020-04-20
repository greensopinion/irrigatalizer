const path = require("path");
const express = require("express");
const nocache = require("nocache");

const schedule = require("../controllers/schedule");
const dashboard = require("../controllers/dashboard");

module.exports = {
  configure(app) {
    app.use(express.static(path.join(__dirname, "../static")));

    app.set("views", path.join(__dirname, "../views"));
    app.set("view engine", "pug");

    app.get("/dashboard", nocache(), dashboard.handler);
    app.get("/schedule", nocache(), schedule.handler);
  },
};
