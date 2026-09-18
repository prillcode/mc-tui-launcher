import * as path from "node:path"
import { JsonFileStore, getLauncherPaths, type KeyValueStore } from "@prillcode/mc-launcher-core"

/**
 * McTUI's credential/session storage adapter.
 *
 * The core is persistence-agnostic: `AuthSessionManager` (and thus
 * `Launcher.auth`) accepts any `KeyValueStore`. This adapter persists
 * the session as JSON in the launcher data root.
 *
 * TODO (hardening, pre-MVP signoff): swap for an encrypted adapter or
 * OS keychain adapter so tokens are not stored in plaintext. The core
 * boundary is already in place — only this file needs to change.
 */
export function createCredentialStore(): KeyValueStore {
  return new JsonFileStore(path.join(getLauncherPaths().root, "session.json"))
}
