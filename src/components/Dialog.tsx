import { Show, type JSX } from "solid-js"

/**
 * A centered modal dialog. Children are rendered inside a bordered box;
 * the parent decides key handling and dismissal.
 */
export function Dialog(props: { title: string; children: JSX.Element }) {
  return (
    <box
      style={{ flexGrow: 1, justifyContent: "center", alignItems: "center" }}
      backgroundColor="#00000080"
    >
      <box
        border
        borderStyle="rounded"
        borderColor="#89b4fa"
        title={props.title}
        backgroundColor="#1e1e2e"
        padding={1}
        width="70%"
      >
        {props.children}
      </box>
    </box>
  )
}
