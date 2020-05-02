const configurationStore = require("./configuration-store");

const newEmptyConfiguration = () => {
  return {
    schedule: [],
  };
};
var model;

const configurationFile = `configuration.json`;

const copy = (c) => JSON.parse(JSON.stringify(c));

const retrieve = async () => {
  if (!model) {
    model =
      (await configurationStore.read(configurationFile)) ||
      newEmptyConfiguration();
  }
  return copy(model);
};

const update = async (newConfig) => {
  await configurationStore.write(configurationFile, newConfig);
  model = copy(newConfig);
};

const clearState = () => {
  model = null;
};

module.exports = {
  retrieve,
  update,
  clearState,
  getConfigurationFile: () => {
    return configurationFile;
  },
};
