import { onMount, For, Show, createSignal, createMemo, createEffect } from "solid-js"
import { useTerminalDimensions } from "@opentui/solid"
import { useBindings } from "@opentui/keymap/solid"
import type { ScrollBoxRenderable } from "@opentui/core"
import {
  instances,
  versions,
  goBack,
  navigate,
  setStatusMessage,
  setBusy,
  busy,
  runningInstanceIds,
} from "../app/state"
import { HINT, allOf, when } from "../app/keymap"
import { useInstancePings } from "../app/useInstancePings"
import { launcherService } from "../services/launcher"
import { InstanceCard, CARD_HEIGHT } from "../components/InstanceCard"
import { KeyHints } from "../components/KeyHints"
import { Progress } from "../components/Progress"

/**
 * Instances: a responsive grid of instance cards, create, open detail,
 * and launch in place.
 *
 * Each card shows the instance's loader/version/heap plus the live
 * Server List Ping status and MOTD for its auto-connect target (green =
 * online, red = unreachable, yellow = checking). Navigation is
 * grid-aware; when the cards exceed the visible area the grid pages
 * (`[`/`]` or PageUp/PageDown). One shared hint bar at the bottom.
 */
const CARD_MIN_WIDTH = 32
const GRID_GAP = 1
const MAX_COLUMNS = 3
/** Fixed rows outside the grid: header/statusbar/hints, screen padding,
 *  title + spacer, and the (busy-only) progress block. */
const CHROME_ROWS = 9

