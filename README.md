# Origami

A clean desktop PDF reader built with Tauri v2 + React + TypeScript. Tailored for the Windows platform.

## Features

- **Reading**: page navigation, wheel zoom, fit width/page, single/double page layout, scroll/flip mode, rotation
- **Navigation**: table of contents (outline), page thumbnails, full-text search
- **Translation**: select text and look it up with AI translation or Wikipedia, shown in the right panel
- **Extras**: file properties, print, recent files, light/dark theme, 10 UI languages, keyboard shortcuts, fullscreen

## Tech Stack

| Layer | Technology |
|---|---|
| Desktop shell | Tauri v2 (Rust) |
| Frontend | React 19 + TypeScript + Vite |
| PDF rendering | pdfjs-dist v6 |
| Package manager | pnpm |

## Development

Prerequisites: Node.js 22+, pnpm 9+, Rust stable (with MSVC toolchain).

```bash
pnpm install      # install dependencies
pnpm tauri dev    # start dev mode with hot reload
```

## Build

```bash
pnpm tauri build  # produce installer under src-tauri/target/release/bundle/
```
