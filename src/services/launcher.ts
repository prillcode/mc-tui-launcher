import * as fs from "node:fs/promises"
import {
  Launcher,
  FileLogger,
  getLauncherPaths,
  setLogger,
  getSettings,
  setSetting as coreSetSetting,
  type Logger,
  type LogLevel,
  type MinecraftProfile,
  type Instance,
  type VersionSummary,
  type StoredSession,
  type ModrinthProject,
  type ServerPingResult,
  type LauncherSettings,
  type DownloadProgress,
} from "@prillcode/mc-launcher-core"
import {
  appendLog,
  setInstances,
  setVersions,
  setProgress,
  setBusy,
  setStatusMessage,
  setProfile,
} from "../app/state"
import { createCredentialStore } from "./credentials"
import { appConfig } from "./config"
import { setInstanceRunning } from "../app/state"

/**
 * Tees core log output into a file under the data root and an
 * in-memory ring buffer rendered by the Logs screen.
 */
class TeeLogger implements Logger {
  private fileLogger = new FileLogger(getLauncherPaths().logs)

  private write(level: LogLevel, message: string, meta?: Record<string, unknown>): void {
    const metaStr = meta && Object.keys(meta).length > 0 ? ` ${JSON.stringify(meta)}` : ""
    appendLog(`[${level}] ${message}${metaStr}`)
    this.fileLogger[level](message, meta)
  }

  error(message: string, meta?: Record<string, unknown>): void {
    this.write("error", message, meta)
  }
  warn(message: string, meta?: Record<string, unknown>): void {
    this.write("warn", message, meta)
  }
  info(message: string, meta?: Record<string, unknown>): void {
    this.write("info", message, meta)
  }
  debug(message: string, meta?: Record<string, unknown>): void {
    this.write("debug", message, meta)
  }
}

/**
 * The one place the TUI talks to @prillcode/mc-launcher-core.
 *
 * Adapts core callbacks into Solid signal updates and exposes small
 * async operations screens can call. Keeps launcher logic out of view
 * markup entirely.
 */
class LauncherService {
  readonly core: Launcher

  constructor() {
    this.core = new Launcher({
      msClientId: appConfig.msClientId,
      credentialStore: createCredentialStore(),
      branding: { name: "bhmc-launcher", version: appConfig.version },
    })
    setLogger(new TeeLogger())
  }

  async init(): Promise<void> {
    await fs.mkdir(getLauncherPaths().logs, { recursive: true })
    await fs.mkdir(getLauncherPaths().temp, { recursive: true })
    await this.core.init()
    await this.refreshInstances()
    const stored = await this.core.auth.getStoredProfile()
    if (stored) setProfile(stored)
  }

  // ── Auth ──────────────────────────────────────────────────────

  /** Start the Microsoft device-code flow; returns what to display. */
  startLogin() {
    return this.core.auth.startLogin()
  }

  /** Await the user finishing browser login; persists the session. */
  completeLogin(): Promise<MinecraftProfile> {
    return this.core.auth.completeLogin()
  }

  getValidSession(): Promise<StoredSession | null> {
    return this.core.auth.getValidSession()
  }

  listMods(instanceId: string) {
    return this.core.listMods(instanceId)
  }

  searchMods(query: string, instance: Instance) {
    return this.core.mods.searchMods(query, instance)
  }

  /** Install a Modrinth search hit plus its required dependencies. */
  installModFromSearch(instanceId: string, hit: Pick<ModrinthProject, "slug" | "title">): Promise<string[]> {
    return this.core.mods.installFromSearch(instanceId, hit)
  }

  async removeMod(instanceId: string, projectId: string): Promise<void> {
    await this.core.mods.removeMod(instanceId, projectId)
  }

  // ── Shader packs ──────────────────────────────────────────────

  searchShaders(query: string, instance: Instance) {
    return this.core.mods.searchShaders(query, instance)
  }

  listShaders(instanceId: string) {
    return this.core.mods.listShaders(instanceId)
  }

  /** Resolve a Modrinth shader hit to its newest version id compatible
   *  with the instance's game version (mirrors ModService.installFromSearch). */
  async getShaderVersionId(instance: Instance, slug: string): Promise<string> {
    const versions = await this.core.modrinth.getVersions(slug, {
      gameVersions: [instance.versionId],
    })
    if (versions.length === 0) {
      throw new Error(`No shader version available for Minecraft ${instance.versionId}`)
    }
    return versions[0]!.id
  }

  installShaderFromModrinth(
    instanceId: string,
    versionId: string,
    onProgress?: (progress: DownloadProgress) => void,
  ) {
    return this.core.mods.installShaderFromModrinth(instanceId, versionId, onProgress)
  }

  removeShader(instanceId: string, fileName: string): Promise<void> {
    return this.core.mods.removeShader(instanceId, fileName)
  }

  /** Import a local .jar (custom/in-development mod) into an instance. */
  importModFile(instanceId: string, jarPath: string) {
    return this.core.mods.importModFile(instanceId, jarPath)
  }

  isInstanceRunning(instanceId: string): boolean {
    return this.core.isInstanceRunning(instanceId)
  }

  /**
   * Minecraft Server List Ping — resolves with motd/players/version or
   * rejects when the server is unreachable. The core applies a 5s
   * socket timeout; callers should still guard with their own race so
   * the UI can never hang.
   */
  pingServer(host: string, port: number): Promise<ServerPingResult> {
    return this.core.pingServer(host, port)
  }

