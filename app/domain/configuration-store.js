const fs = require("fs").promises;

const configurationFolder = `${process.env.HOME}/.irrigatalizer`;

const configurationPath = (file) => `${configurationFolder}/${file}`;

const read = async (file) => {
  const filename = configurationPath(file);
  const fileExists = !!(await fs.stat(filename).catch((e) => false));

  if (fileExists) {
    const content = await fs.readFile(filename, "utf8");
    return JSON.parse(content);
  }
  return null;
};

const write = async (file, newConfig) => {
  const folderExists = !!(await fs
    .stat(configurationFolder)
    .catch((e) => false));
  if (!folderExists) {
    await fs.mkdir(configurationFolder);
  }
  const filename = configurationPath(file);
  await fs.writeFile(filename, JSON.stringify(newConfig, null, 2));
};

module.exports = {
  read,
  write,
  getConfigurationFilePath: configurationPath,
  getConfigurationFolder: () => {
    return configurationFolder;
  },
};
