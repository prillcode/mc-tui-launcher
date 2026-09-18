import { onMount, For, Show, createSignal } from "solid-js"
import { useKeyboard } from "@opentui/solid"
import {
  screen,
  instances,
  versions,
  goBack,
  navigate,
  setStatusMessage,
  setBusy,
  busy,
} from "../app/state"
import { launcherService } from "../services/launcher"
import { KeyHints } from "../components/KeyHints"

/**
 * Instances: list, create (vanilla), open detail.
 */
export function InstancesScreen() {
  const [selected, setSelected] = createSignal(0)
  const [creating, setCreating] = createSignal(false)
  const [createSelected, setCreateSelected] = createSignal(0)
  const [pickingLoader, setPickingLoader] = createSignal(false)
  const [loaderSelected, setLoaderSelected] = createSignal(0)

  const LOADER_CHOICES = ["vanilla", "fabric"] as const

  onMount(() => {
    void launcherService.refreshInstances()
  })

  function openDetail() {
    const instance = instances()[selected()]
    if (instance) {
      navigate("instance-detail", instance.id)
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

  useKeyboard((key) => {
    if (screen() !== "instances") return

    if (key.name === "escape") {
      if (pickingLoader()) {
        setPickingLoader(false)
      } else if (creating()) {
        setCreating(false)
      } else {
        goBack()
      }
      return
    }

    if (creating() && pickingLoader()) {
      if (key.name === "up" || key.name === "k") {
        setLoaderSelected((s) => Math.max(0, s - 1))
      } else if (key.name === "down" || key.name === "j") {
        setLoaderSelected((s) => Math.min(LOADER_CHOICES.length - 1, s + 1))
      } else if (key.name === "return" || key.name === "enter") {
        void confirmCreate()
      }
      return
    }

    if (creating()) {
      if (key.name === "up" || key.name === "k") {
        setCreateSelected((s) => Math.max(0, s - 1))
      } else if (key.name === "down" || key.name === "j") {
        setCreateSelected((s) => Math.min(versions().length - 1, s + 1))
      } else if (key.name === "return" || key.name === "enter") {
        setLoaderSelected(0)
        setPickingLoader(true)
      }
      return
    }

    if (key.name === "up" || key.name === "k") {
      setSelected((s) => Math.max(0, s - 1))
    } else if (key.name === "down" || key.name === "j") {
      setSelected((s) => Math.min(instances().length - 1, s + 1))
    } else if (key.name === "return" || key.name === "enter") {
      openDetail()
    } else if (key.name === "c" && !busy()) {
      void startCreate()
    }
  })

  return (
    <box flexDirection="column" flexGrow={1}>
      <box flexGrow={1} padding={1} flexDirection="column">
        <Show
          when={!creating()}
          fallback={
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
              <box flexDirection="column">
                <text fg="#cdd6f4" attributes={2}>
                  New instance — pick a Minecraft version
                </text>
                <box height={1} />
                <For each={versions().slice(0, 20)}>
                  {(version, i) => (
                    <box flexDirection="row" height={1}>
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
                <box height={1} />
                <text fg="#6c7086">↑/↓ + Enter to continue (showing 20 most recent releases)</text>
              </box>
            </Show>
          }
        >
          <text fg="#cdd6f4" attributes={2}>
            Instances
          </text>
          <box height={1} />
          <Show
            when={instances().length > 0}
            fallback={<text fg="#6c7086">No instances yet — press 'c' to create one.</text>}
          >
            <For each={instances()}>
              {(instance, i) => (
                <box flexDirection="row" height={1}>
                  <text fg={selected() === i() ? "#89b4fa" : "#cdd6f4"} attributes={selected() === i() ? 1 : 0}>
                    {selected() === i() ? "▸ " : "  "}
                    {instance.name}
                  </text>
                  <text fg="#585b70">
                    {" "}
                    [{instance.versionId}
                    {instance.modLoader && instance.modLoader !== "vanilla" ? ` · ${instance.modLoader}` : ""}]
                  </text>
                </box>
              )}
            </For>
          </Show>
        </Show>
      </box>
      <KeyHints
        hints={
          pickingLoader()
            ? [
                ["↑/↓", "loader"],
                ["Enter", "create"],
                ["Esc", "back to versions"],
              ]
            : creating()
              ? [
                  ["↑/↓", "version"],
                  ["Enter", "next: loader"],
                  ["Esc", "cancel"],
                ]
              : [
                  ["↑/↓", "navigate"],
                  ["Enter", "open"],
                  ["c", "new instance"],
                  ["Esc", "back"],
                ]
        }
      />
    </box>
  )
}
