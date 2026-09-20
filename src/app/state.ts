import { batch, createSignal } from "solid-js"
import type {
  Instance,
  MinecraftProfile,
  TaskProgress,
  VersionSummary,
} from "@prillcode/mc-launcher-core"

/**
 * Central reactive application state.
 *
 * Signals live here (not inside components) so screens and services can
 * share one source of truth. Services adapt core events into these
 * signals; screens read them and call service functions.
 */

// ── Navigation ──────────────────────────────────────────────────

export type ScreenName =
  | "home"
  | "login"
  | "instances"
  | "instance-detail"
  | "mods"
  | "worlds"
  | "servers"
  | "settings"
  | "logs"
  | "help"

const [screen, setScreen] = createSignal<ScreenName>("home")
const [previousScreen, setPreviousScreen] = createSignal<ScreenName | null>(null)
const [selectedInstanceId, setSelectedInstanceId] = createSignal<string | null>(null)

export { screen, selectedInstanceId }

export function navigate(to: ScreenName, instanceId?: string): void {
  // Batch: without it `setScreen` renders the next screen synchronously, so a
  // screen that reads `selectedInstanceId()` in onMount would see the old id.
  batch(() => {
    setPreviousScreen(screen())
    setScreen(to)
    if (instanceId !== undefined) setSelectedInstanceId(instanceId)
  })
}

export function goBack(): void {
  const target = previousScreen() ?? "home"
  setPreviousScreen(null)
  setScreen(target)
}

// ── Auth ────────────────────────────────────────────────────────

export type LoginStatus =
  | "idle"
  | "requesting-code"
  | "awaiting-user"
  | "completing"
  | "success"
  | "error"

const [loginStatus, setLoginStatus] = createSignal<LoginStatus>("idle")
const [deviceCode, setDeviceCode] = createSignal<{
  userCode: string
  verificationUri: string
  expiresIn: number
} | null>(null)
const [loginError, setLoginError] = createSignal<string | null>(null)
const [profile, setProfile] = createSignal<MinecraftProfile | null>(null)

export {
  loginStatus,
  deviceCode,
  loginError,
  profile,
  setLoginStatus,
  setDeviceCode,
  setLoginError,
  setProfile,
}

// ── Data ────────────────────────────────────────────────────────

const [instances, setInstances] = createSignal<Instance[]>([])
const [versions, setVersions] = createSignal<VersionSummary[]>([])
export { instances, versions, setInstances, setVersions }

// ── Status / progress / busy ────────────────────────────────────

const [statusMessage, setStatusMessage] = createSignal("Welcome to Blockhaven MC — press ? for help")
const [busy, setBusy] = createSignal(false)
// One progress signal for every core task: DownloadProgress and WorldProgress
// share {phase, current, total, fileName, bytesPerSecond}.
const [progress, setProgress] = createSignal<TaskProgress | null>(null)
export { statusMessage, busy, progress, setStatusMessage, setBusy, setProgress }

// ── Text input capture ──────────────────────────────────────────

/**
 * True while a screen editor input (search box, server host field) is
 * open. The global key handler must ignore keys while this is set so
 * typing text (including 'q' and '?') does not trigger navigation or
 * quit.
 */
const [textInputActive, setTextInputActive] = createSignal(false)
export { textInputActive, setTextInputActive }

// ── Mods screen context ─────────────────────────────────────────

/**
 * Set when opening the Mods screen from an instance detail view so the
 * Mods screen shows that instance first. Cleared after consumption.
 */
const [modsFocusInstanceId, setModsFocusInstanceId] = createSignal<string | null>(null)
export { modsFocusInstanceId, setModsFocusInstanceId }

// ── Worlds screen context ───────────────────────────────────────

/**
 * Set when opening the Worlds screen from an instance detail view so the
 * screen shows that instance first. Cleared after consumption.
 */
const [worldsFocusInstanceId, setWorldsFocusInstanceId] = createSignal<string | null>(null)
export { worldsFocusInstanceId, setWorldsFocusInstanceId }

/**
 * Bumped to force the Worlds screen to rescan the current instance (e.g.
 * after another screen changed something). Screens read it inside their
 * load effect so a bump re-runs the scan.
 */
const [worldsRefreshToken, setWorldsRefreshToken] = createSignal(0)
export { worldsRefreshToken }
export function bumpWorldsRefresh(): void {
  setWorldsRefreshToken((n) => n + 1)
}

// ── Servers screen context ──────────────────────────────────────

/**
 * Set when opening the Servers screen from elsewhere so it focuses a
 * specific server first. Cleared after consumption.
 */
const [serverFocusId, setServerFocusId] = createSignal<string | null>(null)
export { serverFocusId, setServerFocusId }

/**
 * Bumped to force the Servers screen to rescan its records and worlds
 * (e.g. after another screen changed something).
 */
const [serversRefreshToken, setServersRefreshToken] = createSignal(0)
export { serversRefreshToken }
export function bumpServersRefresh(): void {
  setServersRefreshToken((n) => n + 1)
}

// ── Running game processes ──────────────────────────────────────

/**
 * Ids of instances with a live Minecraft child process (same session
 * only — the launcher cannot know about clients started before it).
 */
const [runningInstanceIds, setRunningInstanceIds] = createSignal<string[]>([])
export { runningInstanceIds }

export function setInstanceRunning(instanceId: string, running: boolean): void {
  setRunningInstanceIds((prev) =>
    running ? [...new Set([...prev, instanceId])] : prev.filter((id) => id !== instanceId),
  )
}

// ── Log ring buffer (rendered by the Logs screen) ───────────────

const LOG_BUFFER_LIMIT = 500
const [logLines, setLogLines] = createSignal<string[]>([])
export function appendLog(line: string): void {
  setLogLines((prev) => {
    const next = [...prev, line]
    return next.length > LOG_BUFFER_LIMIT ? next.slice(next.length - LOG_BUFFER_LIMIT) : next
  })
}

export { logLines }
