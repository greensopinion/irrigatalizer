const fs = require("fs").promises;

const newEmptyConfiguration = () => {
  return {
    schedule: [],
  };
};
var configuration;

const configurationFolder = `${process.env.HOME}/.irrigatalizer`;
const configurationFile = `${configurationFolder}/configuration.json`;

const load = async () => {
  const fileExists = !!(await fs.stat(configurationFile).catch((e) => false));

  if (fileExists) {
    const content = await fs.readFile(configurationFile, "utf8");
    return JSON.parse(content);
  }
  return null;
};

const copy = (c) => JSON.parse(JSON.stringify(c));

const retrieve = async () => {
  if (!configuration) {
    configuration = (await load()) || newEmptyConfiguration();
  }
  return copy(configuration);
};

const update = async (newConfig) => {
  const folderExists = !!(await fs
    .stat(configurationFolder)
    .catch((e) => false));
  if (!folderExists) {
    await fs.mkdir(configurationFolder);
  }
  await fs.writeFile(configurationFile, JSON.stringify(newConfig, null, 2));
  configuration = copy(newConfig);
};

const clearState = () => {
  configuration = null;
};

module.exports = {
  retrieve,
  update,
  clearState,
  getConfigurationFolder: () => {
    return configurationFolder;
  },
  getConfigurationFile: () => {
    return configurationFile;
  },
};
