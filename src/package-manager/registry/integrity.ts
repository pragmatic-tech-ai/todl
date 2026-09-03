/**
 * Subresource-Integrity and legacy checksum helpers for the registry client
 * (design: todl-package-manager, registry client). npm records both on every
 * published tarball: `dist.integrity` (SRI, `sha512-<base64>`) and the legacy
 * `dist.shasum` (hex `sha1`). We compute them on publish and verify SRI on fetch.
 */
import { createHash } from "node:crypto";

/** The SRI integrity string for a tarball: `sha512-<base64 digest>`. */
export function integrity(bytes: Uint8Array): string {
  return `sha512-${createHash("sha512").update(bytes).digest("base64")}`;
}

/** The legacy hex `sha1` checksum for a tarball (npm's `dist.shasum`). */
export function shasum(bytes: Uint8Array): string {
  return createHash("sha1").update(bytes).digest("hex");
}

/** Verify `bytes` against an SRI string (`<algo>-<base64>`). Unknown algorithms
 *  throw via `createHash`. */
export function verifyIntegrity(bytes: Uint8Array, expected: string): boolean {
  const dash = expected.indexOf("-");
  if (dash < 0) return false;
  const algorithm = expected.slice(0, dash);
  const digest = createHash(algorithm).update(bytes).digest("base64");
  return digest === expected.slice(dash + 1);
}
