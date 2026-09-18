#!/usr/bin/env bun
import { render } from "@opentui/solid"
import { registerQRCode } from "@opentui/qrcode/solid"
import { App } from "./app/App"
import { launcherService } from "./services/launcher"

registerQRCode()

// Initialize the core (loads persisted stores, refreshes instances/profile)
await launcherService.init()

await render(() => <App />, { exitOnCtrlC: true })
