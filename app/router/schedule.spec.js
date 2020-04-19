const { router } = require("./schedule");
const request = require("supertest");
var bodyParser = require("body-parser");
const express = require("express");

jest.mock("../domain/configuration-service");
const configurationService = require("../domain/configuration-service");

describe("schedule", () => {
  it("should provide a router", () => {
    expect(router).toBeDefined();
  });

  describe("conroller", () => {
    let app;

    beforeEach(() => {
      app = express();
      app.use(bodyParser.json());
      app.use("/", router);
    });

    afterEach(() => {
      jest.clearAllMocks();
    });

    it("should provide a schedule", (done) => {
      const mockConfiguration = {
        schedule: ["mock-schedule"],
      };
      configurationService.retrieve = async () => {
        return mockConfiguration;
      };

      request(app)
        .get("/")
        .expect("Content-Type", "application/json; charset=utf-8")
        .expect(200)
        .end((err, response) => {
          if (err) {
            return done(err);
          }
          expect(response.body).toEqual(mockConfiguration);
          done();
        });
    });

    it("should put a schedule", (done) => {
      const mockConfiguration = {
        schedule: ["mock-schedule"],
      };

      request(app)
        .put("/")
        .send(mockConfiguration)
        .expect("Content-Type", "application/json; charset=utf-8")
        .expect(200)
        .end((err, response) => {
          if (err) {
            return done(err);
          }
          expect(response.body).toEqual({});
          expect(configurationService.update).toHaveBeenCalledWith(
            mockConfiguration
          );
          done();
        });
    });

    it("rejects a schedule update that does not have a schedule", (done) => {
      const mockConfiguration = {};

      request(app)
        .put("/")
        .send(mockConfiguration)
        .expect("Content-Type", "application/json; charset=utf-8")
        .expect(400)
        .end((err, response) => {
          if (err) {
            return done(err);
          }
          expect(response.body).toEqual({ error: "Expected schedule" });
          expect(configurationService.update).not.toHaveBeenCalled();
          done();
        });
    });
  });
});