export function InstancesScreen() {
  const dims = useTerminalDimensions()
  const [selected, setSelected] = createSignal(0)
  const { pings, reping } = useInstancePings()
  const [creating, setCreating] = createSignal(false)
  const [createSelected, setCreateSelected] = createSignal(0)
  const [pickingLoader, setPickingLoader] = createSignal(false)
  const [loaderSelected, setLoaderSelected] = createSignal(0)

  const LOADER_CHOICES = ["vanilla", "fabric"] as const

  // ── Responsive grid geometry ────────────────────────────────────
  const columns = createMemo(() => {
    const usable = Math.max(1, dims().width - 2)
    return Math.max(1, Math.min(MAX_COLUMNS, Math.floor(usable / (CARD_MIN_WIDTH + GRID_GAP))))
  })
  const cardWidth = createMemo(() => {
    const usable = Math.max(1, dims().width - 2)
    const fitted = Math.floor((usable - (columns() - 1) * GRID_GAP) / columns())
    // Never force a card wider than the terminal can show.
    return Math.max(Math.min(CARD_MIN_WIDTH, usable), fitted)
  })
  const rowsPerPage = createMemo(() => {
    const usable = Math.max(1, dims().height - CHROME_ROWS)
    return Math.max(1, Math.floor((usable + GRID_GAP) / (CARD_HEIGHT + GRID_GAP)))
  })
  const pageSize = createMemo(() => columns() * rowsPerPage())
  const page = createMemo(() => Math.floor(selected() / pageSize()))
  const totalPages = createMemo(() => Math.max(1, Math.ceil(instances().length / pageSize())))
  const visible = createMemo(() => {
    const start = page() * pageSize()
    return instances().slice(start, start + pageSize())
  })

  // Live server status is provided by useInstancePings().

  onMount(() => {
    void launcherService.refreshInstances()
  })

  // Keep the cursor inside the list as it changes (create/delete/refresh).
  createEffect(() => {
    const count = instances().length
    setSelected((s) => Math.max(0, Math.min(count - 1, s)))
  })

  function moveBy(delta: number) {
    setSelected((s) => Math.max(0, Math.min(instances().length - 1, s + delta)))
  }

  async function refresh() {
    await launcherService.refreshInstances()
    void reping()
  }

  function openDetail() {
    const instance = instances()[selected()]
    if (instance) navigate("instance-detail", instance.id)
  }

  async function launchSelected() {
    const inst = instances()[selected()]
    if (!inst || busy()) return
    if (runningInstanceIds().includes(inst.id)) {
      setStatusMessage("Already running — press Enter for details, then ctrl+x to close")
      return
    }
    try {
      await launcherService.launchInstance(inst)
    } catch (err) {
      setStatusMessage(`Launch failed: ${err instanceof Error ? err.message : String(err)}`)
    }
  }

  async function startCreate() {
    setCreating(true)
    try {
      await launcherService.refreshVersions()
    } catch (err) {
      setStatusMessage(`Failed to fetch versions: ${err instanceof Error ? err.message : String(err)}`)
      setCreating(false)
    }
  }

  async function confirmCreate() {
    const version = versions()[createSelected()]
    if (!version) return
    setBusy(true)
    try {
      const chosen = LOADER_CHOICES[loaderSelected()] ?? "vanilla"
      await launcherService.createInstance(version.id, version.id, chosen)
      setStatusMessage(`Created instance "${version.id}" (${chosen})`)
      setCreating(false)
      setPickingLoader(false)
    } catch (err) {
      setStatusMessage(`Create failed: ${err instanceof Error ? err.message : String(err)}`)
    } finally {
      setBusy(false)
    }
  }

  // ── Key bindings (OpenTUI keymap) ───────────────────────────────
  // One layer per mode. The grid layer is switched off while the create
  // flow owns the screen, so the arrow keys keep one meaning per mode and
  // the hint bar follows along.
  useBindings(() => ({
    enabled: when(creating, (isCreating) => !isCreating),
    commands: [
      { name: "instances.back", run: () => goBack() },
      { name: "instances.launch", run: () => void launchSelected() },
      { name: "instances.detail", run: () => openDetail() },
      { name: "instances.refresh", run: () => void refresh() },
      { name: "instances.create", run: () => void startCreate() },
      { name: "instances.prevRow", run: () => moveBy(-columns()) },
      { name: "instances.nextRow", run: () => moveBy(columns()) },
      { name: "instances.prev", run: () => moveBy(-1) },
      { name: "instances.next", run: () => moveBy(1) },
      { name: "instances.prevPage", run: () => moveBy(-pageSize()) },
      { name: "instances.nextPage", run: () => moveBy(pageSize()) },
      { name: "instances.first", run: () => setSelected(0) },
      { name: "instances.last", run: () => setSelected(Math.max(0, instances().length - 1)) },
    ],
    bindings: [
      // Bindings sharing a `hint` order and `desc` render as one grouped hint.
      { key: "left", cmd: "instances.prev", desc: "navigate", hint: HINT.primary },
      { key: "up", cmd: "instances.prevRow", desc: "navigate", hint: HINT.primary },
      { key: "down", cmd: "instances.nextRow", desc: "navigate", hint: HINT.primary },
      { key: "right", cmd: "instances.next", desc: "navigate", hint: HINT.primary },
      { key: "k", cmd: "instances.prevRow" },
      { key: "j", cmd: "instances.nextRow" },
      { key: "l", cmd: "instances.launch", desc: "launch", hint: HINT.secondary },
      { key: "return", cmd: "instances.detail", desc: "details", hint: HINT.secondary },
      { key: "c", cmd: "instances.create", desc: "new", hint: HINT.secondary },
      { key: "[", cmd: "instances.prevPage", desc: "page", hint: HINT.edit },
      { key: "]", cmd: "instances.nextPage", desc: "page", hint: HINT.edit },
      { key: "pageup", cmd: "instances.prevPage" },
      { key: "pagedown", cmd: "instances.nextPage" },
      { key: "home", cmd: "instances.first" },
      { key: "end", cmd: "instances.last" },
      { key: "r", cmd: "instances.refresh", desc: "re-ping", hint: HINT.edit },
      { key: "escape", cmd: "instances.back", desc: "back", hint: HINT.cancel },
    ],
  }))

  // Version picker: the whole manifest scrolls, not only the newest 20.
  useBindings(() => ({
    enabled: allOf(
      when(creating, (isCreating) => isCreating),
      when(pickingLoader, (picking) => !picking),
    ),
    commands: [
      { name: "instances.create.cancel", run: () => setCreating(false) },
      { name: "instances.create.prev", run: () => setCreateSelected((s) => Math.max(0, s - 1)) },
      {
        name: "instances.create.next",
        run: () => setCreateSelected((s) => Math.min(versions().length - 1, s + 1)),
      },
      {
        name: "instances.create.accept",
        run() {
          setLoaderSelected(0)
          setPickingLoader(true)
        },
      },
    ],
    bindings: [
      { key: "up", cmd: "instances.create.prev", desc: "version", hint: HINT.primary },
      { key: "down", cmd: "instances.create.next", desc: "version", hint: HINT.primary },
      { key: "k", cmd: "instances.create.prev" },
      { key: "j", cmd: "instances.create.next" },
      { key: "return", cmd: "instances.create.accept", desc: "next: loader", hint: HINT.secondary },
      { key: "escape", cmd: "instances.create.cancel", desc: "cancel", hint: HINT.cancel },
    ],
  }))

  useBindings(() => ({
    enabled: allOf(
      when(creating, (isCreating) => isCreating),
      when(pickingLoader, (picking) => picking),
    ),
    commands: [
      { name: "instances.loader.back", run: () => setPickingLoader(false) },
      { name: "instances.loader.prev", run: () => setLoaderSelected((s) => Math.max(0, s - 1)) },
      {
        name: "instances.loader.next",
        run: () => setLoaderSelected((s) => Math.min(LOADER_CHOICES.length - 1, s + 1)),
      },
      { name: "instances.loader.accept", run: () => void confirmCreate() },
    ],
    bindings: [
      { key: "up", cmd: "instances.loader.prev", desc: "loader", hint: HINT.primary },
      { key: "down", cmd: "instances.loader.next", desc: "loader", hint: HINT.primary },
      { key: "k", cmd: "instances.loader.prev" },
      { key: "j", cmd: "instances.loader.next" },
      { key: "return", cmd: "instances.loader.accept", desc: "create", hint: HINT.secondary },
      { key: "escape", cmd: "instances.loader.back", desc: "back to versions", hint: HINT.cancel },
    ],
  }))

  // Keep the version cursor in view as it moves through a long manifest.
  // The ref is a signal so the effect also runs when the list first appears.
  const [versionListRef, setVersionListRef] = createSignal<ScrollBoxRenderable>()
  createEffect(() => {
    const list = versionListRef()
    if (!list) return
    list.scrollChildIntoView(`version-row-${createSelected()}`)
  })

  return (
    <box flexDirection="column" flexGrow={1}>
      <box flexGrow={1} padding={1} flexDirection="column">
        <Show
          when={!creating()}
          fallback={
            <box flexGrow={1} flexDirection="column" alignItems="center">
            <Show
              when={!pickingLoader()}
              fallback={
                <box flexDirection="column">
                  <text fg="#cdd6f4" attributes={2}>
                    New instance — pick a mod loader
                  </text>
                  <box height={1} />
                  <For each={[...LOADER_CHOICES]}>
                    {(loader, i) => (
                      <box flexDirection="row" height={1}>
                        <text
                          fg={loaderSelected() === i() ? "#89b4fa" : "#cdd6f4"}
                          attributes={loaderSelected() === i() ? 1 : 0}
                        >
                          {loaderSelected() === i() ? "▸ " : "  "}
                          {loader}
                        </text>
                        <text fg="#585b70">
                          {loader === "vanilla"
                            ? " — plain Minecraft, no mods"
                            : " — Fabric libraries load on launch; add mods via the Mods screen"}
                        </text>
                      </box>
                    )}
                  </For>
                  <box height={1} />
                  <text fg="#6c7086">↑/↓ + Enter to create · Esc to pick a different version</text>
                </box>
              }
            >
              <box flexDirection="column" flexGrow={1} width="100%">
                <text fg="#cdd6f4" attributes={2} flexShrink={0}>
                  New instance — pick a Minecraft version
                </text>
                <box height={1} flexShrink={0} />
                <scrollbox
                  ref={setVersionListRef}
                  flexGrow={1}
                  scrollbarOptions={{ showArrows: false }}
                >
                  <For each={versions()}>
                    {(version, i) => (
                      <box id={`version-row-${i()}`} flexDirection="row" height={1}>
                        <text
                          fg={createSelected() === i() ? "#89b4fa" : "#cdd6f4"}
                          attributes={createSelected() === i() ? 1 : 0}
                        >
                          {createSelected() === i() ? "▸ " : "  "}
                          {version.id}
                        </text>
                        <text fg="#585b70"> {version.type}</text>
                      </box>
                    )}
                  </For>
                </scrollbox>
                <text fg="#6c7086" flexShrink={0}>
                  Enter picks a mod loader next · Esc cancels
                </text>
              </box>
            </Show>
            </box>
          }
        >
          <box flexDirection="row" height={1} justifyContent="center">
            <text fg="#cdd6f4" attributes={2}>
              Instances
            </text>
            <text fg="#585b70"> · {instances().length}</text>
            <Show when={totalPages() > 1}>
              <text fg="#6c7086">
                {"   "}page {page() + 1}/{totalPages()} · {page() * pageSize() + 1}–
                {Math.min(instances().length, (page() + 1) * pageSize())} of {instances().length}
              </text>
            </Show>
          </box>
          <box height={1} />
          <Show
            when={instances().length > 0}
            fallback={
              <box flexDirection="row" justifyContent="center">
                <text fg="#6c7086">No instances yet — press 'c' to create one.</text>
              </box>
            }
          >
            <box
              flexDirection="row"
              flexWrap="wrap"
              columnGap={GRID_GAP}
              rowGap={GRID_GAP}
              justifyContent="center"
            >
              <For each={visible()}>
                {(instance, i) => (
                  <InstanceCard
                    instance={instance}
                    selected={instance.id === instances()[selected()]?.id}
                    running={runningInstanceIds().includes(instance.id)}
                    ping={pings()[instance.id] ?? { state: "idle" }}
                    width={cardWidth()}
                    onClick={() => {
                      const globalIndex = page() * pageSize() + i()
                      if (selected() === globalIndex) openDetail()
                      else setSelected(globalIndex)
                    }}
                  />
                )}
              </For>
            </box>
          </Show>
          <box flexGrow={1} />
          <Progress />
        </Show>
      </box>
      <KeyHints />
    </box>
  )
}
