import { createCliRenderer, type ClipboardService } from "@opentui/core"
import { render } from "@opentui/solid"
import { createAppClipboard } from "./app/clipboard"
import { App } from "./app/App"

/**
 * Renders the Solid app tree. Loaded by cli.ts after the Solid JSX
 * transform plugin is registered.
 *
 * Lifecycle (per OpenTUI docs, docs/core-concepts/lifecycle):
 * `render()` resolves right after mounting — it does NOT wait for
 * shutdown. We create the renderer ourselves, wait for its `destroy`
 * event (q key, Ctrl+C, or a termination signal), then dispose the
 * clipboard and destroy the renderer in a `finally` so the terminal is
 * restored on every exit path.
 */
const renderer = await createCliRenderer({ exitOnCtrlC: true })

let clipboard: ClipboardService | undefined
try {
  clipboard = createAppClipboard(renderer)
} catch (err) {
  // No native host clipboard (e.g. no Wayland/X11 display) — degrade to
  // the terminal-only OSC 52 path inside copy operations.
  console.error(`Host clipboard unavailable: ${err instanceof Error ? err.message : String(err)}`)
}
try {
  clipboard = createAppClipboard(renderer)
  await render(() => <App clipboard={clipboard} />, renderer)

  // Resolves when the renderer is destroyed (also emitted for
  // exitOnCtrlC and the built-in signal handlers).
  await new Promise<void>((resolve) => renderer.once("destroy", resolve))
} finally {
  try {
    // Clipboard disposal is asynchronous; await it so native workers
    // release before we exit.
    await clipboard?.dispose()
  } finally {
    renderer.destroy()
  }
}

// Renderer destroyed → terminal restored. Give any in-flight terminal
// replies a moment to drain, then force-exit so pending background
// handles (e.g. an abandoned MSAL device-code poll) cannot keep the
// process alive.
await new Promise((resolve) => setTimeout(resolve, 50))
process.exit(0)
