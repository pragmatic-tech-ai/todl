import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { TokenStore, type Encryptor } from "../token-store.js";

/** A reversible, non-identity fake: XOR-with-0x5A then base64. Proves the on-disk
 *  bytes are NOT the plaintext (encrypt-at-rest) while remaining decryptable. */
class FakeEncryptor implements Encryptor {
  available(): boolean {
    return true;
  }
  encrypt(plain: string): Buffer {
    const raw = Buffer.from(plain, "utf8").map((b) => b ^ 0x5a);
    return Buffer.from(raw.toString("base64"), "utf8");
  }
  decrypt(cipher: Buffer): string {
    const raw = Buffer.from(cipher.toString("utf8"), "base64").map((b) => b ^ 0x5a);
    return raw.toString("utf8");
  }
}

const freshDir = () => mkdtempSync(join(tmpdir(), "todl-token-"));

test("setToken persists encrypted; getToken round-trips the value", () => {
  const dir = freshDir();
  const store = new TokenStore(dir, new FakeEncryptor());
  assert.equal(store.hasToken(), false);
  store.setToken("ghp_secret123");
  assert.equal(store.hasToken(), true);
  assert.equal(store.getToken(), "ghp_secret123");

  const onDisk = readFileSync(join(dir, "registry-token.bin"));
  assert.ok(!onDisk.toString("utf8").includes("ghp_secret123"), "token stored in plaintext");
});

test("getToken returns empty string when no token is stored", () => {
  assert.equal(new TokenStore(freshDir(), new FakeEncryptor()).getToken(), "");
});

test("clear removes the stored token", () => {
  const dir = freshDir();
  const store = new TokenStore(dir, new FakeEncryptor());
  store.setToken("t");
  store.clear();
  assert.equal(store.hasToken(), false);
  assert.equal(existsSync(join(dir, "registry-token.bin")), false);
});

test("when encryption is unavailable, the token is kept in memory but not written", () => {
  class Unavailable extends FakeEncryptor {
    available(): boolean {
      return false;
    }
  }
  const dir = freshDir();
  const store = new TokenStore(dir, new Unavailable());
  store.setToken("mem-only");
  assert.equal(store.getToken(), "mem-only");
  assert.equal(existsSync(join(dir, "registry-token.bin")), false);
});
