import { onMount, For, Show, createSignal } from "solid-js"
import { useBindings } from "@opentui/keymap/solid"
import { goBack, setStatusMessage, setTextInputActive } from "../app/state"
import { HINT, when } from "../app/keymap"
import { launcherService } from "../services/launcher"
import { appConfig } from "../services/config"
import { KeyHints } from "../components/KeyHints"
import { Centered } from "../components/Centered"
import type { LauncherSettings } from "@prillcode/mc-launcher-core"

/**
 * Settings: editable list with a row cursor.
 *
 * Editable rows (Enter/e opens the inline editor, Enter saves, Esc
 * cancels):
 *   - Java path (string, empty = auto-detect)
 *   - default min/max memory (positive integers)
 *   - default resolution width/height (positive integers)
 *   - close on launch (toggle — saves immediately on Enter)
 *
 * defaultAuthMode is intentionally read-only (it belongs to the offline
 * login work) and the blockhaven* keys are Electron-launcher legacy.
 */
type EditableKey =
  | "javaPath"
  | "defaultMinMemory"
  | "defaultMaxMemory"
  | "defaultResolutionWidth"
  | "defaultResolutionHeight"
  | "closeOnLaunch"

interface Row {
  key: EditableKey
  label: string
  kind: "string" | "number" | "toggle"
  value: string
}

