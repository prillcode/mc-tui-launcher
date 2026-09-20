import { onMount, onCleanup, For, Show, createSignal, createMemo, createEffect, Switch, Match } from "solid-js"
import { useTerminalDimensions } from "@opentui/solid"
import { useBindings } from "@opentui/keymap/solid"
import type { ScrollBoxRenderable } from "@opentui/core"
import * as fs from "node:fs"
import * as path from "node:path"
import * as os from "node:os"
import type {
  BackupEntry,
  ServerRecord,
  ServerSource,
  WorldSummary,
} from "@prillcode/mc-launcher-core"
import {
  goBack,
  setStatusMessage,
  setBusy,
  busy,
  setProgress,
  setTextInputActive,
  serversRefreshToken,
  serverFocusId,
  setServerFocusId,
} from "../app/state"
import { HINT, allOf, when } from "../app/keymap"
import { launcherService } from "../services/launcher"
import { useServerWorlds, invalidateServerWorld } from "../app/useServerWorlds"
import { copyToClipboard } from "../app/clipboard"
import { KeyHints } from "../components/KeyHints"
import { Centered } from "../components/Centered"
import { Dialog } from "../components/Dialog"
import { Progress } from "../components/Progress"
import { BackupRow, formatSize, relativeTime, slugify, timestamp } from "../components/WorldBrowser"

/**
 * Servers: explicitly registered local/Docker dedicated-server worlds.
 *
 * Modes:
 *   servers        — server list + world/container details
 *   backups        — this server's backups (Enter restores, p prunes)
 *   export-input   — type a destination path, Enter exports
 *   form           — add ('a') / edit ('E') a server record
 *   container-pick — pick a container from `docker ps` for the form
 *
 * A Docker restore always stops the container, takes a safety snapshot,
 * swaps the world with a helper container and restarts it (the core does
 * this when `manageContainer` is set). Local sources use plain rename.
 */

// Fixed rows above/below the scrolling list (banner 4, Centered padding 2,
// title/subtitle/spacer 3, details pane 6, hint 1, status 1).
const SERVER_CHROME = 17
const LIST_CHROME = 11

type Mode = "servers" | "backups" | "export-input" | "form" | "container-pick"
type FormField =
  | "name"
  | "kind"
  | "container"
  | "dataDir"
  | "levelName"
  | "liveBackup"
  | "requireStopped"
  | "save"

const FIELD_LABELS: Record<FormField, string> = {
  name: "Name",
  kind: "Source",
  container: "Container",
  dataDir: "Data directory",
  levelName: "Level name",
  liveBackup: "Live backup (RCON flush)",
  requireStopped: "Require stopped",
  save: "",
}

/** Expand `~` and resolve relative paths against the export directory. */
function resolveInputPath(raw: string, baseDir: string): string {
  let value = raw.trim()
  if (value === "~" || value.startsWith("~/")) {
    value = path.join(os.homedir(), value.slice(1))
  }
  return path.isAbsolute(value) ? path.normalize(value) : path.resolve(baseDir, value)
}

function openInFileManager(target: string): void {
  const command =
    process.platform === "win32" ? "explorer" : process.platform === "darwin" ? "open" : "xdg-open"
  Bun.spawn([command, target], { stdio: ["ignore", "ignore", "ignore"] })
}

