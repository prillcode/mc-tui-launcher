/**
 * Behaviour checks that need the real renderer: keymap is a direct key
 * listener, so a live single-letter binding would swallow typing.
 *
 * Runs against a throwaway data root unless MC_LAUNCHER_DATA_DIR is set,
 * so it never touches the user's real launcher data (and never
 * ~/.minecraft/saves).
 */
import "@opentui/solid/preload"
import * as os from "node:os"
import * as fs from "node:fs"
import * as path from "node:path"
import { makeLevelDat } from "./lib/level-dat"

if (!process.env.MC_LAUNCHER_DATA_DIR) {
  process.env.MC_LAUNCHER_DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), "bhmc-verify-"))
}

const { createTestRenderer } = await import("@opentui/core/testing")
const { render } = await import("@opentui/solid")
const { KeymapProvider } = await import("@opentui/keymap/solid")
const { registerQRCode } = await import("@opentui/qrcode/solid")
const { loadAppEnv } = await import("../src/services/env")
const { launcherService } = await import("../src/services/launcher")
const { createAppKeymap } = await import("../src/app/keymap")
const { App } = await import("../src/app/App")
const state = await import("../src/app/state")

registerQRCode()
await loadAppEnv()
await launcherService.init()
// The suite expects at least one instance; provide one on a fresh root.
if ((await launcherService.core.instances.list()).length === 0) {
  await launcherService.createInstance("Verify Instance", "1.21.4", "vanilla")
}

const setup = await createTestRenderer({ width: 96, height: 28 })
const keymap = createAppKeymap(setup.renderer)
let destroyed = false
setup.renderer.once("destroy", () => (destroyed = true))
await render(
  () => (
    <KeymapProvider keymap={keymap}>
      <App />
    </KeymapProvider>
  ),
  setup.renderer,
)

const settle = async (ms = 200) => {
  await new Promise((resolve) => setTimeout(resolve, ms))
  await setup.renderOnce()
}

let failures = 0
function check(label: string, actual: unknown, expected: unknown) {
  const ok = JSON.stringify(actual) === JSON.stringify(expected)
  if (!ok) failures++
  console.log(`${ok ? "PASS" : "FAIL"}  ${label}${ok ? "" : `\n      expected ${JSON.stringify(expected)}\n      actual   ${JSON.stringify(actual)}`}`)
}

const findInput = (node: any): any => {
  if (node?.value !== undefined && typeof node.value === "string" && node.constructor?.name?.includes("Input")) return node
  for (const kid of node?.getChildren?.() ?? []) {
    const hit = findInput(kid)
    if (hit) return hit
  }
  return undefined
}

const hintKeys = () =>
  keymap
    .getActiveKeys({ includeMetadata: true, includeBindings: true })
    .filter((k) => typeof k.bindingAttrs?.hint === "number")
    .map((k) => (k.bindings?.[0]?.sequence ?? []).map((p) => p.display).join(" "))

/** Scrollboxes must stop short of the hint bar + status bar rows. */
const scrollBoxes = () => {
  const found: Array<{ id: string; y: number; height: number }> = []
  const walk = (node: any) => {
    if (typeof node?.scrollHeight === "number" && node.viewport) {
      found.push({ id: node.id, y: node.y, height: node.height })
    }
    for (const kid of node?.getChildren?.() ?? []) walk(kid)
  }
  walk(setup.renderer.root)
  return found
}
const checkScrollLayout = (label: string) => {
  const limit = setup.renderer.height - 2
  const boxes = scrollBoxes()
  const overflowing = boxes.filter((box) => box.y + box.height > limit)
  check(`${label}: scrollboxes stay above the hint/status rows (${JSON.stringify(boxes)})`, overflowing.length, 0)
}

/** The selection marker must be inside the newest scrollbox's viewport. */
const checkSelectionVisible = (label: string) => {
  const boxes = scrollBoxes()
  const box = boxes[boxes.length - 1]
  const lines = setup.captureCharFrame().split("\n")
  const viewport = box ? lines.slice(box.y, box.y + box.height) : []
  check(`${label}: the selection marker is visible in the viewport`, viewport.some((line) => line.includes("▸")), true)
}

