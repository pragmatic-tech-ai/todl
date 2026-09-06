/**
 * `SafeStorageEncryptor` — the production `Encryptor` for `TokenStore`, backed by
 * Electron's OS-keyring `safeStorage` (design §5). Isolated in its own file so
 * `TokenStore` (and its unit test) never import Electron.
 */
import { safeStorage } from "electron";
import type { Encryptor } from "./token-store.js";

export class SafeStorageEncryptor implements Encryptor {
  available(): boolean {
    return safeStorage.isEncryptionAvailable();
  }
  encrypt(plain: string): Buffer {
    return safeStorage.encryptString(plain);
  }
  decrypt(cipher: Buffer): string {
    return safeStorage.decryptString(cipher);
  }
}
