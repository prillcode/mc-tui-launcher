import { setLauncherRoot, getLauncherPaths } from "@prillcode/mc-launcher-core"

/**
 * McTUI Launcher configuration.
 *
 * The data root resolution order mirrors the core:
 *   1. MC_LAUNCHER_DATA_DIR env var (applied here at startup)
 *   2. platform default (~/.local/share/mctui-launcher on Linux)
 */

setLauncherRoot(process.env.MC_LAUNCHER_DATA_DIR ?? getLauncherPaths().root)

export const appConfig = {
  productName: "Blockhaven Minecraft Launcher",
  version: "0.1.0",
  msClientId: process.env.MS_CLIENT_ID,
  dataRoot: getLauncherPaths().root,
}
