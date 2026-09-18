import { render } from "@opentui/solid"
import { App } from "./app/App"

/**
 * Renders the Solid app tree. Loaded by cli.ts after the Solid JSX
 * transform plugin is registered.
 */
await render(() => <App />, { exitOnCtrlC: true })
