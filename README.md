# Marky - as seen on warp.dev/learn

This is the sample project used by the Warp Factories introductory course. Learn more at [warp.dev/learn](https://warp.dev/learn)

## What is Marky?

Marky is a local-first desktop app backed by plain Markdown and HTML files.

- **Feels familiar.** A writing experience like Notion or Apple Notes, but for Markdown. `/` commands, Markdown shortcuts, and file properties / frontmatter are supported.
- **Agent ready.** Point your agent at your notes folder to start collaborating. Marky live-reloads as your agent edits.

## Getting started

Install the prerequisites:

- [Node.js](https://nodejs.org/en/download) 22 (22.13 or newer; see `.nvmrc`)
- [pnpm](https://pnpm.io/installation)
- macOS desktop builds: Xcode Command Line Tools via `xcode-select --install`

Then from the repo root:

```sh
pnpm install
pnpm dev:desktop
```

To build a production bundle:

```sh
pnpm bundle:desktop:mac
# or for windows:
pnpm bundle:desktop:win
# or for linux:
pnpm bundle:desktop:linux
```

Bundles are written to `apps/desktop/release/`. See [`apps/desktop/README.md`](./apps/desktop/README.md) for more detail.

## Repository structure

This repo is a pnpm workspace:

```text
.
├── apps
│   └── desktop  # Electron desktop app
└── packages
    ├── editor   # Framework-agnostic Markdown editor core (Tiptap + Markdown conversion)
    ├── ui       # Shared React editor UI built on the editor core
    └── runtime  # Runtime injected into HTML Apps and Embeds
```

## Common commands

From the repo root:

```sh
pnpm install              # install dependencies
pnpm dev:desktop          # run the desktop app in dev
pnpm build:desktop        # build packages, typecheck, and build the desktop app
pnpm test                 # run unit tests
pnpm check                # run Biome
pnpm check:react-compiler # verify the React Compiler handles every component
```

## License

Marky is licensed under the [MIT License](./LICENSE).
