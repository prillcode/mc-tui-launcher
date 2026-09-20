import { onMount, For, Show, createSignal, createMemo, createEffect, Switch, Match } from "solid-js"
import { useTerminalDimensions } from "@opentui/solid"
import { useBindings } from "@opentui/keymap/solid"
import type { ScrollBoxRenderable } from "@opentui/core"
import {
  instances,
  goBack,
  setStatusMessage,
  setBusy,
  busy,
  setProgress,
  setTextInputActive,
  modsFocusInstanceId,
  setModsFocusInstanceId,
} from "../app/state"
import { HINT, allOf, when } from "../app/keymap"
import { launcherService } from "../services/launcher"
import { KeyHints } from "../components/KeyHints"
import { Centered } from "../components/Centered"
import type { InstalledMod, ModrinthProject } from "@prillcode/mc-launcher-core"

type InstalledShader = { fileName: string; fileSize: number; installedAt: number }

/**
 * Rows the scrolling list must leave for everything around it: banner,
 * screen padding, the title and instance lines, the results header, the
 * hint bar and the status bar. The list is given an explicit height because
 * a `<scrollbox>` is not reliably shrink-constrained through the layout slot
 * that `<Switch>` renders its children into.
 */
const RESULTS_CHROME = 12
const INSTALLED_CHROME = 10

