const redirect = require("./redirect");
const express = require("express");
const request = require("supertest");

describe("redirect", () => {
  let app;

  beforeAll(() => {
    app = express();
    app.use("/", redirect.router);
  });

  it("should perform a redirect", (done) => {
    request(app).get("/").expect("Location", "/dashboard/").expect(301, done);
  });
});
