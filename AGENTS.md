Check work: `pnpm build:desktop` (builds packages, runs tsc and the electron-vite build). For quick iteration use `pnpm check` and desktop tsc.

After React changes, run `pnpm check:react-compiler`; it fails on components the compiler skips.
