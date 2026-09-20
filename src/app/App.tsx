import { Switch, Match, Show, createEffect, createMemo, onCleanup, type JSX } from "solid-js"
import { useRenderer } from "@opentui/solid"
import type { ClipboardService } from "@opentui/core"
import { useBindings, useKeymap, useKeymapSelector } from "@opentui/keymap/solid"
import { screen, navigate, setStatusMessage } from "./state"
import { HINT, notEditing } from "./keymap"
import { useCopySelectionOnRelease } from "./clipboard"
import { Banner } from "../components/Banner"
import { StatusBar } from "../components/StatusBar"
import { Dialog } from "../components/Dialog"
import { HomeScreen } from "../screens/HomeScreen"
import { LoginScreen } from "../screens/LoginScreen"
import { InstancesScreen } from "../screens/InstancesScreen"
import { InstanceDetailScreen } from "../screens/InstanceDetailScreen"
import { ModsScreen } from "../screens/ModsScreen"
import { WorldsScreen } from "../screens/WorldsScreen"
import { SettingsScreen } from "../screens/SettingsScreen"
import { LogsScreen } from "../screens/LogsScreen"
import { HelpScreen } from "../screens/HelpScreen"

/** A pending `q` is dropped after this long so a stray press can't linger. */
const QUIT_CONFIRM_MS = 4000

/**
 * Root component: header + active screen + status bar.
 *
 * Owns only the ambient bindings that apply everywhere — help (`?`) and
 * quit (`q q`). Each screen registers the rest of its keys with
 * `useBindings()` while it is mounted, so layers appear and disappear with
 * the `<Switch>` below.
 */
export function App(props: { clipboard?: ClipboardService }): JSX.Element {
  const renderer = useRenderer()
  const keymap = useKeymap()
  if (props.clipboard) useCopySelectionOnRelease(props.clipboard)

  // Quit is a two-stroke sequence rather than a timer + flag: `q` arms the
  // sequence, a second `q` runs app.quit, and any other key clears it.
  const pending = useKeymapSelector((keymap) => keymap.getPendingSequence())
  const quitPending = createMemo(() => pending().length > 0)

  createEffect(() => {
    if (!quitPending()) return
    setStatusMessage("Press 'q' again to quit — any other key cancels")
    const timer = setTimeout(() => {
      keymap.clearPendingSequence()
      setStatusMessage("Quit cancelled")
    }, QUIT_CONFIRM_MS)
    onCleanup(() => clearTimeout(timer))
  })

  useBindings(() => ({
    // Never steal keystrokes from an open editor input.
    enabled: notEditing(),
    commands: [
      {
        name: "app.help",
        desc: "keyboard reference",
        run() {
          // `?` is a no-op on the help screen itself (Esc leaves it).
          if (screen() !== "help") navigate("help")
        },
      },
      {
        name: "app.quit",
        desc: "quit bhmc",
        run() {
          renderer.destroy()
        },
      },
    ],
    bindings: [
      { key: "?", cmd: "app.help", desc: "help", hint: HINT.ambient },
      // Metadata-only prefix binding: it documents the first stroke of the
      // quit sequence so the hint bar can show it before it is pending.
      { key: "q", desc: "quit", hint: HINT.ambient },
      { key: "qq", cmd: "app.quit", desc: "quit", hint: HINT.ambient },
    ],
  }))

  return (
    <box flexDirection="column" flexGrow={1}>
      <Banner />
      <box flexDirection="column" flexGrow={1}>
        <Switch>
          <Match when={screen() === "home"}>
            <HomeScreen />
          </Match>
          <Match when={screen() === "login"}>
            <LoginScreen />
          </Match>
          <Match when={screen() === "instances"}>
            <InstancesScreen />
          </Match>
          <Match when={screen() === "instance-detail"}>
            <InstanceDetailScreen />
          </Match>
          <Match when={screen() === "mods"}>
            <ModsScreen />
          </Match>
          <Match when={screen() === "worlds"}>
            <WorldsScreen />
          </Match>
          <Match when={screen() === "settings"}>
            <SettingsScreen />
          </Match>
          <Match when={screen() === "logs"}>
            <LogsScreen />
          </Match>
          <Match when={screen() === "help"}>
            <HelpScreen />
          </Match>
        </Switch>
      </box>
      <StatusBar />
      <Show when={quitPending()}>
        <Dialog title="Quit bhmc?">
          <text fg="#cdd6f4">Press 'q' again to quit.</text>
          <text fg="#6c7086">Any other key cancels.</text>
        </Dialog>
      </Show>
    </box>
  )
}
