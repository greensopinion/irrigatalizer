const path = require("path");
const express = require("express");

const schedule = require("../controllers/schedule");


module.exports = {
  configure(app) {
    app.use(express.static(path.join(__dirname, "../static")));

    app.set("views", path.join(__dirname, "../views"));
    app.set("view engine", "pug");

    app.get("/schedule", schedule.handler);
  }
};
