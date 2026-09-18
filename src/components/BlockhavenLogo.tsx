import { For, createMemo } from "solid-js"
import { BLOCKHAVEN_LOGO, LOGO_CHARS, LOGO_PALETTE } from "../assets/blockhavenLogo"

/**
 * The Blockhaven cube logo drawn as classic character-shaded ANSI art.
 *
 * Each cell is a glyph from LOGO_CHARS (" .:-=+*#%@") chosen by the local
 * brightness and coloured from a monochrome theme ramp (dark navy ->
 * mauve). Nothing is filled in with full blocks, so it reads as terminal
 * art rather than a downscaled image. Grids are pre-generated from the
 * reference launcher's icon.png (scripts/gen-logo-art.py).
 */
export function BlockhavenLogo(props: { size: number }) {
  const art = createMemo(() => BLOCKHAVEN_LOGO[props.size] ?? BLOCKHAVEN_LOGO[16]!)

  return (
    <box flexDirection="column">
      <For each={art().rows}>
        {(row) => (
          <text wrapMode="none">
            <For each={[...row]}>
              {(ch) => {
                const level = ch.charCodeAt(0) - 48 // rows store '0'..'9'
                const style = { fg: LOGO_PALETTE[level] ?? "#cba6f7" }
                return <span style={style}>{LOGO_CHARS[level] ?? " "}</span>
              }}
            </For>
          </text>
        )}
      </For>
    </box>
  )
}
