import { For, Show, createSignal, createMemo } from "solid-js"
import { useKeyboard, useTerminalDimensions } from "@opentui/solid"
import { navigate, screen, profile, setStatusMessage } from "../app/state"
import { KeyHints } from "../components/KeyHints"
import { Centered } from "../components/Centered"

type BannerFont = "tiny" | "block" | "huge"

interface Banner {
  text: string
  font: BannerFont
  /** Art width in cells (measured from the bundled fonts). */
  artWidth: number
  /** Art height in rows. */
  rows: number
}

/**
 * Home: a centered landing page — greeting, an ASCII-art wordmark banner,
 * and the quick-action menu beneath it. The wordmark picks a size that
 * fits the current terminal (falls back to the compact "tiny" font on
 * smaller windows).
 */
export function HomeScreen() {
  const dims = useTerminalDimensions()
  const [selected, setSelected] = createSignal(0)

  const actions: Array<{ label: string; hint: string; run: () => void }> = [
    { label: "Play — Instances", hint: "browse & launch instances", run: () => navigate("instances") },
    { label: "Account — Microsoft Login", hint: "device-code sign-in", run: () => navigate("login") },
    { label: "Mods", hint: "Modrinth & installed mods", run: () => navigate("mods") },
    { label: "Settings", hint: "launcher configuration", run: () => navigate("settings") },
    { label: "Logs", hint: "launcher & game output", run: () => navigate("logs") },
    { label: "Help", hint: "keyboard reference", run: () => navigate("help") },
  ]

  // Home uses the same 100-col content column as Centered(maxWidth={100}).
  const columnWidth = () => Math.min(100, Math.max(16, dims().width - 4))

  const banner = createMemo<Banner>(() => {
    const w = columnWidth()
    const h = dims().height
    // The banner box adds a 2-col border and 4 cols of padding.
    if (w >= 100 && h >= 24) return { text: "BLOCKHAVEN", font: "block", artWidth: 94, rows: 6 }
    if (w >= 62 && h >= 28) return { text: "BHMC", font: "huge", artWidth: 56, rows: 11 }
    if (w >= 47) return { text: "BLOCKHAVEN", font: "tiny", artWidth: 41, rows: 2 }
    return { text: "BHMC", font: "tiny", artWidth: 18, rows: 2 }
  })

  const menuWidth = () => Math.min(64, Math.max(36, columnWidth() - 8))

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
      <Centered maxWidth={100}>
        <box flexDirection="column" flexGrow={1} alignItems="center">
          <text fg="#cdd6f4" attributes={2}>
            Welcome
          </text>
          <text fg="#6c7086">
            <Show when={profile()} fallback={<>Sign in with Microsoft to play online — press 'a'.</>}>
              Signed in as {profile()!.name}. Pick an instance to play.
            </Show>
          </text>
          <box height={1} />
          <box
            border
            borderStyle="rounded"
            borderColor="#cba6f7"
            backgroundColor="#181825"
            paddingX={2}
            flexDirection="column"
            alignItems="center"
          >
            <ascii_font
              text={banner().text}
              font={banner().font}
              color={["#89b4fa", "#cba6f7", "#f5c2e7"]}
            />
            <text fg="#a6adc8" attributes={4}>
              Blockhaven Minecraft Launcher
            </text>
          </box>
          <box height={1} />
          <box width={menuWidth()} flexDirection="column">
            <For each={actions}>
              {(action, i) => (
                <box
                  flexDirection="row"
                  height={1}
                  backgroundColor={selected() === i() ? "#242438" : undefined}
                >
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
        </box>
      </Centered>
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
