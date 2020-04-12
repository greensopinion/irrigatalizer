const routes = require("./routes");
const status = require("./status");
const schedule = require("./schedule");

describe("routes", () => {
  it("should create routes", () => {
    let mockApp = {
      use: jest.fn()
    };
    routes.createRoutes(mockApp);
    expect(mockApp.use).toHaveBeenCalledWith("/api/status", status.router);
    expect(mockApp.use).toHaveBeenCalledWith("/api/schedule", schedule.router);
  });
});
