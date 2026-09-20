import type { KeyEvent, Renderable } from "@opentui/core"
import type { Keymap, ReactiveMatcher } from "@opentui/keymap"
import { createDefaultOpenTuiKeymap } from "@opentui/keymap/opentui"
import { reactiveMatcherFromSignal } from "@opentui/keymap/solid"
import type { Accessor } from "solid-js"
import { textInputActive } from "./state"

/**
 * Shared keymap wiring (OpenTUI skill: docs/keymap/overview).
 *
 * Every key the app understands is a named command on a layer. Layers are
 * registered per mounted screen / per screen mode and switched off with
 * `enabled` matchers, so "which keys are live right now" has exactly one
 * answer — the keymap — and the hint bar is derived from it instead of
 * from hand-maintained arrays.
 */
export type AppKeymap = Keymap<Renderable, KeyEvent>

/**
 * Hint bar ordering. Bindings only appear in the hint bar when they carry
 * a `hint` field; the number decides the left-to-right order.
 */
export const HINT = {
  /** The screen's primary actions. */
  primary: 10,
  /** Secondary / less common actions. */
  secondary: 20,
  /** Editing affordances for list rows. */
  edit: 30,
  /** Input-mode affordances (typing, submit) supplied by the screen. */
  input: 40,
  /** "cancel" while an editor input is open. */
  cancel: 90,
  /** Ambient keys: help, quit. */
  ambient: 95,
} as const

/**
 * Create the application keymap.
 *
 * `createDefaultOpenTuiKeymap()` installs the shared key parser and the
 * `enabled` / `desc` / `group` field addons. The extra `hint` binding field
 * is app-local: it publishes the hint-bar order as binding metadata.
 */
export function createAppKeymap(renderer: RendererFor): AppKeymap {
  const keymap = createDefaultOpenTuiKeymap(renderer)
  keymap.registerBindingFields({
    hint(value, ctx) {
      ctx.attr("hint", value)
    },
  })
  return keymap
}

type RendererFor = Parameters<typeof createDefaultOpenTuiKeymap>[0]

/** Adapt a Solid accessor to a keymap `enabled` matcher. */
export function when<T>(accessor: Accessor<T>, predicate: (value: T) => boolean): ReactiveMatcher {
  return reactiveMatcherFromSignal(accessor, predicate)
}

/** Matcher that is active only while every matcher is active. */
export function allOf(...matchers: ReactiveMatcher[]): ReactiveMatcher {
  return {
    get: () => matchers.every((matcher) => matcher.get()),
    subscribe(onChange) {
      const disposers = matchers.map((matcher) => matcher.subscribe(onChange))
      return () => {
        for (const dispose of disposers) dispose()
      }
    },
  }
}

/** Matcher that is active while at least one matcher is active. */
export function anyOf(...matchers: ReactiveMatcher[]): ReactiveMatcher {
  return {
    get: () => matchers.some((matcher) => matcher.get()),
    subscribe(onChange) {
      const disposers = matchers.map((matcher) => matcher.subscribe(onChange))
      return () => {
        for (const dispose of disposers) dispose()
      }
    },
  }
}

/**
 * Active while no screen editor input (search box, server host, memory
 * editor, rename field) is open.
 *
 * This gate is not cosmetic: keymap runs before the focused renderable and
 * `preventDefault`s matched bindings, so a live single-letter binding would
 * swallow characters typed into an `<input>`.
 */
export function notEditing(): ReactiveMatcher {
  return when(textInputActive, (active) => !active)
}
