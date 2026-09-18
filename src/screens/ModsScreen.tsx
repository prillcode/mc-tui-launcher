import { onMount, For, Show, createSignal, createMemo, Switch, Match } from "solid-js"
import { useKeyboard } from "@opentui/solid"
import {
  screen,
  instances,
  goBack,
  setStatusMessage,
  setBusy,
  busy,
  setTextInputActive,
} from "../app/state"
import { launcherService } from "../services/launcher"
import { appendLog } from "../app/state"
import { KeyHints } from "../components/KeyHints"
import type { InstalledMod, ModrinthProject } from "@prillcode/mc-launcher-core"

/**
 * Mods: installed list + Modrinth search/install (required dependencies
 * like Fabric API are resolved and installed automatically by the core).
 *
 * Modes:
 *   installed    — mods in the selected instance; x removes, e toggles
 *   search-input — type a query, Enter runs the search
 *   results      — search hits; Enter installs (with dependencies)
 */
export function ModsScreen() {
  const [selected, setSelected] = createSignal(0)
  const [mods, setMods] = createSignal<InstalledMod[]>([])
  const [instanceIndex, setInstanceIndex] = createSignal(0)
  const [mode, setMode] = createSignal<"installed" | "search-input" | "results">("installed")
  const [results, setResults] = createSignal<ModrinthProject[]>([])
  const [resultSelected, setResultSelected] = createSignal(0)

  const instance = createMemo(() => instances()[instanceIndex()])

  async function loadMods() {
    const inst = instance()
    if (!inst) return
    setBusy(true)
    try {
      setMods(await launcherService.listMods(inst.id))
    } catch (err) {
      setStatusMessage(`Failed to list mods: ${err instanceof Error ? err.message : String(err)}`)
    } finally {
      setBusy(false)
    }
  }

  onMount(() => {
    void loadMods()
  })

  async function runSearch() {
    const inst = instance()
    if (!inst) return
    setBusy(true)
    try {
      const query = searchInputRef?.value ?? ""
      const res = await launcherService.searchMods(query, inst)
      // Defer the mode switch to the next macrotask: the same Enter key
      // event that submitted the search is dispatched to this screen's
      // keyboard handler after the submit handler's await completes, and
      // must not be seen as an "install" press in the new mode.
      setTimeout(() => {
        setTextInputActive(false)
        setResults(res.hits.slice(0, 20))
        setResultSelected(0)
        setMode("results")
        if (res.hits.length === 0) setStatusMessage(`No mods found for "${query}"`)
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
    setStatusMessage(`Installing ${hit.title}…`)
    try {
      const installed = await launcherService.installModFromSearch(inst.id, hit)
      setStatusMessage(
        installed.length > 1 ? `Installed: ${installed.join(", ")}` : `Installed ${installed[0] ?? hit.title}`,
      )
      setMode("installed")
      void loadMods()
    } catch (err) {
      setStatusMessage(`Install failed: ${err instanceof Error ? err.message : String(err)}`)
    } finally {
      setBusy(false)
    }
  }

  async function removeSelected() {
    const inst = instance()
    const mod = mods()[selected()]
    if (!inst || !mod || busy()) return
    setBusy(true)
    try {
      await launcherService.removeMod(inst.id, mod.id)
      setStatusMessage(`Removed ${mod.name}`)
      void loadMods()
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
      void loadMods()
    } catch (err) {
      setStatusMessage(`Failed: ${err instanceof Error ? err.message : String(err)}`)
    } finally {
      setBusy(false)
    }
  }

  function openSearch() {
    const inst = instance()
    if (!inst || busy()) return
    if (inst.modLoader === "vanilla" || !inst.modLoader) {
      setStatusMessage("Note: instance is vanilla — enable Fabric on instance detail for Fabric mods")
    }
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

  let searchInputRef: { value: string } | undefined

  useKeyboard((key) => {
    if (screen() !== "mods") return

    // While the search box is open, keys go to the input; only Esc
    // reaches here (handled first so nothing else reacts).
    if (mode() === "search-input") {
      if (key.name === "escape") closeSearch()
      return
    }

    if (key.name === "escape") {
      if (mode() === "results") {
        setMode("installed")
      } else {
        goBack()
      }
      return
    }

    if (busy()) return

    if (mode() === "results") {
      if (key.name === "up" || key.name === "k") {
        setResultSelected((s) => Math.max(0, s - 1))
      } else if (key.name === "down" || key.name === "j") {
        setResultSelected((s) => Math.min(results().length - 1, s + 1))
      } else if (key.name === "return" || key.name === "enter") {
        void installSelected()
      } else if (key.name === "s") {
        openSearch()
      }
      return
    }

    if (key.name === "s") {
      openSearch()
    } else if (key.name === "left") {
      setInstanceIndex((i) => Math.max(0, i - 1))
      void loadMods()
    } else if (key.name === "right") {
      setInstanceIndex((i) => Math.min(instances().length - 1, i + 1))
      void loadMods()
    } else if (key.name === "up" || key.name === "k") {
      setSelected((s) => Math.max(0, s - 1))
    } else if (key.name === "down" || key.name === "j") {
      setSelected((s) => Math.min(mods().length - 1, s + 1))
    } else if (key.name === "r") {
      void loadMods()
    } else if (key.name === "x") {
      void removeSelected()
    } else if (key.name === "e") {
      void toggleSelected()
    }
  })

  return (
    <box flexDirection="column" flexGrow={1}>
      <box flexGrow={1} padding={1} flexDirection="column">
        <text fg="#cdd6f4" attributes={2}>
          Mods
        </text>
        <Show
          when={instance()}
          fallback={<text fg="#6c7086">No instance selected — create one first (Instances screen, 'c').</text>}
        >
          <text fg="#6c7086">
            Instance: {instance()!.name} · {instance()!.modLoader === "fabric" ? "fabric" : "vanilla"}
            {instance()!.modLoader === "vanilla" || !instance()!.modLoader
              ? " — enable Fabric on instance detail ('f') for modded servers"
              : ""}
          </text>
        </Show>
        <box height={1} />
        <Switch>
          <Match when={mode() === "search-input"}>
            <box flexDirection="row">
              <text fg="#89b4fa">Search Modrinth: </text>
              <input
                placeholder="e.g. fabric-api, sodium, minecraft-golf…"
                focused
                ref={(el) => (searchInputRef = el)}
                onSubmit={() => void runSearch()}
              />
            </box>
            <text fg="#6c7086">Enter searches · Esc cancels</text>
          </Match>
          <Match when={mode() === "results"}>
            <text fg="#cdd6f4" attributes={1}>
              Search results — Enter to install (dependencies are resolved automatically)
            </text>
            <For each={results()}>
              {(hit, i) => (
                <box flexDirection="column">
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
          </Match>
          <Match when={true}>
            <Show
              when={mods().length > 0}
              fallback={<text fg="#6c7086">No mods installed in this instance yet — press 's' to search Modrinth.</text>}
            >
              <For each={mods()}>
                {(mod, i) => (
                  <box flexDirection="row" height={1}>
                    <text fg={selected() === i() ? "#89b4fa" : mod.enabled ? "#cdd6f4" : "#585b70"}>
                      {selected() === i() ? "▸ " : "  "}
                      {mod.name}
                    </text>
                    <text fg="#585b70"> {mod.versionNumber}{mod.enabled ? "" : " (disabled)"}</text>
                  </box>
                )}
              </For>
            </Show>
          </Match>
        </Switch>
      </box>
      <KeyHints
        hints={
          mode() === "search-input"
            ? [["Enter", "search"], ["Esc", "cancel"]]
            : mode() === "results"
              ? [
                  ["↑/↓", "navigate"],
                  ["Enter", "install"],
                  ["s", "new search"],
                  ["Esc", "back"],
                ]
              : [
                  ["s", "search Modrinth"],
                  ["e", "enable/disable"],
                  ["x", "remove"],
                  ["←/→", "instance"],
                  ["r", "refresh"],
                  ["Esc", "back"],
                ]
        }
      />
    </box>
  )
}
