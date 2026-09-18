import { For, Show, createSignal } from "solid-js"
import { useKeyboard } from "@opentui/solid"
import { navigate, screen, profile, setStatusMessage } from "../app/state"
import { KeyHints } from "../components/KeyHints"

/**
 * Home: quick actions menu. Keyboard-first; mouse welcome but optional.
 */
export function HomeScreen() {
  const [selected, setSelected] = createSignal(0)

  const actions: Array<{ label: string; hint: string; run: () => void }> = [
    { label: "Play — Instances", hint: "browse & launch instances", run: () => navigate("instances") },
    { label: "Account — Microsoft Login", hint: "device-code sign-in", run: () => navigate("login") },
    { label: "Mods", hint: "Modrinth & installed mods", run: () => navigate("mods") },
    { label: "Settings", hint: "launcher configuration", run: () => navigate("settings") },
    { label: "Logs", hint: "launcher & game output", run: () => navigate("logs") },
    { label: "Help", hint: "keyboard reference", run: () => navigate("help") },
  ]

  function activate() {
    const action = actions[selected()]
    if (!action) return
    setStatusMessage("")
    action.run()
  }

  useKeyboard((key) => {
    if (screen() !== "home") return
    if (key.name === "up" || key.name === "k") {
      setSelected((s) => Math.max(0, s - 1))
    } else if (key.name === "down" || key.name === "j") {
      setSelected((s) => Math.min(actions.length - 1, s + 1))
    } else if (key.name === "return" || key.name === "enter") {
      activate()
    }
  })

  return (
    <box flexDirection="column" flexGrow={1}>
      <box flexGrow={1} padding={1} flexDirection="column">
        <text fg="#cdd6f4" attributes={2}>
          Welcome
        </text>
        <text fg="#6c7086">
          <Show when={profile()} fallback={<>Sign in with Microsoft to play online — press 'a'.</>}>
            Signed in as {profile()!.name}. Pick an instance to play.
          </Show>
        </text>
        <box height={1} />
        <For each={actions}>
          {(action, i) => (
            <box flexDirection="row" height={1}>
              <text
                fg={selected() === i() ? "#89b4fa" : "#cdd6f4"}
                attributes={selected() === i() ? 1 : 0}
              >
                {selected() === i() ? "▸ " : "  "}
                {action.label}
              </text>
              <text fg="#585b70"> — {action.hint}</text>
            </box>
          )}
        </For>
      </box>
      <KeyHints
        hints={[
          ["↑/↓", "navigate"],
          ["Enter", "select"],
          ["q", "quit (press twice)"],
          ["?", "help"],
        ]}
      />
    </box>
  )
}
