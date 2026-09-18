import { useSelectionHandler } from "@opentui/solid"
import {
  createClipboard,
  createHostClipboard,
  createRendererClipboardAdapter,
  type CliRenderer,
  type ClipboardService,
} from "@opentui/core"
import { setStatusMessage } from "./state"

/**
 * Create a clipboard service: native host clipboard (Wayland/X11/Win32/
 * macOS) plus the terminal clipboard via OSC 52.
 *
 * The caller (main.tsx) owns the service and awaits `dispose()` during
 * shutdown — see docs/core-concepts/lifecycle#clipboard.
 */
export function createAppClipboard(renderer: CliRenderer): ClipboardService {
  return createClipboard({
    host: createHostClipboard(),
    terminal: createRendererClipboardAdapter(renderer),
  })
}

/**
 * Copy selected text to the clipboard automatically when the mouse is
 * released after a selection drag. Also writes the primary selection
 * (middle-click paste) on Wayland/X11.
 */
export function useCopySelectionOnRelease(clipboard: ClipboardService): void {
  useSelectionHandler((selection) => {
    if (!selection) return
    const text = selection.getSelectedText()
    if (!text) return

    void Promise.all([
      clipboard.writeText(text, { destination: "best-available" }),
      clipboard.writeText(text, { destination: "best-available", selection: "primary" }),
    ])
      .then(([clip, primary]) => {
        const ok = isWritten(clip.host) || isWritten(clip.terminal) || isWritten(primary.host)
        setStatusMessage(ok ? "Copied selection to clipboard" : "Clipboard copy failed")
      })
      .catch((err) => {
        setStatusMessage(`Clipboard error: ${err instanceof Error ? err.message : String(err)}`)
      })
  })
}

function isWritten(result: { status: string }): boolean {
  return result.status === "written" || result.status === "attempted"
}
