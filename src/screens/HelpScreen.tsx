import { For } from "solid-js"
import { useTerminalDimensions } from "@opentui/solid"
import { useBindings } from "@opentui/keymap/solid"
import { goBack } from "../app/state"
import { HINT } from "../app/keymap"
import { appConfig } from "../services/config"
import { KeyHints } from "../components/KeyHints"

/**
 * Static keyboard reference.
 *
 * The per-screen hint bar is generated from the live keymap; this screen is
 * the full catalogue, including the keys that do not fit in a one-row bar.
 * It scrolls, because the list is longer than most terminals.
 */
const KEYS: Array<[string, string]> = [
  ["↑/↓ ←/→", "move through lists, the instance grid and menus"],
  ["j / k", "same as ↓ / ↑"],
  ["Tab", "switch section (home: instances ↔ menu)"],
  ["Enter", "open instance details · select a menu item"],
  ["l", "launch the selected instance"],
  ["c", "create an instance (pick version, then mod loader)"],
  ["[ / ]", "page the instance grid (PageUp / PageDown also work)"],
  ["Home / End", "first / last item · top / end of the logs"],
  ["t", "jump to the latest log line (Logs)"],
  ["r", "re-ping servers · refresh the current list"],
  ["f", "toggle the Fabric mod loader (instance details)"],
  ["a / n / x", "auto-connect server · rename · delete (details)"],
  ["p", "re-ping the server (details)"],
  ["Shift+M", "edit instance memory (details)"],
  ["ctrl+x", "close the running Minecraft client (details)"],
  ["h", "switch to shader packs (Mods)"],
  ["e / i", "enable / disable · import a local .jar (Mods)"],
  ["w", "worlds: browse, back up & restore saves (home)"],
  ["b / v", "back up a world · toggle the backups list (Worlds)"],
  ["e / i", "export a world zip · import a world zip (Worlds)"],
  ["x / c", "delete a world · copy it to another instance (Worlds)"],
  ["y / o", "yank a path to the clipboard · open the folder (Worlds)"],
  ["Enter", "restore the selected backup (press twice) (Worlds backups)"],
  ["p", "prune old backups beyond the retention count (Worlds backups)"],
  ["i/m/s/a", "instances / mods / settings / accounts (home)"],
  ["Esc", "back · close · cancel"],
  ["?", "help"],
  ["q q", "quit (press q twice)"],
]

export function HelpScreen() {
  const dims = useTerminalDimensions()
  const width = () => Math.max(16, Math.min(84, dims().width - 4))

  useBindings(() => ({
    commands: [{ name: "help.back", run: () => goBack() }],
    bindings: [{ key: "escape", cmd: "help.back", desc: "back", hint: HINT.cancel }],
  }))

  return (
    <box flexDirection="column" flexGrow={1}>
      <scrollbox flexGrow={1} focused scrollbarOptions={{ showArrows: false }}>
        <box flexDirection="column" alignItems="center" paddingY={1}>
          <box flexDirection="column" width={width()}>
            <box flexDirection="row" justifyContent="center">
              <text fg="#cdd6f4" attributes={2}>
                {appConfig.productName} — Keyboard Reference
              </text>
            </box>
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
            <text fg="#6c7086">
              Keys are named commands on one keymap (@opentui/keymap); the bottom bar is
            </text>
            <text fg="#6c7086">generated from the active bindings, so it matches what the keys do.</text>
            <text fg="#6c7086">Data root: {appConfig.dataRoot}</text>
          </box>
        </box>
      </scrollbox>
      <KeyHints extra={[["↑/↓", "scroll"], ["Home/End", "top/end"]]} />
    </box>
  )
}
