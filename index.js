const processCleanup = require("./process-cleanup");
const scheduler = require("./app/scheduler");
const express = require("express");
const app = express();
const compression = require("compression");
const helmet = require("helmet");
const bodyParser = require("body-parser");
const appRoutes = require("./app/router/routes");
const webRoutes = require("./web/router/web-routes");

app.use(helmet());
app.use(compression());
app.use(bodyParser.json());

appRoutes.createRoutes(app);
webRoutes.createRoutes(app);

const closeables = [];
const closeablesProvider = () => {
  return closeables;
};
processCleanup.configureOnExitCleanup(closeablesProvider);

closeables.push({
  close: scheduler.shutdown,
});

// Listen to the env-specified port, or 80 otherwise
const PORT = process.env.PORT || 8000;
app.listen(PORT, () => {
  console.log(`Server listening on port ${PORT}...`);
});

scheduler.start();
