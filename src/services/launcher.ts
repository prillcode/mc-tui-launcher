import * as fs from "node:fs/promises"
import * as path from "node:path"
import {
  Launcher,
  FileLogger,
  getLauncherPaths,
  setLogger,
  getSettings,
  setSetting as coreSetSetting,
  inspectZip,
  readZipLevelDat,
  availableBytes,
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
  type WorldProgress,
  type WorldSummary,
  type WorldStats,
  type BackupEntry,
  type ServerRecord,
  type ServerSource,
  type ServerProgress,
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

/** Compact byte formatting for status messages. */
function formatBytes(bytes: number): string {
  if (bytes >= 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024 * 1024)).toFixed(1)} GB`
  if (bytes >= 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
  if (bytes >= 1024) return `${(bytes / 1024).toFixed(0)} KB`
  return `${bytes} B`
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

  // ── Worlds ────────────────────────────────────────────────────

  listWorlds(instanceId: string): Promise<WorldSummary[]> {
    return this.core.worlds.listWorlds(instanceId)
  }

  measureWorld(instanceId: string, folder: string) {
    return this.core.worlds.measureWorld(instanceId, folder)
  }

  readWorldStats(instanceId: string, folder: string): Promise<WorldStats> {
    return this.core.worlds.readStats(instanceId, folder)
  }

  /** Back up a world, honouring the configured retention count. */
  async backupWorld(
    instanceId: string,
    folder: string,
    onProgress?: (progress: WorldProgress) => void,
  ): Promise<BackupEntry> {
    const settings = await getSettings()
    return this.core.worlds.backupWorld(instanceId, folder, {
      keep: settings.worldsKeepBackups,
      onProgress,
    })
  }

  listBackups(instanceId: string): Promise<BackupEntry[]> {
    return this.core.worlds.listBackups(instanceId)
  }

  deleteBackup(instanceId: string, fileName: string): Promise<void> {
    return this.core.worlds.deleteBackup(instanceId, fileName)
  }

  async pruneBackups(instanceId: string): Promise<BackupEntry[]> {
    const settings = await getSettings()
    return this.core.worlds.pruneBackups(instanceId, settings.worldsKeepBackups)
  }

  restoreBackup(
    instanceId: string,
    fileName: string,
    onProgress?: (progress: WorldProgress) => void,
  ) {
    return this.core.worlds.restoreBackup(instanceId, fileName, { onProgress })
  }

  exportWorld(
    instanceId: string,
    folder: string,
    destZipPath: string,
    onProgress?: (progress: WorldProgress) => void,
  ): Promise<BackupEntry> {
    return this.core.worlds.exportWorld(instanceId, folder, destZipPath, { onProgress })
  }

  importWorld(
    instanceId: string,
    zipPath: string,
    options: { folderName?: string; onProgress?: (progress: WorldProgress) => void } = {},
  ) {
    return this.core.worlds.importWorld(instanceId, zipPath, options)
  }

  deleteWorld(instanceId: string, folder: string): Promise<void> {
    return this.core.worlds.deleteWorld(instanceId, folder)
  }

  duplicateWorld(instanceId: string, folder: string, targetInstanceId: string): Promise<string> {
    return this.core.worlds.duplicateWorld(instanceId, folder, targetInstanceId)
  }

  inspectWorldZip(zipPath: string) {
    return inspectZip(zipPath)
  }

  /** The world's parsed level.dat from inside a zip (no extraction). */
  readWorldZipLevel(zipPath: string) {
    return readZipLevelDat(zipPath)
  }

  availableBytes(dir: string): Promise<number> {
    return availableBytes(dir)
  }

  worldsBackupsDir(instanceId: string): string {
    return this.core.worlds.backupsDirFor(instanceId)
  }

  /** Where exports go by default: the remembered folder, else `<root>/exports`. */
  async worldExportDir(): Promise<string> {
    const settings = await getSettings()
    return settings.lastWorldExportDir || getLauncherPaths().exports
  }

  // ── Dedicated servers ─────────────────────────────────────────

  listServers(): Promise<ServerRecord[]> {
    return this.core.servers.listServers()
  }

  addServer(input: {
    name: string
    source: ServerSource
    liveBackup?: boolean
    requireStopped?: boolean
  }): Promise<ServerRecord> {
    return this.core.servers.addServer(input)
  }

  updateServer(
    id: string,
    patch: Partial<Pick<ServerRecord, "name" | "source" | "liveBackup" | "requireStopped">>,
  ): Promise<ServerRecord> {
    return this.core.servers.updateServer(id, patch)
  }

  removeServer(id: string, options: { deleteBackups?: boolean } = {}): Promise<void> {
    return this.core.servers.removeServer(id, options)
  }

  /** One world per server (null when the world directory is gone). */
  listServerWorld(serverId: string): Promise<WorldSummary | null> {
    return this.core.servers.getWorld(serverId)
  }

  measureServerWorld(serverId: string): Promise<{ sizeBytes: number; fileCount: number }> {
    return this.core.servers.measureWorld(serverId)
  }

  /** Back up a server world, honouring the configured retention count. */
  async backupServerWorld(
    serverId: string,
    onProgress?: (progress: ServerProgress) => void,
  ): Promise<BackupEntry> {
    const settings = await getSettings()
    return this.core.servers.backupWorld(serverId, {
      keep: settings.worldsKeepBackups,
      onProgress,
    })
  }

  listServerBackups(serverId: string): Promise<BackupEntry[]> {
    return this.core.servers.listBackups(serverId)
  }

  deleteServerBackup(serverId: string, fileName: string): Promise<void> {
    return this.core.servers.deleteBackup(serverId, fileName)
  }

  async pruneServerBackups(serverId: string): Promise<BackupEntry[]> {
    const settings = await getSettings()
    return this.core.servers.pruneBackups(serverId, settings.worldsKeepBackups)
  }

  restoreServerBackup(
    serverId: string,
    fileName: string,
    options: { manageContainer?: boolean; onProgress?: (progress: ServerProgress) => void } = {},
  ) {
    return this.core.servers.restoreBackup(serverId, fileName, options)
  }

  exportServerWorld(
    serverId: string,
    destZipPath: string,
    onProgress?: (progress: ServerProgress) => void,
  ): Promise<BackupEntry> {
    return this.core.servers.exportWorld(serverId, destZipPath, { onProgress })
  }

  serverBackupsDir(serverId: string): string {
    return this.core.servers.backupsDirFor(serverId)
  }

  /** Docker discovery for the add-server form (never used to guess records). */
  discoverDockerContainers() {
    return this.core.servers.discoverDockerContainers()
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
   * Opt-in pre-launch world backup. Backs up only worlds whose `level.dat`
   * is newer than their newest backup, and can never block a launch: every
   * failure is logged and reported, then the launch continues.
   */
  async backupChangedWorldsForLaunch(instance: Instance): Promise<void> {
    const settings = await getSettings()
    if (!settings.autoBackupWorldsBeforeLaunch) return

    let worlds: WorldSummary[]
    try {
      worlds = await this.core.worlds.listWorlds(instance.id)
    } catch {
      return
    }
    if (worlds.length === 0) return // common server-play path: no worlds, no cost

    let backups: BackupEntry[] = []
    try {
      backups = await this.core.worlds.listBackups(instance.id)
    } catch {
      backups = []
    }
    const newestByFolder = new Map<string, number>()
    for (const backup of backups) {
      newestByFolder.set(
        backup.worldFolder,
        Math.max(newestByFolder.get(backup.worldFolder) ?? 0, backup.createdAt),
      )
    }

    const changed: WorldSummary[] = []
    for (const world of worlds) {
      let mtime = 0
      try {
        mtime = (await fs.stat(path.join(world.path, "level.dat"))).mtimeMs
      } catch {
        mtime = world.lastPlayed ?? 0
      }
      if (mtime > (newestByFolder.get(world.folder) ?? 0)) changed.push(world)
    }
    if (changed.length === 0) return

    let count = 0
    let bytes = 0
    for (let i = 0; i < changed.length; i++) {
      const world = changed[i]!
      setStatusMessage(`Backing up worlds (${i + 1}/${changed.length}) — ${world.name}…`)
      try {
        const entry = await this.core.worlds.backupWorld(instance.id, world.folder, {
          keep: settings.worldsKeepBackups,
          onProgress: (p) => setProgress(p),
        })
        count++
        bytes += entry.bytes
      } catch (err) {
        // Never let a backup failure stop the launch.
        appendLog(
          `[warn] pre-launch backup failed for "${world.name}": ${err instanceof Error ? err.message : String(err)}`,
        )
        setStatusMessage(`Pre-launch backup failed for "${world.name}" — continuing`)
      }
    }
    setProgress(null)
    if (count > 0) {
      setStatusMessage(`Backed up ${count} world${count === 1 ? "" : "s"} (${formatBytes(bytes)})`)
    }
  }

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
      await this.backupChangedWorldsForLaunch(instance)
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
