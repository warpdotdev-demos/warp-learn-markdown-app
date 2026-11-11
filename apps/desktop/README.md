# Desktop App

Desktop app for Marky (TypeScript + Electron).

## Prerequisites

Install:

- [Node.js](https://nodejs.org/en/download) 22 (22.13 or newer; see `.nvmrc`)
- [pnpm](https://pnpm.io/installation)
- macOS desktop builds: Xcode Command Line Tools via `xcode-select --install`

## Development

From repo root:

```sh
pnpm install
pnpm dev:desktop
```

For Chrome DevTools MCP access:

```sh
pnpm dev:desktop:debug
```

The debug command exposes the Electron renderer over Chrome DevTools Protocol at `http://127.0.0.1:${MARKY_DESKTOP_DEBUG_PORT:-9222}`.

## Build

From repo root:

```sh
pnpm build:desktop
pnpm bundle:desktop:mac    # macOS (.dmg, .zip)
pnpm bundle:desktop:win    # Windows (NSIS .exe installer)
pnpm bundle:desktop:linux  # Linux (.AppImage, .deb)
```

Each `bundle:desktop:*` command creates unsigned artifacts under `apps/desktop/release/`.
Build a given platform's artifacts on that platform.

