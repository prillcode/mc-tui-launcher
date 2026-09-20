/**
 * Ad-hoc render harness: drives the real app through `createTestRenderer`
 * (native in-memory output) and prints frames + the hint bar, so key
 * handling and scroll layouts can be checked without a TTY.
 *
 *   bun run scripts/screenshot.tsx [screen ...]
 */
import "@opentui/solid/preload"
import * as os from "node:os"
import * as fs from "node:fs"
import * as path from "node:path"
import { makeLevelDat } from "./lib/level-dat"

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

await render(
  () => (
    <KeymapProvider keymap={keymap}>
      <App />
    </KeymapProvider>
  ),
  setup.renderer,
)

const settle = async (ms = 250) => {
  await new Promise((resolve) => setTimeout(resolve, ms))
  await setup.renderOnce()
}

const frame = () => setup.captureCharFrame().split("\n")

async function shot(label: string, keys: Array<[string, string?]> = []) {
  for (const [key, modifier] of keys) {
    if (key === "esc") await setup.mockInput.pressEscape()
    else if (key === "up" || key === "down" || key === "left" || key === "right") await setup.mockInput.pressArrow(key)
    else if (modifier) await setup.mockInput.pressKey(key, { [modifier]: true } as never)
    else await setup.mockInput.pressKey(key)
    await settle(60)
  }
  await settle()
  const lines = frame()
  console.log(`\n${"━".repeat(96)}\n${label}\n${"━".repeat(96)}`)
  console.log(lines.join("\n"))
}

const requested = process.argv.slice(2)

// Give the initial instance/version load a moment.
await settle(600)

if (requested.length === 0 || requested.includes("home")) {
  await shot("HOME")
}

if (requested.length === 0 || requested.includes("instances")) {
  await shot("INSTANCES (i)", [["i"]])
  await shot("INSTANCES grid navigation", [["right"], ["down"]])
  await shot("INSTANCES create (c)", [["c"]])
  const scrollKeys: Array<[string, string?]> = []
  for (let i = 0; i < 25; i++) scrollKeys.push(["down"])
  await shot("INSTANCES create — cursor scrolled 25 rows", scrollKeys)
}

if (requested.length === 0 || requested.includes("detail")) {
  state.navigate("instance-detail", state.instances()[0]?.id ?? "none")
  await shot("INSTANCE DETAIL")
}

if (requested.length === 0 || requested.includes("mods")) {
  state.navigate("mods")
  await shot("MODS")
  await shot("MODS search input (s)", [["s"]])
  // Network-dependent: prints the Empty-state instead when offline.
  await setup.mockInput.typeText("sodium")
  await setup.mockInput.pressEnter()
  await settle(4000)
  await shot("MODS search results")
  for (let i = 0; i < 12; i++) await setup.mockInput.pressArrow("down")
  await shot("MODS search results (cursor followed by scrolling)")
  await shot("MODS back to list", [["esc"]])
}

if (requested.length === 0 || requested.includes("worlds") || requested.includes("worlds-backups")) {
  state.navigate("worlds", state.instances()[0]?.id ?? "none")
  await shot("WORLDS")
  // Create a real backup so the backups view is not an empty state.
  await setup.mockInput.pressKey("b")
  await settle(2500)
  await shot("WORLDS after backup (b)")
  await shot("WORLDS backups (v)", [["v"]])
}

if (requested.length === 0 || requested.includes("servers") || requested.includes("servers-backups")) {
  // A local record, so the screenshots never need Docker.
  const serverDir = fs.mkdtempSync(path.join(os.tmpdir(), "bhmc-shots-server-"))
  const serverWorld = path.join(serverDir, "world")
  fs.mkdirSync(path.join(serverWorld, "data"), { recursive: true })
  fs.writeFileSync(path.join(serverWorld, "level.dat"), makeLevelDat("Golf Design World", "26.2", Date.now()))
  fs.writeFileSync(path.join(serverWorld, "data/state.txt"), "shots")
  const record = await launcherService.addServer({
    name: "BirdieBiome - Golf (local)",
    source: { kind: "local", dataDir: serverDir, levelName: "world" },
  })
  state.navigate("servers")
  await shot("SERVERS")
  await setup.mockInput.pressKey("b")
  await settle(2500)
  await shot("SERVERS after backup (b)")
  await shot("SERVERS backups (v)", [["v"]])
  await launcherService.removeServer(record.id, { deleteBackups: true })
  fs.rmSync(serverDir, { recursive: true, force: true })
}

if (requested.length === 0 || requested.includes("settings")) {
  state.navigate("settings")
  await shot("SETTINGS")
  await shot("SETTINGS editor", [["return"]])
}

if (requested.length === 0 || requested.includes("logs")) {
  for (let i = 0; i < 60; i++) state.appendLog(`[00:0${i % 10}:00] [Render thread/INFO]: log line ${i}`)
  state.navigate("logs")
  await shot("LOGS")
}

if (requested.length === 0 || requested.includes("help")) {
  state.navigate("help")
  await shot("HELP")
}

if (requested.length === 0 || requested.includes("quit")) {
  state.navigate("home")
  await shot("QUIT pending (q)", [["q"]])
}

setup.renderer.destroy()
process.exit(0)