export function ServersScreen() {
  const dims = useTerminalDimensions()
  const contentWidth = () => Math.max(20, Math.min(96, dims().width - 4))
  const truncate = (value: string, max = contentWidth()) =>
    value.length > max ? `${value.slice(0, max - 1)}…` : value
  const listHeight = (chrome: number) => Math.max(3, dims().height - chrome)

  const [servers, setServers] = createSignal<ServerRecord[]>([])
  const [serversLoading, setServersLoading] = createSignal(false)
  const [serverIndex, setServerIndex] = createSignal(0)
  const [mode, setMode] = createSignal<Mode>("servers")
  const [containerStates, setContainerStates] = createSignal<Record<string, boolean>>({})

  const { worlds, load: loadWorlds, refresh: refreshWorld, measure } = useServerWorlds()

  const [backups, setBackups] = createSignal<BackupEntry[]>([])
  const [backupSelected, setBackupSelected] = createSignal(0)
  const [backupsLoading, setBackupsLoading] = createSignal(false)
  const [pendingRestore, setPendingRestore] = createSignal<string | null>(null)
  const [restoreDialog, setRestoreDialog] = createSignal<string | null>(null)
  const [pendingRemove, setPendingRemove] = createSignal<string | null>(null)
  const [removeDialog, setRemoveDialog] = createSignal<ServerRecord | null>(null)
  const [pruneDialog, setPruneDialog] = createSignal<{ count: number; keep: number } | null>(null)

  const [exportDir, setExportDir] = createSignal("")
  const [exportPrefill, setExportPrefill] = createSignal("")
  const [pendingCreateParent, setPendingCreateParent] = createSignal(false)
  const [keepCount, setKeepCount] = createSignal(5)

  // Add/edit form.
  const [formMode, setFormMode] = createSignal<"add" | "edit" | null>(null)
  const [editingServerId, setEditingServerId] = createSignal<string | null>(null)
  const [formIndex, setFormIndex] = createSignal(0)
  const [formName, setFormName] = createSignal("")
  const [formKind, setFormKind] = createSignal<"local" | "docker">("docker")
  const [formContainer, setFormContainer] = createSignal("")
  const [formDataDir, setFormDataDir] = createSignal("/data")
  const [formLevel, setFormLevel] = createSignal("world")
  const [formLive, setFormLive] = createSignal(true)
  const [formStopped, setFormStopped] = createSignal(false)
  const [editingField, setEditingField] = createSignal<FormField | null>(null)
  const [containers, setContainers] = createSignal<Array<{ name: string; image: string; running: boolean }>>([])
  const [containerSelected, setContainerSelected] = createSignal(0)

  let deleteTimer: ReturnType<typeof setTimeout> | undefined
  let restoreTimer: ReturnType<typeof setTimeout> | undefined
  let removeTimer: ReturnType<typeof setTimeout> | undefined
  onCleanup(() => {
    clearTimeout(deleteTimer)
    clearTimeout(restoreTimer)
    clearTimeout(removeTimer)
  })

  const selectedServer = () => servers()[serverIndex()]
  const worldFor = (server: ServerRecord | undefined): WorldSummary | null | undefined =>
    server ? worlds().get(server.id) : undefined
  const selectedWorld = () => worldFor(selectedServer())

  const containerRunning = (server: ServerRecord | undefined): boolean => {
    if (!server || server.source.kind !== "docker") return false
    return containerStates()[server.source.container] === true
  }

  const formFields = createMemo<FormField[]>(() => [
    "name",
    "kind",
    ...(formKind() === "docker" ? (["container"] as FormField[]) : []),
    "dataDir",
    "levelName",
    "liveBackup",
    "requireStopped",
    "save",
  ])

  const [serverListRef, setServerListRef] = createSignal<ScrollBoxRenderable>()
  const [backupListRef, setBackupListRef] = createSignal<ScrollBoxRenderable>()
  const [containerListRef, setContainerListRef] = createSignal<ScrollBoxRenderable>()

  createEffect(() => {
    const list = serverListRef()
    if (list) list.scrollChildIntoView(`server-row-${serverIndex()}`)
  })
  createEffect(() => {
    const list = backupListRef()
    if (list) list.scrollChildIntoView(`backup-row-${backupSelected()}`)
  })
  createEffect(() => {
    const list = containerListRef()
    if (list) list.scrollChildIntoView(`container-row-${containerSelected()}`)
  })

  // ── Loading ─────────────────────────────────────────────────────

  async function refreshContainerStates(): Promise<void> {
    if (!servers().some((s) => s.source.kind === "docker")) return
    try {
      const list = await launcherService.discoverDockerContainers()
      setContainerStates(Object.fromEntries(list.map((c) => [c.name, c.running])))
    } catch {
      // Docker unavailable: leave states unknown (no running warning shown).
    }
  }

  async function loadServers(showSpinner = true): Promise<void> {
    if (showSpinner) setServersLoading(true)
    try {
      const list = await launcherService.listServers()
      const focusId = serverFocusId()
      if (focusId) {
        const idx = list.findIndex((s) => s.id === focusId)
        if (idx >= 0) setServerIndex(idx)
        setServerFocusId(null)
      }
      setServers(list)
      setServerIndex((i) => Math.max(0, Math.min(list.length - 1, i)))
      await loadWorlds(list.map((s) => s.id), false)
      await refreshContainerStates()
    } catch (err) {
      setStatusMessage(`Failed to list servers: ${err instanceof Error ? err.message : String(err)}`)
    } finally {
      setServersLoading(false)
    }
  }

  createEffect(() => {
    // Load on mount and whenever another screen bumps the refresh token.
    void serversRefreshToken()
    void loadServers()
  })

  onMount(() => {
    void (async () => {
      setExportDir(await launcherService.worldExportDir())
      try {
        setKeepCount((await launcherService.getSettings()).worldsKeepBackups)
      } catch {
        // keep the default
      }
    })()
  })

  createEffect(() => {
    setBackupSelected(0)
    if (mode() === "backups") void loadBackups()
  })

  createEffect(() => {
    const length = backups().length
    setBackupSelected((s) => Math.max(0, Math.min(length - 1, s)))
  })

  // Lazily measure the selected server world, debounced.
  createEffect(() => {
    const server = selectedServer()
    if (!server || mode() !== "servers") return
    const timer = setTimeout(() => void measure(server.id), 150)
    onCleanup(() => clearTimeout(timer))
  })

  async function loadBackups(): Promise<void> {
    const server = selectedServer()
    if (!server) return
    setBackupsLoading(true)
    try {
      setBackups(await launcherService.listServerBackups(server.id))
    } catch (err) {
      setStatusMessage(`Failed to list backups: ${err instanceof Error ? err.message : String(err)}`)
    } finally {
      setBackupsLoading(false)
    }
  }

  // ── Actions ─────────────────────────────────────────────────────

  function switchServer(delta: number): void {
    if (busy()) return
    setServerIndex((i) => Math.max(0, Math.min(servers().length - 1, i + delta)))
  }

  async function backupSelectedServer(): Promise<void> {
    const server = selectedServer()
    if (!server || busy()) return
    setBusy(true)
    try {
      const world = worldFor(server)
      setStatusMessage(
        `Backing up ${world?.name ?? server.name}${world?.sizeBytes ? ` (${formatSize(world.sizeBytes)})` : ""}…`,
      )
      const entry = await launcherService.backupServerWorld(server.id, (p) => setProgress(p))
      invalidateServerWorld(server.id)
      await refreshWorld(server.id)
      await loadServers(false)
      setStatusMessage(`Backed up ${entry.worldName} (${formatSize(entry.bytes)}) → ${entry.path}`)
      copyToClipboard(entry.path, "backup path")
      if (mode() === "backups") await loadBackups()
    } catch (err) {
      setStatusMessage(`Backup failed: ${err instanceof Error ? err.message : String(err)}`)
    } finally {
      setProgress(null)
      setBusy(false)
    }
  }

  function toggleBackups(): void {
    if (mode() === "backups") {
      setMode("servers")
      return
    }
    setMode("backups")
    setBackupSelected(0)
    void loadBackups()
  }

  async function performRestore(server: ServerRecord, fileName: string): Promise<void> {
    setBusy(true)
    try {
      setStatusMessage(`Restoring ${fileName}…`)
      const result = await launcherService.restoreServerBackup(server.id, fileName, {
        manageContainer: true,
        onProgress: (p) => setProgress(p),
      })
      invalidateServerWorld(server.id)
      await refreshWorld(server.id)
      await loadBackups()
      await loadServers(false)
      setStatusMessage(
        `Restored "${server.name}"` +
          (result.safetyBackup ? ` · safety snapshot: ${result.safetyBackup.fileName}` : "") +
          (result.replacedPath ? ` · old world kept at ${result.replacedPath}` : ""),
      )
    } catch (err) {
      setStatusMessage(`Restore failed: ${err instanceof Error ? err.message : String(err)}`)
    } finally {
      setProgress(null)
      setBusy(false)
    }
  }

  async function restoreSelectedBackup(): Promise<void> {
    const backup = backups()[backupSelected()]
    const server = selectedServer()
    if (!backup || !server || busy()) return
    if (containerRunning(server)) {
      setRestoreDialog(backup.fileName)
      setStatusMessage(
        `Container ${(server.source as { container: string }).container} is running — Enter will stop it, restore, then start it`,
      )
      return
    }
    if (pendingRestore() !== backup.fileName) {
      setPendingRestore(backup.fileName)
      setStatusMessage(`Press Enter again to restore "${backup.worldName}" — the current world is saved first`)
      clearTimeout(restoreTimer)
      restoreTimer = setTimeout(() => setPendingRestore(null), 5000)
      return
    }
    clearTimeout(restoreTimer)
    setPendingRestore(null)
    await performRestore(server, backup.fileName)
  }

  async function confirmRestoreDialog(): Promise<void> {
    const fileName = restoreDialog()
    const server = selectedServer()
    setRestoreDialog(null)
    if (fileName && server) await performRestore(server, fileName)
  }

  function openPrune(): void {
    if (busy()) return
    const pruneable = Math.max(0, backups().length - keepCount())
    if (pruneable === 0) {
      setStatusMessage(`Nothing to prune — keeping the newest ${keepCount()} backups`)
      return
    }
    setPruneDialog({ count: pruneable, keep: keepCount() })
  }

  async function confirmPrune(): Promise<void> {
    const server = selectedServer()
    setPruneDialog(null)
    if (!server) return
    setBusy(true)
    try {
      const removed = await launcherService.pruneServerBackups(server.id)
      setStatusMessage(`Pruned ${removed.length} old backup${removed.length === 1 ? "" : "s"}`)
      await loadBackups()
    } catch (err) {
      setStatusMessage(`Prune failed: ${err instanceof Error ? err.message : String(err)}`)
    } finally {
      setBusy(false)
    }
  }

  function removeSelected(): void {
    const server = selectedServer()
    if (!server || busy()) return
    if (pendingRemove() !== server.id) {
      setPendingRemove(server.id)
      setStatusMessage(`Press 'x' again to remove the "${server.name}" record (the world is never touched)`)
      clearTimeout(removeTimer)
      removeTimer = setTimeout(() => setPendingRemove(null), 5000)
      return
    }
    clearTimeout(removeTimer)
    setPendingRemove(null)
    setRemoveDialog(server)
  }

  async function confirmRemove(deleteBackups: boolean): Promise<void> {
    const server = removeDialog()
    setRemoveDialog(null)
    if (!server) return
    setBusy(true)
    try {
      await launcherService.removeServer(server.id, { deleteBackups })
      invalidateServerWorld(server.id)
      await loadServers(false)
      setStatusMessage(`Removed server "${server.name}"${deleteBackups ? " and its backups" : ""}`)
    } catch (err) {
      setStatusMessage(`Remove failed: ${err instanceof Error ? err.message : String(err)}`)
    } finally {
      setBusy(false)
    }
  }

  function yank(): void {
    const world = selectedWorld()
    if (world) copyToClipboard(world.path, "world path")
  }

  function openSelectedFolder(): void {
    const server = selectedServer()
    const world = selectedWorld()
    if (!server) return
    if (server.source.kind !== "local") {
      setStatusMessage(
        `Docker server — the world lives inside ${(server.source as { container: string }).container}; use 'e' to export a zip`,
      )
      return
    }
    const target = world?.path ?? path.join(server.source.dataDir, server.source.levelName)
    try {
      openInFileManager(target)
      setStatusMessage(`Opened ${target}`)
    } catch (err) {
      setStatusMessage(`Could not open folder: ${err instanceof Error ? err.message : String(err)}`)
    }
  }

  // ── Export ──────────────────────────────────────────────────────

  let exportValue = ""
  function defaultExportPath(server: ServerRecord): string {
    return path.join(exportDir() || os.homedir(), `${slugify(server.source.levelName)}-${timestamp()}.zip`)
  }

  function openExport(): void {
    const server = selectedServer()
    if (!server || busy()) return
    setPendingCreateParent(false)
    setTimeout(() => {
      exportValue = defaultExportPath(server)
      setExportPrefill(exportValue)
      setTextInputActive(true)
      setMode("export-input")
    }, 0)
  }

  function closeInput(): void {
    setTextInputActive(false)
    setPendingCreateParent(false)
    setMode("servers")
  }

  async function submitExport(value: string): Promise<void> {
    const server = selectedServer()
    if (!server) return
    const raw = (value || exportValue || exportPrefill()).trim()
    const dest = resolveInputPath(raw || defaultExportPath(server), exportDir())
    const parent = path.dirname(dest)
    if (!fs.existsSync(parent)) {
      if (!pendingCreateParent()) {
        setPendingCreateParent(true)
        setStatusMessage(`Folder ${parent} does not exist — press Enter again to create it, Esc to cancel`)
        return
      }
    } else if (fs.statSync(parent).isFile()) {
      setStatusMessage(`Not a folder: ${parent}`)
      return
    }
    if (fs.existsSync(dest)) {
      setStatusMessage(`Refusing to overwrite an existing file: ${dest}`)
      return
    }

    setBusy(true)
    try {
      const world = worldFor(server)
      setStatusMessage(`Exporting ${world?.name ?? server.name}…`)
      const entry = await launcherService.exportServerWorld(server.id, dest, (p) => setProgress(p))
      await launcherService.setSetting("lastWorldExportDir", parent)
      setExportDir(parent)
      setStatusMessage(`Exported ${entry.worldName} (${formatSize(entry.bytes)}) → ${entry.path}`)
      copyToClipboard(entry.path, "export path")
    } catch (err) {
      setStatusMessage(`Export failed: ${err instanceof Error ? err.message : String(err)}`)
    } finally {
      setProgress(null)
      setBusy(false)
    }
    setTimeout(closeInput, 0)
  }

  // ── Add / edit form ─────────────────────────────────────────────

  function openAddForm(): void {
    if (busy()) return
    setEditingServerId(null)
    setFormName("")
    setFormKind("docker")
    setFormContainer("")
    setFormDataDir("/data")
    setFormLevel("world")
    setFormLive(true)
    setFormStopped(false)
    setFormIndex(0)
    setFormMode("add")
    setMode("form")
  }

  function openEditForm(): void {
    const server = selectedServer()
    if (!server || busy()) return
    setEditingServerId(server.id)
    setFormName(server.name)
    setFormKind(server.source.kind)
    setFormContainer(server.source.kind === "docker" ? server.source.container : "")
    setFormDataDir(server.source.dataDir)
    setFormLevel(server.source.levelName)
    setFormLive(server.liveBackup)
    setFormStopped(server.requireStopped)
    setFormIndex(0)
    setFormMode("edit")
    setMode("form")
  }

  function closeForm(): void {
    setTextInputActive(false)
    setEditingField(null)
    setFormMode(null)
    setMode("servers")
  }

  function openEditor(field: FormField, initial: string): void {
    setTimeout(() => {
      editValue = initial
      setTextInputActive(true)
      setEditingField(field)
    }, 0)
  }

  let editValue = ""

  function saveEditor(value: string): void {
    const field = editingField()
    if (!field) return
    const raw = (typeof value === "string" && value.length > 0 ? value : editValue).trim()
    if (field === "name") setFormName(raw)
    else if (field === "container") setFormContainer(raw)
    else if (field === "dataDir") setFormDataDir(raw)
    else if (field === "levelName") setFormLevel(raw)
    setTimeout(() => {
      setTextInputActive(false)
      setEditingField(null)
    }, 0)
  }

  function toggleKind(): void {
    const next = formKind() === "docker" ? "local" : "docker"
    setFormKind(next)
    if (next === "docker" && (formDataDir() === os.homedir() || !formDataDir())) setFormDataDir("/data")
    if (next === "local" && formDataDir() === "/data") setFormDataDir(os.homedir())
    setFormIndex((i) => Math.min(i, formFields().length - 1))
  }

  async function openContainerPicker(): Promise<void> {
    setContainerSelected(0)
    setMode("container-pick")
    try {
      const list = await launcherService.discoverDockerContainers()
      setContainers(list)
      if (list.length === 0) {
        setStatusMessage("No Docker containers found — press 'e' to type a name manually")
      }
    } catch (err) {
      setContainers([])
      setStatusMessage(`Docker discovery failed: ${err instanceof Error ? err.message : String(err)}`)
    }
  }

  function pickContainer(): void {
    const container = containers()[containerSelected()]
    if (!container) return
    setFormContainer(container.name)
    setMode("form")
  }

  function activateFormField(): void {
    const field = formFields()[formIndex()]
    if (!field) return
    switch (field) {
      case "name":
        openEditor("name", formName())
        break
      case "kind":
        toggleKind()
        break
      case "container":
        void openContainerPicker()
        break
      case "dataDir":
        openEditor("dataDir", formDataDir())
        break
      case "levelName":
        openEditor("levelName", formLevel())
        break
      case "liveBackup":
        setFormLive((v) => !v)
        break
      case "requireStopped":
        setFormStopped((v) => !v)
        break
      case "save":
        void saveForm()
        break
    }
  }

  async function saveForm(): Promise<void> {
    const name = formName().trim()
    if (!name) {
      setStatusMessage("Server name is required")
      return
    }
    const dataDir = formDataDir().trim()
    if (!dataDir) {
      setStatusMessage("Data directory is required")
      return
    }
    const levelName = formLevel().trim() || "world"
    const container = formContainer().trim()
    if (formKind() === "docker" && !container) {
      setStatusMessage("Container name is required for a Docker server")
      return
    }
    const source: ServerSource =
      formKind() === "docker"
        ? { kind: "docker", container, dataDir, levelName }
        : { kind: "local", dataDir, levelName }

    setBusy(true)
    try {
      if (formMode() === "edit" && editingServerId()) {
        await launcherService.updateServer(editingServerId()!, {
          name,
          source,
          liveBackup: formLive(),
          requireStopped: formStopped(),
        })
        setStatusMessage(`Updated server "${name}"`)
      } else {
        await launcherService.addServer({
          name,
          source,
          liveBackup: formLive(),
          requireStopped: formStopped(),
        })
        setStatusMessage(`Added server "${name}"`)
      }
      closeForm()
      await loadServers()
    } catch (err) {
      setStatusMessage(`Failed to save server: ${err instanceof Error ? err.message : String(err)}`)
    } finally {
      setBusy(false)
    }
  }

  // ── Key bindings (OpenTUI keymap) ───────────────────────────────

  useBindings(() => ({
    enabled: allOf(
      when(mode, (m) => m === "servers"),
      when(busy, (b) => !b),
    ),
    commands: [
      { name: "servers.back", run: () => goBack() },
      { name: "servers.prev", run: () => switchServer(-1) },
      { name: "servers.next", run: () => switchServer(1) },
      { name: "servers.refresh", run: () => void loadServers() },
      { name: "servers.backup", run: () => void backupSelectedServer() },
      { name: "servers.backups", run: () => toggleBackups() },
      { name: "servers.export", run: () => openExport() },
      { name: "servers.yank", run: () => yank() },
      { name: "servers.open", run: () => openSelectedFolder() },
      { name: "servers.add", run: () => openAddForm() },
      { name: "servers.edit", run: () => openEditForm() },
      { name: "servers.remove", run: () => removeSelected() },
    ],
    bindings: [
      { key: "up", cmd: "servers.prev", desc: "select", hint: HINT.primary },
      { key: "down", cmd: "servers.next", desc: "select", hint: HINT.primary },
      { key: "k", cmd: "servers.prev" },
      { key: "j", cmd: "servers.next" },
      { key: "b", cmd: "servers.backup", desc: "back up", hint: HINT.secondary },
      { key: "v", cmd: "servers.backups", desc: "backups", hint: HINT.secondary },
      { key: "e", cmd: "servers.export", desc: "export", hint: HINT.secondary },
      { key: "a", cmd: "servers.add", desc: "add", hint: HINT.secondary },
      { key: "y", cmd: "servers.yank" },
      { key: "o", cmd: "servers.open" },
      { key: "shift+e", cmd: "servers.edit" },
      { key: "x", cmd: "servers.remove" },
      { key: "r", cmd: "servers.refresh", desc: "rescan", hint: HINT.edit },
      { key: "escape", cmd: "servers.back", desc: "back", hint: HINT.cancel },
    ],
  }))

  useBindings(() => ({
    enabled: when(mode, (m) => m === "backups"),
    commands: [
      { name: "servers.backups.back", run: () => setMode("servers") },
      { name: "servers.backups.prev", run: () => setBackupSelected((s) => Math.max(0, s - 1)) },
      {
        name: "servers.backups.next",
        run: () => setBackupSelected((s) => Math.min(backups().length - 1, s + 1)),
      },
      { name: "servers.backups.restore", run: () => void restoreSelectedBackup() },
      { name: "servers.backups.prune", run: () => openPrune() },
      { name: "servers.backups.yank", run: () => yank() },
    ],
    bindings: [
      { key: "up", cmd: "servers.backups.prev", desc: "navigate", hint: HINT.primary },
      { key: "down", cmd: "servers.backups.next", desc: "navigate", hint: HINT.primary },
      { key: "k", cmd: "servers.backups.prev" },
      { key: "j", cmd: "servers.backups.next" },
      { key: "return", cmd: "servers.backups.restore", desc: "restore", hint: HINT.secondary },
      { key: "p", cmd: "servers.backups.prune", desc: "prune", hint: HINT.secondary },
      { key: "y", cmd: "servers.backups.yank" },
      { key: "v", cmd: "servers.backups.back", desc: "servers", hint: HINT.edit },
      { key: "escape", cmd: "servers.backups.back", desc: "back", hint: HINT.cancel },
    ],
  }))

  useBindings(() => ({
    enabled: when(mode, (m) => m === "export-input"),
    commands: [{ name: "servers.cancelInput", run: () => closeInput() }],
    bindings: [{ key: "escape", cmd: "servers.cancelInput", desc: "cancel", hint: HINT.cancel }],
  }))

  useBindings(() => ({
    enabled: allOf(
      when(mode, (m) => m === "form"),
      when(editingField, (f) => f === null),
    ),
    commands: [
      { name: "servers.form.cancel", run: () => closeForm() },
      { name: "servers.form.prev", run: () => setFormIndex((i) => Math.max(0, i - 1)) },
      {
        name: "servers.form.next",
        run: () => setFormIndex((i) => Math.min(formFields().length - 1, i + 1)),
      },
      { name: "servers.form.activate", run: () => activateFormField() },
    ],
    bindings: [
      { key: "up", cmd: "servers.form.prev", desc: "field", hint: HINT.primary },
      { key: "down", cmd: "servers.form.next", desc: "field", hint: HINT.primary },
      { key: "k", cmd: "servers.form.prev" },
      { key: "j", cmd: "servers.form.next" },
      { key: "return", cmd: "servers.form.activate", desc: "edit/save", hint: HINT.secondary },
      { key: "escape", cmd: "servers.form.cancel", desc: "cancel", hint: HINT.cancel },
    ],
  }))

  useBindings(() => ({
    enabled: when(editingField, (f) => f !== null),
    commands: [
      {
        name: "servers.form.cancelEdit",
        run: () => {
          setTextInputActive(false)
          setEditingField(null)
        },
      },
    ],
    bindings: [{ key: "escape", cmd: "servers.form.cancelEdit", desc: "cancel", hint: HINT.cancel }],
  }))

  useBindings(() => ({
    enabled: when(mode, (m) => m === "container-pick"),
    commands: [
      { name: "servers.container.back", run: () => setMode("form") },
      { name: "servers.container.prev", run: () => setContainerSelected((s) => Math.max(0, s - 1)) },
      {
        name: "servers.container.next",
        run: () => setContainerSelected((s) => Math.min(containers().length - 1, s + 1)),
      },
      { name: "servers.container.pick", run: () => pickContainer() },
      {
        name: "servers.container.manual",
        run: () => {
          setMode("form")
          openEditor("container", formContainer())
        },
      },
    ],
    bindings: [
      { key: "up", cmd: "servers.container.prev", desc: "container", hint: HINT.primary },
      { key: "down", cmd: "servers.container.next", desc: "container", hint: HINT.primary },
      { key: "k", cmd: "servers.container.prev" },
      { key: "j", cmd: "servers.container.next" },
      { key: "return", cmd: "servers.container.pick", desc: "pick", hint: HINT.secondary },
      { key: "e", cmd: "servers.container.manual", desc: "type name", hint: HINT.edit },
      { key: "escape", cmd: "servers.container.back", desc: "back", hint: HINT.cancel },
    ],
  }))

  useBindings(() => ({
    enabled: when(pruneDialog, (d) => d !== null),
    commands: [
      { name: "servers.prune.confirm", run: () => void confirmPrune() },
      { name: "servers.prune.cancel", run: () => setPruneDialog(null) },
    ],
    bindings: [
      { key: "return", cmd: "servers.prune.confirm", desc: "confirm", hint: HINT.secondary },
      { key: "escape", cmd: "servers.prune.cancel", desc: "cancel", hint: HINT.cancel },
    ],
  }))

  useBindings(() => ({
    enabled: when(removeDialog, (d) => d !== null),
    commands: [
      { name: "servers.remove.record", run: () => void confirmRemove(false) },
      { name: "servers.remove.withBackups", run: () => void confirmRemove(true) },
      { name: "servers.remove.cancel", run: () => setRemoveDialog(null) },
    ],
    bindings: [
      { key: "return", cmd: "servers.remove.record", desc: "remove", hint: HINT.secondary },
      { key: "d", cmd: "servers.remove.withBackups", desc: "remove + backups", hint: HINT.secondary },
      { key: "escape", cmd: "servers.remove.cancel", desc: "cancel", hint: HINT.cancel },
    ],
  }))

  useBindings(() => ({
    enabled: when(restoreDialog, (d) => d !== null),
    commands: [
      { name: "servers.restore.confirm", run: () => void confirmRestoreDialog() },
      { name: "servers.restore.cancel", run: () => setRestoreDialog(null) },
    ],
    bindings: [
      { key: "return", cmd: "servers.restore.confirm", desc: "stop, restore, restart", hint: HINT.secondary },
      { key: "escape", cmd: "servers.restore.cancel", desc: "cancel", hint: HINT.cancel },
    ],
  }))

  // ── Render helpers ──────────────────────────────────────────────

  const sourceLabel = (server: ServerRecord): string =>
    server.source.kind === "docker"
      ? `docker ${server.source.container}`
      : "local"

  const worldLabel = (server: ServerRecord): string => {
    const world = worldFor(server)
    if (world === undefined) return "…"
    if (world === null) return "no world"
    return `${world.name}${world.versionName ? ` ${world.versionName}` : ""}`
  }

  function fieldRaw(field: FormField): string {
    switch (field) {
      case "name":
        return formName()
      case "container":
        return formContainer()
      case "dataDir":
        return formDataDir()
      case "levelName":
        return formLevel()
      default:
        return ""
    }
  }

  function fieldValue(field: FormField): string {
    switch (field) {
      case "name":
        return formName() || "(required)"
      case "kind":
        return formKind() === "docker" ? "docker container" : "local directory"
      case "container":
        return formContainer() || "(required — Enter to pick)"
      case "dataDir":
        return formDataDir() || "(required)"
      case "levelName":
        return formLevel() || "world"
      case "liveBackup":
        return formLive() ? "yes — RCON save-off / save-all flush / save-on" : "no"
      case "requireStopped":
        return formStopped() ? "yes — refuse to back up while running" : "no"
      case "save":
        return formMode() === "edit" ? "— save changes —" : "— add server —"
    }
  }

  return (
    <box flexDirection="column" flexGrow={1}>
      <Centered maxWidth={96}>
        <box flexDirection="row" justifyContent="center" flexShrink={0}>
          <text fg="#cdd6f4" attributes={2}>
            Servers
            {mode() === "backups"
              ? " — backups"
              : mode() === "form"
                ? formMode() === "edit"
                  ? " — edit"
                  : " — add"
                : mode() === "container-pick"
                  ? " — pick container"
                  : ""}
          </text>
        </box>
        <Show when={mode() === "servers" || mode() === "backups"}>
          <text fg="#6c7086" flexShrink={0}>
            {servers().length} server{servers().length === 1 ? "" : "s"}
            {mode() === "backups" && selectedServer() ? ` · ${selectedServer()!.name}` : ""}
            {servers().some((s) => containerRunning(s)) ? " · ⏳ a container is running" : ""}
          </text>
        </Show>
        <box height={1} flexShrink={0} />

        <Switch>
          <Match when={mode() === "export-input"}>
            <box flexDirection="column">
              <text fg="#a6e3a1">Export "{selectedServer()?.name ?? "server"}" world to:</text>
              <box flexDirection="row">
                <text fg="#89b4fa">Path: </text>
                <input
                  flexGrow={1}
                  value={exportPrefill()}
                  placeholder="~ or a relative path are expanded · Enter exports · Esc cancels"
                  focused
                  onInput={(value) => {
                    if (typeof value === "string") exportValue = value
                  }}
                  onSubmit={(value) =>
                    void submitExport(typeof value === "string" && value.length > 0 ? value : exportValue)
                  }
                />
              </box>
              <text fg="#6c7086">
                A zip of the server world (RCON-flushed when live), safe to import elsewhere.
              </text>
            </box>
          </Match>

          <Match when={mode() === "container-pick"}>
            <box flexDirection="column">
              <text fg="#cdd6f4">Pick a Docker container:</text>
              <Show
                when={containers().length > 0}
                fallback={<text fg="#6c7086">No containers found — press 'e' to type a name manually.</text>}
              >
                <scrollbox ref={setContainerListRef} height={listHeight(LIST_CHROME)} scrollbarOptions={{ showArrows: false }}>
                  <For each={containers()}>
                    {(container, i) => (
                      <box id={`container-row-${i()}`} flexDirection="row" height={1}>
                        <text
                          fg={containerSelected() === i() ? "#89b4fa" : "#cdd6f4"}
                          attributes={containerSelected() === i() ? 1 : 0}
                        >
                          {containerSelected() === i() ? "▸ " : "  "}
                          {container.name}
                        </text>
                        <text fg="#585b70">
                          {" "}
                          · {container.image} · {container.running ? "running" : "stopped"}
                        </text>
                      </box>
                    )}
                  </For>
                </scrollbox>
              </Show>
            </box>
          </Match>

          <Match when={mode() === "form"}>
            <box flexDirection="column" width="100%">
              <text fg="#cdd6f4">
                {formMode() === "edit" ? `Edit server "${formName()}"` : "Add a dedicated server"}
              </text>
              <box height={1} />
              <For each={formFields()}>
                {(field, i) => (
                  <box flexDirection="row" height={1}>
                    <Show
                      when={editingField() === field}
                      fallback={
                        <>
                          <text
                            fg={formIndex() === i() ? "#89b4fa" : field === "save" ? "#a6e3a1" : "#a6adc8"}
                            attributes={formIndex() === i() ? 1 : 0}
                          >
                            {formIndex() === i() ? "▸ " : "  "}
                            {FIELD_LABELS[field].padEnd(26)}
                          </text>
                          <text fg="#cdd6f4">{fieldValue(field)}</text>
                        </>
                      }
                    >
                      <text fg="#89b4fa">{"  "}{FIELD_LABELS[field].padEnd(26)}</text>
                      <input
                        flexGrow={1}
                        value={fieldRaw(field)}
                        placeholder="Enter saves · Esc cancels"
                        focused
                        onInput={(value) => {
                          if (typeof value === "string") editValue = value
                        }}
                        onSubmit={(value) =>
                          saveEditor(typeof value === "string" && value.length > 0 ? value : editValue)
                        }
                      />
                    </Show>
                  </box>
                )}
              </For>
              <box height={1} />
              <text fg="#6c7086">
                Enter edits the selected field · Docker containers are picked from `docker ps`.
              </text>
              <text fg="#6c7086">
                A Docker data directory is the container path (usually /data); the world is the level
                name inside it.
              </text>
            </box>
          </Match>

          <Match when={mode() === "backups"}>
            <Show
              when={backups().length > 0}
              fallback={
                <text fg="#6c7086" flexShrink={0}>
                  {backupsLoading() ? "Loading backups…" : "No backups yet — press 'b' on a server."}
                </text>
              }
            >
              <scrollbox ref={setBackupListRef} height={listHeight(LIST_CHROME)} scrollbarOptions={{ showArrows: false }}>
                <For each={backups()}>
                  {(backup, i) => (
                    <BackupRow
                      id={`backup-row-${i()}`}
                      backup={backup}
                      selected={backupSelected() === i()}
                      pendingRestore={pendingRestore() === backup.fileName}
                      contentWidth={contentWidth()}
                      truncate={truncate}
                    />
                  )}
                </For>
              </scrollbox>
            </Show>
          </Match>

          <Match when={true}>
            <Show
              when={servers().length > 0}
              fallback={
                <box flexDirection="column" flexShrink={0}>
                  <text fg="#6c7086">
                    {serversLoading()
                      ? "Scanning servers…"
                      : "No servers yet — press 'a' to add your Docker or local server directory."}
                  </text>
                  <text fg="#585b70">
                    A server world lives on the server (a Docker volume or host directory), not in this
                    client's saves/.
                  </text>
                </box>
              }
            >
              <scrollbox ref={setServerListRef} height={listHeight(SERVER_CHROME)} scrollbarOptions={{ showArrows: false }}>
                <For each={servers()}>
                  {(server, i) => {
                    const world = () => worldFor(server)
                    const damaged = () => world()?.damage !== undefined && world()!.damage !== "ok"
                    const running = () => containerRunning(server)
                    const pending = () => pendingRemove() === server.id
                    return (
                      <box id={`server-row-${i()}`} flexDirection="column">
                        <box flexDirection="row" height={1}>
                          <text
                            fg={serverIndex() === i() ? "#89b4fa" : damaged() ? "#f9e2af" : "#cdd6f4"}
                            attributes={serverIndex() === i() ? 1 : 0}
                          >
                            {serverIndex() === i() ? "▸ " : "  "}
                            {server.name}
                          </text>
                          <text fg="#585b70"> · {sourceLabel(server)}</text>
                          <text fg="#a6adc8"> · {worldLabel(server)}</text>
                          <Show when={damaged()}>
                            <text fg="#f38ba8">
                              {" "}
                              ⚠ {world()!.damage === "missing-level-dat" ? "no level.dat" : "damaged"}
                            </text>
                          </Show>
                          <Show when={running()}>
                            <text fg="#a6e3a1"> ⏳ running</text>
                          </Show>
                          <Show when={pending()}>
                            <text fg="#f38ba8"> — press 'x' again to remove</text>
                          </Show>
                        </box>
                        <box flexDirection="row" height={1}>
                          <text fg="#585b70">
                            {"  "}
                            {server.source.kind === "docker"
                              ? `${server.source.container}:${server.source.dataDir}/${server.source.levelName}`
                              : server.source.dataDir}
                            {world()?.lastPlayed ? ` · played ${relativeTime(world()!.lastPlayed)}` : ""}
                          </text>
                        </box>
                      </box>
                    )
                  }}
                </For>
              </scrollbox>
            </Show>
          </Match>
        </Switch>

        {/* Details pane — fixed height so the list geometry never shifts. */}
        <Show when={mode() === "servers"}>
          <box flexDirection="column" height={6} flexShrink={0}>
            <Show when={selectedServer()}>
              <text fg="#a6adc8" flexShrink={0}>
                World: {worldLabel(selectedServer()!)}
                {selectedWorld()?.damage && selectedWorld()!.damage !== "ok"
                  ? ` · ⚠ ${selectedWorld()!.damage === "missing-level-dat" ? "no level.dat" : "damaged"}`
                  : ""}
              </text>
              <text fg="#585b70" flexShrink={0}>
                Source: {sourceLabel(selectedServer()!)}
                {selectedServer()!.source.kind === "docker"
                  ? ` · ${containerRunning(selectedServer()) ? "running" : "stopped"}`
                  : " · host directory"}
                {selectedServer()!.liveBackup ? " · live backup" : ""}
                {selectedServer()!.requireStopped ? " · requires stopped" : ""}
              </text>
              <text fg="#a6adc8" flexShrink={0}>
                Type {selectedWorld()?.gameType ?? "—"} · difficulty {selectedWorld()?.difficulty ?? "—"} ·
                last played {relativeTime(selectedWorld()?.lastPlayed)}
              </text>
              <text fg="#a6adc8" flexShrink={0}>
                {selectedWorld()?.fileCount ?? "…"} files · {formatSize(selectedWorld()?.sizeBytes)} ·{" "}
                {selectedWorld()?.folder ?? "—"}
              </text>
              <text fg="#585b70" flexShrink={0}>
                {truncate(
                  `Backup path: ${launcherService.serverBackupsDir(selectedServer()!.id)}/${slugify(
                    selectedServer()!.source.levelName,
                  )}-<timestamp>.zip`,
                )}
              </text>
              <Show
                when={containerRunning(selectedServer())}
                fallback={<text fg="#585b70" flexShrink={0}> Press 'b' to back up · 'v' for backups</text>}
              >
                <text fg="#f9e2af" flexShrink={0}>
                  {" "}
                  ⏳ container running — restore will stop it, restore, then start it again
                </text>
              </Show>
            </Show>
          </box>
        </Show>
      </Centered>
      <Progress />
      <KeyHints
        extra={
          mode() === "export-input"
            ? [["type", "path"], ["Enter", "export"]]
            : mode() === "form" && editingField()
              ? [["type", "value"], ["Enter", "save"]]
              : undefined
        }
      />
      <Show when={pruneDialog()}>
        <Dialog title="Prune backups?">
          <text fg="#cdd6f4">
            Delete {pruneDialog()!.count} old backup{pruneDialog()!.count === 1 ? "" : "s"}, keeping the
            newest {pruneDialog()!.keep}?
          </text>
          <text fg="#6c7086">Enter confirms · Esc cancels</text>
        </Dialog>
      </Show>
      <Show when={removeDialog()}>
        <Dialog title={`Remove "${removeDialog()!.name}"?`}>
          <text fg="#cdd6f4">The server world is never touched — only the launcher record is removed.</text>
          <text fg="#6c7086">Enter removes the record · 'd' also deletes its backups · Esc cancels</text>
        </Dialog>
      </Show>
      <Show when={restoreDialog()}>
        <Dialog title="Container is running">
          <text fg="#cdd6f4">
            Restoring requires the container stopped. Enter will stop it, take a safety snapshot, restore
            the world, then start it again.
          </text>
          <text fg="#6c7086">Enter confirms · Esc cancels</text>
        </Dialog>
      </Show>
    </box>
  )
}
