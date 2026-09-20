import { useSelectionHandler } from "@opentui/solid"
import {
  createClipboard,
  createHostClipboard,
  createRendererClipboardAdapter,
  type CliRenderer,
  type ClipboardService,
  type HostClipboardService,
} from "@opentui/core"
import { setStatusMessage } from "./state"

/**
 * Create a clipboard service: native host clipboard (Wayland/X11/Win32/
 * macOS) plus the terminal clipboard via OSC 52.
 *
 * A missing host clipboard (no display server, a bare TTY) must NOT make
 * this throw: that would leave `main.tsx` with `clipboard === undefined`
 * and every yank/export path silently doing nothing. When the host is
 * unavailable we install an "unsupported" host anyway, so the terminal
 * OSC 52 path still works.
 */
export function createAppClipboard(renderer: CliRenderer): ClipboardService {
  let host: HostClipboardService
  try {
    host = createHostClipboard()
  } catch (err) {
    console.error(`Host clipboard unavailable: ${err instanceof Error ? err.message : String(err)}`)
    host = unsupportedHostClipboard
  }
  return createClipboard({
    host,
    terminal: createRendererClipboardAdapter(renderer),
  })
}

const unsupportedHostClipboard: HostClipboardService = {
  maxWriteBytes: 0,
  async read() {
    return { status: "unsupported" as const }
  },
  async writeText() {
    return { status: "unsupported" as const }
  },
  async clear() {
    return { status: "unsupported" as const }
  },
  async dispose() {},
}

// ── Screen-facing clipboard access ──────────────────────────────
// Screens are not inside the renderer's clipboard lifecycle, so main.tsx
// publishes the service here once it exists.

let service: ClipboardService | undefined

export function setAppClipboard(next: ClipboardService | undefined): void {
  service = next
}

/**
 * Copy `text` (a path, usually) to the best available clipboard and report
 * the outcome in the status bar. Never throws and never silently no-ops:
 * with only OSC 52 available it still attempts the terminal path.
 */
export function copyToClipboard(text: string, label = "path"): void {
  const clipboard = service
  if (!clipboard) {
    // Last-resort: nothing was ever published.
    setStatusMessage("Clipboard unavailable — path not copied")
    return
  }
  void Promise.all([
    clipboard.writeText(text, { destination: "best-available" }),
    clipboard.writeText(text, { destination: "best-available", selection: "primary" }),
  ])
    .then(([clip, primary]) => {
      const ok =
        isWritten(clip.host) || isWritten(clip.terminal) || isWritten(primary.host) || isWritten(primary.terminal)
      setStatusMessage(ok ? `Copied ${label}` : `Clipboard copy failed for ${label}`)
    })
    .catch((err) => {
      setStatusMessage(`Clipboard error: ${err instanceof Error ? err.message : String(err)}`)
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
