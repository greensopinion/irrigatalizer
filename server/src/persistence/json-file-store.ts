import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import type { z } from "zod";

/**
 * Raised when a persisted file exists but does not match its schema. Callers get a
 * clear signal to distinguish corruption from a simply-absent file.
 */
export class PersistenceValidationError extends Error {
  constructor(
    readonly path: string,
    cause: unknown,
  ) {
    super(`invalid data in ${path}`, { cause });
    this.name = "PersistenceValidationError";
  }
}

/**
 * Reads and writes a single JSON file validated against a zod schema. Reads return
 * a caller-provided default when the file is absent (first run), and reject when
 * the file exists but is malformed. Writes validate before persisting and are
 * atomic (write to a temp file, then rename) so a crash mid-write cannot leave a
 * partially written file.
 */
export class JsonFileStore<TSchema extends z.ZodType> {
  constructor(
    private readonly path: string,
    private readonly schema: TSchema,
  ) {}

  async read(fallback: z.infer<TSchema>): Promise<z.infer<TSchema>> {
    let raw: string;
    try {
      raw = await readFile(this.path, "utf8");
    } catch (error) {
      if (isFileNotFound(error)) {
        return fallback;
      }
      throw error;
    }

    let parsed: unknown;
    try {
      parsed = JSON.parse(raw);
    } catch (error) {
      throw new PersistenceValidationError(this.path, error);
    }

    const result = this.schema.safeParse(parsed);
    if (!result.success) {
      throw new PersistenceValidationError(this.path, result.error);
    }
    return result.data;
  }

  async write(value: z.infer<TSchema>): Promise<void> {
    const result = this.schema.safeParse(value);
    if (!result.success) {
      throw new PersistenceValidationError(this.path, result.error);
    }

    await mkdir(dirname(this.path), { recursive: true });
    const serialized = `${JSON.stringify(result.data, null, 2)}\n`;
    const tempPath = `${this.path}.tmp`;
    await writeFile(tempPath, serialized, "utf8");
    await rename(tempPath, this.path);
  }
}

function isFileNotFound(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    (error as { code?: unknown }).code === "ENOENT"
  );
}
