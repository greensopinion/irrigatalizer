
const router = require('express').Router();

const statusHandler = async (request, response) => {
  let date = new Date();
  response.status(200).json({ status: "ok", timestamp: date.getTime(), time: date.toISOString() });
};

router.get('/', statusHandler);

module.exports = {
  router,
  statusHandler
};