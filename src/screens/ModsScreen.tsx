import { onMount, For, Show, createSignal, createMemo } from "solid-js"
import { useKeyboard } from "@opentui/solid"
import { screen, instances, goBack, setStatusMessage, setBusy, busy } from "../app/state"
import { launcherService } from "../services/launcher"
import { KeyHints } from "../components/KeyHints"
import type { InstalledMod } from "@prillcode/mc-launcher-core"

/**
 * Mods: shows installed mods for the selected instance. Modrinth
 * search/install arrives with the MVP polish pass.
 */
export function ModsScreen() {
  const [selected, setSelected] = createSignal(0)
  const [mods, setMods] = createSignal<InstalledMod[]>([])
  const [instanceIndex, setInstanceIndex] = createSignal(0)

  const instance = createMemo(() => instances()[instanceIndex()])

  async function loadMods() {
    const inst = instance()
    if (!inst) return
    setBusy(true)
    try {
      setMods(await launcherService.listMods(inst.id));
    } catch (err) {
      setStatusMessage(`Failed to list mods: ${err instanceof Error ? err.message : String(err)}`)
    } finally {
      setBusy(false)
    }
  }

  onMount(() => {
    void loadMods()
  })

  useKeyboard((key) => {
    if (screen() !== "mods") return
    if (key.name === "escape") {
      goBack()
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
      const inst = instance()
      if (inst) void launcherService.refreshInstances()
      void loadMods()
    }
  })

  return (
    <box flexDirection="column" flexGrow={1}>
      <box flexGrow={1} padding={1} flexDirection="column">
        <text fg="#cdd6f4" attributes={2}>
          Mods
        </text>
        <text fg="#6c7086">
          Instance: {instance()?.name ?? "none"} (←/→ switch instance, 'r' refresh)
        </text>
        <box height={1} />
        <Show
          when={mods().length > 0}
          fallback={<text fg="#6c7086">No mods installed in this instance yet.</text>}
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
      </box>
      <KeyHints
        hints={[
          ["↑/↓", "navigate"],
          ["←/→", "instance"],
          ["r", "refresh"],
          ["Esc", "back"],
        ]}
      />
    </box>
  )
}
