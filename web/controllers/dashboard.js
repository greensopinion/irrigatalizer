exports.handler = async (req, res) => {
  try {
    let model = {
      title: "dashboard",
    };
    res.render("dashboard", model);
  } catch (e) {
    console.log(e.message, e);
    res.status(500).send(e);
  }
};
