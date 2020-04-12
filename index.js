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

// Listen to the env-specified port, or 80 otherwise
const PORT = process.env.PORT || 80;
app.listen(PORT, () => {
  console.log(`Server listening on port ${PORT}...`);
});
