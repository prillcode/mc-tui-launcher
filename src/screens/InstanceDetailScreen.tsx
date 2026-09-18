import { Show, Switch, Match, createMemo } from "solid-js"
import { useKeyboard } from "@opentui/solid"
import { screen, instances, selectedInstanceId, busy, progress, goBack, setStatusMessage } from "../app/state"
import { launcherService } from "../services/launcher"
import { KeyHints } from "../components/KeyHints"
import { Progress } from "../components/Progress"

/**
 * Instance detail: metadata + launch. This is the MVP path:
 * session check → version fetch → file verify/download → Java
 * provisioning → spawn authenticated vanilla Minecraft.
 */
export function InstanceDetailScreen() {
  const instance = createMemo(() => instances().find((i) => i.id === selectedInstanceId()))

  async function launch() {
    const inst = instance()
    if (!inst || busy()) return
    try {
      await launcherService.launchInstance(inst)
    } catch (err) {
      setStatusMessage(`Launch failed: ${err instanceof Error ? err.message : String(err)}`)
    }
  }

  useKeyboard((key) => {
    if (screen() !== "instance-detail") return
    if (key.name === "escape") {
      goBack()
    } else if ((key.name === "l" || key.name === "return" || key.name === "enter") && !busy()) {
      void launch()
    }
  })

  return (
    <box flexDirection="column" flexGrow={1}>
      <box flexGrow={1} padding={1} flexDirection="column">
        <Switch>
          <Match when={instance()}>
            <text fg="#cdd6f4" attributes={2}>
              {instance()!.name}
            </text>
            <box height={1} />
            <text fg="#a6adc8">Version:      {instance()!.versionId}</text>
            <text fg="#a6adc8">Mod loader:   {instance()!.modLoader ?? "vanilla"}</text>
            <text fg="#a6adc8">Memory:       {instance()!.minMemoryMb}–{instance()!.maxMemoryMb} MB</text>
            <text fg="#a6adc8">Game dir:     {instance()!.gameDirectory}</text>
            <Show when={instance()!.serverAutoConnect}>
              <text fg="#a6adc8">
                Server:       {instance()!.serverAutoConnect!.host}:{instance()!.serverAutoConnect!.port}
              </text>
            </Show>
            <box height={1} />
            <Progress />
            <box height={1} />
            <text fg="#a6e3a1">Press 'l' or Enter to launch</text>
          </Match>
          <Match when={true}>
            <text fg="#f38ba8">Instance not found</text>
          </Match>
        </Switch>
      </box>
      <KeyHints
        hints={[
          ["l/Enter", "launch"],
          ["Esc", "back"],
        ]}
      />
    </box>
  )
}
