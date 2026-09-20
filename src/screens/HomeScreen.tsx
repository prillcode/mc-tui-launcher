import { For, Show, createSignal, createMemo, createEffect } from "solid-js"
import { useTerminalDimensions } from "@opentui/solid"
import { useBindings } from "@opentui/keymap/solid"
import {
  navigate,
  profile,
  setStatusMessage,
  instances,
  busy,
  runningInstanceIds,
  setWorldsFocusInstanceId,
} from "../app/state"
import { HINT, when } from "../app/keymap"
import { launcherService } from "../services/launcher"
import { useInstancePings } from "../app/useInstancePings"
import { KeyHints } from "../components/KeyHints"
import { Centered } from "../components/Centered"
import { InstanceCard } from "../components/InstanceCard"

const CARD_MIN_WIDTH = 32
const GRID_GAP = 1
const MAX_COLUMNS = 3

/**
 * Home: a centered, text-only launch pad.
 *
 *   Signed in as …
 *   [ instance cards — click/Enter launches ]
 *   Minecraft Instances          (menu)
 *     manage & launch
 *   ────────────────────────
 *     Account/Login
 *     …
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
    { label: "Worlds", hint: "browse, back up & restore saves", run: () => openWorlds() },
    { label: "Servers", hint: "Docker & local dedicated-server worlds", run: () => navigate("servers") },
    { label: "Account/Login", hint: "device-code sign-in", run: () => navigate("login") },
    { label: "Mods & Shaders", hint: "Modrinth & installed mods", run: () => navigate("mods") },
    { label: "Settings", hint: "launcher configuration", run: () => navigate("settings") },
    { label: "Logs", hint: "launcher & game output", run: () => navigate("logs") },
    { label: "Help", hint: "keyboard reference", run: () => navigate("help") },
  ]

  /** Open the Worlds screen focused on the instance selected on Home. */
  function openWorlds(): void {
    const inst = shownInstances()[instanceIndex()]
    setWorldsFocusInstanceId(inst?.id ?? null)
    navigate("worlds")
  }

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

  // ── Key bindings (OpenTUI keymap) ───────────────────────────────
  // Split by focused section so the hint bar only advertises the keys
  // that are live in that section; the shared layer covers the rest.
  const hasAnyInstance = () => instances().length > 0

  useBindings(() => ({
    enabled: when(section, (current) => current === "instances" && hasAnyInstance()),
    commands: [
      { name: "home.instance.prev", run: () => setInstanceIndex((i) => Math.max(0, i - 1)) },
      {
        name: "home.instance.next",
        run: () => setInstanceIndex((i) => Math.min(shownInstances().length - 1, i + 1)),
      },
      { name: "home.launch", run: () => void launchSelected() },
      { name: "home.focusMenu", run: () => setSection("menu") },
    ],
    bindings: [
      // Bindings that share a `hint` order and `desc` render as one hint.
      { key: "left", cmd: "home.instance.prev", desc: "instance", hint: HINT.primary },
      { key: "right", cmd: "home.instance.next", desc: "instance", hint: HINT.primary },
      { key: "return", cmd: "home.launch", desc: "launch", hint: HINT.primary },
      { key: "l", cmd: "home.launch", desc: "launch", hint: HINT.primary },
      { key: "down", cmd: "home.focusMenu", desc: "menu", hint: HINT.secondary },
      { key: "j", cmd: "home.focusMenu" },
    ],
  }))

  useBindings(() => ({
    enabled: when(section, (current) => current === "menu"),
    commands: [
      {
        name: "home.menu.prev",
        run() {
          if (menuIndex() === 0 && hasInstances()) setSection("instances")
          else setMenuIndex((i) => Math.max(0, i - 1))
        },
      },
      { name: "home.menu.next", run: () => setMenuIndex((i) => Math.min(menu.length - 1, i + 1)) },
      { name: "home.menu.activate", run: () => activateMenu() },
      { name: "home.launchFromMenu", run: () => void launchSelected() },
    ],
    bindings: [
      { key: "up", cmd: "home.menu.prev", desc: "menu", hint: HINT.primary },
      { key: "k", cmd: "home.menu.prev" },
      { key: "down", cmd: "home.menu.next", desc: "menu", hint: HINT.primary },
      { key: "j", cmd: "home.menu.next" },
      { key: "return", cmd: "home.menu.activate", desc: "select", hint: HINT.secondary },
      { key: "l", cmd: "home.launchFromMenu", desc: "launch", hint: HINT.secondary },
    ],
  }))

  // Section-independent home keys. They stay out of the hint bar: the menu
  // already lists these destinations with their own descriptions.
  useBindings(() => ({
    commands: [
      { name: "home.toggleSection", run: () => toggleSection() },
      { name: "nav.instances", run: () => navigate("instances") },
      { name: "nav.worlds", run: () => openWorlds() },
      { name: "nav.servers", run: () => navigate("servers") },
      { name: "nav.login", run: () => navigate("login") },
      { name: "nav.mods", run: () => navigate("mods") },
      { name: "nav.settings", run: () => navigate("settings") },
    ],
    bindings: [
      { key: "tab", cmd: "home.toggleSection", desc: "switch section", hint: HINT.edit },
      { key: "i", cmd: "nav.instances" },
      { key: "w", cmd: "nav.worlds" },
      { key: "d", cmd: "nav.servers" },
      { key: "a", cmd: "nav.login" },
      { key: "m", cmd: "nav.mods" },
      { key: "s", cmd: "nav.settings" },
    ],
  }))

  return (
    <box flexDirection="column" flexGrow={1}>
      <Centered maxWidth={100}>
        <box flexDirection="column" flexGrow={1} alignItems="center">
          <text fg="#6c7086">
            <Show when={profile()} fallback={<>Sign in with Microsoft to play online — press 'a'.</>}>
              Pick an instance to play.
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
                    onClick={() => {
                      if (section() === "instances" && i() === instanceIndex()) {
                        // Clicking the already-selected card launches it.
                        void launchSelected()
                      } else {
                        setSection("instances")
                        setInstanceIndex(i())
                      }
                    }}
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
                let downAt: { x: number; y: number } | null = null
                return (
                  <>
                    <Show when={i() > 0}>
                      <text fg="#45475a">{"─".repeat(menuWidth())}</text>
                    </Show>
                    <box
                      flexDirection="column"
                      backgroundColor={active() ? "#242438" : undefined}
                      paddingX={1}
                      onMouseDown={(e) => {
                        downAt = { x: e.x, y: e.y }
                      }}
                      onMouseUp={(e) => {
                        if (!downAt || e.button !== 0) return
                        const moved = Math.abs(e.x - downAt.x) + Math.abs(e.y - downAt.y)
                        downAt = null
                        if (moved > 1) return
                        setSection("menu")
                        setMenuIndex(i())
                        setStatusMessage("")
                        menu[i()]?.run()
                      }}
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
      <KeyHints />
    </box>
  )
}
