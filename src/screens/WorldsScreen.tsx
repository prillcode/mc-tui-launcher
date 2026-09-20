import { onMount, onCleanup, For, Show, createSignal, createMemo, createEffect, Switch, Match } from "solid-js"
import { useTerminalDimensions } from "@opentui/solid"
import { useBindings } from "@opentui/keymap/solid"
import type { ScrollBoxRenderable } from "@opentui/core"
import * as fs from "node:fs"
import * as path from "node:path"
import * as os from "node:os"
import type { BackupEntry, WorldStats, WorldSummary } from "@prillcode/mc-launcher-core"
import {
  instances,
  selectedInstanceId,
  goBack,
  setStatusMessage,
  setBusy,
  busy,
  progress,
  setProgress,
  setTextInputActive,
  runningInstanceIds,
  worldsFocusInstanceId,
  setWorldsFocusInstanceId,
} from "../app/state"
import { HINT, allOf, when } from "../app/keymap"
import { launcherService } from "../services/launcher"
import { useWorlds, invalidateWorlds, invalidateWorldStats } from "../app/useWorlds"
import { copyToClipboard } from "../app/clipboard"
import { KeyHints } from "../components/KeyHints"
import { Centered } from "../components/Centered"
import { Dialog } from "../components/Dialog"
import { Progress } from "../components/Progress"

/**
 * Worlds: per-instance singleplayer browser + backup/export/import/restore.
 *
 * Modes:
 *   worlds        — world list + details pane (b/e/i/y/x/c/o)
 *   backups       — backup list (v toggles, Enter restores, p prunes)
 *   export-input  — type a destination path, Enter exports
 *   import-input  — type a world zip path, Enter imports
 *   duplicate     — pick a target instance, Enter copies
 *
 * Every world-mutating action is refused while the instance is running
 * (the core throws InstanceRunningError, surfaced in the status bar) and
 * delete/restore are 2-press confirms.
 */

// Fixed rows above/below the scrolling list (see the layout-height note in
// ModsScreen): banner 4, Centered padding 2, title/instance/spacer 3, the
// 6-line details pane, hint 1, status 1.
const WORLDS_CHROME = 17
// Backups/duplicate modes have no details pane.
const LIST_CHROME = 11

type Mode = "worlds" | "backups" | "export-input" | "import-input" | "duplicate"

