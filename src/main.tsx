import { createCliRenderer, type ClipboardService } from "@opentui/core"
import { render } from "@opentui/solid"
import { KeymapProvider } from "@opentui/keymap/solid"
import { createAppClipboard, setAppClipboard } from "./app/clipboard"
import { createAppKeymap } from "./app/keymap"
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

// One keymap for the whole app; every screen registers its layers into it
// and the hint bar reads its live state (see app/keymap.ts).
const keymap = createAppKeymap(renderer)

let clipboard: ClipboardService | undefined
try {
  clipboard = createAppClipboard(renderer)
} catch (err) {
  // Should be unreachable: createAppClipboard degrades to the terminal-only
  // OSC 52 path rather than throwing. Kept as a last resort so the app still
  // runs when even the renderer adapter is unavailable.
  console.error(`Clipboard unavailable: ${err instanceof Error ? err.message : String(err)}`)
}
// Publish it for screens (yank/export paths) in addition to the App prop.
setAppClipboard(clipboard)
try {
  await render(
    () => (
      <KeymapProvider keymap={keymap}>
        <App clipboard={clipboard} />
      </KeymapProvider>
    ),
    renderer,
  )

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
