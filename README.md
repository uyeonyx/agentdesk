# Agent Desk

All your coding agents in one inbox, across every project. Claude Code and Codex run as real CLIs in their own git worktrees; you answer, review, and merge from one window. A desktop app for macOS and Windows.

## Install

Download the installer for your machine from [Releases](https://github.com/uyeonyx/agentdesk/releases): `AgentDesk-<version>-mac-arm64.dmg` (Apple silicon), `-mac-x64.dmg` (Intel), `-win-x64.exe` or `-win-arm64.exe`.

The builds aren't code-signed yet, so the OS asks once:

- **macOS:** drag Agent Desk to Applications, then right-click it → Open → Open. If macOS says the app is damaged, run `xattr -dr com.apple.quarantine "/Applications/Agent Desk.app"` once.
- **Windows:** SmartScreen shows "Windows protected your PC": More info → Run anyway. Windows support is **beta**: the agent screens it reads (permission menus, the prompt box) were tuned on macOS.

Needs git, and at least one of `claude` (Claude Code) or `codex` installed. PRs need `gh` signed in. The app reads your login shell's environment, so whatever works in your terminal works here.

**Updates:** when a new version is out, a button appears in the top bar. One click downloads it; the app checks it against a checksum list signed by the release build, then swaps itself in when you restart or quit. Running agents are never stopped for an update: you choose "apply when I quit". (Also under Agent Desk → 업데이트 확인… and in ⌘K.) If the app runs from somewhere it can't replace itself (straight from the disk image, say), the button opens the download page instead.

Coming from 0.2.x (the `agentdesk` CLI)? The first launch stops the old background service and carries your projects and tasks over. You can then `npm uninstall -g agentdesk`.

## How it works

- **A list sorted by what needs you.** 내 차례 (a permission, a choice, a question, a reply to read, changes to review), 작업 중, 멈춤, 끝남. A task stuck on a permission says what it wants right in its row ("허락 · rm -rf build"). The project switch above the list shows one project or all of them, by name and logo, with what's waiting in each (`⌥1`–`⌥9`, `⌥0` for all).
- **The conversation, drawn by the app.** Replies render as markdown with highlighted code. Tool calls fold into one line per run ("명령 3 · 읽기 5 · 수정 2"), with edited files as chips and failures opened up; a subagent's work nests under it, and the agent's plan sits above the conversation. The real CLI is one key away (`⌘J`), so `/rewind`, `!cmd` and the interactive slash commands still work.
- **Answer on a card.** When the agent stops for you, a card above the input box shows exactly what it wants: the command, the diff of the edit, its questions (single or multiple choice, or your own words), or the plan. Press a button or its digit; Desk checks every key against the CLI's own screen and hands you the terminal if anything looks different.
- **차례로 (`Space`).** Walk through everything waiting on you, one card at a time: a digit answers and it moves on, `R` replies, `S` skips. At the end it says what you did and takes you back.
- **관제 ↔ 집중 (`B`).** Two views of the same sessions. 관제 lays every session out as a mosaic where size follows what needs you: a session waiting on a permission gets a big panel with the card to answer it, a reply or a new result gets a wide one, quiet work and finished sessions stay small. Each panel shows the last thing the agent did and a 30-minute activity strip (reading, editing, commands, web, waiting on you). Arrows move by position, `↵` opens the session in 집중, `N` (or the + tile) starts a new one with its project, agent, start mode and model. [자동 크기 | 같은 크기] and the pin keep things where you want them. 집중 is one session in full: the conversation in the middle; to-dos, changed files, activity and the session's settings on the right.
- **The input box knows the session.** Under it: the permission mode (`⇧Tab` cycles 묻고 진행 → 수정은 바로 → 계획 모드 → 자동, the way Claude Code does; a change made while the agent works applies from its next tool call), the model and effort level (for this session only; your Claude Code defaults are never touched), a context gauge and 압축. The box's border and hint follow the mode, so plan mode looks like plan mode.
- **Recaps where you can see them.** Claude Code's own recap ("while you were away…") shows up in the conversation, and coming back to the window after a while opens the ones that arrived meanwhile (요약 모아 보기 reopens them). No extra model calls: Desk only shows what the agent wrote.
- **Slash commands on screen.** `/context`, `/cost` and other commands that print show their output in the conversation; `/model`, `/effort` and `/compact` use the controls under the input box instead of a terminal. Menus like `/config` and `/mcp` still open the real CLI.
- **Stopped sessions pick up where they left off.** A stopped session says why, shows its last recap and has 이어서 하기.
- **되감기 and 갈래 on every message (Claude Code).** 되감기 runs Claude Code's own `/rewind` to just before that message: the session forgets it and everything after, the files go back to the snapshot Desk took before it (shell changes included), and your words come back to the input box. 갈래 starts a new session from just before a message, in its own worktree, with the conversation and the files as they were then; the original goes on untouched.
- **Sessions that change the same files talk it out.** When two running sessions of one project change the same file, both panels say so. 협의시키기 hands each agent the other's diff and carries one line at a time between them (`@상대: …` at the end of a reply) until both say 끝; Desk only carries the words, the agents decide. 기다리게 asks one of them to leave those files until the other is done. The talk shows beside the conversation.
- **The agent island.** While another app is in front, a small dark bar sits under the menu bar: a dot per running session, the first thing waiting on you, and your plan's usage. A permission request unfolds it with the card, so you can answer without switching apps. Off, or kept folded, in settings.
- **Plan usage in the title bar.** Read from Claude Code's own `/usage` (the 5-hour limit when your plan has one, the week, Fable, credits) by a short-lived `claude` that loads none of your settings or hooks and makes no model call. It reads again every 10 minutes while sessions run, and when you open it.
- **Claude Code's own settings, from Desk.** 설정 > MCP 서버 lists what Claude Code loads (user, project `.mcp.json`, your local entry), checks connections and adds or removes servers through `claude mcp`. 권한 shows the allow / ask / deny rules of your user, project and local `settings.json` and edits one rule at a time, leaving the rest of the file alone.
- **Quick panel (`⌥Space`, or the menu bar icon).** Answer what's waiting without switching to Desk. The shortcut is yours to change in settings.
- **Undo right after sending.** The message shows up as sent with ⌘Z for a few seconds; undoing stops the agent, restores the files to the snapshot taken before it, puts your text back and tells the agent to ignore it. Codex messages can be rolled back from the conversation the same way (Claude Code ones use 되감기). `Esc` never undoes.
- **Careful mode** (per project): sending and answering take `⌘↵` / a second press, so the Enter habit from another project can't fire an instruction here.
- **Your own shell, right there.** `` ⌃` `` opens a login shell in the task's folder. When the agent asks you to run something yourself (`npm login`, `gh auth login`…), those commands show up as chips; a click puts the command on the shell's line for you to check and run. Desk's tokens never reach that shell.
- **Adding a project without typing paths.** 폴더 고르기 (`⌘O`) opens the system's folder picker, or drop folders from Finder / Explorer onto the sheet. A repo (or any folder inside one) goes straight in; a folder that holds several repos lists them, deep ones included, to pick from. Repos found near your home folder are listed too, with a search box; typing a path is still there.
- **Projects set themselves up.** Adding a folder fills in its description from the README / package.json / Cargo.toml, uses the repo's own logo and picks a color for its marks. Any image can be its logo instead (settings, or right-click the project); it's kept in `~/.agentdesk/logos`, never in the repo. Anything you change in settings stays yours.
- **Several repos in one task.** Group projects (프로젝트 추가 → 여러 저장소 묶기) or add repos when starting a task. Each repo gets a worktree on the same branch inside one task folder; review groups files by repo; merge checks every repo for conflicts before touching any.
- **Review = instruction.** 변경 shows a Monaco diff. Hover a line and click `+` (or select lines and press `C`) to comment; comments go to the agent as one message with file and line references. Merging and PRs are the agent's job: ask it. 머지 and PR 만들기 are still in ⌘K for when you want to do it yourself.
- **Files on demand.** 파일 opens a viewer, not an editor, with a version switch to compare the same file in this task, the main checkout, where the task started, or another task's worktree. Select lines and press `A` to point the agent at them. "VS Code" opens the exact file and line.
- **Themes.** Desk Light and Dark, Cyberpunk (with Umbra and Scarlet), SynthWave '84, Dracula, Nord, Catppuccin, Tokyo Night, Rosé Pine, Gruvbox, Solarized, One, GitHub, Kanagawa, Everforest, Ayu and Monokai, following the system's light/dark or fixed. Import your own from a VS Code theme, Ghostty, iTerm2, Windows Terminal or kitty. Text is kept readable on every surface whatever the colors. Sources and licenses: [THEMES.md](THEMES.md).

Keys (`?` shows them all): `⌘K` find and commands · `⌘N` new task · `Space` 차례로 · `J`/`K` move · `R` or `↵` reply · `1`–`9` answer the card · `E` archive · `B` 관제 ↔ 집중 · `N` new session (관제) · `⇧Tab` permission mode · `/` commands · `⌘1/2/3` 대화/변경/파일 · `⌘J` raw terminal · `` ⌃` `` shell · `⌘.` stop this turn · `⌘Z` undo the last send · `⌘\` hide the list.

## Sessions that already exist

불러오기 lists Claude Code sessions running right now (any terminal, VS Code, background) and past Claude Code and Codex conversations, matched to your projects by folder.

- **Running elsewhere → 보기 · 동기화.** Desk follows the session's transcript live: messages, tools, plan, subagents, busy/idle. Typing into another app's Claude Code process isn't possible from outside, so you can tick "닫으면 여기서 이어받기" (Desk resumes the same conversation the moment it closes there) or 복사본으로 분기 (`--fork-session`). Running Codex sessions accept messages through `codex queue`.
- **Background sessions** can also be taken over: stopped there, resumed here.
- **Past conversations** reopen with `--resume <id>` in their original folder (no new worktree). Nothing in that folder is ever deleted; 목록에서 빼기 just stops following it.
- New Claude tasks pin their session id, so 재개 reopens exactly that conversation, not just the latest one in the folder.

## Phone (Claude app)

Turn on 폰에서 이어하기 for a task (or as a project default) and Claude Code starts with Remote Control: the same session shows up in the Claude app's Code tab and on claude.ai. Instructions sent from the phone are recorded in Desk with a snapshot taken before the agent acts on them, so they can be undone like any other. Codex has no equivalent.

## Security

- **No network port.** Nothing listens on TCP. The window reaches the Desk through a private channel (a MessagePort) that the app hands only to its own top-level page; agents report through a Unix socket that only you can open (a per-run named pipe on Windows). There is no login, cookie or key for another program, web page or browser extension to steal.
- **Its own window, not your browser.** The UI loads from `app://desk/` in an isolated, sandboxed renderer with no Node access, under a strict CSP with no inline scripts. Agent output is always rendered as text. Links go to your browser (http/https) or VS Code (vscode://) and nothing else.
- **The Desk runs in its own process.** A native crash in a terminal or a slow scan can't freeze or take down the window; the app restarts it.
- **Hardened app binary.** Electron's RunAsNode, NODE_OPTIONS and `--inspect` switches are turned off in release builds, so the app binary can't be borrowed to run other code.
- **One token per task.** Each agent reports status with its own token (an HMAC of a per-run secret), so one agent can't report for another task.
- **Agents are started without a shell.** On Windows the `claude`/`codex` npm shims are read and their targets run directly, so quotes, `&`, `|` or `%` in a prompt can't break arguments or run commands; hooks use exec form for the same reason.
- **No control bytes in typed text.** Anything typed into a terminal is stripped of control bytes, so file names or pasted text can't inject keystrokes.
- **File access stays in the worktree.** Reads and undo never leave the task's worktree, including through symlinks.
- **Other sessions are read, never driven.** Session discovery reads Claude Code's and Codex's own files; only a session you pick is resumed, copied, or (background only, on request) stopped. Session ids are validated as UUIDs and every CLI value is passed as `--flag=value`.
- **Updates are checked twice.** A download is used only if its SHA-256 is in `SHA256SUMS` and that file carries the release key's Ed25519 signature (the public key ships in the app).

`pnpm test` runs these attack scenarios, plus regressions for each finding of an independent review; `pnpm test:e2e` drives the real app.

**Limitation:** agents run as your user, so a hostile agent could read anything you can. Agent Desk doesn't add a sandbox; rely on each agent's own permission settings for that.

## Development

```bash
pnpm install
pnpm dev        # build the UI and open the app (data in ~/.agentdesk-dev)
pnpm test       # core, hook socket and app-shell rules, with mock agents
pnpm test:e2e   # the real app end to end (AGENTDESK_E2E_EXE=<packaged binary> for a build)
pnpm dist       # installers for this OS in release/
```

Data lives in `~/.agentdesk` (`AGENTDESK_HOME` to change it; another data dir is a separate app instance). Worktrees are created under `<repo>/.agentdesk/worktrees/` and hidden from the main checkout's `git status`. Releasing: [docs/release.md](docs/release.md).
