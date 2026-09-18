import { Show, Switch, Match, createMemo, createSignal } from "solid-js"
import { useKeyboard } from "@opentui/solid"
import {
  screen,
  instances,
  selectedInstanceId,
  busy,
  progress,
  goBack,
  setStatusMessage,
  setTextInputActive,
} from "../app/state"
import { launcherService } from "../services/launcher"
import { KeyHints } from "../components/KeyHints"
import { Progress } from "../components/Progress"

/**
 * Instance detail: metadata + launch + mod-loader/auto-connect setup.
 * This is the MVP path: session check → version fetch → file
 * verify/download → Java provisioning → spawn authenticated Minecraft.
 */
export function InstanceDetailScreen() {
  const instance = createMemo(() => instances().find((i) => i.id === selectedInstanceId()))

  const [editingServer, setEditingServer] = createSignal(false)

  async function launch() {
    const inst = instance()
    if (!inst || busy()) return
    try {
      await launcherService.launchInstance(inst)
    } catch (err) {
      setStatusMessage(`Launch failed: ${err instanceof Error ? err.message : String(err)}`)
    }
  }

  async function toggleLoader() {
    const inst = instance()
    if (!inst || busy()) return
    const next = inst.modLoader === "fabric" ? "vanilla" : "fabric"
    try {
      await launcherService.setInstanceModLoader(inst.id, next)
      setStatusMessage(
        next === "fabric"
          ? "Fabric loader enabled — libraries load on next launch"
          : "Mod loader set to vanilla",
      )
    } catch (err) {
      setStatusMessage(`Failed: ${err instanceof Error ? err.message : String(err)}`)
    }
  }

  function openServerEditor() {
    const inst = instance()
    if (!inst || busy()) return
    // Defer so the opening keystroke ('a') can't land in the input
    setTimeout(() => {
      setTextInputActive(true)
      setEditingServer(true)
    }, 0)
  }

  let serverInputRef: { value: string } | undefined

  function closeServerEditor() {
    setTextInputActive(false)
    setEditingServer(false)
  }

  async function saveServer(value: string) {
    const inst = instance()
    closeServerEditor()
    if (!inst) return
    const trimmed = value.trim()
    if (!trimmed) {
      try {
        await launcherService.clearInstanceAutoConnect(inst.id)
        setStatusMessage("Auto-connect cleared")
      } catch (err) {
        setStatusMessage(`Failed: ${err instanceof Error ? err.message : String(err)}`)
      }
      return
    }
    const [host, portStr] = trimmed.split(":")
    const port = portStr ? Number.parseInt(portStr, 10) : 25565
    if (!host || Number.isNaN(port) || port < 1 || port > 65535) {
      setStatusMessage("Invalid server — use host[:port], e.g. localhost:25565")
      return
    }
    try {
      await launcherService.setInstanceAutoConnect(inst.id, host, port)
      setStatusMessage(`Auto-connecting to ${host}:${port} on launch`)
    } catch (err) {
      setStatusMessage(`Failed: ${err instanceof Error ? err.message : String(err)}`)
    }
  }

  useKeyboard((key) => {
    if (screen() !== "instance-detail") return
    if (editingServer()) {
      if (key.name === "escape") closeServerEditor()
      return
    }
    if (key.name === "escape") {
      goBack()
    } else if ((key.name === "l" || key.name === "return" || key.name === "enter") && !busy()) {
      void launch()
    } else if (key.name === "f" && !busy()) {
      void toggleLoader()
    } else if (key.name === "a" && !busy()) {
      openServerEditor()
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
            <text fg="#a6adc8">
              Mod loader:   {instance()!.modLoader === "fabric" ? "fabric" : "vanilla"}
              {instance()!.modLoader === "fabric" ? " (latest at launch)" : ""}
            </text>
            <text fg="#a6adc8">Memory:       {instance()!.minMemoryMb}–{instance()!.maxMemoryMb} MB</text>
            <text fg="#a6adc8">Game dir:     {instance()!.gameDirectory}</text>
            <Show
              when={!editingServer()}
              fallback={
                <box flexDirection="row">
                  <text fg="#a6e3a1">Server: </text>
                  <input
                    placeholder="host[:port] · Enter saves · Esc cancels"
                    focused
                    ref={(el) => (serverInputRef = el)}
                    onSubmit={() => void saveServer(serverInputRef?.value ?? "")}
                  />
                </box>
              }
            >
              <text fg="#a6adc8">
                Server:{"       "}
                {(() => {
                  const ac = instance()!.serverAutoConnect
                  return ac ? `${ac.host}:${ac.port} (auto-connect)` : "not set — press 'a' to set"
                })()}
              </text>
            </Show>
            <box height={1} />
            <Progress />
            <box height={1} />
            <text fg="#a6e3a1">Press 'l' or Enter to launch</text>
            <text fg="#6c7086">'f' toggles Fabric · 'a' sets auto-connect server · mods live on the Mods screen</text>
          </Match>
          <Match when={true}>
            <text fg="#f38ba8">Instance not found</text>
          </Match>
        </Switch>
      </box>
      <KeyHints
        hints={
          editingServer()
            ? [["type", "host[:port]"], ["Enter", "save"], ["Esc", "cancel"]]
            : [
                ["l/Enter", "launch"],
                ["f", "fabric on/off"],
                ["a", "auto-connect"],
                ["Esc", "back"],
              ]
        }
      />
    </box>
  )
}
