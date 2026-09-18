# Project Scaffold: `mc-launcher-core` + `mctui-launcher`

You are working in the new mostly empty project directory mctui-launcher. At the same level as `mctui-launcher` is another project directory `bh-minecraft-launcher`.

Create another sibling repository beside these named `mc-launcher-core`.

The 3 project directories will be as follows:

```text
bh-minecraft-launcher/
mc-launcher-core/
mctui-launcher/
```

The existing `bh-minecraft-launcher` is a working Electron + React + TypeScript Minecraft launcher. Its reusable launcher logic currently lives primarily under `bh-minecraft-launcher/src/core/`.

Extract that logic into a standalone TypeScript package named `mc-launcher-core` using the new project directory by the same name. Then scaffold `mctui-launcher` using TypeScript, OpenTUI, and SolidJS. The TUI should become the first consumer used to validate the extracted package.

Do **not** update `bh-minecraft-launcher` to consume the new package during this work. Leave that repository functionally unchanged after using it as the reference implementation. Migrating BlockHaven is a deferred, optional follow-up to consider only after `mctui-launcher` has reached a working MVP.

The TUI should eventually provide a full-featured Minecraft launcher, including authenticated Microsoft/Minecraft online play.

## Product and executable naming

Use these names consistently:

| Context | Name |
| --- | --- |
| Display/product name | **McTUI Launcher** |
| Repository and directory | `mctui-launcher` |
| Installed terminal command | `mctui` |
| Shared core package | `@prillcode/mc-launcher-core` |

The repository/package may retain the descriptive `mctui-launcher` name, but users should launch it with the concise command:

```bash
mctui
```

## Primary goals

1. Create `mc-launcher-core` as a standalone TypeScript library.
2. Extract reusable launcher behavior from `bh-minecraft-launcher/src/core/`.
3. Remove Electron- and UI-specific assumptions from the extracted core.
4. Create and scaffold `mctui-launcher` as the first consumer of the package.
5. Use OpenTUI with TypeScript and SolidJS for the TUI.
6. Establish clean boundaries before significant TUI implementation.
7. Prove the extracted behavior through a working `mctui-launcher` MVP.
8. Preserve `bh-minecraft-launcher` in its current working state without migrating it yet.
9. Use Solid's reactive model idiomatically rather than treating it as React with different imports.

## Required sequencing

Follow this order:

1. Inspect `bh-minecraft-launcher` as the known-good reference implementation.
2. Extract and verify `mc-launcher-core` without deleting or replacing BlockHaven's existing core.
3. Scaffold `mctui-launcher` against the extracted package.
4. Build and validate the `mctui-launcher` MVP.
5. Stop. Do not migrate BlockHaven as part of this effort.
6. In a later, separately authorized task, decide whether migrating BlockHaven provides enough value to justify the work.

Do not rewrite working behavior unnecessarily. Prefer extracting/copying, adapting, and testing the existing implementation while leaving BlockHaven's working copy intact.

---

# Repository 1: `mc-launcher-core`

Create and initialize:

```text
mc-launcher-core/
```

Use TypeScript. The package name should be:

```text
@prillcode/mc-launcher-core
```

Use that name consistently unless a concrete technical issue requires a change. Configure sibling-repository development without requiring an npm publish, while keeping the package suitable for later publication to the public npm registry with semantic versioning.

## Responsibilities

Extract the existing reusable functionality where implemented:

- Microsoft OAuth device-code flow
- Xbox Live authentication and XSTS exchange
- Minecraft authentication and profile retrieval
- token refresh and cache behavior
- Minecraft version manifests and metadata
- asset and library downloads
- hash verification and parallel downloads
- Java detection and validation
- launch-argument construction and process launching
- instance/profile management and isolated game directories
- Modrinth integration
- OS-specific paths
- logging abstractions
- progress and lifecycle events

Treat `bh-minecraft-launcher/src/core/` as the authoritative starting point. Do not independently reimplement these systems unless extraction requires refactoring.

## Suggested structure

```text
mc-launcher-core/
├── src/
│   ├── auth/
│   ├── game/
│   ├── mods/
│   ├── storage/
│   ├── logging/
│   ├── events/
│   ├── utils/
│   └── index.ts
├── tests/
├── package.json
├── tsconfig.json
├── README.md
└── .gitignore
```

