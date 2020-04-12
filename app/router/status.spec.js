const { router } = require("./status");
const request = require("supertest");
const express = require("express");

describe("status", () => {
    it("should provide a router", () => {
        expect(router).toBeDefined();
    });

    describe("conroller", () => {
        let app;

        beforeEach(() => {
            app = express();
            app.use("/", router);
        });
        it("should provide status", done => {
            request(app)
                .get("/")
                .expect("Content-Type", "application/json; charset=utf-8")
                .expect(200)
                .end((err, response) => {
                    if (err) {
                        return done(err);
                    }
                    expect(response.body).toMatchObject(
                        { 
                            status: "ok",
                            time: expect.stringMatching(/\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z/)
                        }
                    );
                    done();
                });
        });
    });
});
