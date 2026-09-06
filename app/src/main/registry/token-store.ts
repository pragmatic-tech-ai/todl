/**
 * `TokenStore` — the registry auth token, encrypted at rest in `userData`
 * (design §5, security §7). The renderer never sees the token; only `hasToken()`
 * crosses the bridge. Encryption is injected as an `Encryptor` so the unit test
 * runs with no Electron; production wires `SafeStorageEncryptor` (Task 6). If
 * encryption is unavailable (rare Linux without a keyring), the token is held in
 * memory for the session and never written in plaintext.
 */
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";

/** The encryption seam. `available()` gates writing to disk. */
export interface Encryptor {
  available(): boolean;
  encrypt(plain: string): Buffer;
  decrypt(cipher: Buffer): string;
}

const TOKEN_FILE = "registry-token.bin";

export class TokenStore {
  private readonly path: string;
  private memoryToken = "";

  constructor(
    private readonly userDataDir: string,
    private readonly encryptor: Encryptor,
  ) {
    this.path = join(userDataDir, TOKEN_FILE);
  }

  hasToken(): boolean {
    return this.getToken().length > 0;
  }

  getToken(): string {
    if (this.memoryToken.length > 0) return this.memoryToken;
    if (!existsSync(this.path)) return "";
    return this.encryptor.decrypt(readFileSync(this.path));
  }

  setToken(token: string): void {
    if (!this.encryptor.available()) {
      this.memoryToken = token; // session-only fallback; never write plaintext
      return;
    }
    mkdirSync(this.userDataDir, { recursive: true });
    writeFileSync(this.path, this.encryptor.encrypt(token));
    this.memoryToken = "";
  }

  clear(): void {
    this.memoryToken = "";
    if (existsSync(this.path)) rmSync(this.path);
  }
}
