const router = require("express").Router();

const configurationService = require("../domain/configuration-service");
const scheduler = require("../scheduler");

const statusHandler = async (request, response) => {
  const configuration = await configurationService.retrieve();
  response.status(200).json(configuration);
};

const updateHandler = async (request, response) => {
  const model = request.body;
  if (!model.schedule) {
    response.status(400).json({ error: "Expected schedule" });
  } else {
    await configurationService.update(model);
    await scheduler.restart();
    response.status(200).json({});
  }
};

router.get("/", statusHandler);
router.put("/", updateHandler);

module.exports = {
  router,
  statusHandler,
};