function formatSize(bytes: number): string {
  if (bytes >= 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
  if (bytes >= 1024) return `${(bytes / 1024).toFixed(0)} KB`
  return `${bytes} B`
}

/**
 * Mods: installed list + Modrinth search/install (required dependencies
 * like Fabric API are resolved and installed automatically by the core).
 *
 * Modes:
 *   installed     — mods (or shader packs with 'h'); x removes, e toggles
 *   search-input  — type a query, Enter runs the search (mods or shaders)
 *   results       — search hits; Enter installs
 *   import-input  — path to a local .jar, Enter imports it
 *
 * 'h' toggles the shader-packs list. In packs mode 's' searches Modrinth
 * shaders, Enter installs the selected hit (progress bar shows download
 * status), 'x' removes the selected pack, and Esc returns to mods mode.
 */
export function ModsScreen() {
  const [selected, setSelected] = createSignal(0)
  const [mods, setMods] = createSignal<InstalledMod[]>([])
  const [shaders, setShaders] = createSignal<InstalledShader[]>([])
  const [listType, setListType] = createSignal<"mods" | "shaders">("mods")
  const [instanceIndex, setInstanceIndex] = createSignal(0)
  const [mode, setMode] = createSignal<"installed" | "search-input" | "results" | "import-input">(
    "installed",
  )
  const [results, setResults] = createSignal<ModrinthProject[]>([])
  const [resultSelected, setResultSelected] = createSignal(0)
  const [resultKind, setResultKind] = createSignal<"mods" | "shaders">("mods")
  let searchValue = ""

  const dims = useTerminalDimensions()
  const instance = createMemo(() => instances()[instanceIndex()])
  const listLength = () => (listType() === "shaders" ? shaders().length : mods().length)
  const listHeight = (chrome: number) => Math.max(3, dims().height - chrome)

  async function loadCurrent() {
    const inst = instance()
    if (!inst) return
    setBusy(true)
    try {
      if (listType() === "shaders") setShaders(await launcherService.listShaders(inst.id))
      else setMods(await launcherService.listMods(inst.id))
    } catch (err) {
      setStatusMessage(
        `Failed to list ${listType() === "shaders" ? "shader packs" : "mods"}: ${
          err instanceof Error ? err.message : String(err)
        }`,
      )
    } finally {
      setBusy(false)
    }
  }

  onMount(() => {
    // When opened from an instance detail view, focus that instance
    const focusId = modsFocusInstanceId()
    if (focusId) {
      const idx = instances().findIndex((i) => i.id === focusId)
      if (idx >= 0) setInstanceIndex(idx)
      setModsFocusInstanceId(null)
    }
    void loadCurrent()
  })

  async function runSearch() {
    const inst = instance()
    if (!inst) return
    const kind = listType()
    setBusy(true)
    try {
      const query = searchValue
      const res =
        kind === "shaders"
          ? await launcherService.searchShaders(query, inst)
          : await launcherService.searchMods(query, inst)
      // Defer the mode switch to the next macrotask: the same Enter key
      // event that submitted the search is dispatched to this screen's
      // keyboard handler after the submit handler's await completes, and
      // must not be seen as an "install" press in the new mode.
      setTimeout(() => {
        setTextInputActive(false)
        setResults(res.hits.slice(0, 20))
        setResultKind(kind)
        setResultSelected(0)
        setMode("results")
        if (res.hits.length === 0) {
          setStatusMessage(`No ${kind === "shaders" ? "shader packs" : "mods"} found for "${query}"`)
        }
        setBusy(false)
      }, 0)
    } catch (err) {
      setStatusMessage(`Search failed: ${err instanceof Error ? err.message : String(err)}`)
      setBusy(false)
    }
  }

  async function installSelected() {
    const inst = instance()
    const hit = results()[resultSelected()]
    if (!inst || !hit || busy()) return
    setBusy(true)
    try {
      if (resultKind() === "shaders") {
        setStatusMessage(`Installing shader pack ${hit.title}…`)
        const versionId = await launcherService.getShaderVersionId(inst, hit.slug)
        const info = await launcherService.installShaderFromModrinth(inst.id, versionId, (p) =>
          setProgress(p),
        )
        setStatusMessage(`Installed shader pack ${info.fileName}`)
        setListType("shaders")
      } else {
        setStatusMessage(`Installing ${hit.title}…`)
        const installed = await launcherService.installModFromSearch(inst.id, hit)
        setStatusMessage(
          installed.length > 1 ? `Installed: ${installed.join(", ")}` : `Installed ${installed[0] ?? hit.title}`,
        )
      }
      setMode("installed")
      void loadCurrent()
    } catch (err) {
      setStatusMessage(`Install failed: ${err instanceof Error ? err.message : String(err)}`)
    } finally {
      setProgress(null)
      setBusy(false)
    }
  }

  async function removeSelected() {
    const inst = instance()
    if (!inst || busy()) return
    setBusy(true)
    try {
      if (listType() === "shaders") {
        const shader = shaders()[selected()]
        if (!shader) return
        await launcherService.removeShader(inst.id, shader.fileName)
        setStatusMessage(`Removed ${shader.fileName}`)
        void loadCurrent()
        return
      }
      const mod = mods()[selected()]
      if (!mod) return
      await launcherService.removeMod(inst.id, mod.id)
      setStatusMessage(`Removed ${mod.name}`)
      void loadCurrent()
    } catch (err) {
      setStatusMessage(`Remove failed: ${err instanceof Error ? err.message : String(err)}`)
    } finally {
      setBusy(false)
    }
  }

  async function toggleSelected() {
    const inst = instance()
    const mod = mods()[selected()]
    if (!inst || !mod || busy()) return
    setBusy(true)
    try {
      const enabled = await launcherService.toggleMod(inst.id, mod.id)
      setStatusMessage(`${mod.name} ${enabled ? "enabled" : "disabled"}`)
      void loadCurrent()
    } catch (err) {
      setStatusMessage(`Failed: ${err instanceof Error ? err.message : String(err)}`)
    } finally {
      setBusy(false)
    }
  }

  function togglePacks() {
    if (busy() || mode() !== "installed") return
    const next = listType() === "shaders" ? "mods" : "shaders"
    setListType(next)
    setSelected(0)
    setStatusMessage(
      next === "shaders"
        ? "Shader packs — 's' searches Modrinth · 'x' removes · Esc back to mods"
        : "Mods",
    )
    void loadCurrent()
  }

  function openSearch() {
    const inst = instance()
    if (!inst || busy()) return
    if (listType() === "mods" && (inst.modLoader === "vanilla" || !inst.modLoader)) {
      setStatusMessage("Note: instance is vanilla — enable Fabric on instance detail for Fabric mods")
    }
    searchValue = ""
    // Defer to the next task so the opening keystroke is fully
    // dispatched before the editor input exists to receive it.
    setTimeout(() => {
      setTextInputActive(true)
      setMode("search-input")
    }, 0)
  }

  function closeSearch() {
    setTextInputActive(false)
    setMode("installed")
  }

  function openImport() {
    const inst = instance()
    if (!inst || busy()) return
    // Defer so the opening keystroke ('i') can't land in the input
    setTimeout(() => {
      setTextInputActive(true)
      setMode("import-input")
    }, 0)
  }

  function closeImport() {
    setTextInputActive(false)
    setMode("installed")
  }

  let importValue = ""

  async function runImport() {
    const inst = instance()
    if (!inst) return
    const jarPath = importValue
    try {
      const mod = await launcherService.importModFile(inst.id, jarPath)
      // Defer the mode switch so the submitting Enter isn't re-dispatched
      // as an action in the new mode (same pattern as runSearch).
      setTimeout(() => {
        setTextInputActive(false)
        setMode("installed")
        setStatusMessage(`Imported ${mod.name} into ${inst.name}`)
        void loadCurrent()
      }, 0)
    } catch (err) {
      setStatusMessage(`Import failed: ${err instanceof Error ? err.message : String(err)}`)
    }
  }

  // ── Key bindings (OpenTUI keymap) ───────────────────────────────
  // One layer per mode, plus dedicated Esc layers so leaving the screen
  // still works while a download is running (`busy`).
  useBindings(() => ({
    enabled: when(mode, (current) => current === "results" || current === "installed"),
    commands: [
      {
        name: "mods.back",
        run() {
          if (mode() === "results") {
            setMode("installed")
          } else if (listType() === "shaders") {
            // Esc leaves packs mode first, then the screen.
            setListType("mods")
            setSelected(0)
            void loadCurrent()
          } else {
            goBack()
          }
        },
      },
    ],
    bindings: [{ key: "escape", cmd: "mods.back", desc: "back", hint: HINT.cancel }],
  }))

  useBindings(() => ({
    enabled: allOf(when(mode, (current) => current === "results"), when(busy, (isBusy) => !isBusy)),
    commands: [
      { name: "mods.result.prev", run: () => setResultSelected((s) => Math.max(0, s - 1)) },
      {
        name: "mods.result.next",
        run: () => setResultSelected((s) => Math.min(results().length - 1, s + 1)),
      },
      { name: "mods.result.install", run: () => void installSelected() },
      { name: "mods.result.search", run: () => openSearch() },
    ],
    bindings: [
      { key: "up", cmd: "mods.result.prev", desc: "navigate", hint: HINT.primary },
      { key: "down", cmd: "mods.result.next", desc: "navigate", hint: HINT.primary },
      { key: "k", cmd: "mods.result.prev" },
      { key: "j", cmd: "mods.result.next" },
      { key: "return", cmd: "mods.result.install", desc: "install", hint: HINT.secondary },
      { key: "s", cmd: "mods.result.search", desc: "new search", hint: HINT.secondary },
    ],
  }))

  useBindings(() => ({
    enabled: allOf(when(mode, (current) => current === "installed"), when(busy, (isBusy) => !isBusy)),
    commands: [
      { name: "mods.togglePacks", run: () => togglePacks() },
      { name: "mods.search", run: () => openSearch() },
      {
        name: "mods.import",
        run() {
          // Only mods are importable from a local .jar.
          if (listType() === "mods") openImport()
        },
      },
      {
        name: "mods.instance.prev",
        run() {
          setInstanceIndex((i) => Math.max(0, i - 1))
          setSelected(0)
          void loadCurrent()
        },
      },
      {
        name: "mods.instance.next",
        run() {
          setInstanceIndex((i) => Math.min(instances().length - 1, i + 1))
          setSelected(0)
          void loadCurrent()
        },
      },
      { name: "mods.prev", run: () => setSelected((s) => Math.max(0, s - 1)) },
      { name: "mods.next", run: () => setSelected((s) => Math.min(listLength() - 1, s + 1)) },
      { name: "mods.refresh", run: () => void loadCurrent() },
      { name: "mods.remove", run: () => void removeSelected() },
      {
        name: "mods.toggle",
        run() {
          if (listType() === "mods") void toggleSelected()
        },
      },
    ],
    bindings: [
      { key: "up", cmd: "mods.prev", desc: "navigate", hint: HINT.primary },
      { key: "down", cmd: "mods.next", desc: "navigate", hint: HINT.primary },
      { key: "k", cmd: "mods.prev" },
      { key: "j", cmd: "mods.next" },
      { key: "s", cmd: "mods.search", desc: "search Modrinth", hint: HINT.secondary },
      { key: "i", cmd: "mods.import", desc: "import jar", hint: HINT.secondary },
      { key: "e", cmd: "mods.toggle", desc: "enable/disable", hint: HINT.secondary },
      { key: "x", cmd: "mods.remove", desc: "remove", hint: HINT.secondary },
      { key: "h", cmd: "mods.togglePacks", desc: "shader packs", hint: HINT.edit },
      { key: "left", cmd: "mods.instance.prev", desc: "instance", hint: HINT.edit },
      { key: "right", cmd: "mods.instance.next", desc: "instance", hint: HINT.edit },
      { key: "r", cmd: "mods.refresh", desc: "refresh", hint: HINT.edit },
    ],
  }))

  useBindings(() => ({
    enabled: when(mode, (current) => current === "search-input" || current === "import-input"),
    commands: [
      {
        name: "mods.cancelInput",
        run() {
          if (mode() === "import-input") closeImport()
          else closeSearch()
        },
      },
    ],
    bindings: [{ key: "escape", cmd: "mods.cancelInput", desc: "cancel", hint: HINT.cancel }],
  }))

  // Keep the focused row visible in the scrolling lists. The refs are
  // signals so each effect also runs when its list first appears (the
  // lists mount empty and fill in once the service answers).
  const [modsListRef, setModsListRef] = createSignal<ScrollBoxRenderable>()
  const [resultsListRef, setResultsListRef] = createSignal<ScrollBoxRenderable>()
  createEffect(() => {
    const list = modsListRef()
    if (!list) return
    list.scrollChildIntoView(`mod-row-${selected()}`)
  })
  createEffect(() => {
    const list = resultsListRef()
    if (!list) return
    list.scrollChildIntoView(`result-row-${resultSelected()}`)
  })


  const packsMode = () => listType() === "shaders"

  return (
    <box flexDirection="column" flexGrow={1}>
      <Centered maxWidth={96}>
        <box flexDirection="row" justifyContent="center" flexShrink={0}>
          <text fg="#cdd6f4" attributes={2}>
            Mods & Shaders{packsMode() ? " — shader packs" : ""}
          </text>
        </box>
        <Show
          when={instance()}
          fallback={<text fg="#6c7086" flexShrink={0}>No instance selected — create one first (Instances screen, 'c').</text>}
        >
          <text fg="#6c7086" flexShrink={0}>
            Instance: {instance()!.name} · {instance()!.modLoader === "fabric" ? "fabric" : "vanilla"}
            {!packsMode() && (instance()!.modLoader === "vanilla" || !instance()!.modLoader)
              ? " — enable Fabric on instance detail ('f') for modded servers"
              : ""}
          </text>
        </Show>
        <box height={1} flexShrink={0} />
        <Switch>
          <Match when={mode() === "search-input"}>
            <box flexDirection="row">
              <text fg="#89b4fa">{packsMode() ? "Search shader packs: " : "Search Modrinth: "}</text>
              <input
                flexGrow={1}
                placeholder={
                  packsMode() ? "e.g. sildurs, complementary, bsl…" : "e.g. fabric-api, sodium, minecraft-golf…"
                }
                focused
                onInput={(value) => {
                  if (typeof value === "string") searchValue = value
                }}
                onSubmit={(value) => {
                  if (typeof value === "string") searchValue = value
                  void runSearch()
                }}
              />
            </box>
            <text fg="#6c7086">Enter searches · Esc cancels</text>
          </Match>
          <Match when={mode() === "import-input"}>
            <box flexDirection="row">
              <text fg="#a6e3a1">Import mod file: </text>
              <input
                flexGrow={1}
                placeholder="/path/to/mod.jar — must be a .JAR file"
                focused
                onInput={(value) => {
                  if (typeof value === "string") importValue = value
                }}
                onSubmit={(value) => {
                  if (typeof value === "string") importValue = value
                  void runImport()
                }}
              />
            </box>
            <text fg="#6c7086">Enter imports (copies into the instance's mods dir) · Esc cancels</text>
          </Match>
          <Match when={mode() === "results"}>
            <text fg="#cdd6f4" attributes={1} flexShrink={0}>
              {resultKind() === "shaders"
                ? "Shader results — Enter to install"
                : "Search results — Enter to install (dependencies are resolved automatically)"}
            </text>
            <scrollbox
              ref={setResultsListRef}
              height={listHeight(RESULTS_CHROME)}
              scrollbarOptions={{ showArrows: false }}
            >
              <For each={results()}>
                {(hit, i) => (
                  <box id={`result-row-${i()}`} flexDirection="column">
                    <box flexDirection="row" height={1}>
                      <text fg={resultSelected() === i() ? "#89b4fa" : "#cdd6f4"} attributes={resultSelected() === i() ? 1 : 0}>
                        {resultSelected() === i() ? "▸ " : "  "}
                        {hit.title}
                      </text>
                      <text fg="#585b70"> [{hit.downloads.toLocaleString()} downloads]</text>
                    </box>
                    <box flexDirection="row" height={1}>
                      <text fg="#585b70">  {hit.description.slice(0, 100)}</text>
                    </box>
                  </box>
                )}
              </For>
            </scrollbox>
          </Match>
          <Match when={true}>
            <Show when={packsMode()}>
              <Show
                when={shaders().length > 0}
                fallback={
                  <text fg="#6c7086" flexShrink={0}>
                    No shader packs installed — press 's' to search Modrinth (e.g. "sildurs").
                  </text>
                }
              >
                <scrollbox
                  ref={setModsListRef}
                  height={listHeight(INSTALLED_CHROME)}
                  scrollbarOptions={{ showArrows: false }}
                >
                  <For each={shaders()}>
                    {(shader, i) => (
                      <box id={`mod-row-${i()}`} flexDirection="row" height={1}>
                        <text fg={selected() === i() ? "#89b4fa" : "#cdd6f4"} attributes={selected() === i() ? 1 : 0}>
                          {selected() === i() ? "▸ " : "  "}
                          {shader.fileName}
                        </text>
                        <text fg="#585b70"> {formatSize(shader.fileSize)}</text>
                      </box>
                    )}
                  </For>
                </scrollbox>
              </Show>
            </Show>
            <Show when={!packsMode()}>
              <Show
                when={mods().length > 0}
                fallback={<text fg="#6c7086" flexShrink={0}>No mods installed in this instance yet — press 's' to search Modrinth.</text>}
              >
                <scrollbox
                  ref={setModsListRef}
                  height={listHeight(INSTALLED_CHROME)}
                  scrollbarOptions={{ showArrows: false }}
                >
                  <For each={mods()}>
                    {(mod, i) => (
                      <box id={`mod-row-${i()}`} flexDirection="row" height={1}>
                        <text fg={selected() === i() ? "#89b4fa" : mod.enabled ? "#cdd6f4" : "#585b70"}>
                          {selected() === i() ? "▸ " : "  "}
                          {mod.name}
                        </text>
                        <text fg="#585b70"> {mod.versionNumber}{mod.enabled ? "" : " (disabled)"}</text>
                      </box>
                    )}
                  </For>
                </scrollbox>
              </Show>
            </Show>
          </Match>
        </Switch>
      </Centered>
      <KeyHints
        extra={
          mode() === "search-input"
            ? [["type", packsMode() ? "shader name" : "query"], ["Enter", "search"]]
            : mode() === "import-input"
              ? [["type", "path to .jar"], ["Enter", "import"]]
              : undefined
        }
      />
    </box>
  )
}
