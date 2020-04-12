const router = require("express").Router();

router.get("", (request, response) => {
  response.redirect(301, "/schedule/");
});

module.exports = {
  router
};
