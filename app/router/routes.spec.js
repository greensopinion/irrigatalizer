const routes = require("./routes");
const status = require("./status");
const configuration = require("./configuration");

describe("routes", () => {
  it("should create routes", () => {
    let mockApp = {
      use: jest.fn()
    };
    routes.createRoutes(mockApp);
    expect(mockApp.use).toHaveBeenCalledWith("/api/status", expect.any(Function), status.router);
    expect(mockApp.use).toHaveBeenCalledWith("/api/configuration", expect.any(Function), configuration.router);
  });
});
