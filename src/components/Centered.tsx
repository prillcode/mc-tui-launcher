import { useTerminalDimensions } from "@opentui/solid"
import type { JSX } from "solid-js"

/**
 * Horizontally centers a content column at most `maxWidth` cells wide,
 * always leaving a small gutter at the terminal edges. Used by every
 * screen except Logs (log output reads better full-width and
 * left-aligned).
 *
 * Content inside the column is laid out normally; screens that want
 * their children centered within the column (e.g. the home banner and
 * menu) add `alignItems="center"` themselves.
 */
export function Centered(props: { children: JSX.Element; maxWidth?: number; paddingY?: number }) {
  const dims = useTerminalDimensions()
  const width = () => Math.max(16, Math.min(props.maxWidth ?? 96, dims().width - 4))
  return (
    <box flexGrow={1} flexDirection="column" alignItems="center" paddingY={props.paddingY ?? 1}>
      <box flexDirection="column" flexGrow={1} width={width()}>
        {props.children}
      </box>
    </box>
  )
}
