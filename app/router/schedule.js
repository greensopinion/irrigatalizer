
const router = require('express').Router();

const statusHandler = async (request, response) => {
  let date = new Date();
  response.status(200).json({ placeholder: "true" });
};

router.get('/', statusHandler);

module.exports = {
  router,
  statusHandler
};