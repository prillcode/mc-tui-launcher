import { Switch, Match } from "solid-js"
import { useRenderer, useKeyboard } from "@opentui/solid"
import { screen, navigate } from "./state"
import { createAppClipboard, useCopySelectionOnRelease } from "./clipboard"
import { Header } from "../components/Header"
import { StatusBar } from "../components/StatusBar"
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
export function App() {
  const renderer = useRenderer()
  const clipboard = createAppClipboard()
  useCopySelectionOnRelease(clipboard)

  useKeyboard((key) => {
    if (key.name === "q") {
      renderer.destroy()
      return
    }
    if (key.sequence === "?" && screen() !== "help") {
      navigate("help")
      return
    }
    // Global jumps only from the home screen so lists keep their keys
    if (screen() !== "home") return
    if (key.name === "i") navigate("instances")
    else if (key.name === "a") navigate("login")
    else if (key.name === "m") navigate("mods")
    else if (key.name === "s") navigate("settings")
    else if (key.name === "l") navigate("logs")
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
    </box>
  )
}
