import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { ConfigStore, HistoryStore } from "./stores";
import { PersistenceValidationError } from "./json-file-store";
import {
  emptyConfiguration,
  emptyHistory,
  type Configuration,
  type RunRecord,
} from "./schema";

function sampleConfiguration(): Configuration {
  return {
    circuits: [
      { number: 1, name: "Front lawn", pin: 17 },
      { number: 2, name: "Garden beds", pin: 27 },
    ],
    programs: [
      {
        id: "morning",
        name: "Morning",
        days: [1, 3, 5],
        startSlot: 12,
        steps: [
          { circuit: 1, durationMinutes: 10 },
          { circuit: 2, durationMinutes: 15 },
        ],
      },
    ],
    enabled: true,
    override: null,
    timezone: "America/Vancouver",
  };
}

function run(circuit: number, start: number): RunRecord {
  return { circuit, start, end: start + 1000 };
}

describe("persistence stores", () => {
  let dataDir: string;

  beforeEach(async () => {
    dataDir = await mkdtemp(join(tmpdir(), "irrigatalizer-test-"));
  });

  afterEach(async () => {
    await rm(dataDir, { recursive: true, force: true });
  });

  describe("ConfigStore", () => {
    it("defaults to an empty configuration when the file is absent", async () => {
      const store = new ConfigStore(dataDir);
      expect(await store.read()).toEqual(emptyConfiguration());
    });

    it("round-trips a configuration through write and read", async () => {
      const store = new ConfigStore(dataDir);
      const configuration = sampleConfiguration();
      await store.write(configuration);
      expect(await store.read()).toEqual(configuration);
    });

    it("rejects a malformed configuration file", async () => {
      await writeFile(
        join(dataDir, "configuration.json"),
        "{ not json",
        "utf8",
      );
      const store = new ConfigStore(dataDir);
      await expect(store.read()).rejects.toBeInstanceOf(
        PersistenceValidationError,
      );
    });

    it("rejects a file that violates the schema", async () => {
      await writeFile(
        join(dataDir, "configuration.json"),
        JSON.stringify({ circuits: "nope" }),
        "utf8",
      );
      const store = new ConfigStore(dataDir);
      await expect(store.read()).rejects.toBeInstanceOf(
        PersistenceValidationError,
      );
    });

    it("rejects writing an invalid configuration", async () => {
      const store = new ConfigStore(dataDir);
      const invalid = {
        ...emptyConfiguration(),
        circuits: [{ number: 0, name: "", pin: -1 }],
      } as Configuration;
      await expect(store.write(invalid)).rejects.toBeInstanceOf(
        PersistenceValidationError,
      );
    });
  });

  describe("HistoryStore", () => {
    it("defaults to an empty history when the file is absent", async () => {
      const store = new HistoryStore(dataDir);
      expect(await store.read()).toEqual(emptyHistory());
    });

    it("round-trips history through write and read", async () => {
      const store = new HistoryStore(dataDir);
      const history = { runs: [run(1, 1000), run(2, 3000)] };
      await store.write(history);
      expect(await store.read()).toEqual(history);
    });

    it("appends run records and persists them", async () => {
      const store = new HistoryStore(dataDir);
      await store.append(run(1, 1000));
      const after = await store.append(run(2, 2000));
      expect(after.runs).toHaveLength(2);
      expect(await store.read()).toEqual(after);
    });

    it("trims the oldest records beyond the retention cap", async () => {
      const retention = 3;
      const store = new HistoryStore(dataDir, retention);
      for (let i = 0; i < 10; i++) {
        await store.append(run(1, i * 1000));
      }
      const history = await store.read();
      expect(history.runs).toHaveLength(retention);
      // The most recent records are kept; the oldest are dropped.
      expect(history.runs.map((r) => r.start)).toEqual([7000, 8000, 9000]);
    });

    it("caps an oversized history on write", async () => {
      const store = new HistoryStore(dataDir, 2);
      await store.write({ runs: [run(1, 0), run(1, 1), run(1, 2), run(1, 3)] });
      const history = await store.read();
      expect(history.runs.map((r) => r.start)).toEqual([2, 3]);
    });

    it("closes the newest open run by setting its end", async () => {
      const store = new HistoryStore(dataDir);
      await store.append({ circuit: 1, start: 1000, end: null });
      const after = await store.closeOpenRun(4000);
      expect(after.runs).toEqual([{ circuit: 1, start: 1000, end: 4000 }]);
      expect(await store.read()).toEqual(after);
    });

    it("closes only the most recent open run, leaving earlier closed runs intact", async () => {
      const store = new HistoryStore(dataDir);
      await store.append(run(1, 1000)); // already closed
      await store.append({ circuit: 2, start: 5000, end: null }); // open
      const after = await store.closeOpenRun(6000);
      expect(after.runs).toEqual([
        { circuit: 1, start: 1000, end: 2000 },
        { circuit: 2, start: 5000, end: 6000 },
      ]);
    });

    it("is a no-op when there is no open run", async () => {
      const store = new HistoryStore(dataDir);
      await store.append(run(1, 1000));
      const after = await store.closeOpenRun(9999);
      expect(after.runs).toEqual([{ circuit: 1, start: 1000, end: 2000 }]);
    });
  });
});
