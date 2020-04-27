const duration = require("./duration");

describe("duration", () => {
  it("should provide a string for 0 seconds", () => {
    expect(duration(0)).toEqual("0s");
  });

  it("should provide a string for less than a second", () => {
    expect(duration(153)).toEqual("153ms");
  });

  it("should provide a string for less than a minute", () => {
    expect(duration(54153)).toEqual("54s");
  });

  it("should provide a string", () => {
    expect(duration(52954153)).toEqual("14h 42m 34s");
  });
});
