import { For } from "solid-js"

export function KeyHints(props: { hints: Array<[string, string]> }) {
  return (
    <box height={1} flexDirection="row" backgroundColor="#181825">
      <For each={props.hints}>
        {([key, label]) => (
          <box flexDirection="row" height={1}>
            <text fg="#89b4fa"> {key} </text>
            <text fg="#6c7086">{label} </text>
          </box>
        )}
      </For>
    </box>
  )
}
