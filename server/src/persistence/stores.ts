import { homedir } from "node:os";
import { join } from "node:path";
import { JsonFileStore } from "./json-file-store";
import {
  ConfigurationSchema,
  HistorySchema,
  emptyConfiguration,
  emptyHistory,
  type Configuration,
  type History,
  type RunRecord,
} from "./schema";

/**
 * Default number of run records retained. Older records beyond this are dropped,
 * matching the bounded rolling window carried forward from the existing system.
 */
export const DEFAULT_HISTORY_RETENTION = 200;

/**
 * Resolve the persistence directory. Defaults to ~/.irrigatalizer; overridable for
 * tests and non-default deployments.
 */
export function defaultDataDir(): string {
  return join(homedir(), ".irrigatalizer");
}

/**
 * Typed access to the persisted configuration. Reads default to an empty
 * configuration on first run; writes are validated and atomic.
 */
export class ConfigStore {
  private readonly file: JsonFileStore<typeof ConfigurationSchema>;

  constructor(dataDir: string = defaultDataDir()) {
    this.file = new JsonFileStore(
      join(dataDir, "configuration.json"),
      ConfigurationSchema,
    );
  }

  async read(): Promise<Configuration> {
    return this.file.read(emptyConfiguration());
  }

  async write(configuration: Configuration): Promise<void> {
    await this.file.write(configuration);
  }
}

/**
 * Typed access to run history with a bounded retention window. Reads default to an
 * empty history; appends trim the oldest records beyond the retention cap.
 */
export class HistoryStore {
  private readonly file: JsonFileStore<typeof HistorySchema>;

  constructor(
    dataDir: string = defaultDataDir(),
    private readonly retention: number = DEFAULT_HISTORY_RETENTION,
  ) {
    this.file = new JsonFileStore(join(dataDir, "history.json"), HistorySchema);
  }

  async read(): Promise<History> {
    return this.file.read(emptyHistory());
  }

  async write(history: History): Promise<void> {
    await this.file.write(this.capped(history));
  }

  /**
   * Append a run record, trimming to the retention cap, and persist.
   */
  async append(record: RunRecord): Promise<History> {
    const current = await this.read();
    const next = this.capped({ runs: [...current.runs, record] });
    await this.file.write(next);
    return next;
  }

  /**
   * Close the most recent still-open run (the newest record whose `end` is null)
   * by setting its end time, then persist. Used when a run that was recorded at
   * start (end: null) completes, so history reflects one record per run with its
   * actual end rather than a duplicate. No-op if there is no open run.
   */
  async closeOpenRun(end: number): Promise<History> {
    const current = await this.read();
    let index = -1;
    for (let i = current.runs.length - 1; i >= 0; i--) {
      if (current.runs[i]?.end === null) {
        index = i;
        break;
      }
    }
    if (index === -1) {
      return current;
    }
    const runs = current.runs.map((run, i) =>
      i === index ? { ...run, end } : run,
    );
    const next = { runs };
    await this.file.write(next);
    return next;
  }

  private capped(history: History): History {
    if (history.runs.length <= this.retention) {
      return history;
    }
    return { runs: history.runs.slice(history.runs.length - this.retention) };
  }
}
