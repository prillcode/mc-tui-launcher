import { For, Show, createSignal, createMemo, createEffect } from "solid-js"
import { useKeyboard, useTerminalDimensions } from "@opentui/solid"
import {
  navigate,
  screen,
  profile,
  setStatusMessage,
  instances,
  busy,
  runningInstanceIds,
} from "../app/state"
import { launcherService } from "../services/launcher"
import { useInstancePings } from "../app/useInstancePings"
import { KeyHints } from "../components/KeyHints"
import { Centered } from "../components/Centered"
import { InstanceCard } from "../components/InstanceCard"
import { BlockhavenLogo } from "../components/BlockhavenLogo"

const CARD_MIN_WIDTH = 32
const GRID_GAP = 1
const MAX_COLUMNS = 3
const LOGO_SIZES = [32, 24, 20, 16, 12, 8]

/**
 * Home: a centered launch pad.
 *
 *   ╭────────╮
 *   │  logo  │            ASCII-art Blockhaven logo (top)
 *   ╰────────╯
 *   Welcome
 *   Signed in as …
 *   [ instance cards — read-only, Enter launches ]
 *   ▸ Play — Instances    (menu)
 *     Account …
 *
 * The instance cards are selectable and launch directly; managing or
 * creating instances stays on the Instances screen ('i').
 */
