const processCleanup = require("./process-cleanup");
const scheduler = require("./app/scheduler");
const express = require("express");
const app = express();
const compression = require("compression");
const helmet = require("helmet");
const bodyParser = require("body-parser");
const appRoutes = require("./app/router/routes");
const webRoutes = require("./web/router/web-routes");
const logger = require("./app/logger");

app.use(helmet({
  contentSecurityPolicy: false,
}));
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

const PORT = process.env.PORT || 8000;
app.listen(PORT, () => {
  console.log(`Server listening on port ${PORT}...`);
});

scheduler.start().catch((error) => {
  logger.log(
    `failed to start scheduler: ${error.message || error}\n${error.stack}`
  );
});
