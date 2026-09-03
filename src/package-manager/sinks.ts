/**
 * `PackageSink` implementations for packing (design: todl-package-manager §5, SP2).
 * `FileSink` writes a package directory to disk (Node); `MemorySink` records writes
 * in memory for tests and browser/in-memory packing.
 */
import { mkdir, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import type { PackageSink } from "../publish/stores.js";

/** Writes package files into a directory on disk, creating parents as needed. */
export class FileSink implements PackageSink {
  constructor(private readonly root: string) {}

  async writeText(path: string, content: string): Promise<void> {
    const full = join(this.root, path);
    await mkdir(dirname(full), { recursive: true });
    await writeFile(full, content, "utf8");
  }
}

/** Records package writes in an in-memory map — the seam for tests. */
export class MemorySink implements PackageSink {
  readonly files = new Map<string, string>();

  writeText(path: string, content: string): Promise<void> {
    this.files.set(path, content);
    return Promise.resolve();
  }
}
