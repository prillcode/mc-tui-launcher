import { Show } from "solid-js"
import type { BackupEntry, WorldStats, WorldSummary } from "@prillcode/mc-launcher-core"

/**
 * Presentational pieces shared by the client Worlds screen and the
 * dedicated-server Servers screen, plus the small formatting helpers they
 * use. Keeping them here means the two screens show rows, details and
 * backups the same way without duplicating markup.
 *
 * The `truncate` function is a prop so each screen keeps its own width
 * logic; scrollboxes and key handling stay in the screens.
 */

export function formatSize(bytes: number | undefined): string {
  if (bytes === undefined) return "…"
  if (bytes >= 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024 * 1024)).toFixed(1)} GB`
  if (bytes >= 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
  if (bytes >= 1024) return `${(bytes / 1024).toFixed(0)} KB`
  return `${bytes} B`
}

export function relativeTime(ms: number | undefined): string {
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

export function formatPlaytime(ticks: number | undefined): string {
  if (!ticks) return "—"
  const totalMinutes = Math.floor(ticks / 20 / 60)
  const hours = Math.floor(totalMinutes / 60)
  const minutes = totalMinutes % 60
  return hours > 0 ? `${hours}h ${minutes}m` : `${minutes}m`
}

export function formatDistance(cm: number | undefined): string {
  if (!cm) return "—"
  const km = cm / 100000
  return km >= 1 ? `${km.toFixed(1)} km` : `${Math.round(cm / 100)} m`
}

export function slugify(name: string): string {
  const slug = name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
  return slug || "world"
}

export function timestamp(date = new Date()): string {
  const pad = (n: number) => String(n).padStart(2, "0")
  return (
    `${date.getFullYear()}${pad(date.getMonth() + 1)}${pad(date.getDate())}` +
    `-${pad(date.getHours())}${pad(date.getMinutes())}${pad(date.getSeconds())}`
  )
}

/** One world list row: marker, name, size, version mismatch, damage. */
export function WorldRow(props: {
  id: string
  world: WorldSummary
  selected: boolean
  versionMismatch: boolean
  /** The instance's version id, shown in the mismatch warning. */
  instanceVersionId?: string
  pendingDelete: boolean
}) {
  const damaged = () => props.world.damage !== "ok"
  return (
    <box id={props.id} flexDirection="column">
      <box flexDirection="row" height={1}>
        <text
          fg={props.selected ? "#89b4fa" : damaged() ? "#f9e2af" : "#cdd6f4"}
          attributes={props.selected ? 1 : 0}
        >
          {props.selected ? "▸ " : "  "}
          {props.world.name}
        </text>
        <text fg="#585b70"> · {formatSize(props.world.sizeBytes)}</text>
        <Show when={props.versionMismatch}>
          <text fg="#f9e2af">
            {" "}
            ⚠ world {props.world.versionName} · instance {props.instanceVersionId}
          </text>
        </Show>
        <Show when={damaged()}>
          <text fg="#f38ba8">
            {" "}
            ⚠ {props.world.damage === "missing-level-dat" ? "no level.dat" : "damaged"}
          </text>
        </Show>
        <Show when={props.pendingDelete}>
          <text fg="#f38ba8"> — press 'x' again to delete</text>
        </Show>
      </box>
      <box flexDirection="row" height={1}>
        <text fg="#585b70">
          {"  "}
          {[
            props.world.gameType,
            props.world.difficulty,
            props.world.hardcore ? "hardcore" : undefined,
            props.world.cheats ? "cheats" : undefined,
            relativeTime(props.world.lastPlayed),
          ]
            .filter(Boolean)
            .join(" · ")}
        </text>
      </box>
    </box>
  )
}

/**
 * Fixed 6-line world details pane, so the list geometry never shifts.
 * Rendered even when there is no world (an empty 6-row block).
 */
export function WorldDetails(props: {
  world: WorldSummary | undefined
  stats: WorldStats | null
  versionMismatch: boolean
  instanceVersionId?: string
  /** Directory the 'b' key writes into (shown with the expected file name). */
  backupsDir: string
  /** Why mutating actions are disabled, if they are. */
  running: boolean
  truncate: (value: string, max?: number) => string
}) {
  return (
    <box flexDirection="column" height={6} flexShrink={0}>
      <Show when={props.world}>
        <text fg="#a6adc8" flexShrink={0}>
          Folder: {props.world!.folder}
        </text>
        <text fg="#585b70" flexShrink={0}>
          {"  "}
          {props.truncate(props.world!.path)}
        </text>
        <text fg="#a6adc8" flexShrink={0}>
          Playtime {formatPlaytime(props.stats?.playTimeTicks)} · deaths {props.stats?.deaths ?? "—"} · mob
          kills {props.stats?.mobKills ?? "—"} · walked {formatDistance(props.stats?.walkOneCm)}
        </text>
        <text fg="#a6adc8" flexShrink={0}>
          Advancements {props.stats?.advancementsDone ?? "—"}/{props.stats?.advancementsTotal ?? "—"} ·
          players {props.stats?.players ?? "—"} · {props.world!.fileCount ?? "…"} files ·{" "}
          {formatSize(props.world!.sizeBytes)}
        </text>
        <text fg="#585b70" flexShrink={0}>
          {props.truncate(
            `Backup path: ${props.backupsDir}/${slugify(props.world!.folder)}-<timestamp>.zip`,
          )}
        </text>
        <Show
          when={props.versionMismatch || props.running}
          fallback={
            <text fg="#585b70" flexShrink={0}>
              {" "}
              Press 'b' to back up · 'v' for backups
            </text>
          }
        >
          <text fg="#f9e2af" flexShrink={0}>
            {props.running
              ? " ⏳ instance running — backup/delete/restore/copy are disabled until it stops"
              : ` ⚠ saved by ${props.world!.versionName}; ${props.instanceVersionId} will upgrade it (back it up first)`}
          </text>
        </Show>
      </Show>
    </box>
  )
}

/** One backup row: name + safety marker, size/version/date, absolute path. */
export function BackupRow(props: {
  id: string
  backup: BackupEntry
  selected: boolean
  pendingRestore: boolean
  contentWidth: number
  truncate: (value: string, max?: number) => string
}) {
  const isSafety = () => props.backup.fileName.includes("-pre-restore-")
  return (
    <box id={props.id} flexDirection="column">
      <box flexDirection="row" height={1}>
        <text
          fg={props.selected ? "#89b4fa" : isSafety() ? "#f9e2af" : "#cdd6f4"}
          attributes={props.selected ? 1 : 0}
        >
          {props.selected ? "▸ " : "  "}
          {props.backup.worldName}
          {isSafety() ? " (pre-restore safety)" : ""}
        </text>
        <text fg="#585b70">
          {" "}
          {formatSize(props.backup.bytes)}
          {props.backup.worldVersionName ? ` · ${props.backup.worldVersionName}` : ""} ·{" "}
          {relativeTime(props.backup.createdAt)}
          {props.pendingRestore ? "   ⏎ press Enter again to restore" : ""}
        </text>
      </box>
      <box flexDirection="row" height={1}>
        <text fg="#585b70">  {props.truncate(props.backup.path, props.contentWidth - 2)}</text>
      </box>
    </box>
  )
}
