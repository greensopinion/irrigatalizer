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

  it("should provide a string for multiple days", () => {
    expect(duration(582954153)).toEqual("6 days 17h 55m 54s");
  });

  it("should provides an abbreviated string when hours and seconds are 0", () => {
    expect(duration(259380000)).toEqual("3 days 3m");
  });
});