Let the actual code determine the final modules. Do not create empty abstractions merely to match a proposed tree.

## Architectural boundary

`mc-launcher-core` must not depend on:

- Electron
- React
- SolidJS
- OpenTUI
- DOM APIs or browser globals
- renderer stores
- UI components
- Electron IPC

Expose typed behavior, data, events, and small interfaces. Consumers decide how to display them.

For example, expose progress as data:

```ts
export interface DownloadProgress {
  completed: number
  total: number
  currentFile?: string
}
```

## Credentials and persistence

Do not carry Electron-specific persistence into the core. Introduce a small interface where needed:

```ts
export interface CredentialStore {
  get(key: string): Promise<string | undefined>
  set(key: string, value: string): Promise<void>
  delete(key: string): Promise<void>
}
```

The TUI should provide its own adapter. Design the boundary so BlockHaven could provide a separate adapter later if it is eventually migrated. Preserve Microsoft/MSAL token-cache behavior and silent refresh. Never log secrets or tokens.

## Logging and events

Use a small injected logger or a safe default with consumer override support. The core must not directly manipulate terminal or GUI output. It should emit structured progress, status, log, and process events that either frontend can render.

## Public API

Create deliberate root and, where useful, subpath exports:

```ts
import {
  MicrosoftAuth,
  MinecraftAuth,
  JavaDetector,
  VersionManifest,
  Launcher,
} from "@prillcode/mc-launcher-core"

import { MicrosoftAuth } from "@prillcode/mc-launcher-core/auth"
```

Consumers should not import private implementation paths. Do not export every helper automatically.

## Tests

Move or recreate relevant core tests. Prioritize:

- authentication token transformations
- launch-argument construction
- version metadata parsing
- Java detection
- asset/hash validation
- instance paths and configuration

Mock network calls. Automated tests must not require real Microsoft authentication. Preserve behavior unless a bug is identified; document a discovered bug before intentionally changing behavior.

---

# Deferred follow-up: possible `bh-minecraft-launcher` migration

This is **not part of the current implementation task**.

Use `bh-minecraft-launcher` for read-only inspection and as the known-good behavioral reference while extracting the package. Do not replace its imports, remove its existing core, change its dependency graph, or otherwise migrate it during the core/TUI work.

Temporary duplication is acceptable during this transition:

```text
bh-minecraft-launcher
└── existing embedded core (legacy/reference copy)

@prillcode/mc-launcher-core
└── extracted package used by mctui-launcher
```

The immediate architecture is:

```text
bh-minecraft-launcher         @prillcode/mc-launcher-core
Electron/React                           │
existing embedded core                   ▼
                                  mctui-launcher
                                  OpenTUI/SolidJS
```

Only after `mctui-launcher` reaches a working MVP should a separate planning decision consider whether BlockHaven should consume the package. Since BlockHaven currently has only one user, preserving its present working implementation is more valuable during TUI development than forcing an early migration.

If that later migration is authorized, use a simple sibling dependency or published package, remove duplication only after the migration is verified, and preserve the existing Git history. Do not assume that follow-up will necessarily happen.

For the current task, the only BlockHaven completion criterion is that no functional changes are made to its tracked files. Do not publish or deploy it.

---

# Repository 2: `mctui-launcher`

Create and initialize:

```text
mctui-launcher/
```

Configure the project so its installed executable is named `mctui`. Use the package/runtime's current supported command-entry mechanism. For a standard Node-compatible package, the conceptual package metadata is:

```json
{
  "name": "mctui-launcher",
  "bin": {
    "mctui": "./dist/cli.js"
  }
}
```

Treat that snippet as directional: choose the actual entry path and build output that match the current OpenTUI runtime and project structure. The executable entry point must use the appropriate shebang or native-binary configuration, accept terminal signals cleanly, and restore terminal state when it exits.

Use:

```text
TypeScript
OpenTUI
SolidJS
```

Expected packages may include:

```text
@opentui/core
@opentui/solid
@opentui/keymap
solid-js
```

This list is directional. Consult current official OpenTUI documentation and the installed OpenTUI skill before selecting the runtime, exact packages, versions, JSX settings, and APIs. Use mutually compatible versions documented by OpenTUI. Do not copy stale version pins from old examples.

Do not install or use React or `@opentui/react` in `mctui-launcher` unless a concrete blocker is discovered and documented for review before changing direction.

## OpenTUI agent skill