export function HomeScreen() {
  const dims = useTerminalDimensions()
  const [section, setSection] = createSignal<"instances" | "menu">("instances")
  const [instanceIndex, setInstanceIndex] = createSignal(0)
  const [menuIndex, setMenuIndex] = createSignal(0)
  const { pings } = useInstancePings()

  const menu: Array<{ label: string; hint: string; run: () => void }> = [
    { label: "Minecraft Instances", hint: "manage & launch", run: () => navigate("instances") },
    { label: "Account/Login", hint: "device-code sign-in", run: () => navigate("login") },
    { label: "Mods & Shaders", hint: "Modrinth & installed mods", run: () => navigate("mods") },
    { label: "Settings", hint: "launcher configuration", run: () => navigate("settings") },
    { label: "Logs", hint: "launcher & game output", run: () => navigate("logs") },
    { label: "Help", hint: "keyboard reference", run: () => navigate("help") },
  ]

  const columnWidth = () => Math.min(100, Math.max(16, dims().width - 4))
  const menuWidth = () => Math.min(44, Math.max(30, columnWidth() - 8))

  const columns = createMemo(() => {
    const usable = Math.max(1, columnWidth())
    return Math.max(1, Math.min(MAX_COLUMNS, Math.floor(usable / (CARD_MIN_WIDTH + GRID_GAP))))
  })
  const cardWidth = createMemo(() => {
    const usable = Math.max(1, columnWidth())
    const fitted = Math.floor((usable - (columns() - 1) * GRID_GAP) / columns())
    return Math.max(Math.min(CARD_MIN_WIDTH, usable), fitted)
  })
  const shownInstances = createMemo(() => instances().slice(0, columns()))
  const hiddenCount = createMemo(() => Math.max(0, instances().length - shownInstances().length))
  const hasInstances = () => shownInstances().length > 0

  // Largest logo that fits the leftover vertical space: the logo box takes
  // art/2 + 2 rows; the greeting, cards, divided two-line menu items,
  // spacers and chrome take ~30 more.
  const logoSize = createMemo(() => {
    const maxPixels = 2 * Math.max(2, dims().height - 32)
    const byWidth = Math.max(8, columnWidth() - 6)
    return LOGO_SIZES.find((n) => n <= maxPixels && n <= byWidth) ?? 8
  })

  // Keep the cursors in range as instances/menu change.
  createEffect(() => {
    const last = shownInstances().length - 1
    setInstanceIndex((i) => Math.max(0, Math.min(instances().length - 1, i)))
    void last
  })
  createEffect(() => {
    if (!hasInstances()) setSection("menu")
  })

  async function launchSelected() {
    const inst = shownInstances()[instanceIndex()]
    if (!inst || busy()) return
    if (runningInstanceIds().includes(inst.id)) {
      setStatusMessage(`"${inst.name}" is already running — press ctrl+x on its detail screen to close it`)
      return
    }
    try {
      await launcherService.launchInstance(inst)
    } catch (err) {
      setStatusMessage(`Launch failed: ${err instanceof Error ? err.message : String(err)}`)
    }
  }

  function activateMenu() {
    const action = menu[menuIndex()]
    if (!action) return
    setStatusMessage("")
    action.run()
  }

  function toggleSection() {
    if (!hasInstances()) {
      setSection("menu")
      return
    }
    setSection((s) => (s === "instances" ? "menu" : "instances"))
  }

  useKeyboard((key) => {
    if (screen() !== "home") return

    if (key.name === "tab") {
      toggleSection()
      return
    }

    if (section() === "instances" && hasInstances()) {
      if (key.name === "left") {
        setInstanceIndex((i) => Math.max(0, i - 1))
      } else if (key.name === "right") {
        setInstanceIndex((i) => Math.min(shownInstances().length - 1, i + 1))
      } else if (key.name === "down" || key.name === "j") {
        setSection("menu")
      } else if (key.name === "return" || key.name === "enter" || key.name === "l") {
        void launchSelected()
      }
      return
    }

    // Menu section
    if (key.name === "up" || key.name === "k") {
      if (menuIndex() === 0 && hasInstances()) setSection("instances")
      else setMenuIndex((i) => Math.max(0, i - 1))
    } else if (key.name === "down" || key.name === "j") {
      setMenuIndex((i) => Math.min(menu.length - 1, i + 1))
    } else if (key.name === "return" || key.name === "enter") {
      activateMenu()
    } else if (key.name === "l") {
      void launchSelected()
    }
  })

  return (
    <box flexDirection="column" flexGrow={1}>
      <Centered maxWidth={100} paddingY={0}>
        <box flexDirection="column" flexGrow={1} alignItems="center">
          <box
            border
            borderStyle="rounded"
            borderColor="#cba6f7"
            backgroundColor="#181825"
            paddingX={2}
            flexDirection="column"
            alignItems="center"
          >
            <BlockhavenLogo size={logoSize()} />
          </box>
          <box height={1} />
          <text fg="#6c7086">
            <Show when={profile()} fallback={<>Sign in with Microsoft to play online — press 'a'.</>}>
              Signed in as {profile()!.name}. Pick an instance to play.
            </Show>
          </text>
          <box height={1} />
          <Show
            when={hasInstances()}
            fallback={<text fg="#6c7086">No instances yet — press 'i' to set one up.</text>}
          >
            <box flexDirection="row" columnGap={GRID_GAP} justifyContent="center">
              <For each={shownInstances()}>
                {(instance, i) => (
                  <InstanceCard
                    instance={instance}
                    selected={section() === "instances" && i() === instanceIndex()}
                    running={runningInstanceIds().includes(instance.id)}
                    ping={pings()[instance.id] ?? { state: "idle" }}
                    width={cardWidth()}
                  />
                )}
              </For>
            </box>
          </Show>
          <Show when={hiddenCount() > 0}>
            <text fg="#6c7086">
              +{hiddenCount()} more on the Instances page (press 'i')
            </text>
          </Show>
          <box height={1} />
          <box width={menuWidth()} flexDirection="column">
            <For each={menu}>
              {(action, i) => {
                const active = () => section() === "menu" && menuIndex() === i()
                return (
                  <>
                    <Show when={i() > 0}>
                      <text fg="#45475a">{"─".repeat(menuWidth())}</text>
                    </Show>
                    <box
                      flexDirection="column"
                      backgroundColor={active() ? "#242438" : undefined}
                      paddingX={1}
                    >
                      <text fg={active() ? "#89b4fa" : "#cdd6f4"} attributes={active() ? 1 : 0}>
                        {active() ? "▸ " : "  "}
                        {action.label}
                      </text>
                      <text fg="#585b70">{"  "}{action.hint}</text>
                    </box>
                  </>
                )
              }}
            </For>
          </box>
        </box>
      </Centered>
      <KeyHints
        hints={
          section() === "instances"
            ? [
                ["←/→", "instance"],
                ["Enter/l", "launch"],
                ["↓", "menu"],
                ["i", "manage"],
                ["q q", "quit"],
              ]
            : [
                ["↑/↓", "menu"],
                ["Enter", "select"],
                ["l", "launch"],
                ["Tab", "instances"],
                ["q q", "quit"],
              ]
        }
      />
    </box>
  )
}
