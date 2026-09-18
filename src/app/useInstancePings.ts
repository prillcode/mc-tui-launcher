import { createSignal, createEffect, onCleanup } from "solid-js"
import { instances } from "./state"
import { pingAutoConnect, type PingStatus } from "../services/ping"

/**
 * Live Server List Ping status for every instance with an auto-connect
 * target, keyed by instance id. Shared by the Instances grid and the
 * Home page's launch list so both show the same status/MOTD.
 *
 * Re-pings whenever the set of targets changes; `reping()` forces a
 * refresh (used by the `r` key). Stale in-flight results are dropped.
 */
export function useInstancePings() {
  const [pings, setPings] = createSignal<Record<string, PingStatus>>({})
  let run = 0

  async function pingAll() {
    const current = ++run
    const targets = instances().filter((i) => i.serverAutoConnect)
    if (targets.length === 0) return
    setPings((prev) => {
      const next = { ...prev }
      for (const inst of targets) next[inst.id] = { state: "pinging" }
      return next
    })
    await Promise.all(
      targets.map(async (inst) => {
        const ac = inst.serverAutoConnect!
        const status = await pingAutoConnect(ac.host, ac.port)
        if (current !== run) return
        setPings((prev) => ({ ...prev, [inst.id]: status }))
      }),
    )
  }

  createEffect(() => {
    const fingerprint = instances()
      .map((i) => `${i.id}|${i.serverAutoConnect?.host ?? ""}|${i.serverAutoConnect?.port ?? ""}`)
      .join(";")
    void fingerprint
    void pingAll()
  })

  onCleanup(() => {
    run++
  })

  return { pings, reping: pingAll }
}