Install the official OpenTUI coding-agent skill if it is not already available:

```bash
npx skills add anomalyco/opentui --skill opentui
```

Use a global installation only if that matches the existing agent/skill conventions. Read and follow the installed skill and current OpenTUI Solid documentation before implementing the TUI.

The skill is development guidance for the coding agent; it is not a runtime dependency of the launcher.

## SolidJS implementation guidance

Use SolidJS idiomatically:

- Use signals, memos, and stores according to their semantics.
- Use lifecycle primitives such as `onMount` and `onCleanup`.
- Remember that Solid components normally execute once; do not apply a React rerender mental model.
- Preserve reactivity when reading or destructuring reactive values.
- Keep long-running launcher operations outside view markup.
- Adapt core events into UI state through a small service/controller boundary.
- Clean up subscriptions, timers, process listeners, and key handlers.
- Do not add React compatibility layers merely to reuse React patterns.

An illustrative entry point might resemble:

```tsx
import { render } from "@opentui/solid"

function App() {
  return (
    <box>
      <text>McTUI Launcher</text>
    </box>
  )
}

await render(App)
```

This is conceptual only. Use the current documented OpenTUI Solid API and JSX configuration.

## Suggested TUI structure

```text
mctui-launcher/
├── src/
│   ├── app/
│   │   ├── App.tsx
│   │   ├── navigation.ts
│   │   └── state.ts
│   ├── screens/
│   │   ├── HomeScreen.tsx
│   │   ├── LoginScreen.tsx
│   │   ├── InstancesScreen.tsx
│   │   ├── InstanceDetailScreen.tsx
│   │   ├── ModsScreen.tsx
│   │   ├── SettingsScreen.tsx
│   │   └── LogsScreen.tsx
│   ├── components/
│   │   ├── Header.tsx
│   │   ├── StatusBar.tsx
│   │   ├── KeyHints.tsx
│   │   ├── Progress.tsx
│   │   └── Dialog.tsx
│   ├── services/
│   │   ├── launcher.ts
│   │   ├── credentials.ts
│   │   └── config.ts
│   └── index.tsx
├── package.json
├── tsconfig.json
├── README.md
└── .gitignore
```

Adapt this to the current official conventions. The `.tsx` files use Solid's JSX transform, not React's.

## UX goals

Build a keyboard-first terminal application. Plan for:

```text
Up/Down or j/k    navigate
Enter             select / activate
Esc               back / close
/                 search
m                 mods
s                 settings
a                 accounts
?                 help
q                 quit
```

Use current OpenTUI keymap facilities and Solid bindings where appropriate. Mouse support is welcome but optional. Design a true terminal workflow rather than translating the Electron GUI literally.

The application should display **McTUI Launcher** in its interface and help text. Documentation, install instructions, and examples should use `mctui` as the command users run.

## Initial screens

Establish architecture for:

- Home
- Microsoft Login
- Instances
- Instance Details
- Mods
- Settings
- Logs
- Help

A working shell with navigation and partial or placeholder screens is sufficient for scaffolding. Wire `@prillcode/mc-launcher-core` immediately so the dependency is real.

## Microsoft login UX

Use the existing Microsoft device-code flow. Plan for a screen that always displays the verification URL, short code, current status, and cancellation key.

Investigate whether the current OpenTUI ecosystem can render a QR code for the login URL, but do not let that complicate scaffolding. The URL and short code must remain visible as text.

## MVP completion target

1. Launch the TUI in a full-screen terminal interface.
2. Authenticate through Microsoft device-code flow.
3. Retrieve and display the Minecraft profile.
4. Fetch available Minecraft versions.
5. Select a vanilla version.
6. Verify or download required assets and libraries.
7. Detect compatible Java.
8. Launch authenticated vanilla Minecraft.

The initial scaffold may be completed as its own logical checkpoint, but this milestone must be reached and validated before any BlockHaven migration is considered. Do not use unfinished TUI work as a reason to begin integrating the package back into BlockHaven.

## Later features

Architect for but do not prematurely implement:

- multiple accounts and isolated instances
- Fabric, NeoForge, and Forge
- Modrinth search/install/update and modpacks
- resource packs, shaders, and worlds
- server favorites and auto-connect
- import/export
- RAM/JVM configuration
- Java runtime management
- download progress and game-log streaming
- crash reports and update notifications

