import { createSignal } from "solid-js"
import type { DownloadProgress, Instance, MinecraftProfile, VersionSummary } from "@prillcode/mc-launcher-core"

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
  | "settings"
  | "logs"
  | "help"

const [screen, setScreen] = createSignal<ScreenName>("home")
const [previousScreen, setPreviousScreen] = createSignal<ScreenName | null>(null)
const [selectedInstanceId, setSelectedInstanceId] = createSignal<string | null>(null)

export { screen, selectedInstanceId }

export function navigate(to: ScreenName, instanceId?: string): void {
  setPreviousScreen(screen())
  setScreen(to)
  if (instanceId !== undefined) setSelectedInstanceId(instanceId)
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

const [statusMessage, setStatusMessage] = createSignal("Welcome to McTUI Launcher — press ? for help")
const [busy, setBusy] = createSignal(false)
const [progress, setProgress] = createSignal<DownloadProgress | null>(null)
export { statusMessage, busy, progress, setStatusMessage, setBusy, setProgress }

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
