const service = require("./schedule-service");

jest.mock("./domain/configuration-service");
const configurationService = require("./domain/configuration-service");

describe("schedule-service", () => {
  let configuration;

  beforeEach(() => {
    configuration = {
      schedule: [],
    };
    configurationService.retrieve = jest.fn(async () => {
      return configuration;
    });
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  const createEntry = (dayOfWeek) => {
    return {
      day: {
        name: "Some day",
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

  it("should retrieve an empty schedule", async () => {
    expect(service.retrieve).toBeDefined();
    expect(await service.retrieve()).toEqual({
      current: undefined,
      next: undefined,
      schedule: [],
    });
  });

  it("should retrieve a scheduleX", async () => {
    expect(service.retrieve).toBeDefined();
    const dayOfWeek = new Date().getDay();
    configuration = {
      schedule: [createEntry(dayOfWeek + 1), createEntry(dayOfWeek + 2)],
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
});