await settle(600)

// ── Mods: typing must reach the search box even though s/e/x are bound ──
state.navigate("mods")
await settle(400)
checkScrollLayout("mods list")
await setup.mockInput.pressKey("s")
await settle(200)
await setup.mockInput.typeText("sex")
await settle(200)
check(
  "mods search input receives 'sex' (s/e/x are bound on other layers)",
  findInput(setup.renderer.root)?.value,
  "sex",
)
check("no pending sequence while typing", keymap.getPendingSequence().length, 0)

await setup.mockInput.pressEscape()
await settle(400)
check("Esc returns to the mods list", hintKeys().includes("s"), true)
check("the typed text did not trigger list actions", state.instances().length > 0, true)

// ── Mods results: network-dependent, only the layout is asserted ──
await setup.mockInput.pressKey("s")
await settle(200)
await setup.mockInput.typeText("sodium")
await settle(100)
await setup.mockInput.pressEnter()
await settle(4000)
if (hintKeys().includes("s")) {
  checkScrollLayout("mods results")
  for (let i = 0; i < 12; i++) await setup.mockInput.pressArrow("down")
  await settle(300)
  checkScrollLayout("mods results (scrolled)")
  checkSelectionVisible("mods results (scrolled)")
} else {
  console.log("SKIP  mods results layout (Modrinth search returned nothing)")
}
await setup.mockInput.pressEscape()
await settle(300)

// ── Settings: typing into the Java path editor ──
state.navigate("settings")
await settle(500)
checkScrollLayout("settings")
await setup.mockInput.pressArrow("down")
await setup.mockInput.pressKey("return")
await settle(300)
await setup.mockInput.typeText("qja2")
await settle(200)
// The editor opens pre-filled with the current value and appends at the cursor.
check("settings editor receives typed text ('q' is a global binding)", (findInput(setup.renderer.root)?.value ?? "").endsWith("qja2"), true)
check("no quit sequence armed by typing 'q'", keymap.getPendingSequence().length, 0)
await setup.mockInput.pressEscape()
await settle(300)

// ── ctrl+x must not leak into an editor ──
state.navigate("logs")
for (let i = 0; i < 40; i++) state.appendLog(`log line ${i}`)
await settle(400)
checkScrollLayout("logs")

state.navigate("instances")
await settle(500)
checkScrollLayout("instances grid")
await setup.mockInput.pressKey("c")
await settle(1500)
checkScrollLayout("instances version picker")
for (let i = 0; i < 25; i++) await setup.mockInput.pressArrow("down")
await settle(300)
checkScrollLayout("instances version picker (scrolled)")
checkSelectionVisible("instances version picker (scrolled)")

state.navigate("home")
await settle(400)

// ── Worlds: list, backup, restore, running guard, import input ─────────

const scratch = await launcherService.createInstance("Worlds Verify", "1.21.4", "vanilla")
const scratchSaves = path.join(scratch.gameDirectory, "saves")
const mainWorld = path.join(scratchSaves, "Verify World")
fs.mkdirSync(path.join(mainWorld, "data"), { recursive: true })
fs.writeFileSync(path.join(mainWorld, "level.dat"), makeLevelDat("Verify World Name", "1.20.1", Date.now()))
fs.writeFileSync(path.join(mainWorld, "data/state.txt"), "original")
const backupsDir = launcherService.worldsBackupsDir(scratch.id)
const zipCount = () =>
  fs.existsSync(backupsDir) ? fs.readdirSync(backupsDir).filter((f) => f.endsWith(".zip")).length : 0

state.navigate("worlds", scratch.id)
await settle(900)
checkScrollLayout("worlds list")
check("worlds list shows the LevelName, not the folder name", setup.captureCharFrame().includes("Verify World Name"), true)
check("worlds list marks a version mismatch", setup.captureCharFrame().includes("world 1.20.1"), true)

