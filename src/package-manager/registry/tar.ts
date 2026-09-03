/**
 * A minimal, dependency-free tar+gzip writer for the registry client (design:
 * todl-package-manager, registry client). npm package tarballs are ordinary
 * gzipped USTAR archives with every entry rooted under `package/`; our packed
 * packages are a handful of small text files, so a ~60-line writer replaces the
 * `npm pack` shell-out and keeps publish fully self-contained.
 */
import { gzipSync } from "node:zlib";

/** One file to place in the archive. `path` is the full archive path, e.g.
 *  `package/model.json`. */
export interface TarEntry {
  path: string;
  bytes: Uint8Array;
}

const BLOCK = 512;
const encoder = new TextEncoder();

/** A fixed-width, null-terminated octal field (npm's numeric header encoding). */
function octalField(value: number, length: number): string {
  return `${value.toString(8).padStart(length - 1, "0")}\0`;
}

/** Build the 512-byte USTAR header for one regular-file entry. */
function header(name: string, size: number): Uint8Array {
  const block = new Uint8Array(BLOCK);
  const put = (str: string, offset: number, max: number): void => {
    const bytes = encoder.encode(str);
    if (bytes.length > max) throw new Error(`tar header field too long: ${str}`);
    block.set(bytes, offset);
  };

  // USTAR splits paths over 100 bytes into a 155-byte prefix + 100-byte name.
  let filename = name;
  let prefix = "";
  if (encoder.encode(name).length > 100) {
    const cut = name.lastIndexOf("/", 100);
    if (cut < 0) throw new Error(`tar path too long to split: ${name}`);
    prefix = name.slice(0, cut);
    filename = name.slice(cut + 1);
  }

  put(filename, 0, 100);
  put(octalField(0o644, 8), 100, 8); // mode
  put(octalField(0, 8), 108, 8); // uid
  put(octalField(0, 8), 116, 8); // gid
  put(octalField(size, 12), 124, 12); // size
  put(octalField(0, 12), 136, 12); // mtime (fixed → deterministic archives)
  for (let i = 0; i < 8; i++) block[148 + i] = 0x20; // checksum placeholder: spaces
  block[156] = 0x30; // typeflag '0' — regular file
  put("ustar\0", 257, 6); // magic
  put("00", 263, 2); // version
  put(prefix, 345, 155);

  let sum = 0;
  for (let i = 0; i < BLOCK; i++) sum += block[i]!;
  put(`${sum.toString(8).padStart(6, "0")}\0 `, 148, 8); // checksum: 6 octal + NUL + space
  return block;
}

/** Pad a body to the next 512-byte boundary. */
function padding(size: number): Uint8Array {
  const remainder = size % BLOCK;
  return remainder === 0 ? new Uint8Array(0) : new Uint8Array(BLOCK - remainder);
}

/** Assemble `entries` into a gzipped tar archive (an npm-style `.tgz`). */
export function createTgz(entries: readonly TarEntry[]): Uint8Array {
  const blocks: Uint8Array[] = [];
  for (const entry of entries) {
    blocks.push(header(entry.path, entry.bytes.length));
    blocks.push(entry.bytes);
    blocks.push(padding(entry.bytes.length));
  }
  blocks.push(new Uint8Array(BLOCK)); // two zero blocks terminate the archive
  blocks.push(new Uint8Array(BLOCK));

  const total = blocks.reduce((n, b) => n + b.length, 0);
  const tar = new Uint8Array(total);
  let offset = 0;
  for (const block of blocks) {
    tar.set(block, offset);
    offset += block.length;
  }
  return gzipSync(tar);
}
