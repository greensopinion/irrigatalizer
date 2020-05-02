const mockFs = require("mock-fs");
const service = require("./configuration-service");
const configurationStore = require("./configuration-store");
const fs = require("fs").promises;

describe("configuration-service", () => {
  const configurationFile = configurationStore.getConfigurationFilePath(
    service.getConfigurationFile()
  );

  beforeEach(() => {
    const files = {};
    files[configurationStore.getConfigurationFolder()] = {
      "somefile.txt": "some content",
    };
    mockFs(files);
  });

  afterEach(() => {
    mockFs.restore();
    service.clearState();
  });

  const fileExists = async (filename) => {
    try {
      await fs.stat(filename);
      return true;
    } catch (e) {
      return false;
    }
  };

  it("should retrieve a configuration when no file exists", async () => {
    expect(service.retrieve).toBeDefined();
    expect(await fileExists(configurationFile)).toBe(false);
    expect(await service.retrieve()).toMatchObject({
      schedule: [],
    });
    expect(await fileExists(configurationFile)).toBe(false);
  });

  it("should retrieve a configuration from a file", async () => {
    let mockConfiguration = { "is a test": true };
    const files = {};
    files[configurationStore.getConfigurationFolder()] = {
      "configuration.json": JSON.stringify(mockConfiguration),
    };
    mockFs(files);
    expect(await service.retrieve()).toEqual(mockConfiguration);
  });

  it("should not have side-effects when model is changed", async () => {
    var configuration = await service.retrieve();
    configuration["is a test"] = true;
    expect(await service.retrieve()).not.toEqual(configuration);
  });

  it("should write a configuration", async () => {
    mockFs({});
    expect(service.update).toBeDefined();
    var configuration = await service.retrieve();
    configuration["is a test"] = true;

    expect(await fileExists(configurationFile)).toBe(false);
    await service.update(configuration);
    expect(await fileExists(configurationFile)).toBe(true);
    expect(JSON.parse(await fs.readFile(configurationFile))).toEqual(
      configuration
    );
  });
});
