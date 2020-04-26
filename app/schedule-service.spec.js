const service = require("./schedule-service");

jest.mock("./domain/configuration-service");
const configurationService = require("./domain/configuration-service");

describe("schedule-service", () => {
  let configuration;
  const originalNow = Date.now.bind(global.Date);

  beforeEach(() => {
    configuration = {
      schedule: [],
    };
    configurationService.retrieve = jest.fn(async () => {
      return configuration;
    });
  });

  afterEach(() => {
    Date.now = originalNow;
    jest.clearAllMocks();
  });

  const create6amEntry = (dayOfWeek) => {
    return {
      day: {
        name: `day ${dayOfWeek}`,
        offset: dayOfWeek,
      },
      start: {
        name: "6 am",
        offset: 360,
      },
      duration: 15,
      circuits: {
        "1": true,
        "2": true,
      },
    };
  };

  const create8amEntry = (dayOfWeek) => {
    return {
      day: {
        name: `day ${dayOfWeek}`,
        offset: dayOfWeek,
      },
      start: {
        name: "8 am",
        offset: 480,
      },
      duration: 20,
      circuits: {
        "3": true,
        "4": true,
      },
    };
  };

  it("should retrieve an empty schedule", async () => {
    expect(service.retrieve).toBeDefined();
    expect(await service.retrieve()).toEqual({
      current: undefined,
      next: undefined,
      schedule: [],
    });
  });

  it("should retrieve a schedule", async () => {
    expect(service.retrieve).toBeDefined();
    const dayOfWeek = new Date().getDay();
    configuration = {
      schedule: [create6amEntry(dayOfWeek + 1), create6amEntry(dayOfWeek + 2)],
    };
    configurationService.retrieve = jest.fn(async () => {
      return configuration;
    });
    expect(await service.retrieve()).toMatchObject({
      current: undefined,
      next: { circuit: 1, duration: 900000 },
      schedule: [
        { circuit: 1, duration: 900000 },
        { circuit: 2, duration: 900000 },
        { circuit: 1, duration: 900000 },
        { circuit: 2, duration: 900000 },
      ],
    });
  });

  it("should retrieve a schedule", async () => {
    expect(service.retrieve).toBeDefined();
    const dayOfWeek = new Date().getDay();
    configuration = {
      schedule: [create6amEntry(dayOfWeek + 1), create6amEntry(dayOfWeek + 2)],
    };
    configurationService.retrieve = jest.fn(async () => {
      return configuration;
    });
    expect(await service.retrieve()).toMatchObject({
      current: undefined,
      next: { circuit: 1, duration: 900000 },
      schedule: [
        { circuit: 1, duration: 900000 },
        { circuit: 2, duration: 900000 },
        { circuit: 1, duration: 900000 },
        { circuit: 2, duration: 900000 },
      ],
    });
  });

  const mockDateNow = () => {
    let timezoneOffset = new Date().getTimezoneOffset();
    let sign = timezoneOffset < 0 ? "+" : "-";
    let minutes = `${timezoneOffset % 60}`;
    let hours = `${Math.trunc(timezoneOffset / 60)}`;
    if (minutes.length < 2) {
      minutes = `0${minutes}`;
    }
    if (hours.length < 2) {
      hours = `0${hours}`;
    }
    let rfc3336Time = `2020-04-26T07:07:30.000${sign}${hours}${minutes}`;
    let time = new Date(rfc3336Time).getTime();
    global.Date.now = () => time;
  };

  it("should schedule entries before now on the same day to a week from now", async () => {
    mockDateNow();
    const dayOfWeek = new Date(Date.now()).getDay();
    configuration = {
      schedule: [create6amEntry(dayOfWeek), create8amEntry(dayOfWeek)],
    };
    configurationService.retrieve = jest.fn(async () => {
      return configuration;
    });
    expect(await service.retrieve()).toEqual({
      current: undefined,
      next: {
        circuit: 3,
        duration: 1200000,
        effectiveEndTime: 1587914400000,
        effectiveStartTime: 1587913200000,
      },
      schedule: [
        {
          circuit: 3,
          duration: 1200000,
          effectiveEndTime: 1587914400000,
          effectiveStartTime: 1587913200000,
        },
        {
          circuit: 4,
          duration: 1200000,
          effectiveStartTime: 1587914400000,
          effectiveEndTime: 1587915600000,
        },
        {
          circuit: 1,
          duration: 900000,
          effectiveStartTime: 1588510800000,
          effectiveEndTime: 1588511700000,
        },
        {
          circuit: 2,
          duration: 900000,
          effectiveStartTime: 1588511700000,
          effectiveEndTime: 1588512600000,
        },
      ],
    });
  });
});
