# Blockhaven MC (bhmc)

**Blockhaven MC (`bhmc`)** is a keyboard-first terminal Minecraft launcher built with TypeScript, [OpenTUI](https://github.com/anomalyco/opentui), and SolidJS. It is the first consumer of [`@prillcode/mc-launcher-core`](https://github.com/prillcode/mc-launcher-core), the UI-agnostic launcher engine extracted from the BlockHaven launcher.

**Status: scaffold / early MVP.** Architecture, navigation, and the core dependency are in place; the MVP milestone (full authenticated vanilla launch) is being built against this shell.

## If you fork or clone this

This repo is published as `mc-tui-launcher`, but the package/binary keep the
original `bhmc` (Blockhaven MC) name. **Decide your own identity up front** —
don't inherit someone else's:

1. **Package / binary / product name.** Keep `bhmc`, or rename all of:
   `package.json` `name` and `bin`, `src/services/config.ts` `productName`, and
   the README title. A rename is a one-time decision; doing it later means
   re-linking the command and updating your notes.
2. **Data directory.** The core derives it from its own
   `defaultRoot()` (`~/.local/share/bhmc-launcher` on Linux,
   `%APPDATA%\bhmc-launcher`, `~/Library/Application Support/bhmc-launcher`).
   Rename it to match — and note that changing it starts from an empty data
   root (existing instances/settings/session are under the old name), so move
   them if you want to keep them.
3. **Your own Azure app registration.** No client ID ships in this repo. Create
   your own app and set `MS_CLIENT_ID` (see *Microsoft authentication* below).
   Even if you like the code as-is, **do not reuse someone else's client ID** —
   consent, rate limits and branding belong to the app owner.

Do all three before your first release, while there is nothing to migrate.

## Run it

Requires [Bun](https://bun.sh) 1.3+ (OpenTUI's primary runtime) and a sibling checkout of `mc-launcher-core`.

```bash
# 1. Build the core (clone it next to this repo, or point the file: dep at it)
#    https://github.com/prillcode/mc-launcher-core
cd ../mc-launcher-core && pnpm install && pnpm build

# 2. Install and link the TUI
pnpm install        # or: bun install
bun link            # installs the global `bhmc` command

# 3. Launch
bhmc                # or: bun run src/cli.ts
```

### Microsoft authentication

The launcher uses the Microsoft device-code flow. **No Azure client ID is
bundled** — create your own app registration and export its Application
(client) ID:

1. Microsoft Entra ID → **App registrations** → **New registration**. Any name;
   account type *Personal Microsoft accounts* (or multitenant).
2. **Authentication → Advanced settings → Allow public client flows = Yes.**
   This is what enables the device-code flow; a redirect URI is not required.
3. Copy the **Application (client) ID**:

```bash
export MS_CLIENT_ID="your-azure-app-client-id"
bhmc
```

The login screen displays the verification URL and short code (plus a QR code);
open the URL in any browser, enter the code, and sign in. Until `MS_CLIENT_ID`
is set, Microsoft sign-in is unavailable (offline-mode play still works).

### Data location

All launcher data lives under a single root: `MC_LAUNCHER_DATA_DIR` if set, otherwise the platform default (`~/.local/share/bhmc-launcher` on Linux, `%APPDATA%\bhmc-launcher` on Windows, `~/Library/Application Support/bhmc-launcher` on macOS).

World backups and exports live inside that root:

```
<data root>/backups/index.json                 # backup index (per instance)
<data root>/backups/<instanceId>/<world>-<YYYYMMDD-HHmmss>.zip
<data root>/exports/<world>-<YYYYMMDD-HHmmss>.zip
<data root>/servers.json                        # explicit dedicated-server records
<data root>/backups/servers/index.json          # server-world backup index
<data root>/backups/servers/<serverId>/<level>-<YYYYMMDD-HHmmss>.zip
```

Backups are plain `.zip` files whose archive root is the world folder
(`<world>/level.dat`), so they open with any zip tool and can be shared or
dropped straight into another instance. Retention defaults to the 5 newest
per instance (Settings → *World backups to keep*); pruning never removes the
newest. Restoring a backup first writes a `*-pre-restore-*.zip` safety
snapshot and keeps the replaced world as `<folder>.replaced-<timestamp>`.
Every world-mutating action is refused while that instance is running.

### Backing up a local / Docker dedicated-server world

A dedicated server's world is **not** in any instance's `saves/`, so a server
profile legitimately shows 0 worlds. Use the Servers screen (`d` from Home):
add an explicit record for each server (a Docker container, or a plain host
directory) with its data directory and level name. Nothing is guessed — this
machine has both a live Docker-volume world and a stale `run/` leftover.

- **Live backup (default, Docker):** the launcher runs `rcon-cli save-off`,
  `save-all flush`, copies the world out with `docker cp`, zips it, then always
  runs `save-on` (even if the copy fails). If RCON is unavailable it warns and
  copies anyway. A *Require stopped* toggle forces the clean path instead.
- **Restore:** always requires the container stopped. If it was running, the
  launcher stops it, writes a `*-pre-restore-*` safety snapshot, extracts the
  chosen backup, swaps the world inside the volume with a throwaway helper
  container (`docker run --rm --volumes-from <container> …` — the volume is
  root-owned, and `docker cp` would *merge* rather than replace), then starts
  the container again. The old world is kept as `<level>.replaced-<timestamp>`.
- **Local** sources use an ordinary temp-dir + rename, exactly like client
  worlds.

Server backups are normal `.zip` files (`<world>/level.dat` as the archive
root) under `<data root>/backups/servers/<serverId>/`, with the same keep-N
retention as client worlds. Exports go anywhere you choose.

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
| `d` | servers: Docker & local dedicated-server worlds (home) |
| `a` / `Shift+E` | add / edit a server record (Servers) |
| `b` / `v` | back up the server world / toggle its backups (Servers) |
| `e` / `y` / `o` | export / yank the world path / open a local server dir (Servers) |
| `x` | remove a server record — press twice; the world is never touched (Servers) |
| `Enter` | restore a server backup; a running container is stopped, restored, restarted (Servers backups) |
| `p` | prune old backups beyond the retention count (Worlds & Servers backups) |
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
- **Servers** — explicit local/Docker dedicated-server records, live RCON-flushed
  backups, stopped-container restore via a helper-container volume swap
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
