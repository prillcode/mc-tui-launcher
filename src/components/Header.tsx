import { Show } from "solid-js"
import { screen, profile } from "../app/state"
import { appConfig } from "../services/config"

const SCREEN_LABELS: Record<string, string> = {
  home: "Home",
  login: "Microsoft Login",
  instances: "Instances",
  "instance-detail": "Instance",
  mods: "Mods",
  settings: "Settings",
  logs: "Logs",
  help: "Help",
}

export function Header() {
  return (
    <box height={1} flexDirection="row" backgroundColor="#1e1e2e">
      <text fg="#cba6f7" attributes={1}>
        Blockhaven Minecraft Launcher
      </text>
      <text fg="#585b70"> │ </text>
      <text fg="#89b4fa">{SCREEN_LABELS[screen()] ?? screen()}</text>
      <text fg="#585b70"> │ </text>
      <Show when={profile()} fallback={<text fg="#6c7086">not signed in</text>}>
        <text fg="#a6e3a1">signed in: {profile()!.name}</text>
      </Show>
    </box>
  )
}
