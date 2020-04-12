const { router } = require("./schedule");
const request = require("supertest");
const express = require("express");

describe("schedule", () => {
    it("should provide a router", () => {
        expect(router).toBeDefined();
    });

    describe("conroller", () => {
        let app;

        beforeEach(() => {
            app = express();
            app.use("/", router);
        });
        it("should provide a schedule", done => {
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
                            placeholder: "true"
                        }
                    );
                    done();
                });
        });
    });
});
