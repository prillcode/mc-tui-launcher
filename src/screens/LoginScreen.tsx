import { onMount, onCleanup, Show, Switch, Match } from "solid-js"
import { useKeyboard } from "@opentui/solid"
import {
  screen,
  deviceCode,
  loginStatus,
  loginError,
  setLoginStatus,
  setDeviceCode,
  setLoginError,
  setProfile,
  setStatusMessage,
  goBack,
} from "../app/state"
import { launcherService } from "../services/launcher"
import { KeyHints } from "../components/KeyHints"

/**
 * Open a URL in the user's default browser. The terminal's own
 * Ctrl+click link handling is suppressed while mctui enables mouse
 * reporting, so we handle clicks on the link element ourselves.
 */
function openExternalUrl(url: string): void {
  try {
    if (process.platform === "win32") {
      Bun.spawn(["cmd", "/c", "start", "", url], { stdio: ["ignore", "ignore", "ignore"] })
    } else {
      Bun.spawn([process.platform === "darwin" ? "open" : "xdg-open", url], {
        stdio: ["ignore", "ignore", "ignore"],
      })
    }
    setStatusMessage("Opened verification URL in browser")
  } catch (err) {
    setStatusMessage(`Could not open URL: ${err instanceof Error ? err.message : String(err)}`)
  }
}

/**
 * Microsoft device-code login.
 *
 * The verification URL and short code are always visible as text; a QR
 * code is rendered when the terminal can fit it. Esc cancels the UI
 * flow (the pending MSAL request is simply abandoned; starting a new
 * login resets MSAL state, as in the reference implementation).
 */
export function LoginScreen() {
  let flowStarted = false

  onMount(async () => {
    if (flowStarted) return
    flowStarted = true

    setLoginStatus("requesting-code")
    setLoginError(null)
    setDeviceCode(null)

    try {
      const code = await launcherService.startLogin()
      setDeviceCode(code)
      setLoginStatus("awaiting-user")

      // Await completion in the background; do not block the UI
      setLoginStatus("completing")
      const profileResult = await launcherService.completeLogin()
      setProfile(profileResult)
      setLoginStatus("success")
      setStatusMessage(`Signed in as ${profileResult.name}`)
    } catch (err) {
      setLoginStatus("error")
      setLoginError(err instanceof Error ? err.message : String(err))
    }
  })

  useKeyboard((key) => {
    if (screen() !== "login") return
    if (key.name === "escape") {
      if (loginStatus() === "success") {
        setStatusMessage("")
      } else {
        setStatusMessage("Login cancelled")
      }
      goBack()
    }
  })

  return (
    <box flexDirection="column" flexGrow={1}>
      <box flexGrow={1} padding={1} flexDirection="row">
        <box flexDirection="column" flexGrow={1}>
          <text fg="#cdd6f4" attributes={2}>
            Microsoft Device Login
          </text>
          <box height={1} />
          <Switch>
            <Match when={loginStatus() === "requesting-code"}>
              <text fg="#f9e2af">Requesting device code…</text>
            </Match>
            <Match when={deviceCode()}>
              {(() => {
                const url = deviceCode()!.verificationUri
                // Distinguish a plain click from the start of a selection
                // drag: remember where the press happened and only treat
                // a release at (roughly) the same cell as a click.
                let downAt: { x: number; y: number } | null = null
                return (
                  <>
                    <text fg="#cdd6f4">1. Open this URL in a browser (click it):</text>
                    <box
                      onMouseDown={(e) => {
                        downAt = { x: e.x, y: e.y }
                      }}
                      onMouseUp={(e) => {
                        if (!downAt || e.button !== 0) return
                        const moved = Math.abs(e.x - downAt.x) + Math.abs(e.y - downAt.y)
                        downAt = null
                        if (moved <= 1) openExternalUrl(url)
                      }}
                    >
                      <text fg="#89b4fa">
                        <a href={url}>
                          <u>{url}</u>
                        </a>
                      </text>
                    </box>
                    <box height={1} />
                    <text fg="#cdd6f4">2. Enter this code (double-click it to copy):</text>
                    <text fg="#a6e3a1" attributes={1}>
                      {deviceCode()!.userCode}
                    </text>
                    <box height={1} />
                    <Switch>
                      <Match when={loginStatus() === "awaiting-user" || loginStatus() === "completing"}>
                        <text fg="#f9e2af">Waiting for you to complete sign-in… (Esc to cancel)</text>
                      </Match>
                      <Match when={loginStatus() === "success"}>
                        <text fg="#a6e3a1">Signed in successfully!</text>
                      </Match>
                    </Switch>
                  </>
                )
              })()}
            </Match>
            <Match when={loginError()}>
              <text fg="#f38ba8">Login failed: {loginError()}</text>
              <text fg="#6c7086">Esc to go back. Set MS_CLIENT_ID in the environment to enable login.</text>
            </Match>
          </Switch>
        </box>
        <box width={20} flexDirection="column" justifyContent="center">
          <Show when={deviceCode()}>
            <text fg="#6c7086">or scan:</text>
            <qr_code content={deviceCode()!.verificationUri} scale={1} />
          </Show>
        </box>
      </box>
      <KeyHints
        hints={[
          ["click", "open link"],
          ["select", "copy text"],
          ["Esc", "back / cancel"],
        ]}
      />
    </box>
  )
}
