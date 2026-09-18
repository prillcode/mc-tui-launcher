import { Show } from "solid-js"
import type { Instance } from "@prillcode/mc-launcher-core"
import type { PingStatus } from "../services/ping"

/** Total card height in terminal rows (border 2 + 4 content rows). */
export const CARD_HEIGHT = 6

function truncate(value: string, max: number): string {
  if (max <= 1) return ""
  return value.length > max ? `${value.slice(0, max - 1)}…` : value
}

/**
 * One instance as a bordered card for the Instances grid.
 *
 * Layout (4 content rows):
 *   ╭──────────────────────────────╮
 *   │ BirdieBiome - Golf           │  name (accented when selected)
 *   │ 26.2 · fabric · 512–2048 MB  │  version / loader / heap
 *   │ ● online · 0/20 · 26.2       │  live server status (accented)
 *   │ Minecraft Golf dev server    │  MOTD (accented) or server address
 *   ╰──────────────────────────────╯
 */
export function InstanceCard(props: {
  instance: Instance
  ping: PingStatus
  selected: boolean
  running: boolean
  width: number
}) {
  const inner = () => Math.max(8, props.width - 4)

  const accent = () => (props.selected ? "#89b4fa" : props.running ? "#a6e3a1" : "#45475a")

  const metaLine = () => {
    const inst = props.instance
    const loader = inst.modLoader && inst.modLoader !== "vanilla" ? ` · ${inst.modLoader}` : ""
    return `${inst.versionId}${loader} · ${inst.minMemoryMb}–${inst.maxMemoryMb} MB`
  }

  const statusColor = () => {
    switch (props.ping.state) {
      case "ok":
        return "#a6e3a1"
      case "down":
        return "#f38ba8"
      case "pinging":
        return "#f9e2af"
      default:
        return "#6c7086"
    }
  }

  const statusGlyph = () => (props.ping.state === "pinging" || props.ping.state === "idle" ? "◌" : "●")

  const statusText = () => {
    const ac = props.instance.serverAutoConnect
    if (!ac) return "no auto-connect server"
    switch (props.ping.state) {
      case "ok": {
        const r = props.ping.result
        const players = r.players ? ` · ${r.players.online}/${r.players.max}` : ""
        const version = r.version ? ` · ${r.version}` : ""
        return `online${players}${version}`
      }
      case "down":
        return "unreachable"
      case "pinging":
        return "checking…"
      default:
        return "press 'r' to ping"
    }
  }

  const detailAccent = () => (props.ping.state === "ok" ? "#b4befe" : "#6c7086")

  const detailLine = () => {
    if (props.ping.state === "ok" && props.ping.result.motd) return props.ping.result.motd
    const ac = props.instance.serverAutoConnect
    if (!ac) return "singleplayer / no server set"
    return `→ ${ac.host}${ac.port !== undefined ? `:${ac.port}` : ""}`
  }

  return (
    <box
      width={props.width}
      height={CARD_HEIGHT}
      border
      borderStyle="rounded"
      borderColor={accent()}
      backgroundColor={props.selected ? "#242438" : undefined}
      paddingX={1}
      flexDirection="column"
      overflow="hidden"
    >
      <box flexDirection="row" height={1}>
        <text fg={props.selected ? "#89b4fa" : "#cdd6f4"} attributes={1} wrapMode="none">
          {truncate(props.instance.name, props.running ? inner() - 10 : inner())}
        </text>
        <Show when={props.running}>
          <text fg="#a6e3a1" wrapMode="none"> ● running</text>
        </Show>
      </box>
      <text fg="#6c7086" wrapMode="none">
        {truncate(metaLine(), inner())}
      </text>
      <box flexDirection="row" height={1}>
        <text fg={statusColor()} wrapMode="none">
          {statusGlyph()}
        </text>
        <text fg="#9399b2" wrapMode="none"> {truncate(statusText(), inner() - 2)}</text>
      </box>
      <text fg={detailAccent()} attributes={props.ping.state === "ok" ? 4 : 2} wrapMode="none">
        {truncate(detailLine(), inner())}
      </text>
    </box>
  )
}
