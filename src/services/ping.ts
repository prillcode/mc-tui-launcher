import { launcherService } from "./launcher"
import type { ServerPingResult } from "@prillcode/mc-launcher-core"

/**
 * Result of pinging one instance's auto-connect server, as consumed by
 * the instance grid. Kept separate from the core's ServerPingResult so
 * screens can represent "checking" and "unreachable" without throwing.
 */
export type PingStatus =
  | { state: "idle" }
  | { state: "pinging" }
  | { state: "ok"; result: ServerPingResult }
  | { state: "down" }

/** The core already applies a 5s socket timeout; race a hair longer so
 *  the UI always settles even if the socket never fires. */
const PING_TIMEOUT_MS = 6000

export async function pingAutoConnect(host: string, port?: number): Promise<PingStatus> {
  try {
    const result = await Promise.race([
      launcherService.pingServer(host, port ?? 25565),
      new Promise<never>((_, reject) =>
        setTimeout(() => reject(new Error("ping timed out")), PING_TIMEOUT_MS),
      ),
    ])
    return { state: "ok", result }
  } catch {
    return { state: "down" }
  }
}
