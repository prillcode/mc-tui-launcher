import { For } from "solid-js"
import { useKeyboard } from "@opentui/solid"
import { screen, goBack } from "../app/state"
import { appConfig } from "../services/config"
import { KeyHints } from "../components/KeyHints"

const KEYS: Array<[string, string]> = [
  ["↑/↓ ←/→", "navigate lists & the instance grid"],
  ["Enter", "open instance details"],
  ["l", "launch the selected instance"],
  ["c", "create an instance"],
  ["[ / ]", "page the instance grid"],
  ["r", "re-ping servers / refresh"],
  ["M", "edit instance memory (details)"],
  ["p", "re-ping the server (details)"],
  ["h", "shader packs mode (Mods)"],
  ["i/m/s/a", "instances / mods / settings / accounts"],
  ["Esc", "back / close / cancel"],
  ["?", "help"],
  ["q", "quit"],
]

export function HelpScreen() {
  useKeyboard((key) => {
    if (screen() !== "help") return
    if (key.name === "escape") goBack()
  })

  return (
    <box flexDirection="column" flexGrow={1}>
      <box flexGrow={1} padding={1} flexDirection="column">
        <text fg="#cdd6f4" attributes={2}>
          {appConfig.productName} — Keyboard Reference
        </text>
        <box height={1} />
        <For each={KEYS}>
          {([key, label]) => (
            <box flexDirection="row" height={1}>
              <text fg="#89b4fa">{key.padEnd(12)}</text>
              <text fg="#cdd6f4">{label}</text>
            </box>
          )}
        </For>
        <box height={1} />
        <text fg="#6c7086">A keyboard-first terminal Minecraft launcher built on OpenTUI + SolidJS.</text>
        <text fg="#6c7086">Data root: {appConfig.dataRoot}</text>
      </box>
      <KeyHints hints={[["Esc", "back"]]} />
    </box>
  )
}
