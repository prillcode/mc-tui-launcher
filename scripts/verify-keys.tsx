/**
 * Behaviour checks that need the real renderer: keymap is a direct key
 * listener, so a live single-letter binding would swallow typing.
 */
import "@opentui/solid/preload"

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

// ── q q quits ──
await setup.mockInput.pressKey("q")
await settle(150)
check("first q arms the quit sequence", keymap.getPendingSequence().length, 1)
await setup.mockInput.pressKey("q")
await settle(250)
check("second q destroys the renderer", destroyed, true)

console.log(failures === 0 ? "\nAll checks passed." : `\n${failures} check(s) failed.`)
process.exit(failures === 0 ? 0 : 1)
