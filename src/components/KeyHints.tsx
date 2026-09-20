import { For, createMemo } from "solid-js"
import { useTerminalDimensions } from "@opentui/solid"
import { useKeymapSelector } from "@opentui/keymap/solid"
import { stringifyKeySequence } from "@opentui/keymap"
import { HINT } from "../app/keymap"

interface Hint {
  /** Hint-bar order; lower comes first. */
  order: number
  /** The key stroke(s), e.g. `↑/↓`. */
  strokes: string
  /** What the keys do. */
  label: string
}

/** Compact glyphs for the named keys, so the one-row bar stays short. */
const KEY_GLYPHS: Record<string, string> = {
  up: "↑",
  down: "↓",
  left: "←",
  right: "→",
  pageup: "PgUp",
  pagedown: "PgDn",
  escape: "Esc",
  return: "Enter",
  backspace: "Bksp",
  space: "Space",
  tab: "Tab",
}

/** Replace named strokes with glyphs, keeping `/` (alternatives) and ` ` (sequence). */
function glyphs(strokes: string): string {
  return strokes
    .split(/([/ ])/)
    .map((part) => KEY_GLYPHS[part] ?? part)
    .join("")
}

/**
 * Bottom hint bar.
 *
 * Derived from the keymap rather than hand-maintained per screen: it lists
 * every *active* binding that opted in with a `hint` metadata field, in
 * `hint` order, so the bar can never advertise a key that is not live (or
 * silently miss one that is). Bindings without `hint` stay out of the bar
 * and are covered by the Help screen instead.
 *
 * `extra` covers affordances that are not keymap bindings, such as typing
 * into an editor input or its Enter-to-submit.
 */
export function KeyHints(props: { extra?: Array<[string, string]> }) {
  const dims = useTerminalDimensions()

  const derived = useKeymapSelector<Hint[]>((keymap) =>
    keymap
      .getActiveKeys({ includeMetadata: true, includeBindings: true })
      .flatMap((key) => {
        const order = key.bindingAttrs?.hint
        const label = key.bindingAttrs?.desc
        if (typeof order !== "number" || typeof label !== "string") return []
        const sequence = key.bindings?.[0]?.sequence
        const strokes = glyphs(sequence ? stringifyKeySequence(sequence, { separator: " " }) : key.display)
        return [{ order, strokes, label }]
      })
      .sort((a, b) => a.order - b.order)
      // Bindings that share a hint order and label read as one entry, so a
      // key pair (`left`/`right`) renders as "←/→ instance".
      .reduce<Hint[]>((merged, entry) => {
        const previous = merged[merged.length - 1]
        if (previous && previous.order === entry.order && previous.label === entry.label) {
          previous.strokes = `${previous.strokes}/${entry.strokes}`
          return merged
        }
        merged.push({ ...entry })
        return merged
      }, []),
  )

  const visible = createMemo<Array<[string, string]>>(() => {
    const all = derived()
    // "cancel / help / quit" must stay visible: on a narrow terminal drop
    // contextual hints from the right instead of the trailing group.
    const tail = all.filter((hint) => hint.order >= HINT.cancel)
    const head: Hint[] = [
      ...(props.extra ?? []).map(([strokes, label]) => ({ order: -1, strokes, label })),
      ...all.filter((hint) => hint.order < HINT.cancel),
    ]

    const budget = dims().width
    const width = (hint: Hint) => hint.strokes.length + hint.label.length + 3
    let used = tail.reduce((total, hint) => total + width(hint), 0)
    const kept: Hint[] = []
    for (const hint of head) {
      const hintWidth = width(hint)
      if (used + hintWidth > budget) break
      used += hintWidth
      kept.push(hint)
    }

    return [...kept, ...tail].map(({ strokes, label }) => [strokes, label] as [string, string])
  })

  return (
    <box height={1} flexDirection="row" backgroundColor="#181825" flexShrink={0}>
      <For each={visible()}>
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
