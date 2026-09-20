import { createSignal, createEffect, onCleanup, type Accessor } from "solid-js"
import type { WorldStats, WorldSummary } from "@prillcode/mc-launcher-core"
import { launcherService } from "../services/launcher"
import { worldsRefreshToken } from "./state"

/**
 * Worlds data layer.
 *
 * Listing is cheap (the core reads only `level.dat` + `icon.png` per
 * world), so it refreshes on mount and on demand. Sizes are expensive for
 * big worlds, so they are measured lazily for the selected row only, and
 * cached per instance. Stats are cached per world for the session.
 */

const worldCache = new Map<string, WorldSummary[]>()
const statsCache = new Map<string, WorldStats>()
const measuring = new Set<string>()

const statsKey = (instanceId: string, folder: string) => `${instanceId}\u0000${folder}`

/** Forget an instance's cached worlds (after import/delete/restore). */
export function invalidateWorlds(instanceId: string): void {
  worldCache.delete(instanceId)
  for (const key of [...statsCache.keys()]) {
    if (key.startsWith(`${instanceId}\u0000`)) statsCache.delete(key)
  }
}

/** Forget one world's cached stats (after a restore rewrites it). */
export function invalidateWorldStats(instanceId: string, folder: string): void {
  statsCache.delete(statsKey(instanceId, folder))
}

export interface UseWorlds {
  worlds: Accessor<WorldSummary[]>
  loading: Accessor<boolean>
  error: Accessor<string | null>
  refresh: () => Promise<void>
  /** Measure a world's recursive size, debounced by the caller. */
  measure: (folder: string) => Promise<void>
  /** Player stats for a world, cached for the session. */
  stats: (folder: string) => Promise<WorldStats | undefined>
}

export function useWorlds(instanceId: Accessor<string | undefined>): UseWorlds {
  const [worlds, setWorlds] = createSignal<WorldSummary[]>([])
  const [loading, setLoading] = createSignal(false)
  const [error, setError] = createSignal<string | null>(null)
  let token = 0

  async function load(id: string, showSpinner: boolean): Promise<void> {
    const current = ++token
    if (showSpinner) setLoading(true)
    try {
      const list = await launcherService.listWorlds(id)
      if (current !== token) return
      worldCache.set(id, list)
      setWorlds(list)
      setError(null)
    } catch (err) {
      if (current !== token) return
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      if (current === token) setLoading(false)
    }
  }

  async function refresh(): Promise<void> {
    const id = instanceId()
    if (!id) return
    worldCache.delete(id)
    await load(id, true)
  }

  createEffect(() => {
    const id = instanceId()
    // Read the refresh token so bumpWorldsRefresh() re-runs this scan.
    void worldsRefreshToken()
    if (!id) {
      setWorlds([])
      setError(null)
      return
    }
    const cached = worldCache.get(id)
    if (cached) setWorlds(cached)
    void load(id, !cached)
  })

  onCleanup(() => {
    token++
  })

  async function measure(folder: string): Promise<void> {
    const id = instanceId()
    if (!id) return
    const key = statsKey(id, folder)
    if (measuring.has(key)) return
    const existing = worldCache.get(id)?.find((w) => w.folder === folder)
    if (existing?.sizeBytes !== undefined) return
    measuring.add(key)
    try {
      const { sizeBytes, fileCount } = await launcherService.measureWorld(id, folder)
      const list = worldCache.get(id)
      if (!list) return
      const next = list.map((w) => (w.folder === folder ? { ...w, sizeBytes, fileCount } : w))
      worldCache.set(id, next)
      // Only publish if this instance is still the one on screen.
      if (instanceId() === id) setWorlds(next)
    } catch {
      // Sizes are cosmetic; a failure leaves the "…" placeholder.
    } finally {
      measuring.delete(key)
    }
  }

  async function stats(folder: string): Promise<WorldStats | undefined> {
    const id = instanceId()
    if (!id) return undefined
    const key = statsKey(id, folder)
    const cached = statsCache.get(key)
    if (cached) return cached
    try {
      const result = await launcherService.readWorldStats(id, folder)
      statsCache.set(key, result)
      return result
    } catch {
      return undefined
    }
  }

  return { worlds, loading, error, refresh, measure, stats }
}
