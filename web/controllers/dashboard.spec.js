const request = require("supertest");
const express = require("express");
const views = require("../router/views");

describe("dashboard", () => {
  beforeEach(() => {
    app = express();
    views.configure(app);
  });

  it("should render", (done) => {
    request(app)
      .get("/dashboard")
      .expect("Content-Type", "text/html; charset=utf-8")
      .expect(200)
      .end((err, response) => {
        if (err) {
          return done(err);
        }
        expect(response.text).toMatch(/<title>dashboard<\/title>/);
        expect(response.text).toMatch(/<h1>dashboard<\/h1>/);
        done();
      });
  });
});
