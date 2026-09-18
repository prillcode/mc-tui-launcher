import { Show, Switch, Match, createMemo, createSignal, createEffect, onCleanup } from "solid-js"
import { useKeyboard, useRenderer } from "@opentui/solid"
import type { ServerPingResult } from "@prillcode/mc-launcher-core"
import {
  screen,
  instances,
  selectedInstanceId,
  busy,
  progress,
  goBack,
  navigate,
  setStatusMessage,
  setTextInputActive,
  setModsFocusInstanceId,
  runningInstanceIds,
} from "../app/state"
import { launcherService } from "../services/launcher"
import { KeyHints } from "../components/KeyHints"
import { Centered } from "../components/Centered"
import { Progress } from "../components/Progress"

/**
 * Instance detail: metadata + launch + editing.
 *
 * - launch ('l'/Enter): session check → version fetch → file
 *   verify/download → Java provisioning → spawn Minecraft
 * - 'f' toggles the Fabric mod loader (libraries load at launch)
 * - 'a' sets an auto-connect server (host[:port])
 * - 'n' renames the instance
 * - 'x' deletes it (press twice to confirm — removes the game dir!)
 * - 'm' opens the Mods screen focused on this instance
 */
export function InstanceDetailScreen() {
  const instance = createMemo(() => instances().find((i) => i.id === selectedInstanceId()))
  const renderer = useRenderer()

  // ── Server status (ping) ────────────────────────────────────────
  const PING_TIMEOUT_MS = 6000
  const [pingState, setPingState] = createSignal<"idle" | "pinging" | "ok" | "down">("idle")
  const [pingResult, setPingResult] = createSignal<ServerPingResult | null>(null)
  let pingToken = 0

  async function pingServer(): Promise<void> {
    const ac = instance()?.serverAutoConnect
    if (!ac) {
      setPingState("idle")
      setPingResult(null)
      return
    }
    const token = ++pingToken
    setPingState("pinging")
    setPingResult(null)
    try {
      const result = await Promise.race([
        launcherService.pingServer(ac.host, ac.port ?? 25565),
        new Promise<never>((_, reject) =>
          setTimeout(() => reject(new Error("ping timed out")), PING_TIMEOUT_MS),
        ),
      ])
      if (token !== pingToken) return
      setPingResult(result)
      setPingState("ok")
    } catch {
      if (token !== pingToken) return
      setPingResult(null)
      setPingState("down")
    }
  }

  // Auto-ping on mount and whenever the auto-connect target changes.
  createEffect(() => {
    void instance()?.serverAutoConnect?.host
    void instance()?.serverAutoConnect?.port
    void pingServer()
  })

  onCleanup(() => {
    pingToken++
  })

  function truncate(value: string): string {
    const max = Math.max(20, renderer.terminalWidth - 20)
    return value.length > max ? `${value.slice(0, max - 1)}…` : value
  }

  const [editingServer, setEditingServer] = createSignal(false)
  const [renaming, setRenaming] = createSignal(false)

  /** Padded "Label:" column (JSX collapses runs of spaces in text nodes). */
  const rowLabel = (name: string) => `${name}:`.padEnd(14)

  // ── Per-instance memory editor (two steps: min then max) ────────
  const [memoryStep, setMemoryStep] = createSignal<null | "min" | "max">(null)
  let memoryMin = 0
  let memoryValue = ""

  function openMemoryEditor() {
    const inst = instance()
    if (!inst || busy()) return
    // Defer so the opening keystroke ('M') can't leak into the input.
    setTimeout(() => {
      memoryMin = inst.minMemoryMb
      memoryValue = String(inst.minMemoryMb)
      setTextInputActive(true)
      setMemoryStep("min")
    }, 0)
  }

  function closeMemoryEditor() {
    setTextInputActive(false)
    setMemoryStep(null)
  }

  async function submitMemory(value: string) {
    const inst = instance()
    const step = memoryStep()
    if (!inst || !step) return
    const raw = String(value ?? "").trim() || memoryValue
    if (!/^\d+$/.test(raw) || Number.parseInt(raw, 10) <= 0) {
      setStatusMessage(`${step === "min" ? "Min" : "Max"} memory must be a positive integer (MB)`)
      return // stay in the editor
    }
    const n = Number.parseInt(raw, 10)
    if (step === "min") {
      memoryMin = n
      // Defer the step switch so the submitting Enter isn't handed to
      // the freshly-mounted max input.
      setTimeout(() => {
        memoryValue = String(inst.maxMemoryMb)
        setMemoryStep("max")
      }, 0)
      return
    }
    if (memoryMin > n) {
      setStatusMessage(`Min memory (${memoryMin} MB) cannot exceed max (${n} MB)`)
      return // stay in the editor
    }
    try {
      await launcherService.setInstanceMemory(inst.id, memoryMin, n)
      setStatusMessage(`Memory set to ${memoryMin}\u2013${n} MB`)
    } catch (err) {
      setStatusMessage(`Failed to set memory: ${err instanceof Error ? err.message : String(err)}`)
    } finally {
      setTimeout(closeMemoryEditor, 0)
    }
  }
  const [confirmDelete, setConfirmDelete] = createSignal(false)
  let deleteTimer: ReturnType<typeof setTimeout> | undefined
  onCleanup(() => clearTimeout(deleteTimer))

  let nameInputRef: { value: string } | undefined

  async function launch() {
    const inst = instance()
    if (!inst || busy()) return
    if (runningInstanceIds().includes(inst.id)) {
      setStatusMessage("Minecraft is already running — press ctrl+x to close it")
      return
    }
    try {
      await launcherService.launchInstance(inst)
    } catch (err) {
      setStatusMessage(`Launch failed: ${err instanceof Error ? err.message : String(err)}`)
    }
  }

  async function closeRunningClient() {
    const inst = instance()
    if (!inst || !runningInstanceIds().includes(inst.id)) return
    setStatusMessage(`Closing Minecraft for "${inst.name}"…`)
    try {
      await launcherService.closeInstance(inst.id)
    } catch (err) {
      setStatusMessage(`Close failed: ${err instanceof Error ? err.message : String(err)}`)
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
    const port = portStr ? Number.parseInt(portStr, 10) : undefined
    if (!host || (port !== undefined && (Number.isNaN(port) || port < 1 || port > 65535))) {
      setStatusMessage("Invalid server — use host[:port], e.g. localhost:25565")
      return
    }
    try {
      await launcherService.setInstanceAutoConnect(inst.id, host, port)
      setStatusMessage(port ? `Auto-connecting to ${host}:${port} on launch` : `Auto-connecting to ${host} on launch`)
    } catch (err) {
      setStatusMessage(`Failed: ${err instanceof Error ? err.message : String(err)}`)
    }
  }

  function closeServerEditor() {
    setTextInputActive(false)
    setEditingServer(false)
  }

  function openRename() {
    const inst = instance()
    if (!inst || busy()) return
    setTimeout(() => {
      setTextInputActive(true)
      setRenaming(true)
    }, 0)
  }

  function closeRename() {
    setTextInputActive(false)
    setRenaming(false)
  }

  async function saveName(value: string) {
    const inst = instance()
    closeRename()
    if (!inst) return
    const name = value.trim()
    if (!name || name === inst.name) return
    try {
      await launcherService.renameInstance(inst.id, name)
      setStatusMessage(`Renamed to "${name}"`)
    } catch (err) {
      setStatusMessage(`Rename failed: ${err instanceof Error ? err.message : String(err)}`)
    }
  }

  async function deleteInstance() {
    const inst = instance()
    if (!inst || busy()) return
    if (!confirmDelete()) {
      setConfirmDelete(true)
      setStatusMessage(`Press 'x' again to delete "${inst.name}" — this removes its game directory!`)
      clearTimeout(deleteTimer)
      deleteTimer = setTimeout(() => setConfirmDelete(false), 4000)
      return
    }
    clearTimeout(deleteTimer)
    setConfirmDelete(false)
    try {
      const name = inst.name
      await launcherService.deleteInstance(inst.id)
      setStatusMessage(`Deleted instance "${name}"`)
      goBack()
    } catch (err) {
      setStatusMessage(`Delete failed: ${err instanceof Error ? err.message : String(err)}`)
    }
  }

  function openMods() {
    const inst = instance()
    if (!inst) return
    setModsFocusInstanceId(inst.id)
    navigate("mods")
  }

  useKeyboard((key) => {
    if (screen() !== "instance-detail") return
    if (editingServer()) {
      if (key.name === "escape") closeServerEditor()
      return
    }
    if (renaming()) {
      if (key.name === "escape") closeRename()
      return
    }
    if (memoryStep()) {
      if (key.name === "escape") closeMemoryEditor()
      return
    }
    if (key.name === "escape") {
      if (confirmDelete()) {
        setConfirmDelete(false)
      } else {
        goBack()
      }
      return
    }
    if (busy()) return
    if (key.ctrl && key.name === "x") {
      void closeRunningClient()
    } else if (key.ctrl && key.name === "s") {
      void closeRunningClient()
    } else if (key.name === "l" || key.name === "return" || key.name === "enter") {
      void launch()
    } else if (key.name === "f") {
      void toggleLoader()
    } else if (key.name === "a") {
      openServerEditor()
    } else if (key.name === "p" && instance()?.serverAutoConnect) {
      void pingServer()
    } else if (key.name === "n") {
      openRename()
    } else if (key.name === "x") {
      void deleteInstance()
    } else if ((key.name === "m" && key.shift) || key.name === "M") {
      openMemoryEditor()
    } else if (key.name === "m") {
      openMods()
    }
  })

  return (
    <box flexDirection="column" flexGrow={1}>
      <Centered maxWidth={80}>
        <Switch>
          <Match when={instance()}>
            <Show
              when={!renaming()}
              fallback={
                <box flexDirection="row">
                  <text fg="#a6e3a1">Name: </text>
                  <input
                    flexGrow={1}
                    value={instance()!.name}
                    placeholder="new name · Enter saves · Esc cancels"
                    focused
                    ref={(el) => (nameInputRef = el)}
                    onSubmit={() => void saveName(nameInputRef?.value ?? "")}
                  />
                </box>
              }
            >
              <box flexDirection="row" justifyContent="center">
                <text fg="#cdd6f4" attributes={2}>
                  {instance()!.name}
                  {confirmDelete() ? "  (press 'x' again to confirm delete!)" : ""}
                </text>
              </box>
            </Show>
            <box height={1} />
            <text fg="#a6adc8">{rowLabel("Version")}{instance()!.versionId}</text>
            <text fg="#a6adc8">
              {rowLabel("Mod loader")}
              {instance()!.modLoader === "fabric" ? "fabric" : "vanilla"}
              {instance()!.modLoader === "fabric" ? " (latest at launch)" : ""}
            </text>
            <Show
              when={memoryStep()}
              keyed
              fallback={
                <text fg="#a6adc8">{rowLabel("Memory")}{instance()!.minMemoryMb}–{instance()!.maxMemoryMb} MB ('M' to edit)</text>
              }
            >
              {(step: "min" | "max") => (
                <box flexDirection="row">
                  <text fg="#89b4fa">{step === "min" ? "Min memory (MB): " : "Max memory (MB): "}</text>
                  <input
                    flexGrow={1}
                    value={step === "min" ? String(instance()!.minMemoryMb) : String(instance()!.maxMemoryMb)}
                    placeholder="positive integer MB · Enter next/save · Esc cancels"
                    focused
                    onInput={(value) => {
                      if (typeof value === "string") memoryValue = value
                    }}
                    onSubmit={(value) =>
                      void submitMemory(typeof value === "string" && value.length > 0 ? value : memoryValue)
                    }
                  />
                </box>
              )}
            </Show>
            <text fg="#a6adc8">{rowLabel("Game dir")}{instance()!.gameDirectory}</text>
            <Show
              when={!editingServer()}
              fallback={
                <box flexDirection="row">
                  <text fg="#a6e3a1">Server: </text>
                  <input
                    flexGrow={1}
                    placeholder="host[:port] · Enter saves · Esc cancels"
                    focused
                    ref={(el) => (serverInputRef = el)}
                    onSubmit={() => void saveServer(serverInputRef?.value ?? "")}
                  />
                </box>
              }
            >
              <text fg="#a6adc8">
                {rowLabel("Server")}
                {(() => {
                  const ac = instance()!.serverAutoConnect
                  return ac
                    ? `${ac.host}${ac.port !== undefined ? ":" + ac.port : ""} (auto-connect)`
                    : "not set — press 'a' to set"
                })()}
              </text>
            </Show>
            <box height={1} />
            <Progress />
            <box height={1} />
            <Show when={instance()!.serverAutoConnect}>
              <Switch>
                <Match when={pingState() === "pinging"}>
                  <text fg="#f9e2af">Server status: checking…</text>
                </Match>
                <Match when={pingState() === "ok" && pingResult()}>
                  <text fg="#a6e3a1">
                    Server status: online
                    {pingResult()!.players
                      ? ` · ${pingResult()!.players!.online}/${pingResult()!.players!.max} players`
                      : ""}
                    {pingResult()!.version ? ` · ${pingResult()!.version}` : ""}
                  </text>
                  <Show when={pingResult()!.motd}>
                    <text fg="#a6adc8">  {truncate(pingResult()!.motd)}</text>
                  </Show>
                </Match>
                <Match when={pingState() === "down"}>
                  <text fg="#f38ba8">Server status: unreachable — launch still works</text>
                </Match>
                <Match when={true}>
                  <text fg="#6c7086">Server status: not checked — press 'p' to ping</text>
                </Match>
              </Switch>
              <box height={1} />
            </Show>
            <Switch>
              <Match when={runningInstanceIds().includes(instance()!.id)}>
                <text fg="#a6e3a1" attributes={1}>
                  Minecraft is running for this instance
                </text>
                <text fg="#6c7086">Press ctrl+x to close the running Minecraft client</text>
              </Match>
              <Match when={true}>
                <text fg="#a6e3a1">Press 'l' or Enter to launch</text>
              </Match>
            </Switch>
            <text fg="#6c7086">
              'f' Fabric · 'n' rename · 'x' delete · 'a' auto-connect · 'p' ping · 'M' memory · 'm' mods · Esc back
            </text>
          </Match>
          <Match when={true}>
            <text fg="#f38ba8">Instance not found</text>
          </Match>
        </Switch>
      </Centered>
      <KeyHints
        hints={
          editingServer()
            ? [["type", "host[:port]"], ["Enter", "save"], ["Esc", "cancel"]]
            : renaming()
              ? [["type", "new name"], ["Enter", "save"], ["Esc", "cancel"]]
              : memoryStep()
                ? [
                    ["type", memoryStep() === "min" ? "min MB" : "max MB"],
                    ["Enter", memoryStep() === "min" ? "next" : "save"],
                    ["Esc", "cancel"],
                  ]
                : instance() && runningInstanceIds().includes(instance()!.id)
                  ? [["ctrl+x", "close client"], ["m", "mods"], ["Esc", "back"]]
                  : [
                      ["l/Enter", "launch"],
                      ["f", "fabric on/off"],
                      ["a", "auto-connect"],
                      ["p", "ping"],
                      ["n", "rename"],
                      ["x", "delete"],
                      ["M", "memory"],
                      ["m", "mods"],
                      ["Esc", "back"],
                    ]
        }
      />
    </box>
  )
}