// Import path input: typing must reach the input (i/w/x are bound elsewhere).
await setup.mockInput.pressKey("i")
await settle(250)
await setup.mockInput.typeText("world.zip")
await settle(200)
check("import input receives typed text ('i' is a global binding)", findInput(setup.renderer.root)?.value, "world.zip")
check("typing into the import input arms no action", keymap.getPendingSequence().length, 0)
await setup.mockInput.pressEscape()
await settle(300)

// Running-instance guard: 'b' must refuse and create nothing.
state.setInstanceRunning(scratch.id, true)
await settle(200)
const whileRunning = zipCount()
await setup.mockInput.pressKey("b")
await settle(1500)
check("'b' while the instance is running creates no backup", zipCount(), whileRunning)
check("'b' while running explains why", state.statusMessage().includes("disabled"), true)
state.setInstanceRunning(scratch.id, false)
await settle(200)

// A real backup.
await setup.mockInput.pressKey("b")
await settle(4000)
check("'b' creates a backup zip", zipCount() > whileRunning, true)

// Backup -> restore round-trip through the UI.
fs.writeFileSync(path.join(mainWorld, "data/state.txt"), "changed")
fs.writeFileSync(path.join(mainWorld, "data/extra.txt"), "should-disappear")
await setup.mockInput.pressKey("v")
await settle(600)
checkScrollLayout("worlds backups list")
await setup.mockInput.pressEnter()
await settle(300)
check("restore requires a second Enter", state.statusMessage().includes("Press Enter again"), true)
await setup.mockInput.pressEnter()
await settle(5000)
check(
  "restore brings the original content back",
  fs.readFileSync(path.join(mainWorld, "data/state.txt"), "utf8"),
  "original",
)
check(
  "restore drops files created after the backup",
  fs.existsSync(path.join(mainWorld, "data/extra.txt")),
  false,
)
check(
  "restore keeps a pre-restore safety snapshot",
  fs.readdirSync(backupsDir).some((f) => f.includes("pre-restore")),
  true,
)
await setup.mockInput.pressEscape()
await settle(300)

// D1: pre-launch backup only backs up worlds whose level.dat changed.
await launcherService.setSetting("autoBackupWorldsBeforeLaunch", true)
const beforeAuto = zipCount()
fs.utimesSync(path.join(mainWorld, "level.dat"), new Date(), new Date())
await launcherService.backupChangedWorldsForLaunch(scratch)
const afterChanged = zipCount()
check("pre-launch backup backs up a changed world", afterChanged > beforeAuto, true)
await launcherService.backupChangedWorldsForLaunch(scratch)
check("pre-launch backup skips unchanged worlds", zipCount(), afterChanged)
await launcherService.setSetting("autoBackupWorldsBeforeLaunch", false)

// Scrolling: enough worlds that the selection must be scrolled into view.
for (let i = 0; i < 20; i++) {
  const dir = path.join(scratchSaves, `World ${String(i).padStart(2, "0")}`)
  fs.mkdirSync(dir, { recursive: true })
  fs.writeFileSync(path.join(dir, "level.dat"), makeLevelDat(`Scrolling World ${i}`, "1.21.4", Date.now() + i))
}
state.bumpWorldsRefresh()
await settle(900)
for (let i = 0; i < 15; i++) await setup.mockInput.pressArrow("down")
await settle(400)
checkScrollLayout("worlds list (scrolled)")
checkSelectionVisible("worlds list (scrolled)")

// Clean up the scratch instance and its backups.
await launcherService.deleteInstance(scratch.id)
fs.rmSync(backupsDir, { recursive: true, force: true })

