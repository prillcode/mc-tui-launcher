import type { JSX } from "solid-js"

/**
 * A centered modal dialog rendered as a full-screen overlay. The parent
 * decides key handling and dismissal; this component is purely visual.
 */
export function Dialog(props: { title: string; children: JSX.Element }) {
  return (
    <box
      position="absolute"
      top={0}
      left={0}
      right={0}
      bottom={0}
      justifyContent="center"
      alignItems="center"
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
