import { render } from "@opentui/solid"
import { App } from "./app/App"

/**
 * Renders the Solid app tree. Loaded by cli.ts after the Solid JSX
 * transform plugin is registered.
 */
await render(() => <App />, { exitOnCtrlC: true })

// Renderer destroyed → terminal restored. Force-exit so pending
// background handles (e.g. an abandoned MSAL device-code poll) don't
// keep the process alive.
process.exit(0)