Avoid speculative abstractions until needed.

---

# Development principles

1. Preserve working BlockHaven behavior.
2. Extract before rewriting.
3. Make `mc-launcher-core` the source of truth for the new TUI while explicitly tolerating BlockHaven's temporary legacy copy.
4. Keep the core UI-framework agnostic.
5. Keep SolidJS/OpenTUI concerns in `mctui-launcher`.
6. Keep Electron/React concerns in `bh-minecraft-launcher`.
7. Use idiomatic SolidJS rather than translating React hooks mechanically.
8. Prefer small interfaces over generalized framework abstractions.
9. Maintain strong TypeScript types and avoid undocumented `any`.
10. Keep secrets out of logs and source control.
11. Follow current official OpenTUI APIs and the installed skill.
12. Add tests around moved behavior.
13. Do not publish, deploy, create remotes, or push without explicit instruction.
14. Do not alter BlockHaven implementation or dependencies during the current effort.
15. Do not begin the optional BlockHaven migration until the TUI MVP is complete and a separate task explicitly authorizes it.

---

# Planning before implementation

Before changing code:

1. Inspect all of `bh-minecraft-launcher/src/core/`.
2. Inspect how Electron main, preload, and renderer layers consume it.
3. Identify hidden Electron, React, browser, or UI dependencies.
4. Inspect tests and package dependencies.
5. Read the installed OpenTUI skill and current OpenTUI Solid documentation.
6. Confirm runtime, package, JSX, TypeScript, and Solid version requirements.
7. Produce a concise extraction/scaffold plan.

The plan should identify files that can be extracted nearly unchanged, refactors and adapters, tests to move, dependencies, the TUI scaffold, Solid state/lifecycle design, MVP verification, and how to avoid modifying BlockHaven. Do not include BlockHaven package integration in the execution plan.

Then execute. Do not spend excessive time on speculative documentation.

---

# Verification

## `mc-launcher-core`

- dependencies install
- TypeScript compiles
- tests pass
- package exports resolve
- no Electron, React, SolidJS, or OpenTUI dependency exists

## `bh-minecraft-launcher`

- repository remains on its existing implementation
- no imports are redirected to the shared package
- no embedded core files are removed
- no tracked functional changes are introduced by this task

## `mctui-launcher`

- dependencies install
- TypeScript and Solid JSX compile
- no React or `@opentui/react` dependency is present
- the project exposes an executable named `mctui`
- `mctui` launches the application after the documented local/global installation or link workflow
- the OpenTUI Solid application launches
- basic navigation works
- the shared core imports successfully
- reactive state updates render
- subscriptions and handlers clean up
- normal exit and handled interruption restore terminal state

Run configured linting and formatting. Do not declare success with failing verification.

---

# Documentation

Create concise READMEs.

For `mc-launcher-core`, document purpose, supported features, installation, API use, sibling-repo development, testing, and architecture.

For `mctui-launcher`, document the **McTUI Launcher** product name, purpose, status, TypeScript/OpenTUI/SolidJS stack, setup, installation/link workflow, the `mctui` command, controls, and its relationship to the core and BlockHaven.

Do not update BlockHaven documentation to claim it consumes the package; it will continue using its embedded core until a possible later migration.

---

# Git constraints

Initialize Git for `mc-launcher-core` and `mctui-launcher`. Preserve BlockHaven's existing Git history. Make logical local commits where appropriate.

Do not create remote repositories or push anything without explicit instruction.

---

# Desired end state

```text
dev/
├── bh-minecraft-launcher/
│   └── Electron + React GUI
├── mc-launcher-core/
│   └── reusable TypeScript Minecraft launcher engine
└── mctui-launcher/
    └── OpenTUI + SolidJS terminal launcher
```

For the current phase, `mc-launcher-core` is the source of truth for `mctui-launcher`, while BlockHaven intentionally retains its existing embedded implementation as a temporary legacy/reference copy.

The intended current dependency relationship is:

```text
@prillcode/mc-launcher-core
            │
            ▼
    mctui-launcher
    OpenTUI/SolidJS

bh-minecraft-launcher remains independent and unchanged
```

A future BlockHaven migration is optional and requires a separate decision after the TUI MVP is working.

Begin by inspecting the existing BlockHaven repository and planning against the code that actually exists. Do not assume any proposed directory tree perfectly matches the current implementation.
