import { For, createMemo } from "solid-js"
import { BLOCKHAVEN_LOGO, LOGO_ALPHABET } from "../assets/blockhavenLogo"

interface Cell {
  t: string
  b: string
}

/**
 * The Blockhaven cube logo as colored ANSI half-block art.
 *
 * Each terminal cell draws "▀" (upper half block) with `fg` = the top
 * pixel and `bg` = the bottom pixel, so one cell row carries two pixel
 * rows. The pixel grids are pre-generated from the reference launcher's
 * icon.png (see scripts/gen-logo-art.py) at several square sizes; pick
 * the largest that fits the available height.
 */
export function BlockhavenLogo(props: { size: number }) {
  const art = createMemo(() => BLOCKHAVEN_LOGO[props.size] ?? BLOCKHAVEN_LOGO[16]!)

  const cellRows = createMemo<Cell[][]>(() => {
    const a = art()
    const n = a.size
    const rows: Cell[][] = []
    for (let r = 0; r < n / 2; r++) {
      const top = a.rows[r * 2]!
      const bottom = a.rows[r * 2 + 1]!
      const cells: Cell[] = []
      for (let x = 0; x < n; x++) {
        cells.push({
          t: a.palette[LOGO_ALPHABET.indexOf(top[x]!)] ?? "#000000",
          b: a.palette[LOGO_ALPHABET.indexOf(bottom[x]!)] ?? "#000000",
        })
      }
      rows.push(cells)
    }
    return rows
  })

  return (
    <box flexDirection="column">
      <For each={cellRows()}>
        {(row) => (
          <text wrapMode="none">
            <For each={row}>
              {(cell) => {
                // The Solid reconciler only honors fg/bg on text nodes via the
                // `style` prop (direct fg/bg are ignored for spans).
                const style = { fg: cell.t, bg: cell.b }
                return <span style={style}>▀</span>
              }}
            </For>
          </text>
        )}
      </For>
    </box>
  )
}
