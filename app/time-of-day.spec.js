
const timeOfDay = require("./time-of-day");

describe("time-of-day", () => {
    it("should provide a time of day before noon", ()=> {
       expect(timeOfDay(0)).toEqual("0:00 am");
       expect(timeOfDay(1)).toEqual("0:01 am");
       expect(timeOfDay(330)).toEqual("5:30 am");
    });

    it("should provide a time of day at noon", ()=> {
       expect(timeOfDay(720)).toEqual("12:00 pm");
    });
    
    it("should provide a time of day after noon", ()=> {
       expect(timeOfDay(750)).toEqual("12:30 pm");
       expect(timeOfDay(915)).toEqual("3:15 pm");
    });
});