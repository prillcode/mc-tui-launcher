import { Show, Switch, Match, createMemo } from "solid-js"
import { busy, progress, statusMessage } from "../app/state"

export function StatusBar() {
  const line = createMemo(() => {
    const p = progress()
    if (p && p.total > 0) {
      const pct = Math.round((p.current / p.total) * 100)
      return `${p.phase}: ${p.current}/${p.total} (${pct}%) ${p.fileName}`
    }
    return statusMessage()
  })

  return (
    <box height={1} flexDirection="row" backgroundColor="#181825" flexShrink={0}>
      <Show when={busy()}>
        <text fg="#f9e2af">⏳ </text>
      </Show>
      <Switch>
        <Match when={busy()}>
          <text fg="#f9e2af">{line()}</text>
        </Match>
        <Match when={true}>
          <text fg="#cdd6f4">{statusMessage()}</text>
        </Match>
      </Switch>
    </box>
  )
}
