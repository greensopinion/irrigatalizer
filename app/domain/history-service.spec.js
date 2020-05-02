const mockFs = require("mock-fs");
const configurationStore = require("./configuration-store");
const service = require("./history-service");
const fs = require("fs").promises;

describe("history-service", () => {
  const historyFile = configurationStore.getConfigurationFilePath(
    "history.json"
  );

  beforeEach(() => {
    const files = {};
    files[configurationStore.getConfigurationFolder()] = {
      "somefile.txt": "some content",
    };
    mockFs(files);
  });

  afterEach(() => {
    service.clearState();
    mockFs.restore();
  });

  const fileExists = async (filename) => {
    try {
      await fs.stat(filename);
      return true;
    } catch (e) {
      return false;
    }
  };

  it("should load history when there is none", async () => {
    expect(service.readEntries).toBeDefined();
    expect(await fileExists(historyFile)).toBe(false);
    expect(await service.readEntries()).toEqual([]);
    expect(await fileExists(historyFile)).toBe(false);
  });

  it("should load history when there is a file", async () => {
    let mockEntries = [{ id: "first" }, { id: "second" }];
    const files = {};
    files[configurationStore.getConfigurationFolder()] = {
      "history.json": JSON.stringify({ history: mockEntries }),
    };
    mockFs(files);
    expect(await service.readEntries()).toEqual(mockEntries);
  });

  it("should add entires", async () => {
    expect(await fileExists(historyFile)).toBe(false);
    await service.addEntries([{ id: "first" }, { id: "second" }]);
    await service.addEntries([{ id: "third" }]);
    expect(await fileExists(historyFile)).toBe(true);
    const expectedHistory = [
      { id: "first" },
      { id: "second" },
      { id: "third" },
    ];
    expect(await service.readEntries()).toEqual(expectedHistory);
    expect(JSON.parse(await fs.readFile(historyFile))).toEqual({
      history: expectedHistory,
    });
  });

  it("should truncate history", async () => {
    for (let x = 0; x < 120; ++x) {
      await service.addEntries([{ id: `entry ${x}` }]);
    }
    const entries = await service.readEntries();
    expect(entries.length).toEqual(100);
    expect(entries[0]).toEqual({ id: "entry 20" });
    expect(entries[99]).toEqual({ id: "entry 119" });
  });
});
