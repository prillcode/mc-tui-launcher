import { For, createMemo, createSignal } from "solid-js"
import { useKeyboard } from "@opentui/solid"
import { screen, logLines, goBack } from "../app/state"
import { getLauncherPaths } from "@prillcode/mc-launcher-core"
import { KeyHints } from "../components/KeyHints"

/**
 * Logs: in-memory ring buffer of launcher + game output. Full logs are
 * persisted by the core under the data root's logs directory.
 */
export function LogsScreen() {
  const [tail, setTail] = createSignal(false)

  const visible = createMemo(() => {
    const lines = logLines()
    return tail() ? lines.slice(-30) : lines
  })

  useKeyboard((key) => {
    if (screen() !== "logs") return
    if (key.name === "escape") goBack()
    else if (key.name === "t") setTail((t) => !t)
  })

  return (
    <box flexDirection="column" flexGrow={1}>
      <box flexGrow={1} padding={1} flexDirection="column">
        <text fg="#cdd6f4" attributes={2}>
          Logs {tail() ? "(last 30)" : ""}
        </text>
        <box height={1} />
        <For each={visible()} fallback={<text fg="#6c7086">No output yet.</text>}>
          {(line) => <text fg="#9399b2">{line}</text>}
        </For>
      </box>
      <KeyHints
        hints={[
          ["t", "tail"],
          ["Esc", "back"],
        ]}
      />
    </box>
  )
}
