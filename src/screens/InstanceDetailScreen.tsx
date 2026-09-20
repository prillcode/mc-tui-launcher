import { Show, Switch, Match, createMemo, createSignal, createEffect, onCleanup } from "solid-js"
import { useRenderer } from "@opentui/solid"
import { useBindings } from "@opentui/keymap/solid"
import type { ServerPingResult, WorldSummary } from "@prillcode/mc-launcher-core"
import {
  instances,
  selectedInstanceId,
  busy,
  goBack,
  navigate,
  setStatusMessage,
  setTextInputActive,
  setModsFocusInstanceId,
  setWorldsFocusInstanceId,
  runningInstanceIds,
} from "../app/state"
import { HINT, allOf, anyOf, notEditing, when } from "../app/keymap"
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

  // ── Worlds summary (cheap: cached summaries only, no size measuring) ─
  const [worlds, setWorlds] = createSignal<WorldSummary[]>([])
  createEffect(() => {
    const inst = instance()
    if (!inst) {
      setWorlds([])
      return
    }
    void (async () => {
      try {
        setWorlds(await launcherService.listWorlds(inst.id))
      } catch {
        setWorlds([])
      }
    })()
  })

  const worldsInfo = createMemo(() => {
    const inst = instance()
    const list = worlds()
    const versions = new Set<string>()
    let mismatched = 0
    let measured = 0
    let anyMeasured = false
    for (const world of list) {
      if (inst && world.versionName && world.versionName !== inst.versionId) {
        mismatched++
        versions.add(world.versionName)
      }
      if (world.sizeBytes !== undefined) {
        measured += world.sizeBytes
        anyMeasured = true
      }
    }
    return { count: list.length, mismatched, versions: [...versions], measured, anyMeasured }
  })

  function formatBytes(bytes: number): string {
    if (bytes >= 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024 * 1024)).toFixed(1)} GB`
    if (bytes >= 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
    if (bytes >= 1024) return `${(bytes / 1024).toFixed(0)} KB`
    return `${bytes} B`
  }

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
  const [confirmLoader, setConfirmLoader] = createSignal(false)
  let deleteTimer: ReturnType<typeof setTimeout> | undefined
  let loaderTimer: ReturnType<typeof setTimeout> | undefined
  onCleanup(() => {
    clearTimeout(deleteTimer)
    clearTimeout(loaderTimer)
  })

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
    // Switching *off* Fabric silently strands mods and breaks Fabric
    // servers, so require a second press (mirrors the delete flow).
    if (next === "vanilla" && !confirmLoader()) {
      setConfirmLoader(true)
      setStatusMessage("Press 'f' again to switch to vanilla — Fabric mods will not load")
      clearTimeout(loaderTimer)
      loaderTimer = setTimeout(() => setConfirmLoader(false), 4000)
      return
    }
    clearTimeout(loaderTimer)
    setConfirmLoader(false)
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

  function openWorlds() {
    const inst = instance()
    if (!inst) return
    setWorldsFocusInstanceId(inst.id)
    navigate("worlds")
  }

  // ── Key bindings (OpenTUI keymap) ───────────────────────────────
  // Three layers: the Esc/“leave this screen” keys stay live even while a
  // launch is running; the instance actions are off while busy and while
  // an editor input holds the keyboard; the input layer only owns Esc.
  const editingSomething = () => anyOf(
    when(editingServer, (open) => open),
    when(renaming, (open) => open),
    when(memoryStep, (step) => step !== null),
  )

  function cancelEdit() {
    if (editingServer()) closeServerEditor()
    else if (renaming()) closeRename()
    else if (memoryStep()) closeMemoryEditor()
  }

  useBindings(() => ({
    // Esc never blocks: it leaves the screen or dismisses a pending confirm.
    enabled: notEditing(),
    commands: [
      {
        name: "detail.back",
        run() {
          if (confirmDelete()) setConfirmDelete(false)
          else if (confirmLoader()) setConfirmLoader(false)
          else goBack()
        },
      },
    ],
    bindings: [{ key: "escape", cmd: "detail.back", desc: "back", hint: HINT.cancel }],
  }))

  useBindings(() => ({
    enabled: allOf(notEditing(), when(busy, (isBusy) => !isBusy)),
    commands: [
      { name: "detail.launch", run: () => void launch() },
      { name: "detail.toggleLoader", run: () => void toggleLoader() },
      { name: "detail.server", run: () => openServerEditor() },
      { name: "detail.ping", run: () => void pingServer() },
      { name: "detail.rename", run: () => openRename() },
      { name: "detail.delete", run: () => void deleteInstance() },
      { name: "detail.memory", run: () => openMemoryEditor() },
      { name: "detail.mods", run: () => openMods() },
      { name: "detail.worlds", run: () => openWorlds() },
      { name: "detail.close", run: () => void closeRunningClient() },
    ],
    bindings: [
      { key: "l", cmd: "detail.launch", desc: "launch", hint: HINT.primary },
      { key: "return", cmd: "detail.launch", desc: "launch", hint: HINT.primary },
      { key: "f", cmd: "detail.toggleLoader", desc: "fabric", hint: HINT.secondary },
      { key: "a", cmd: "detail.server", desc: "auto-connect", hint: HINT.secondary },
      { key: "p", cmd: "detail.ping", desc: "ping", hint: HINT.secondary },
      { key: "n", cmd: "detail.rename", desc: "rename", hint: HINT.secondary },
      { key: "x", cmd: "detail.delete", desc: "delete", hint: HINT.secondary },
      // `M` — the parser lowercases bare literals, so this must be shift+m.
      { key: "shift+m", cmd: "detail.memory", desc: "memory", hint: HINT.secondary },
      { key: "m", cmd: "detail.mods", desc: "mods", hint: HINT.secondary },
      { key: "w", cmd: "detail.worlds", desc: "worlds", hint: HINT.secondary },
      // No hint: the body only mentions closing when a client is running.
      { key: "ctrl+x", cmd: "detail.close" },
      { key: "ctrl+s", cmd: "detail.close" },
    ],
  }))

  useBindings(() => ({
    enabled: editingSomething(),
    commands: [{ name: "detail.cancelEdit", run: () => cancelEdit() }],
    bindings: [{ key: "escape", cmd: "detail.cancelEdit", desc: "cancel", hint: HINT.cancel }],
  }))

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
              {confirmLoader() ? "  (press 'f' again to confirm vanilla!)" : ""}
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
              when={worldsInfo().count > 0}
              fallback={
                <text fg="#a6adc8">
                  {rowLabel("Worlds")}none — press 'w' to browse or import a world zip
                </text>
              }
            >
              <text fg="#a6adc8">
                {rowLabel("Worlds")}
                {worldsInfo().count}
                {worldsInfo().mismatched > 0
                  ? ` · ${worldsInfo().mismatched} in ${worldsInfo().versions.join(", ")} ⚠`
                  : ""}
                {worldsInfo().anyMeasured ? ` · ${formatBytes(worldsInfo().measured)} total` : ""}
              </text>
            </Show>
            <Show when={worldsInfo().mismatched > 0}>
              <text fg="#f9e2af">
                {"  "}⚠ {worldsInfo().mismatched} world{worldsInfo().mismatched === 1 ? "" : "s"}{" "}
                {worldsInfo().mismatched === 1 ? "was" : "were"} last saved by {worldsInfo().versions.join(", ")} —
                Minecraft {instance()!.versionId} will upgrade them and older versions can no longer open them; press 'w'
                to back them up first.
              </text>
            </Show>
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
              'f' Fabric · 'n' rename · 'x' delete · 'a' auto-connect · 'p' ping · 'M' memory · 'm' mods · 'w' worlds · Esc back
            </text>
          </Match>
          <Match when={true}>
            <text fg="#f38ba8">Instance not found</text>
          </Match>
        </Switch>
      </Centered>
      <KeyHints
        extra={
          editingServer()
            ? [["type", "host[:port]"], ["Enter", "save"]]
            : renaming()
              ? [["type", "new name"], ["Enter", "save"]]
              : memoryStep()
                ? [["type", memoryStep() === "min" ? "min MB" : "max MB"], ["Enter", memoryStep() === "min" ? "next" : "save"]]
                : undefined
        }
      />
    </box>
  )
}
