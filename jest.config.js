module.exports = {
  verbose: true,
  testEnvironment: "node",
  collectCoverage: true,
  coverageReporters: ["text", "html"],
  coverageDirectory: "coverage",
  coveragePathIgnorePatterns: ["<rootDir>/web/", "<rootDir>/node_modules/"],
  coverageThreshold: {
    global: {
      branches: 90,
      functions: 98,
      lines: 95,
      statements: 95,
    },
  },
};