function formatSize(bytes: number | undefined): string {
  if (bytes === undefined) return "…"
  if (bytes >= 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024 * 1024)).toFixed(1)} GB`
  if (bytes >= 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
  if (bytes >= 1024) return `${(bytes / 1024).toFixed(0)} KB`
  return `${bytes} B`
}

function relativeTime(ms: number | undefined): string {
  if (!ms) return "never"
  const diff = Date.now() - ms
  if (diff < 0) return "just now"
  const minutes = Math.floor(diff / 60000)
  if (minutes < 1) return "just now"
  if (minutes < 60) return `${minutes}m ago`
  const hours = Math.floor(minutes / 60)
  if (hours < 24) return `${hours}h ago`
  const days = Math.floor(hours / 24)
  if (days < 30) return `${days} day${days === 1 ? "" : "s"} ago`
  const months = Math.floor(days / 30)
  if (months < 12) return `${months} mo ago`
  return `${Math.floor(months / 12)}y ago`
}

function formatPlaytime(ticks: number | undefined): string {
  if (!ticks) return "—"
  const totalMinutes = Math.floor(ticks / 20 / 60)
  const hours = Math.floor(totalMinutes / 60)
  const minutes = totalMinutes % 60
  return hours > 0 ? `${hours}h ${minutes}m` : `${minutes}m`
}

function formatDistance(cm: number | undefined): string {
  if (!cm) return "—"
  const km = cm / 100000
  return km >= 1 ? `${km.toFixed(1)} km` : `${Math.round(cm / 100)} m`
}

function slugify(name: string): string {
  const slug = name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
  return slug || "world"
}

function timestamp(date = new Date()): string {
  const pad = (n: number) => String(n).padStart(2, "0")
  return (
    `${date.getFullYear()}${pad(date.getMonth() + 1)}${pad(date.getDate())}` +
    `-${pad(date.getHours())}${pad(date.getMinutes())}${pad(date.getSeconds())}`
  )
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

function versionNameOf(levelDat: Record<string, unknown> | null): string | undefined {
  const data = levelDat?.Data
  if (data === null || typeof data !== "object") return undefined
  const version = (data as Record<string, unknown>).Version
  if (version === null || typeof version !== "object") return undefined
  const name = (version as Record<string, unknown>).Name
  return typeof name === "string" ? name : undefined
}

export function WorldsScreen() {
  const [instanceIndex, setInstanceIndex] = createSignal(0)
  const [mode, setMode] = createSignal<Mode>("worlds")
  const [selected, setSelected] = createSignal(0)
  const [backups, setBackups] = createSignal<BackupEntry[]>([])
  const [backupSelected, setBackupSelected] = createSignal(0)
  const [backupsLoading, setBackupsLoading] = createSignal(false)
  const [selectedStats, setSelectedStats] = createSignal<WorldStats | null>(null)
  const [pendingDelete, setPendingDelete] = createSignal<string | null>(null)
  const [pendingRestore, setPendingRestore] = createSignal<string | null>(null)
  const [pruneDialog, setPruneDialog] = createSignal<{ count: number; keep: number } | null>(null)
  const [keepCount, setKeepCount] = createSignal(5)
  const [exportDir, setExportDir] = createSignal("")
  const [exportPrefill, setExportPrefill] = createSignal("")
  const [pendingCreateParent, setPendingCreateParent] = createSignal(false)
  const [duplicateSelected, setDuplicateSelected] = createSignal(0)
  const [targetFree, setTargetFree] = createSignal<Record<string, number>>({})

  let deleteTimer: ReturnType<typeof setTimeout> | undefined
  let restoreTimer: ReturnType<typeof setTimeout> | undefined
  onCleanup(() => {
    clearTimeout(deleteTimer)
    clearTimeout(restoreTimer)
  })

  const dims = useTerminalDimensions()
  const contentWidth = () => Math.max(20, Math.min(96, dims().width - 4))
  /** Keep fixed-height rows from wrapping into the hint bar. */
  const truncate = (value: string, max = contentWidth()) =>
    value.length > max ? `${value.slice(0, max - 1)}…` : value
  const instance = createMemo(() => instances()[instanceIndex()])
  const instanceId = createMemo(() => instance()?.id)
  const { worlds, loading, error, refresh, measure, stats } = useWorlds(instanceId)
  const listHeight = (chrome: number) => Math.max(3, dims().height - chrome)

  const running = () => {
    const id = instanceId()
    return id !== undefined && runningInstanceIds().includes(id)
  }
  const selectedWorld = () => worlds()[selected()]
  const duplicateTargets = () => instances().filter((i) => i.id !== instanceId())
  const duplicateTarget = () => duplicateTargets()[duplicateSelected()]

  const versionMismatch = (world: WorldSummary | undefined): boolean => {
    const inst = instance()
    return Boolean(world?.versionName && inst && world.versionName !== inst.versionId)
  }

  // ── Loading ─────────────────────────────────────────────────────

  onMount(() => {
    const focusId = worldsFocusInstanceId() ?? selectedInstanceId()
    if (focusId) {
      const idx = instances().findIndex((i) => i.id === focusId)
      if (idx >= 0) setInstanceIndex(idx)
      setWorldsFocusInstanceId(null)
    }
    void (async () => {
      setExportDir(await launcherService.worldExportDir())
      try {
        const settings = await launcherService.getSettings()
        setKeepCount(settings.worldsKeepBackups)
      } catch {
        // keep the default
      }
    })()
  })

  async function loadBackups() {
    const id = instanceId()
    if (!id) return
    setBackupsLoading(true)
    try {
      setBackups(await launcherService.listBackups(id))
    } catch (err) {
      setStatusMessage(`Failed to list backups: ${err instanceof Error ? err.message : String(err)}`)
    } finally {
      setBackupsLoading(false)
    }
  }

  async function refreshAll() {
    await refresh()
    if (mode() === "backups") await loadBackups()
  }

  createEffect(() => {
    // Reset selection when the instance (or its world list) changes.
    void instanceId()
    setSelected(0)
    setBackupSelected(0)
    setSelectedStats(null)
    if (mode() === "backups") void loadBackups()
  })

  createEffect(() => {
    const length = worlds().length
    setSelected((s) => Math.max(0, Math.min(length - 1, s)))
  })

  // Player stats for the selected world (cached per session).
  createEffect(() => {
    const world = selectedWorld()
    if (!world || mode() !== "worlds") {
      setSelectedStats(null)
      return
    }
    void (async () => {
      const result = await stats(world.folder)
      if (selectedWorld()?.folder === world.folder) setSelectedStats(result ?? null)
    })()
  })

  // Lazily measure the selected world's size, debounced so arrowing through
  // a long list does not measure every row.
  createEffect(() => {
    const world = selectedWorld()
    if (!world || mode() !== "worlds") return
    const timer = setTimeout(() => void measure(world.folder), 150)
    onCleanup(() => clearTimeout(timer))
  })

  // Keep the focused row visible (signal ref: a plain `let` never re-runs).
  const [worldListRef, setWorldListRef] = createSignal<ScrollBoxRenderable>()
  const [backupListRef, setBackupListRef] = createSignal<ScrollBoxRenderable>()
  createEffect(() => {
    const list = worldListRef()
    if (!list) return
    list.scrollChildIntoView(`world-row-${selected()}`)
  })
  createEffect(() => {
    const list = backupListRef()
    if (!list) return
    list.scrollChildIntoView(`backup-row-${backupSelected()}`)
  })

  // ── Actions ─────────────────────────────────────────────────────

  function switchInstance(delta: number) {
    if (busy()) return
    const next = Math.max(0, Math.min(instances().length - 1, instanceIndex() + delta))
    setInstanceIndex(next)
  }

  function refuseIfRunning(action: string): boolean {
    if (running()) {
      setStatusMessage(`${action} disabled while the instance is running — stop Minecraft first`)
      return true
    }
    return false
  }

  async function backupWorldSelected() {
    const world = selectedWorld()
    if (!world || busy()) return
    if (refuseIfRunning("Backups")) return
    setBusy(true)
    try {
      const measured = world.sizeBytes ?? (await launcherService.measureWorld(instanceId()!, world.folder)).sizeBytes
      setStatusMessage(`Backing up ${world.name} (${formatSize(measured)})…`)
      const entry = await launcherService.backupWorld(instanceId()!, world.folder, (p) => setProgress(p))
      invalidateWorlds(instanceId()!)
      setStatusMessage(`Backed up ${world.name} (${formatSize(entry.bytes)}) → ${entry.path}`)
      copyToClipboard(entry.path, "backup path")
      await loadBackups()
    } catch (err) {
      setStatusMessage(`Backup failed: ${err instanceof Error ? err.message : String(err)}`)
    } finally {
      setProgress(null)
      setBusy(false)
    }
  }

  async function deleteSelected() {
    const world = selectedWorld()
    if (!world || busy()) return
    if (refuseIfRunning("World deletion")) return
    if (pendingDelete() !== world.folder) {
      setPendingDelete(world.folder)
      setStatusMessage(
        `Press 'x' again to delete "${world.name}"${world.sizeBytes ? ` — ${formatSize(world.sizeBytes)}` : ""}, not recoverable (press 'b' first to back it up)`,
      )
      clearTimeout(deleteTimer)
      deleteTimer = setTimeout(() => setPendingDelete(null), 5000)
      return
    }
    clearTimeout(deleteTimer)
    setPendingDelete(null)
    setBusy(true)
    try {
      await launcherService.deleteWorld(instanceId()!, world.folder)
      invalidateWorlds(instanceId()!)
      setStatusMessage(`Deleted world "${world.name}"`)
      await refresh()
      invalidateWorldStats(instanceId()!, world.folder)
    } catch (err) {
      setStatusMessage(`Delete failed: ${err instanceof Error ? err.message : String(err)}`)
    } finally {
      setBusy(false)
    }
  }

  function openDuplicate() {
    const world = selectedWorld()
    if (!world || busy()) return
    if (refuseIfRunning("World copies")) return
    setDuplicateSelected(0)
    setMode("duplicate")
    void (async () => {
      const free: Record<string, number> = {}
      for (const target of duplicateTargets()) {
        try {
          free[target.id] = await launcherService.availableBytes(target.gameDirectory)
        } catch {
          // leave unknown
        }
      }
      setTargetFree(free)
    })()
  }

  async function confirmDuplicate() {
    const world = selectedWorld()
    const target = duplicateTarget()
    if (!world || !target || busy()) return
    setBusy(true)
    try {
      const newFolder = await launcherService.duplicateWorld(instanceId()!, world.folder, target.id)
      setStatusMessage(`Copied "${world.name}" to ${target.name} as "${newFolder}"`)
      setMode("worlds")
    } catch (err) {
      setStatusMessage(`Copy failed: ${err instanceof Error ? err.message : String(err)}`)
    } finally {
      setBusy(false)
    }
  }

  // ── Export ──────────────────────────────────────────────────────

  let exportValue = ""

  function defaultExportPath(folder: string): string {
    return path.join(exportDir() || os.homedir(), `${slugify(folder)}-${timestamp()}.zip`)
  }

  function openExport() {
    const world = selectedWorld()
    if (!world || busy()) return
    if (refuseIfRunning("World exports")) return
    setPendingCreateParent(false)
    // Defer so the opening 'e' cannot leak into the fresh input.
    setTimeout(() => {
      exportValue = defaultExportPath(world.folder)
      setExportPrefill(exportValue)
      setTextInputActive(true)
      setMode("export-input")
    }, 0)
  }

  function closeInput() {
    setTextInputActive(false)
    setPendingCreateParent(false)
    setMode("worlds")
  }

  async function submitExport(value: string) {
    const world = selectedWorld()
    if (!world) return
    const raw = (value || exportValue || exportPrefill()).trim()
    const dest = resolveInputPath(raw || defaultExportPath(world.folder), exportDir())
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
      const measured =
        world.sizeBytes ?? (await launcherService.measureWorld(instanceId()!, world.folder)).sizeBytes
      if (fs.existsSync(parent)) {
        const free = await launcherService.availableBytes(parent)
        if (measured > free) {
          setStatusMessage(
            `Not enough space in ${parent} for ${formatSize(measured)} (free ${formatSize(free)})`,
          )
          return
        }
      }
      setStatusMessage(`Exporting ${world.name} (${formatSize(measured)})…`)
      const entry = await launcherService.exportWorld(instanceId()!, world.folder, dest, (p) => setProgress(p))
      await launcherService.setSetting("lastWorldExportDir", parent)
      setExportDir(parent)
      setStatusMessage(`Exported ${world.name} (${formatSize(entry.bytes)}) → ${entry.path}`)
      copyToClipboard(entry.path, "export path")
    } catch (err) {
      setStatusMessage(`Export failed: ${err instanceof Error ? err.message : String(err)}`)
    } finally {
      setProgress(null)
      setBusy(false)
    }
    setTimeout(closeInput, 0)
  }

  // ── Import ──────────────────────────────────────────────────────

  let importValue = ""

  function openImport() {
    if (busy()) return
    if (refuseIfRunning("World imports")) return
    setTimeout(() => {
      importValue = ""
      setTextInputActive(true)
      setMode("import-input")
    }, 0)
  }

  async function submitImport(value: string) {
    const id = instanceId()
    const inst = instance()
    if (!id || !inst) return
    const raw = (value || importValue).trim()
    if (!raw) return
    const zipPath = resolveInputPath(raw, exportDir())
    if (!zipPath.toLowerCase().endsWith(".zip")) {
      setStatusMessage("Import expects a .zip file")
      return
    }
    if (!fs.existsSync(zipPath)) {
      setStatusMessage(`No such file: ${zipPath}`)
      return
    }

    setBusy(true)
    try {
      const inspection = await launcherService.inspectWorldZip(zipPath)
      if (inspection.kind === "none" || inspection.kind === "multi-root" || !inspection.hasLevelDat) {
        setStatusMessage(`That zip does not contain a Minecraft world: ${path.basename(zipPath)}`)
        return
      }
      const level = await launcherService.readWorldZipLevel(zipPath)
      const version = versionNameOf(level)
      const name = inspection.rootDir ?? path.basename(zipPath).replace(/\.zip$/i, "")
      if (version && version !== inst.versionId) {
        // Advisory only — Minecraft is the authority on upgrading worlds.
        setStatusMessage(`⚠ "${name}" was saved by ${version}; importing into ${inst.versionId}`)
      } else {
        setStatusMessage(`Importing ${name} (${inspection.entryCount} files)…`)
      }
      const imported = await launcherService.importWorld(id, zipPath, { onProgress: (p) => setProgress(p) })
      invalidateWorlds(id)
      await refresh()
      const index = worlds().findIndex((w) => w.folder === imported.folder)
      if (index >= 0) setSelected(index)
      setStatusMessage(
        imported.folder === name
          ? `Imported ${imported.summary.name}`
          : `Imported ${imported.summary.name} as "${imported.folder}"`,
      )
    } catch (err) {
      setStatusMessage(`Import failed: ${err instanceof Error ? err.message : String(err)}`)
    } finally {
      setProgress(null)
      setBusy(false)
    }
    setTimeout(closeInput, 0)
  }

  // ── Backups ─────────────────────────────────────────────────────

  function toggleBackups() {
    if (mode() === "backups") {
      setMode("worlds")
      return
    }
    setMode("backups")
    setBackupSelected(0)
    void loadBackups()
  }

  async function restoreSelectedBackup() {
    const backup = backups()[backupSelected()]
    if (!backup || busy()) return
    if (refuseIfRunning("World restores")) return
    if (pendingRestore() !== backup.fileName) {
      setPendingRestore(backup.fileName)
      setStatusMessage(
        `Press Enter again to restore "${backup.worldName}" — the current world is saved first`,
      )
      clearTimeout(restoreTimer)
      restoreTimer = setTimeout(() => setPendingRestore(null), 5000)
      return
    }
    clearTimeout(restoreTimer)
    setPendingRestore(null)
    setBusy(true)
    try {
      setStatusMessage(`Restoring ${backup.worldName}…`)
      const result = await launcherService.restoreBackup(instanceId()!, backup.fileName, (p) =>
        setProgress(p),
      )
      invalidateWorlds(instanceId()!)
      invalidateWorldStats(instanceId()!, result.worldFolder)
      await refresh()
      await loadBackups()
      setStatusMessage(
        `Restored "${result.worldFolder}"` +
          (result.safetyBackup ? ` · safety snapshot: ${result.safetyBackup.fileName}` : ""),
      )
    } catch (err) {
      setStatusMessage(`Restore failed: ${err instanceof Error ? err.message : String(err)}`)
    } finally {
      setProgress(null)
      setBusy(false)
    }
  }

  function openPrune() {
    if (busy()) return
    const pruneable = Math.max(0, backups().length - keepCount())
    if (pruneable === 0) {
      setStatusMessage(`Nothing to prune — keeping the newest ${keepCount()} backups`)
      return
    }
    setPruneDialog({ count: pruneable, keep: keepCount() })
  }

  async function confirmPrune() {
    setPruneDialog(null)
    setBusy(true)
    try {
      const removed = await launcherService.pruneBackups(instanceId()!)
      setStatusMessage(`Pruned ${removed.length} old backup${removed.length === 1 ? "" : "s"}`)
      await loadBackups()
    } catch (err) {
      setStatusMessage(`Prune failed: ${err instanceof Error ? err.message : String(err)}`)
    } finally {
      setBusy(false)
    }
  }

  function yank(kind: "world" | "backup") {
    if (kind === "backup") {
      const backup = backups()[backupSelected()]
      if (backup) copyToClipboard(backup.path, "backup path")
      return
    }
    const world = selectedWorld()
    if (world) copyToClipboard(world.path, "world path")
  }

  function openSelectedFolder() {
    const world = selectedWorld()
    if (!world) return
    try {
      openInFileManager(world.path)
      setStatusMessage(`Opened ${world.path}`)
    } catch (err) {
      setStatusMessage(`Could not open folder: ${err instanceof Error ? err.message : String(err)}`)
    }
  }

  // ── Key bindings (OpenTUI keymap) ───────────────────────────────

  // List modes share the instance switcher and Esc semantics.
  useBindings(() => ({
    enabled: allOf(
      when(mode, (m) => m === "worlds" || m === "backups"),
      when(busy, (b) => !b),
    ),
    commands: [
      { name: "worlds.instance.prev", run: () => switchInstance(-1) },
      { name: "worlds.instance.next", run: () => switchInstance(1) },
    ],
    bindings: [
      { key: "left", cmd: "worlds.instance.prev", desc: "instance", hint: HINT.edit },
      { key: "right", cmd: "worlds.instance.next", desc: "instance", hint: HINT.edit },
    ],
  }))

  useBindings(() => ({
    enabled: when(mode, (m) => m === "worlds"),
    commands: [
      { name: "worlds.back", run: () => goBack() },
      { name: "worlds.toggleBackups", run: () => toggleBackups() },
      { name: "worlds.prev", run: () => setSelected((s) => Math.max(0, s - 1)) },
      { name: "worlds.next", run: () => setSelected((s) => Math.min(worlds().length - 1, s + 1)) },
      { name: "worlds.refresh", run: () => void refreshAll() },
      { name: "worlds.backup", run: () => void backupWorldSelected() },
      { name: "worlds.export", run: () => openExport() },
      { name: "worlds.import", run: () => openImport() },
      { name: "worlds.delete", run: () => void deleteSelected() },
      { name: "worlds.duplicate", run: () => openDuplicate() },
      { name: "worlds.open", run: () => openSelectedFolder() },
      { name: "worlds.yank", run: () => yank("world") },
    ],
    bindings: [
      { key: "up", cmd: "worlds.prev", desc: "navigate", hint: HINT.primary },
      { key: "down", cmd: "worlds.next", desc: "navigate", hint: HINT.primary },
      { key: "k", cmd: "worlds.prev" },
      { key: "j", cmd: "worlds.next" },
      { key: "b", cmd: "worlds.backup", desc: "back up", hint: HINT.secondary },
      { key: "e", cmd: "worlds.export", desc: "export", hint: HINT.secondary },
      { key: "i", cmd: "worlds.import", desc: "import", hint: HINT.secondary },
      { key: "x", cmd: "worlds.delete", desc: "delete", hint: HINT.secondary },
      { key: "c", cmd: "worlds.duplicate", desc: "copy to…", hint: HINT.secondary },
      { key: "y", cmd: "worlds.yank", desc: "yank path", hint: HINT.secondary },
      { key: "o", cmd: "worlds.open", desc: "open folder", hint: HINT.secondary },
      { key: "v", cmd: "worlds.toggleBackups", desc: "backups", hint: HINT.edit },
      { key: "r", cmd: "worlds.refresh", desc: "rescan", hint: HINT.edit },
      { key: "escape", cmd: "worlds.back", desc: "back", hint: HINT.cancel },
    ],
  }))

  useBindings(() => ({
    enabled: when(mode, (m) => m === "backups"),
    commands: [
      { name: "worlds.backups.back", run: () => setMode("worlds") },
      { name: "worlds.backups.prev", run: () => setBackupSelected((s) => Math.max(0, s - 1)) },
      {
        name: "worlds.backups.next",
        run: () => setBackupSelected((s) => Math.min(backups().length - 1, s + 1)),
      },
      { name: "worlds.backups.restore", run: () => void restoreSelectedBackup() },
      { name: "worlds.backups.prune", run: () => openPrune() },
      { name: "worlds.backups.yank", run: () => yank("backup") },
    ],
    bindings: [
      { key: "up", cmd: "worlds.backups.prev", desc: "navigate", hint: HINT.primary },
      { key: "down", cmd: "worlds.backups.next", desc: "navigate", hint: HINT.primary },
      { key: "k", cmd: "worlds.backups.prev" },
      { key: "j", cmd: "worlds.backups.next" },
      { key: "return", cmd: "worlds.backups.restore", desc: "restore", hint: HINT.secondary },
      { key: "p", cmd: "worlds.backups.prune", desc: "prune", hint: HINT.secondary },
      { key: "y", cmd: "worlds.backups.yank", desc: "yank path", hint: HINT.secondary },
      { key: "v", cmd: "worlds.backups.back", desc: "worlds", hint: HINT.edit },
      { key: "escape", cmd: "worlds.backups.back", desc: "back", hint: HINT.cancel },
    ],
  }))

  useBindings(() => ({
    enabled: when(mode, (m) => m === "export-input" || m === "import-input"),
    commands: [{ name: "worlds.cancelInput", run: () => closeInput() }],
    bindings: [{ key: "escape", cmd: "worlds.cancelInput", desc: "cancel", hint: HINT.cancel }],
  }))

  useBindings(() => ({
    enabled: when(mode, (m) => m === "duplicate"),
    commands: [
      { name: "worlds.duplicate.cancel", run: () => setMode("worlds") },
      {
        name: "worlds.duplicate.prev",
        run: () => setDuplicateSelected((s) => Math.max(0, s - 1)),
      },
      {
        name: "worlds.duplicate.next",
        run: () => setDuplicateSelected((s) => Math.min(duplicateTargets().length - 1, s + 1)),
      },
      { name: "worlds.duplicate.confirm", run: () => void confirmDuplicate() },
    ],
    bindings: [
      { key: "up", cmd: "worlds.duplicate.prev", desc: "target", hint: HINT.primary },
      { key: "down", cmd: "worlds.duplicate.next", desc: "target", hint: HINT.primary },
      { key: "k", cmd: "worlds.duplicate.prev" },
      { key: "j", cmd: "worlds.duplicate.next" },
      { key: "return", cmd: "worlds.duplicate.confirm", desc: "copy", hint: HINT.secondary },
      { key: "escape", cmd: "worlds.duplicate.cancel", desc: "cancel", hint: HINT.cancel },
    ],
  }))

  // Prune confirmation dialog owns Enter/Esc while it is open.
  useBindings(() => ({
    enabled: when(pruneDialog, (open) => open !== null),
    commands: [
      { name: "worlds.prune.confirm", run: () => void confirmPrune() },
      { name: "worlds.prune.cancel", run: () => setPruneDialog(null) },
    ],
    bindings: [
      { key: "return", cmd: "worlds.prune.confirm", desc: "confirm", hint: HINT.secondary },
      { key: "escape", cmd: "worlds.prune.cancel", desc: "cancel", hint: HINT.cancel },
    ],
  }))

  const totalSize = createMemo(() => {
    const measured = worlds().filter((w) => w.sizeBytes !== undefined)
    if (measured.length === 0) return undefined
    return measured.reduce((sum, w) => sum + (w.sizeBytes ?? 0), 0)
  })

  return (
    <box flexDirection="column" flexGrow={1}>
      <Centered maxWidth={96}>
        <box flexDirection="row" justifyContent="center" flexShrink={0}>
          <text fg="#cdd6f4" attributes={2}>
            Worlds{mode() === "backups" ? " — backups" : mode() === "duplicate" ? " — copy to instance" : ""}
          </text>
        </box>
        <Show
          when={instance()}
          fallback={
            <text fg="#6c7086" flexShrink={0}>
              No instance selected — create one first (Instances screen, 'c').
            </text>
          }
        >
          <text fg="#6c7086" flexShrink={0}>
            Instance: {instance()!.name} · {instance()!.versionId} ·{" "}
            {worlds().length} world{worlds().length === 1 ? "" : "s"}
            {totalSize() !== undefined ? ` · ${formatSize(totalSize())} measured` : ""}
            {running() ? " · ⏳ instance running — world actions disabled" : ""}
          </text>
        </Show>
        <box height={1} flexShrink={0} />
        <Switch>
          <Match when={mode() === "export-input"}>
            <box flexDirection="column">
              <text fg="#a6e3a1">
                Export "{selectedWorld()?.name ?? "world"}" to:
              </text>
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
                Default: {defaultExportPath(selectedWorld()?.folder ?? "world")}
              </text>
              <text fg="#6c7086">Free space and overwrite are checked before writing.</text>
            </box>
          </Match>

          <Match when={mode() === "import-input"}>
            <box flexDirection="column">
              <text fg="#a6e3a1">Import a world zip into {instance()?.name ?? "this instance"}:</text>
              <box flexDirection="row">
                <text fg="#89b4fa">File: </text>
                <input
                  flexGrow={1}
                  placeholder="/path/to/world.zip — Enter imports · Esc cancels"
                  focused
                  onInput={(value) => {
                    if (typeof value === "string") importValue = value
                  }}
                  onSubmit={(value) =>
                    void submitImport(typeof value === "string" && value.length > 0 ? value : importValue)
                  }
                />
              </box>
              <text fg="#6c7086">
                A version mismatch is a warning, never a block — Minecraft decides how to upgrade.
              </text>
            </box>
          </Match>

          <Match when={mode() === "duplicate"}>
            <box flexDirection="column">
              <text fg="#cdd6f4">Copy "{selectedWorld()?.name ?? "world"}" to:</text>
              <Show
                when={duplicateTargets().length > 0}
                fallback={<text fg="#6c7086">No other instances to copy into.</text>}
              >
                <scrollbox ref={setBackupListRef} height={listHeight(LIST_CHROME)} scrollbarOptions={{ showArrows: false }}>
                  <For each={duplicateTargets()}>
                    {(target, i) => (
                      <box id={`backup-row-${i()}`} flexDirection="row" height={1}>
                        <text
                          fg={duplicateSelected() === i() ? "#89b4fa" : "#cdd6f4"}
                          attributes={duplicateSelected() === i() ? 1 : 0}
                        >
                          {duplicateSelected() === i() ? "▸ " : "  "}
                          {target.name}
                        </text>
                        <text fg="#585b70">
                          {" "}
                          {target.versionId}
                          {targetFree()[target.id] !== undefined
                            ? ` · ${formatSize(targetFree()[target.id])} free`
                            : ""}
                        </text>
                      </box>
                    )}
                  </For>
                </scrollbox>
              </Show>
            </box>
          </Match>

          <Match when={mode() === "backups"}>
            <Show
              when={backups().length > 0}
              fallback={
                <text fg="#6c7086" flexShrink={0}>
                  {backupsLoading() ? "Loading backups…" : "No backups yet — press 'v' then 'b' on a world."}
                </text>
              }
            >
              <scrollbox ref={setBackupListRef} height={listHeight(LIST_CHROME)} scrollbarOptions={{ showArrows: false }}>
                <For each={backups()}>
                  {(backup, i) => {
                    const isSafety = () => backup.fileName.includes("-pre-restore-")
                    const isPending = () => pendingRestore() === backup.fileName
                    return (
                      <box id={`backup-row-${i()}`} flexDirection="column">
                        <box flexDirection="row" height={1}>
                          <text
                            fg={backupSelected() === i() ? "#89b4fa" : isSafety() ? "#f9e2af" : "#cdd6f4"}
                            attributes={backupSelected() === i() ? 1 : 0}
                          >
                            {backupSelected() === i() ? "▸ " : "  "}
                            {backup.worldName}
                            {isSafety() ? " (pre-restore safety)" : ""}
                          </text>
                          <text fg="#585b70">
                            {" "}
                            {formatSize(backup.bytes)}
                            {backup.worldVersionName ? ` · ${backup.worldVersionName}` : ""} ·{" "}
                            {relativeTime(backup.createdAt)}
                            {isPending() ? "   ⏎ press Enter again to restore" : ""}
                          </text>
                        </box>
                        <box flexDirection="row" height={1}>
                          <text fg="#585b70">  {truncate(backup.path, contentWidth() - 2)}</text>
                        </box>
                      </box>
                    )
                  }}
                </For>
              </scrollbox>
            </Show>
          </Match>

          <Match when={true}>
            <Show
              when={error()}
              fallback={
                <Show
                  when={worlds().length > 0}
                  fallback={
                    <text fg="#6c7086" flexShrink={0}>
                      {loading()
                        ? "Scanning worlds…"
                        : "No worlds yet — press 'i' to import a world zip."}
                    </text>
                  }
                >
                  <scrollbox ref={setWorldListRef} height={listHeight(WORLDS_CHROME)} scrollbarOptions={{ showArrows: false }}>
                    <For each={worlds()}>
                      {(world, i) => {
                        const mismatch = () => versionMismatch(world)
                        const damaged = () => world.damage !== "ok"
                        const isPending = () => pendingDelete() === world.folder
                        return (
                          <box id={`world-row-${i()}`} flexDirection="column">
                            <box flexDirection="row" height={1}>
                              <text
                                fg={selected() === i() ? "#89b4fa" : damaged() ? "#f9e2af" : "#cdd6f4"}
                                attributes={selected() === i() ? 1 : 0}
                              >
                                {selected() === i() ? "▸ " : "  "}
                                {world.name}
                              </text>
                              <text fg="#585b70"> · {formatSize(world.sizeBytes)}</text>
                              <Show when={mismatch()}>
                                <text fg="#f9e2af">
                                  {" "}
                                  ⚠ world {world.versionName} · instance {instance()?.versionId}
                                </text>
                              </Show>
                              <Show when={damaged()}>
                                <text fg="#f38ba8"> ⚠ {world.damage === "missing-level-dat" ? "no level.dat" : "damaged"}</text>
                              </Show>
                              <Show when={isPending()}>
                                <text fg="#f38ba8"> — press 'x' again to delete</text>
                              </Show>
                            </box>
                            <box flexDirection="row" height={1}>
                              <text fg="#585b70">
                                {"  "}
                                {[
                                  world.gameType,
                                  world.difficulty,
                                  world.hardcore ? "hardcore" : undefined,
                                  world.cheats ? "cheats" : undefined,
                                  relativeTime(world.lastPlayed),
                                ]
                                  .filter(Boolean)
                                  .join(" · ")}
                              </text>
                            </box>
                          </box>
                        )
                      }}
                    </For>
                  </scrollbox>
                </Show>
              }
            >
              <text fg="#f38ba8" flexShrink={0}>Failed to scan worlds: {error()}</text>
            </Show>
          </Match>
        </Switch>

        {/* Details pane — fixed height so the list geometry never shifts. */}
        <Show when={mode() === "worlds"}>
          <box flexDirection="column" height={6} flexShrink={0}>
            <Show when={selectedWorld()}>
              <text fg="#a6adc8" flexShrink={0}>
                Folder: {selectedWorld()!.folder}
              </text>
              <text fg="#585b70" flexShrink={0}>  {truncate(selectedWorld()!.path)}</text>
              <text fg="#a6adc8" flexShrink={0}>
                Playtime {formatPlaytime(selectedStats()?.playTimeTicks)} · deaths{" "}
                {selectedStats()?.deaths ?? "—"} · mob kills {selectedStats()?.mobKills ?? "—"} · walked{" "}
                {formatDistance(selectedStats()?.walkOneCm)}
              </text>
              <text fg="#a6adc8" flexShrink={0}>
                Advancements {selectedStats()?.advancementsDone ?? "—"}/{selectedStats()?.advancementsTotal ?? "—"} ·
                players {selectedStats()?.players ?? "—"} · {selectedWorld()!.fileCount ?? "…"} files ·{" "}
                {formatSize(selectedWorld()!.sizeBytes)}
              </text>
              <text fg="#585b70" flexShrink={0}>
                {truncate(
                  `Backup path: ${launcherService.worldsBackupsDir(instanceId() ?? "")}/${slugify(selectedWorld()!.folder)}-<timestamp>.zip`,
                )}
              </text>
              <Show
                when={versionMismatch(selectedWorld()) || running()}
                fallback={<text fg="#585b70" flexShrink={0}> Press 'b' to back up · 'v' for backups</text>}
              >
                <text fg="#f9e2af" flexShrink={0}>
                  {running()
                    ? " ⏳ instance running — backup/delete/restore/copy are disabled until it stops"
                    : ` ⚠ saved by ${selectedWorld()!.versionName}; ${instance()?.versionId} will upgrade it (back it up first)`}
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
            : mode() === "import-input"
              ? [["type", "path to .zip"], ["Enter", "import"]]
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
    </box>
  )
}
