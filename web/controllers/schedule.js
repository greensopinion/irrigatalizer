
exports.handler = async (req, res) => {
    try {
        const scheduleModel = {
            "title": "Schedule",
            "test": "data"
        };
    
        res.render("schedule",scheduleModel);
    } catch (e) {
        console.log(e.message, e);
        res.status(500).send(e);
    }
  };
  