// ── Servers: local record, backup, restore, form typing ────────────────
// A `local` source means this whole section works without Docker.
const serverDataDir = fs.mkdtempSync(path.join(os.tmpdir(), "bhmc-verify-server-"))
const serverWorld = path.join(serverDataDir, "world")
fs.mkdirSync(path.join(serverWorld, "data"), { recursive: true })
fs.writeFileSync(
  path.join(serverWorld, "level.dat"),
  makeLevelDat("Verify Server World", "1.21.4", Date.now()),
)
fs.writeFileSync(path.join(serverWorld, "data/state.txt"), "server-original")
const serverRecord = await launcherService.addServer({
  name: "Verify Local Server",
  source: { kind: "local", dataDir: serverDataDir, levelName: "world" },
})
const serverBackupsDir = launcherService.serverBackupsDir(serverRecord.id)
const serverZipCount = () =>
  fs.existsSync(serverBackupsDir)
    ? fs.readdirSync(serverBackupsDir).filter((f) => f.endsWith(".zip")).length
    : 0

state.navigate("servers")
await settle(1000)
checkScrollLayout("servers list")
check(
  "servers list shows the record name",
  setup.captureCharFrame().includes("Verify Local Server"),
  true,
)
check(
  "servers list shows the world name",
  setup.captureCharFrame().includes("Verify Server World"),
  true,
)

// Add form: typing must reach the input (a/d/e/x/w are bound elsewhere).
await setup.mockInput.pressKey("a")
await settle(250)
check("add form opens", setup.captureCharFrame().includes("Add a dedicated server"), true)
// Enter must be pressed with pressEnter(): the named-key helper is what the
// real terminal sends, and the form's Enter binding matches it.
await setup.mockInput.pressEnter()
await settle(200)
await setup.mockInput.typeText("typed-server")
await settle(200)
check(
  "server form input receives typed text ('a'/'d'/'e' are bound)",
  (findInput(setup.renderer.root)?.value ?? "").endsWith("typed-server"),
  true,
)
check("typing into the server form arms no action", keymap.getPendingSequence().length, 0)
await setup.mockInput.pressEscape()
await settle(200)
await setup.mockInput.pressEscape()
await settle(400)
check(
  "Esc leaves the add form back on the server list",
  setup.captureCharFrame().includes("Verify Local Server"),
  true,
)

// A real local backup.
await setup.mockInput.pressKey("b")
await settle(4000)
check("'b' creates a server backup zip", serverZipCount() > 0, true)

// Backups view + restore round-trip.
fs.writeFileSync(path.join(serverWorld, "data/state.txt"), "server-changed")
fs.writeFileSync(path.join(serverWorld, "data/extra.txt"), "should-disappear")
await setup.mockInput.pressKey("v")
await settle(600)
checkScrollLayout("servers backups list")
await setup.mockInput.pressEnter()
await settle(300)
check(
  "server restore requires a second Enter",
  state.statusMessage().includes("Press Enter again"),
  true,
)
await setup.mockInput.pressEnter()
await settle(5000)
check(
  "server restore brings the original content back",
  fs.readFileSync(path.join(serverWorld, "data/state.txt"), "utf8"),
  "server-original",
)
check(
  "server restore drops files created after the backup",
  fs.existsSync(path.join(serverWorld, "data/extra.txt")),
  false,
)
check(
  "server restore keeps a pre-restore snapshot",
  fs.readdirSync(serverBackupsDir).some((f) => f.includes("pre-restore")),
  true,
)
await setup.mockInput.pressEscape()
await settle(300)

// Clean up the record, its backups and the scratch world.
await launcherService.removeServer(serverRecord.id, { deleteBackups: true })
fs.rmSync(serverDataDir, { recursive: true, force: true })

state.navigate("home")
await settle(400)

// ── q q quits ──
await setup.mockInput.pressKey("q")
await settle(150)
check("first q arms the quit sequence", keymap.getPendingSequence().length, 1)
await setup.mockInput.pressKey("q")
await settle(250)
check("second q destroys the renderer", destroyed, true)

console.log(failures === 0 ? "\nAll checks passed." : `\n${failures} check(s) failed.`)
process.exit(failures === 0 ? 0 : 1)
