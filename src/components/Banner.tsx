import { For, Show, createMemo } from "solid-js"
import { useTerminalDimensions } from "@opentui/solid"
import { screen, profile } from "../app/state"

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

interface Token {
  text: string
  color: string
}

/** The tagline as individually coloured words (a small gradient). */
const QUOTE: Token[] = [
  { text: "✦", color: "#6c7086" },
  { text: "Launch", color: "#89b4fa" },
  { text: "Minecraft", color: "#b4befe" },
  { text: "in", color: "#cba6f7" },
  { text: "the", color: "#f5c2e7" },
  { text: "Terminal", color: "#f5c2e7" },
  { text: "✦", color: "#6c7086" },
]

/** Greedy word wrap; each returned token carries its own leading space. */
function wrapQuote(tokens: Token[], width: number): Token[][] {
  const lines: Token[][] = []
  let line: Token[] = []
  let len = 0
  for (const t of tokens) {
    const need = (line.length > 0 ? 1 : 0) + t.text.length
    if (line.length > 0 && len + need > width) {
      lines.push(line)
      line = []
      len = 0
    }
    const text = line.length > 0 ? " " + t.text : t.text
    line.push({ text, color: t.color })
    len += text.length
  }
  if (line.length > 0) lines.push(line)
  return lines
}

/**
 * Full-width banner shown on every screen: a slightly decorated tagline
 * (centred, wrapping on narrow terminals) above the current screen title
 * and account state.
 */
export function Banner() {
  const dims = useTerminalDimensions()
  // border (2) + paddingX (4)
  const innerWidth = () => Math.max(8, dims().width - 6)

  const quoteLines = createMemo(() => wrapQuote(QUOTE, innerWidth()))
  const title = () => SCREEN_LABELS[screen()] ?? screen()
  const account = () => (profile() ? `signed in: ${profile()!.name}` : "not signed in")
  const showAccount = () => innerWidth() >= title().length + account().length + 6

  return (
    <box
      width="100%"
      border
      borderStyle="single"
      borderColor="#45475a"
      backgroundColor="#181825"
      paddingX={2}
      flexDirection="column"
    >
      <For each={quoteLines()}>
        {(line) => (
          <box flexDirection="row" width="100%" justifyContent="center">
            <text attributes={1}>
              <For each={line}>
                {(t) => <span style={{ fg: t.color }}>{t.text}</span>}
              </For>
            </text>
          </box>
        )}
      </For>
      <box flexDirection="row" width="100%" alignItems="center" justifyContent="space-between">
        <text fg="#89b4fa">{title()}</text>
        <Show when={showAccount()}>
          <text fg="#a6e3a1">{account()}</text>
        </Show>
      </box>
    </box>
  )
}
