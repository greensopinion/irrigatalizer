const { router } = require("./schedule");
const request = require("supertest");
var bodyParser = require("body-parser");
const express = require("express");

jest.mock("../domain/configuration-service");
const configurationService = require("../domain/configuration-service");
jest.mock("../scheduler");
const scheduler = require("../scheduler");
jest.mock("../logger");
const logger = require("../logger");

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
          expect(scheduler.restart).not.toHaveBeenCalled();
          done();
        });
    });

    it("should put a schedule", (done) => {
      const mockConfiguration = {
        schedule: [],
      };
      configurationService.retrieve = async () => {
        return mockConfiguration;
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
          expect(scheduler.restart).toHaveBeenCalled();
          expect(logger.log).not.toHaveBeenCalled();
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
          expect(scheduler.restart).not.toHaveBeenCalled();
          done();
        });
    });

    it("rejects a schedule update that saves with error", (done) => {
      configurationService.update = () => {
        throw new Error("intentional failure");
      };
      const mockConfiguration = {
        schedule: [],
      };

      request(app)
        .put("/")
        .send(mockConfiguration)
        .expect("Content-Type", "application/json; charset=utf-8")
        .expect(400)
        .end((err, response) => {
          if (err) {
            return done(err);
          }
          expect(response.body).toEqual({
            error: "Error saving configuration: intentional failure",
          });
          expect(scheduler.restart).not.toHaveBeenCalled();
          expect(logger.log).toHaveBeenCalled();
          done();
        });
    });

    it("rejects a schedule update that restarts scheduler with error", (done) => {
      scheduler.restart = () => {
        throw new Error("intentional failure");
      };
      const mockConfiguration = {
        schedule: [],
      };

      request(app)
        .put("/")
        .send(mockConfiguration)
        .expect("Content-Type", "application/json; charset=utf-8")
        .expect(400)
        .end((err, response) => {
          if (err) {
            return done(err);
          }
          expect(response.body).toEqual({
            error: "Error saving configuration: intentional failure",
          });
          expect(logger.log).toHaveBeenCalled();
          done();
        });
    });
  });
});
