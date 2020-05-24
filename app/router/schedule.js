const router = require("express").Router();
const logger = require("../logger");

const configurationService = require("../domain/configuration-service");
const scheduler = require("../scheduler");

const statusHandler = async (request, response) => {
  const configuration = await configurationService.retrieve();
  response.status(200).json(configuration);
};

const respondWithError = (response, context, error) => {
  const detailMessage = error.message || `${error}`;
  const message = `Error ${context}: ${detailMessage}`;
  logger.log(`${message}\n${error.stack}`);
  response.status(400).json({ error: message });
};

const updateHandler = async (request, response) => {
  const model = request.body;
  if (!model.schedule) {
    response.status(400).json({ error: "Expected schedule" });
  } else {
    try {
      await configurationService.update(model);
    } catch (e) {
      return respondWithError(response, "saving configuration", e);
    }
    try {
      await scheduler.restart();
    } catch (e) {
      return respondWithError(response, "restarting scheduler", e);
    }
    response.status(200).json({});
  }
};

router.get("/", statusHandler);
router.put("/", updateHandler);

module.exports = {
  router,
  statusHandler,
};
