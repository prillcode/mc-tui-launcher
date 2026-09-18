import { For, createMemo } from "solid-js"
import { BLOCKHAVEN_LOGO, LOGO_ALPHABET, LOGO_PALETTE } from "../assets/blockhavenLogo"

interface Cell {
  t: string
  b: string
  empty: boolean
}

/**
 * The Blockhaven cube logo as block pixel art.
 *
 * The source image is reduced to a small square pixel grid where every
 * pixel is either the panel background (transparent) or a solid theme
 * shade. Each terminal cell draws two stacked pixels with "▀" (fg = top
 * pixel, bg = bottom pixel); cells that are entirely background render
 * blank. That keeps the pixels square and the surrounding area empty, so
 * it reads as a grid of filled/empty squares rather than a bitmap.
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
        const ti = LOGO_ALPHABET.indexOf(top[x]!)
        const bi = LOGO_ALPHABET.indexOf(bottom[x]!)
        cells.push({
          t: LOGO_PALETTE[ti] ?? LOGO_PALETTE[0]!,
          b: LOGO_PALETTE[bi] ?? LOGO_PALETTE[0]!,
          empty: ti === 0 && bi === 0,
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
                if (cell.empty) return <span> </span>
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
