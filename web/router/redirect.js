const router = require("express").Router();

router.get("", (request, response) => {
  response.redirect(301, "/dashboard/");
});

module.exports = {
  router,
};
