import { Switch, Match, Show, createSignal, onCleanup, type JSX } from "solid-js"
import { useRenderer, useKeyboard } from "@opentui/solid"
import type { ClipboardService } from "@opentui/core"
import { screen, navigate, textInputActive, setStatusMessage } from "./state"
import { useCopySelectionOnRelease } from "./clipboard"
import { Header } from "../components/Header"
import { StatusBar } from "../components/StatusBar"
import { Dialog } from "../components/Dialog"
import { HomeScreen } from "../screens/HomeScreen"
import { LoginScreen } from "../screens/LoginScreen"
import { InstancesScreen } from "../screens/InstancesScreen"
import { InstanceDetailScreen } from "../screens/InstanceDetailScreen"
import { ModsScreen } from "../screens/ModsScreen"
import { SettingsScreen } from "../screens/SettingsScreen"
import { LogsScreen } from "../screens/LogsScreen"
import { HelpScreen } from "../screens/HelpScreen"

/**
 * Root component: header + active screen + status bar.
 *
 * Handles only global keys; screens subscribe to their own keys and
 * clean up automatically when they unmount (Solid owner cleanup).
 */
export function App(props: { clipboard?: ClipboardService }): JSX.Element {
  const renderer = useRenderer()
  if (props.clipboard) useCopySelectionOnRelease(props.clipboard)

  // Quit needs a second press so a stray 'q' can't kill the session.
  const QUIT_CONFIRM_MS = 4000
  const [confirmQuit, setConfirmQuit] = createSignal(false)
  let quitTimer: ReturnType<typeof setTimeout> | undefined

  function armQuit() {
    clearTimeout(quitTimer)
    setConfirmQuit(true)
    setStatusMessage("Press 'q' again to quit — any other key cancels")
    quitTimer = setTimeout(() => {
      setConfirmQuit(false)
      setStatusMessage("Quit cancelled")
    }, QUIT_CONFIRM_MS)
  }

  function cancelQuit() {
    clearTimeout(quitTimer)
    if (confirmQuit()) {
      setConfirmQuit(false)
      setStatusMessage("Quit cancelled")
    }
  }

  onCleanup(() => clearTimeout(quitTimer))

  useKeyboard((key) => {
    // Screens with editor inputs (search, server host) capture keys —
    // don't quit or navigate on characters the user is typing.
    if (textInputActive()) return
    if (key.name === "q") {
      if (confirmQuit()) {
        clearTimeout(quitTimer)
        renderer.destroy()
      } else {
        armQuit()
      }
      return
    }
    // Any other key dismisses a pending quit without acting on it.
    if (confirmQuit()) {
      cancelQuit()
      return
    }
    if (key.sequence === "?" && screen() !== "help") {
      navigate("help")
      return
    }
    // Global jumps only from the home screen so lists keep their keys.
    // ('l' is not a global shortcut — it launches the selected instance on
    // the home/instance screens; Logs is in the home menu.)
    if (screen() !== "home") return
    if (key.name === "i") navigate("instances")
    else if (key.name === "a") navigate("login")
    else if (key.name === "m") navigate("mods")
    else if (key.name === "s") navigate("settings")
  })

  return (
    <box flexDirection="column" flexGrow={1}>
      <Header />
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
      <Show when={confirmQuit()}>
        <Dialog title="Quit bhmc?">
          <text fg="#cdd6f4">Press 'q' again to quit.</text>
          <text fg="#6c7086">Any other key cancels.</text>
        </Dialog>
      </Show>
    </box>
  )
}
