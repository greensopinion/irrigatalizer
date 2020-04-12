const redirect = require("./redirect");
const routes = require("./web-routes");

const views = require("./views");
jest.mock("./views");

describe("web/routes", () => {
  it("should create web routes", () => {
    let mockApp = {
      use: jest.fn(),
      get: jest.fn()
    };
    routes.createRoutes(mockApp);
    expect(mockApp.use).toHaveBeenCalledWith("/", redirect.router);
    expect(views.configure).toHaveBeenCalledWith(mockApp);
  });
});
