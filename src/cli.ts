#!/usr/bin/env bun
/**
 * McTUI Launcher entry point.
 *
 * Plain TS (no JSX) so Bun compiles it with the default transform.
 * First action: register the Solid JSX transform plugin — this makes
 * the app independent of cwd/bunfig.toml (a global `mctui` command may
 * be invoked from any directory; bunfig preload is cwd-relative).
 */
import "@opentui/solid/preload"
import { loadAppEnv } from "./services/env"

// Load .env from the app directory before anything reads process.env
await loadAppEnv()

// Everything below is loaded after the transform plugin is registered
const { registerQRCode } = await import("@opentui/qrcode/solid")
registerQRCode()

const { launcherService } = await import("./services/launcher")
await launcherService.init()

// Load the app last — main.tsx renders the Solid tree and resolves
// when the renderer shuts down
await import("./main.tsx")
