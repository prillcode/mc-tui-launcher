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
