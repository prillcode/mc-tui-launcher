import { For, Show } from "solid-js"
import type { ScrollBoxRenderable } from "@opentui/core"
import { useBindings } from "@opentui/keymap/solid"
import { logLines, goBack } from "../app/state"
import { HINT } from "../app/keymap"
import { getLauncherPaths } from "@prillcode/mc-launcher-core"
import { KeyHints } from "../components/KeyHints"

/** Resolved once — the data root does not change while the app runs. */
const LOG_DIRECTORY = getLauncherPaths().logs

/**
 * Logs: in-memory ring buffer of launcher + game output. Full logs are
 * persisted by the core under the data root's logs directory.
 *
 * The buffer is rendered in a `<scrollbox>` that sticks to the bottom, so
 * new output follows along by itself while the view stays put once the
 * user scrolls back to read history (`End`/`t` returns to the live tail).
 */
export function LogsScreen() {
  let listRef: ScrollBoxRenderable | undefined

  useBindings(() => ({
    commands: [
      { name: "logs.back", run: () => goBack() },
      {
        name: "logs.latest",
        run() {
          // scrollPosition is clamped, so scrollHeight is "as far as possible".
          if (listRef) listRef.scrollTo(listRef.scrollHeight)
        },
      },
    ],
    bindings: [
      { key: "t", cmd: "logs.latest", desc: "latest", hint: HINT.primary },
      { key: "escape", cmd: "logs.back", desc: "back", hint: HINT.cancel },
    ],
  }))

  return (
    <box flexDirection="column" flexGrow={1}>
      <box flexGrow={1} padding={1} flexDirection="column">
        <text fg="#cdd6f4" attributes={2} flexShrink={0}>
          Logs
        </text>
        <text fg="#585b70" flexShrink={0}>full logs: {LOG_DIRECTORY}</text>
        <box height={1} flexShrink={0} />
        <Show
          when={logLines().length > 0}
          fallback={<text fg="#6c7086" flexShrink={0}>No output yet.</text>}
        >
          <scrollbox
            ref={(el) => (listRef = el)}
            flexGrow={1}
            focused
            stickyScroll
            stickyStart="bottom"
            scrollbarOptions={{ showArrows: false }}
          >
            <For each={logLines()}>{(line) => <text fg="#9399b2">{line}</text>}</For>
          </scrollbox>
        </Show>
      </box>
      <KeyHints extra={[["↑/↓", "scroll"], ["Home/End", "top/end"]]} />
    </box>
  )
}
