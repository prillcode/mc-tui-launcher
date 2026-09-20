# Blockhaven MC (bhmc)

**Blockhaven MC (`bhmc`)** is a keyboard-first terminal Minecraft launcher built with TypeScript, [OpenTUI](https://github.com/anomalyco/opentui), and SolidJS. It is the first consumer of [`@prillcode/mc-launcher-core`](../mc-launcher-core), the UI-agnostic launcher engine extracted from the BlockHaven launcher.

**Status: scaffold / early MVP.** Architecture, navigation, and the core dependency are in place; the MVP milestone (full authenticated vanilla launch) is being built against this shell.

## Run it

Requires [Bun](https://bun.sh) 1.3+ (OpenTUI's primary runtime) and a sibling checkout of `mc-launcher-core`.

```bash
# 1. Build the core (sibling repo)
cd ../mc-launcher-core && pnpm install && pnpm build

# 2. Install and link the TUI
pnpm install        # or: bun install
bun link            # installs the global `bhmc` command

# 3. Launch
bhmc                # or: bun run src/cli.ts
```

### Microsoft authentication

The launcher uses the Microsoft device-code flow. Set your Azure AD application (client) ID in the environment:

```bash
export MS_CLIENT_ID="your-azure-app-client-id"
bhmc
```

The login screen displays the verification URL and short code (plus a QR code); open the URL in any browser, enter the code, and sign in.

### Data location

All launcher data lives under a single root: `MC_LAUNCHER_DATA_DIR` if set, otherwise the platform default (`~/.local/share/bhmc-launcher` on Linux, `%APPDATA%\bhmc-launcher` on Windows, `~/Library/Application Support/bhmc-launcher` on macOS).

World backups and exports live inside that root:

```
<data root>/backups/index.json                 # backup index (per instance)
<data root>/backups/<instanceId>/<world>-<YYYYMMDD-HHmmss>.zip
<data root>/exports/<world>-<YYYYMMDD-HHmmss>.zip
```

Backups are plain `.zip` files whose archive root is the world folder
(`<world>/level.dat`), so they open with any zip tool and can be shared or
dropped straight into another instance. Retention defaults to the 5 newest
per instance (Settings → *World backups to keep*); pruning never removes the
newest. Restoring a backup first writes a `*-pre-restore-*.zip` safety
snapshot and keeps the replaced world as `<folder>.replaced-<timestamp>`.
Every world-mutating action is refused while that instance is running.

### Backing up a Docker / local server world (manual stopgap)

Worlds that live on a dedicated server are **not** in any instance's `saves/`,
so a server profile (e.g. one auto-connecting to `localhost`) legitimately shows
0 worlds. Until the dedicated server-world backup work lands, the existing
pieces cover it manually:

```bash
# inside the server container (itzg image), flush the world first
docker exec minecraft-golf-dev rcon-cli save-all flush

# copy the live world out (named volumes are root-owned on the host, so use docker cp)
docker cp minecraft-golf-dev:/data/world /tmp/

# zip it with the world folder as the archive root
(cd /tmp && zip -r golf-world.zip world)
```

Then open the Worlds screen on any instance and press `i` to import
`/tmp/golf-world.zip`. The server keeps writing while you copy, so this
snapshot is crash-consistent at best — stop the container
(`docker compose -f dev-server/docker-compose.yml stop`) for a clean one, or
rely on the RCON flush above. Server-world backups, restore and the
stopped-server guard are planned as phase 05.

## Controls

Every key is a named command on one `@opentui/keymap` keymap, scoped to the
screen or mode that owns it. The hint bar at the bottom is generated from the
bindings that are active right now, so it always matches what the keys do;
press `?` for the full reference.

| Key | Action |
| --- | --- |
| `↑/↓` `←/→` or `j/k` | navigate lists, menus and the instance grid |
| `Tab` | switch section (home: instances ↔ menu) |
| `Enter` | select / open instance details |
| `l` | launch the selected instance |
| `c` | create an instance (pick version, then mod loader) |
| `[` / `]` | page the instance grid |
| `Home` / `End` | first / last item (logs: top / end) |
| `t` | jump to the latest log line |
| `r` | re-ping servers / refresh the current list |
| `f` | toggle the Fabric mod loader (instance details) |
| `a` / `n` / `x` | auto-connect server / rename / delete (instance details) |
| `p` | re-ping the server (instance details) |
| `Shift+M` | edit instance memory (instance details) |
| `ctrl+x` | close the running Minecraft client (instance details) |
| `m` | mods (home) |
| `w` | worlds: browse, back up and restore singleplayer saves (home) |
| `b` / `v` | back up the selected world / toggle the backups list (Worlds) |
| `e` / `i` | export a world zip / import a world zip (Worlds) |
| `x` / `c` | delete a world / copy it to another instance (Worlds) |
| `y` / `o` | yank a path to the clipboard / open the folder (Worlds) |
| `Enter` | restore the selected backup — press twice (Worlds backups) |
| `s` / `i` / `e` | search Modrinth / import a `.jar` / enable-disable (Mods) |
| `h` | shader packs mode (Mods) |
| `Esc` | back / close / cancel |
| `?` | help |
| `q` `q` | quit (press twice) |

### Verifying UI changes without a TTY

The screens are rendered with OpenTUI's in-memory test renderer, so key
handling and scroll layouts can be checked headlessly:

```bash
bun run verify          # assertion suite: typing vs. bindings, scroll geometry, q q
bun run shots instances # print rendered frames for a screen (or all screens)
```

## Screens

- **Home** — quick actions, account status
- **Login** — Microsoft device-code flow with QR code
- **Instances** — list, create (vanilla), open details
- **Instance detail** — metadata + launch (the MVP chain: session → version files → Java → launch)
- **Mods** — installed mods per instance (Modrinth search/install coming)
- **Worlds** — per-instance singleplayer worlds with real `level.dat` metadata,
  zip backup/export/import, restore with a safety snapshot
- **Settings** — current configuration (editing coming)
- **Logs** — launcher and Minecraft process output
- **Help** — keyboard reference

## Architecture

```
src/
├── app/          App shell, navigation, shared reactive state, keymap wiring
├── screens/      One module per screen (Solid components)
├── components/   Header, StatusBar, KeyHints, Progress, Dialog
├── services/     The only place that talks to the core package
└── index.tsx     Entry point (bun shebang, OpenTUI render)
```

- **SolidJS idioms**: signals/memos for state, `onMount`/`onCleanup` for lifecycle, single-render components — no React mental model.
- **One keymap**: `app/keymap.ts` builds the app keymap; each screen registers
  `useBindings()` layers for the modes it owns and switches them off with
  `enabled` matchers. Commands carry `desc`/`hint` metadata, which is what the
  hint bar and the Help screen read.
- **Service boundary**: all core events (progress, stdout, exit) are adapted into Solid signals in `services/launcher.ts`; screens stay declarative.
- **Credentials**: the core accepts any `KeyValueStore`; bhmc currently uses a JSON-file adapter (`services/credentials.ts`). An encrypted/keychain adapter is a planned hardening step before the MVP is signed off.

## Relationship to the other repos

```
@prillcode/mc-launcher-core   ← reusable engine (source of truth)
            │
            ▼
bhmc-launcher (this repo)    ← OpenTUI/SolidJS terminal launcher

bh-minecraft-launcher         ← unchanged Electron/React launcher (reference)
```

BlockHaven intentionally keeps its own embedded copy of the launcher logic; whether it later consumes `@prillcode/mc-launcher-core` is a separate future decision.
