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
      await launcherService.createVanillaInstance(version.id, version.id)
      setStatusMessage(`Created instance "${version.id}"`)
      setCreating(false)
    } catch (err) {
      setStatusMessage(`Create failed: ${err instanceof Error ? err.message : String(err)}`)
    } finally {
      setBusy(false)
    }
  }

  useKeyboard((key) => {
    if (screen() !== "instances") return

    if (key.name === "escape") {
      if (creating()) {
        setCreating(false)
      } else {
        goBack()
      }
      return
    }

    if (creating()) {
      if (key.name === "up" || key.name === "k") {
        setCreateSelected((s) => Math.max(0, s - 1))
      } else if (key.name === "down" || key.name === "j") {
        setCreateSelected((s) => Math.min(versions().length - 1, s + 1))
      } else if (key.name === "return" || key.name === "enter") {
        void confirmCreate()
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
              <text fg="#6c7086">↑/↓ + Enter to create (showing 20 most recent releases)</text>
            </box>
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
          creating()
            ? [
                ["↑/↓", "version"],
                ["Enter", "create"],
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