export function SettingsScreen() {
  const [settings, setSettings] = createSignal<LauncherSettings | null>(null)
  const [selected, setSelected] = createSignal(0)
  const [editing, setEditing] = createSignal<Row | null>(null)
  let editValue = ""

  async function reload() {
    setSettings(await launcherService.getSettings())
  }

  onMount(async () => {
    try {
      await reload()
    } catch (err) {
      setStatusMessage(`Failed to load settings: ${err instanceof Error ? err.message : String(err)}`)
    }
  })

  const rows = (): Row[] => {
    const s = settings()
    if (!s) return []
    return [
      { key: "javaPath", label: "Java path", kind: "string", value: s.javaPath },
      {
        key: "defaultMinMemory",
        label: "Default min memory (MB)",
        kind: "number",
        value: String(s.defaultMinMemory),
      },
      {
        key: "defaultMaxMemory",
        label: "Default max memory (MB)",
        kind: "number",
        value: String(s.defaultMaxMemory),
      },
      {
        key: "defaultResolutionWidth",
        label: "Default resolution W",
        kind: "number",
        value: String(s.defaultResolutionWidth),
      },
      {
        key: "defaultResolutionHeight",
        label: "Default resolution H",
        kind: "number",
        value: String(s.defaultResolutionHeight),
      },
      {
        key: "closeOnLaunch",
        label: "Close on launch",
        kind: "toggle",
        value: s.closeOnLaunch ? "yes" : "no",
      },
    ]
  }

  function closeEditor() {
    setTextInputActive(false)
    setEditing(null)
  }

  function openEditor(row: Row) {
    // Defer so the opening keystroke can't leak into the fresh input.
    setTimeout(() => {
      editValue = row.value
      setTextInputActive(true)
      setEditing(row)
    }, 0)
  }

  /** Save a value, reload settings, and report the outcome. */
  async function persist(save: () => Promise<void>, label: string) {
    try {
      await save()
      await reload()
      setStatusMessage(`Saved ${label}`)
    } catch (err) {
      setStatusMessage(`Failed to save ${label}: ${err instanceof Error ? err.message : String(err)}`)
    }
  }

  async function saveEditor(value: string) {
    const row = editing()
    if (!row) return
    const raw = (typeof value === "string" && value.length > 0 ? value : editValue).trim()

    if (row.kind === "number") {
      if (!/^\d+$/.test(raw) || Number.parseInt(raw, 10) <= 0) {
        setStatusMessage(`"${row.label}" must be a positive integer`)
        return // stay in the editor
      }
      const n = Number.parseInt(raw, 10)
      // Keep the editor open through the async save so the re-dispatched
      // Enter is swallowed, then close on the next macrotask.
      await persist(() => launcherService.setSetting(row.key, n), row.label)
    } else {
      await persist(() => launcherService.setSetting(row.key, raw), row.label)
    }
    setTimeout(closeEditor, 0)
  }

  function activate() {
    const row = rows()[selected()]
    if (!row) return
    if (row.kind === "toggle") {
      const s = settings()
      if (!s) return
      void persist(() => launcherService.setSetting("closeOnLaunch", !s.closeOnLaunch), row.label)
      return
    }
    openEditor(row)
  }

  // ── Key bindings (OpenTUI keymap) ────────────────────────────────
  // The list layer is off while a row editor is open so typed values
  // reach the focused <input> instead of the screen's single-letter keys.
  useBindings(() => ({
    enabled: when(editing, (open) => !open),
    commands: [
      { name: "settings.back", run: () => goBack() },
      { name: "settings.prev", run: () => setSelected((s) => Math.max(0, s - 1)) },
      { name: "settings.next", run: () => setSelected((s) => Math.min(rows().length - 1, s + 1)) },
      { name: "settings.activate", run: () => activate() },
    ],
    bindings: [
      { key: "up", cmd: "settings.prev", desc: "navigate", hint: HINT.primary },
      { key: "down", cmd: "settings.next", desc: "navigate", hint: HINT.primary },
      { key: "k", cmd: "settings.prev" },
      { key: "j", cmd: "settings.next" },
      { key: "return", cmd: "settings.activate", desc: "edit", hint: HINT.secondary },
      { key: "e", cmd: "settings.activate", desc: "edit", hint: HINT.secondary },
      { key: "escape", cmd: "settings.back", desc: "back", hint: HINT.cancel },
    ],
  }))

  useBindings(() => ({
    enabled: when(editing, (open) => open !== null),
    commands: [{ name: "settings.cancelEdit", run: () => closeEditor() }],
    bindings: [{ key: "escape", cmd: "settings.cancelEdit", desc: "cancel", hint: HINT.cancel }],
  }))

  return (
    <box flexDirection="column" flexGrow={1}>
      <Centered maxWidth={76}>
        <box flexDirection="row" justifyContent="center">
          <text fg="#cdd6f4" attributes={2}>
            Settings
          </text>
        </box>
        <box height={1} />
        <For each={rows()}>
          {(row, i) => (
            <box flexDirection="row" height={1}>
              <Show
                when={editing()?.key === row.key}
                fallback={
                  <>
                    <text
                      fg={selected() === i() ? "#89b4fa" : "#a6adc8"}
                      attributes={selected() === i() ? 1 : 0}
                    >
                      {selected() === i() ? "▸ " : "  "}
                      {row.label.padEnd(26)}
                    </text>
                    <text fg="#cdd6f4">{row.value || "(auto-detect)"}</text>
                  </>
                }
              >
                <text fg="#89b4fa">{"  "}{row.label.padEnd(26)}</text>
                <input
                  flexGrow={1}
                  value={row.value}
                  placeholder="Enter saves · Esc cancels"
                  focused
                  onInput={(value) => {
                    if (typeof value === "string") editValue = value
                  }}
                  onSubmit={(value) => void saveEditor(typeof value === "string" ? value : editValue)}
                />
              </Show>
            </box>
          )}
        </For>
        <box height={1} />
        <text fg="#6c7086">  Auth mode:      {settings()?.defaultAuthMode ?? "microsoft"} (read-only)</text>
        <text fg="#6c7086">
          {"  "}BlockHaven:     {settings()?.blockhavenDefaultHost ?? "—"}:{settings()?.blockhavenDefaultPort ?? "—"} (legacy)
        </text>
        <text fg="#6c7086">  Data root:      {appConfig.dataRoot}</text>
      </Centered>
      <KeyHints extra={editing() ? [["type", "value"], ["Enter", "save"]] : undefined} />
    </box>
  )
}
