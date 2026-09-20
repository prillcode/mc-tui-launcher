import { createSignal, type Accessor } from "solid-js"
import type { WorldSummary } from "@prillcode/mc-launcher-core"
import { launcherService } from "../services/launcher"

/**
 * Server-worlds data layer.
 *
 * There is exactly one world per server, so the cache is keyed by server
 * id. Listing is cheap (the core reads only `level.dat`), but a live
 * server's world changes constantly, so sizes are measured lazily through
 * the core's short-TTL cache rather than kept forever.
 */

const worldCache = new Map<string, WorldSummary | null>()
const measuring = new Set<string>()

/** Forget one server's cached world (after backup/restore/removal). */
export function invalidateServerWorld(serverId: string): void {
  worldCache.delete(serverId)
}

/** Forget every cached server world (after a full rescan). */
export function invalidateAllServerWorlds(): void {
  worldCache.clear()
}

export interface UseServerWorlds {
  worlds: Accessor<Map<string, WorldSummary | null>>
  loading: Accessor<boolean>
  error: Accessor<string | null>
  /** Load the worlds for the given servers (concurrently). */
  load: (serverIds: string[], showSpinner?: boolean) => Promise<void>
  /** Forget and reload one server's world. */
  refresh: (serverId: string) => Promise<void>
  /** Measure one server world's size lazily. */
  measure: (serverId: string) => Promise<void>
}

export function useServerWorlds(): UseServerWorlds {
  const [worlds, setWorlds] = createSignal<Map<string, WorldSummary | null>>(new Map(worldCache))
  const [loading, setLoading] = createSignal(false)
  const [error, setError] = createSignal<string | null>(null)
  let token = 0

  async function load(serverIds: string[], showSpinner = true): Promise<void> {
    const current = ++token
    if (showSpinner) setLoading(true)
    try {
      const results = await Promise.all(
        serverIds.map(async (id): Promise<[string, WorldSummary | null]> => {
          try {
            const world = await launcherService.listServerWorld(id)
            worldCache.set(id, world)
            return [id, world]
          } catch {
            // A transient docker failure must not blank the list; keep the
            // last known value (or null).
            return [id, worldCache.get(id) ?? null]
          }
        }),
      )
      if (current !== token) return
      setWorlds(new Map(results))
      setError(null)
    } catch (err) {
      if (current !== token) return
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      if (current === token) setLoading(false)
    }
  }

  async function refresh(serverId: string): Promise<void> {
    worldCache.delete(serverId)
    await load([serverId], false)
  }

  async function measure(serverId: string): Promise<void> {
    if (measuring.has(serverId)) return
    const existing = worlds().get(serverId)
    if (existing?.sizeBytes !== undefined) return
    measuring.add(serverId)
    try {
      const measured = await launcherService.measureServerWorld(serverId)
      const next = new Map(worlds())
      const world = next.get(serverId)
      if (world) {
        const updated = { ...world, ...measured }
        next.set(serverId, updated)
        worldCache.set(serverId, updated)
        setWorlds(next)
      }
    } catch {
      // Sizes are cosmetic; a failure leaves the "…" placeholder.
    } finally {
      measuring.delete(serverId)
    }
  }

  return { worlds, loading, error, load, refresh, measure }
}
