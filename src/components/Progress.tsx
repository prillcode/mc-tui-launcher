import { Show, createMemo } from "solid-js"
import { busy, progress, statusMessage } from "../app/state"

/**
 * Horizontal progress bar driven by the core's DownloadProgress data.
 * Pure display: the core emits data, this decides how it looks.
 */
export function Progress() {
  const p = createMemo(() => progress())
  const filled = createMemo(() => {
    const cur = p()
    if (!cur || cur.total <= 0) return 0
    return Math.round((cur.current / cur.total) * 30)
  })

  return (
    <Show when={busy()}>
      <box flexDirection="column">
        <text fg="#f9e2af">
          {filled() > 0 ? "█".repeat(filled()) : ""}
          {filled() < 30 ? "░".repeat(30 - filled()) : ""}
        </text>
        <text fg="#a6adc8">{statusMessage()}</text>
      </box>
    </Show>
  )
}
