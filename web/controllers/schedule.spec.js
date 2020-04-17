const request = require("supertest");
const express = require("express");
const views = require("../router/views");

describe("schedule", () => {
  beforeEach(() => {
    app = express();
    views.configure(app);
  });

  it("should render a response", (done) => {
    request(app)
      .get("/schedule")
      .expect("Content-Type", "text/html; charset=utf-8")
      .expect(200)
      .end((err, response) => {
        if (err) {
          return done(err);
        }
        expect(response.text).toMatch(/<title>schedule<\/title>/);
        expect(response.text).toMatch(/<h1>schedule<\/h1>/);
        done();
      });
  });
});
