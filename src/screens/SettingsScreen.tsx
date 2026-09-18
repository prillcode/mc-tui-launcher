import { onMount, For, createSignal } from "solid-js"
import { useKeyboard } from "@opentui/solid"
import { screen, goBack, setStatusMessage } from "../app/state"
import { launcherService } from "../services/launcher"
import { appConfig } from "../services/config"
import { KeyHints } from "../components/KeyHints"

/**
 * Settings: read-only view of current launcher settings for now.
 * Editing arrives with the MVP polish pass.
 */
export function SettingsScreen() {
  const [settings, setSettings] = createSignal<Awaited<ReturnType<typeof launcherService.getSettings>> | null>(null)

  onMount(async () => {
    try {
      setSettings(await launcherService.getSettings())
    } catch (err) {
      setStatusMessage(`Failed to load settings: ${err instanceof Error ? err.message : String(err)}`)
    }
  })

  useKeyboard((key) => {
    if (screen() !== "settings") return
    if (key.name === "escape") goBack()
  })

  const rows = () => {
    const s = settings()
    if (!s) return []
    return [
      ["Default auth mode", s.defaultAuthMode],
      ["Memory range", `${s.defaultMinMemory}–${s.defaultMaxMemory} MB`],
      ["Java path", s.javaPath || "(auto-detect)"],
      ["Close on launch", s.closeOnLaunch ? "yes" : "no"],
      ["Default resolution", `${s.defaultResolutionWidth}x${s.defaultResolutionHeight}`],
      ["BlockHaven server", `${s.blockhavenDefaultHost}:${s.blockhavenDefaultPort}`],
      ["Data root", appConfig.dataRoot],
    ] as Array<[string, string]>
  }

  return (
    <box flexDirection="column" flexGrow={1}>
      <box flexGrow={1} padding={1} flexDirection="column">
        <text fg="#cdd6f4" attributes={2}>
          Settings
        </text>
        <box height={1} />
        <For each={rows()}>
          {([label, value]) => (
            <box flexDirection="row" height={1}>
              <text fg="#a6adc8">{label.padEnd(20)}</text>
              <text fg="#cdd6f4">{value}</text>
            </box>
          )}
        </For>
        <box height={1} />
        <text fg="#6c7086">Editing arrives with the MVP polish pass. MS_CLIENT_ID is read from the environment.</text>
      </box>
      <KeyHints hints={[["Esc", "back"]]} />
    </box>
  )
}
