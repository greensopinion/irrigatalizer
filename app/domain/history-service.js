const configurationStore = require("./configuration-store");

const historyFile = `history.json`;

const copy = (c) => JSON.parse(JSON.stringify(c));

const MAX_HISTORY = 100;

var model;

const newEmptyHistory = () => {
  return { history: [] };
};

const load = async () => {
  if (!model) {
    model = (await configurationStore.read(historyFile)) || newEmptyHistory();
  }
  return copy(model);
};

const write = async (newModel) => {
  await configurationStore.write(historyFile, newModel);
  model = newModel;
};

const addEntries = async (entries) => {
  let historyModel = await load();
  entries.forEach((entry) => historyModel.history.push(entry));
  let excessEntries = historyModel.history.length - MAX_HISTORY;
  if (excessEntries > 0) {
    historyModel.history.splice(0, excessEntries);
  }
  await write(historyModel);
};

const readEntries = async () => {
  const history = await load();
  return history.history;
};

const clearState = () => {
  model = null;
};

module.exports = {
  addEntries,
  readEntries,
  clearState,
};
