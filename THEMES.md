# Themes

Agent Desk ships the themes below and can import more from other apps. A theme only supplies a
background, a foreground, the 16 terminal colors and (optionally) syntax colors, an accent, an
aurora and glass settings. `ui/src/theme/derive.js` turns that into the full token set (surfaces,
text levels, status colors, diff, syntax, terminal, Monaco, glass, shadows) and adjusts text
lightness until it passes WCAG against every surface it can land on, glass over the brightest
aurora stop included.

## Built-in themes

Palettes are each project's published colors. Where a project leaves something out, the gap is
filled as noted. Palettes are used under the licenses listed.

| Theme | id | Kind | Source | License | Notes |
| --- | --- | --- | --- | --- | --- |
| Desk Glass Dark | `desk-glass-dark` | dark | this repo | MIT | Original. Default dark theme. |
| Desk Glass Light | `desk-glass-light` | light | this repo | MIT | Original. Default light theme. |
| Cyberpunk | `cyberpunk` | dark | this repo | MIT | Original genre palette, glow on. |
| SynthWave '84 | `synthwave-84` | dark | https://github.com/robb0wen/synthwave-vscode | MIT | Glow on. Terminal black/white use VS Code defaults (the theme leaves them unset). |
| Dracula | `dracula` | dark | https://draculatheme.com/spec | MIT | Includes the spec's ANSI palette. |
| Nord | `nord` | dark | https://www.nordtheme.com/docs/colors-and-palettes | MIT | Terminal from nord-iterm2, syntax from nord-visual-studio-code. |
| Nord Light | `nord-light` | light | https://www.nordtheme.com/docs/colors-and-palettes | MIT | Nord has no official light theme; this arranges the Nord palette on Snow Storm. |
| Catppuccin Mocha | `catppuccin-mocha` | dark | https://catppuccin.com/palette | MIT | |
| Catppuccin Macchiato | `catppuccin-macchiato` | dark | https://catppuccin.com/palette | MIT | |
| Catppuccin Frappé | `catppuccin-frappe` | dark | https://catppuccin.com/palette | MIT | |
| Catppuccin Latte | `catppuccin-latte` | light | https://catppuccin.com/palette | MIT | |
| Tokyo Night | `tokyo-night` | dark | https://github.com/folke/tokyonight.nvim | Apache-2.0 | |
| Tokyo Night Storm | `tokyo-night-storm` | dark | https://github.com/folke/tokyonight.nvim | Apache-2.0 | |
| Tokyo Night Day | `tokyo-night-day` | light | https://github.com/folke/tokyonight.nvim | Apache-2.0 | |
| Rosé Pine | `rose-pine` | dark | https://rosepinetheme.com/palette | MIT | |
| Rosé Pine Moon | `rose-pine-moon` | dark | https://rosepinetheme.com/palette | MIT | |
| Rosé Pine Dawn | `rose-pine-dawn` | light | https://rosepinetheme.com/palette | MIT | |
| Gruvbox Dark | `gruvbox-dark` | dark | https://github.com/morhetz/gruvbox | MIT | |
| Gruvbox Light | `gruvbox-light` | light | https://github.com/morhetz/gruvbox | MIT | |
| Solarized Dark | `solarized-dark` | dark | https://ethanschoonover.com/solarized/ | MIT | Syntax roles follow VS Code's bundled Solarized. |
| Solarized Light | `solarized-light` | light | https://ethanschoonover.com/solarized/ | MIT | Same. |
| One Dark | `one-dark` | dark | https://github.com/atom/atom/tree/master/packages/one-dark-syntax | MIT | Terminal from https://github.com/joshdick/onedark.vim (MIT). |
| One Light | `one-light` | light | https://github.com/atom/atom/tree/master/packages/one-light-syntax | MIT | Terminal from https://github.com/sonph/onehalf (MIT). |
| GitHub Dark | `github-dark` | dark | https://github.com/primer/github-vscode-theme | MIT | |
| GitHub Dark Dimmed | `github-dark-dimmed` | dark | https://github.com/primer/github-vscode-theme | MIT | |
| GitHub Light | `github-light` | light | https://github.com/primer/github-vscode-theme | MIT | Status colors from Primer (the terminal "yellow" is a dark brown). |
| Kanagawa Wave | `kanagawa-wave` | dark | https://github.com/rebelot/kanagawa.nvim | MIT | |
| Kanagawa Lotus | `kanagawa-lotus` | light | https://github.com/rebelot/kanagawa.nvim | MIT | |
| Everforest Dark | `everforest-dark` | dark | https://github.com/sainnhe/everforest | MIT | Medium contrast. |
| Everforest Light | `everforest-light` | light | https://github.com/sainnhe/everforest | MIT | Medium contrast. |
| Ayu Dark | `ayu-dark` | dark | https://github.com/ayu-theme/ayu-colors | MIT | Ayu's translucent comment/punctuation colors are flattened onto the background. |
| Ayu Mirage | `ayu-mirage` | dark | https://github.com/ayu-theme/ayu-colors | MIT | Same. |
| Ayu Light | `ayu-light` | light | https://github.com/ayu-theme/ayu-colors | MIT | Same. |
| Monokai | `monokai` | dark | https://github.com/microsoft/vscode/tree/main/extensions/theme-monokai | MIT | Original by Wimer Hazenberg; colors and terminal palette as bundled with VS Code. |

## Importing

`detectAndImport(text, filename)` in `ui/src/theme/import/index.js` reads:

| App | File | What is read |
| --- | --- | --- |
| VS Code | `*.json`, `*-color-theme.json` (JSONC) | `name`, `type`, `colors` (editor, sidebar, widgets, focus/button accent, terminal ANSI, selection, cursor, diff, error/warning/info), `tokenColors` by exact TextMate scope. `include` is not followed. |
| Ghostty | theme file (no extension) | `palette = N=#hex`, `background`, `foreground`, `cursor-color`, `selection-background`. |
| iTerm2 | `*.itermcolors` | `Ansi 0-15 Color`, `Background`, `Foreground`, `Cursor`, `Selection Color` (sRGB 0-1 components). |
| Windows Terminal | scheme JSON or `settings.json` | `name`, `background`, `foreground`, `cursorColor`, `selectionBackground`, `black`...`brightWhite` (`purple` = magenta). First scheme of `schemes`. |
| kitty | `*.conf` | `color0-15`, `background`, `foreground`, `cursor`, `selection_background`, `## name/author/license/upstream` metadata. |

Files over 1 MB are refused. Only strict hex/`rgb()` colors are accepted; anything else is dropped
with a warning, and missing pieces fall back to the source app's defaults. Imported ids are
`user-<slug of name>`.
