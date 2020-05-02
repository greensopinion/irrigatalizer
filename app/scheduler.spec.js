
const scheduler = require("./scheduler");
const circuitService = require("./circuit-service");

jest.mock("onoff");
jest.mock("./schedule-service");
jest.mock("./logger");
const scheduleService = require("./schedule-service");
const logger = require("./logger");

describe("scheduler", () => {
    const originalNow = Date.now.bind(global.Date);
    let scheduleModel;
    let logEntries;

    beforeEach(() => {
        scheduleModel = {
            current: null,
            next: null
        };
        logEntries = [];
        jest.useFakeTimers();
        logger.log = jest.fn((firstArg) => {
            logEntries.push(firstArg);
        });
        scheduleService.retrieve = async () => {
            return scheduleModel;
        };
    });
    afterEach(async () => {
        Date.now = originalNow;
        jest.clearAllMocks();
        await scheduler.shutdown();
        circuitService.allCircuits().forEach((c) => {
            expect(c.isOn).toBe(false);
        });
    });


    const mockDateNow = (time) => {
        global.Date.now = () => time;
    };

    it("should start with nothing to do", async () => {
        await scheduler.start();
        expect(logEntries).toEqual([
            "starting scheduler",
            "scheduler has nothing to do, stopping"
        ]);
    });

    it("should start with a future schedule", async () => {
        scheduleModel.next = {
            circuit: 3,
            duration: 1200000,
            effectiveEndTime: 1587914400000,
            effectiveStartTime: 1587913200000,
        };
        mockDateNow(1587912300000)
        expect(circuitService.circuit(3).isOn).toBe(false);
        await scheduler.start();
        expect(circuitService.circuit(3).isOn).toBe(false);
        expect(logEntries).toEqual([
            "starting scheduler",
            `scheduler waking up in 15m at ${new Date(1587913200000)}`
        ]);
    });

    it("should start with a current schedule", async () => {
        scheduleModel.current = {
            circuit: 3,
            duration: 1200000,
            effectiveEndTime: 1587914400000,
            effectiveStartTime: 1587913200000,
        };
        mockDateNow(1587913200003)
        expect(circuitService.circuit(3).isOn).toBe(false);
        await scheduler.start();
        expect(logEntries).toEqual([
            "starting scheduler",
            "turning circuit on: 3",
            `scheduler waking up in 19m 59s at ${new Date(1587914400000)}`
        ]);
        expect(circuitService.circuit(3).isOn).toBe(true);
    });


    it("should start with a next schedule in the past", async () => {
        scheduleModel.next = {
            circuit: 3,
            duration: 1200000,
            effectiveEndTime: 1587914400000,
            effectiveStartTime: 1587913200000,
        };
        mockDateNow(1587913201000)
        expect(circuitService.circuit(3).isOn).toBe(false);
        await scheduler.start();
        expect(logEntries).toEqual([
            "starting scheduler",
            "turning circuit on: 3",
            `scheduler waking up in 19m 59s at ${new Date(1587914400000)}`
        ]);
        expect(circuitService.circuit(3).isOn).toBe(true);
    });

    it("should switch circuits when one is on", async () => {
        scheduleModel.current = {
            circuit: 3,
            duration: 1200000,
            effectiveEndTime: 1587914400000,
            effectiveStartTime: 1587913200000,
        };
        mockDateNow(1587913200003)
        await circuitService.circuit(2).on();
        expect(circuitService.circuit(2).isOn).toBe(true);
        expect(circuitService.circuit(3).isOn).toBe(false);
        await scheduler.start();
        expect(logEntries).toEqual([
            "turning circuit on: 2",
            "starting scheduler",
            "turning circuit off: 2",
            "turning circuit on: 3",
            `scheduler waking up in 19m 59s at ${new Date(1587914400000)}`
        ]);
        expect(circuitService.circuit(2).isOn).toBe(false);
        expect(circuitService.circuit(3).isOn).toBe(true);
    });
});