  closeInstance(instanceId: string): void {
    this.core.closeInstance(instanceId)
  }

  async toggleMod(instanceId: string, projectId: string): Promise<boolean> {
    const result = await this.core.mods.toggleMod(instanceId, projectId)
    return result.enabled
  }

  getSettings() {
    return getSettings()
  }

  /** Persist a single launcher setting (writes through the core's
   *  lazy-loading settings store — no initSettings call needed). */
  setSetting<K extends keyof LauncherSettings>(key: K, value: LauncherSettings[K]): Promise<void> {
    return coreSetSetting(key, value)
  }

  async logout(): Promise<void> {
    await this.core.auth.logout()
    setProfile(null)
  }

  // ── Instances / versions ──────────────────────────────────────

  async refreshInstances(): Promise<void> {
    setInstances(await this.core.instances.list())
  }

  async refreshVersions(): Promise<VersionSummary[]> {
    const list = await this.core.versions.getVersionList()
    setVersions(list.versions)
    return list.versions
  }

  async createVanillaInstance(name: string, versionId: string): Promise<Instance> {
    return this.createInstance(name, versionId, "vanilla")
  }

  async createInstance(name: string, versionId: string, modLoader: "vanilla" | "fabric"): Promise<Instance> {
    const instance = await this.core.instances.create({ name, versionId, modLoader })
    await this.refreshInstances()
    return instance
  }

  /** Delete an instance and remove its game directory. */
  async deleteInstance(id: string): Promise<void> {
    await this.core.instances.delete(id)
    await this.refreshInstances()
  }

  async renameInstance(instanceId: string, name: string): Promise<void> {
    await this.core.instances.update(instanceId, { name })
    await this.refreshInstances()
  }

  /** Switch an instance's mod loader. Fabric libraries are fetched
   *  automatically at the next launch. */
  async setInstanceModLoader(instanceId: string, modLoader: "vanilla" | "fabric"): Promise<void> {
    await this.core.instances.update(instanceId, { modLoader })
    await this.refreshInstances()
  }

  /** Auto-join a server on launch (quickPlayMultiplayer). Port is
   *  optional — the game applies the vanilla default (25565). */
  async setInstanceAutoConnect(instanceId: string, host: string, port?: number): Promise<void> {
    await this.core.instances.update(instanceId, {
      serverAutoConnect: port !== undefined ? { host, port } : { host },
    })
    await this.refreshInstances()
  }

  async clearInstanceAutoConnect(instanceId: string): Promise<void> {
    await this.core.instances.update(instanceId, { serverAutoConnect: undefined })
    await this.refreshInstances()
  }

  /** Set an instance's min/max heap in MB. These are consumed at launch
   *  by the core's buildJvmArgs (-Xms/-Xmx). */
  async setInstanceMemory(instanceId: string, min: number, max: number): Promise<void> {
    await this.core.instances.update(instanceId, { minMemoryMb: min, maxMemoryMb: max })
    await this.refreshInstances()
  }

  // ── MVP launch chain ──────────────────────────────────────────

  /**
   * Ensure files + Java for an instance, then launch it with the
   * stored session. Throws with a user-presentable message on failure.
   */
  async launchInstance(instance: Instance): Promise<number | undefined> {
    setBusy(true)
    try {
      setStatusMessage("Checking session…")
      if (this.core.isInstanceRunning(instance.id)) {
        throw new Error("Minecraft is already running for this instance")
      }
      const session = await this.getValidSession()
      if (!session) {
        throw new Error("Not signed in — press 'a' to log in")
      }
      setProfile(session.profile)

      setStatusMessage(`Fetching version ${instance.versionId}…`)
      const version = await this.core.versions.getVersion(instance.versionId)

      setStatusMessage(`Verifying files for ${version.id}…`)
      await this.core.ensureVersionFiles(version, (p) => setProgress(p))
      setProgress(null)

      const settings = await getSettings()
      if (!instance.javaPath && !settings.javaPath) {
        const component = version.javaVersion?.component ?? "java-runtime-delta"
        setStatusMessage(`Provisioning Java runtime (${component})…`)
        await this.core.ensureJava(component, (p) => setProgress(p))
        setProgress(null)
      }

      setStatusMessage("Launching Minecraft…")
      const child = await this.core.launchInstance({
        instanceId: instance.id,
        accessToken: session.minecraft.accessToken,
        profile: { id: session.profile.id, name: session.profile.name },
        userType: session.authMode === "offline" ? "legacy" : "msa",
        globalJavaPath: settings.javaPath || undefined,
        onProgress: (p) => setProgress(p),
        onStdout: (data) => appendLog(`[MC] ${data.trimEnd()}`),
        onStderr: (data) => appendLog(`[MC] ${data.trimEnd()}`),
        onExit: (code) => {
          setInstanceRunning(instance.id, false)
          appendLog(`Minecraft exited with code ${code}`)
          setStatusMessage(`Minecraft exited (code ${code})`)
        },
      })

      setInstanceRunning(instance.id, true)
      setStatusMessage(`Minecraft launched (pid ${child.pid})`)
      await this.core.instances.markPlayed(instance.id)
      return child.pid
    } finally {
      setBusy(false)
    }
  }
}

export const launcherService = new LauncherService()
