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

- **Inbox, not tabs.** Tasks are grouped by what they need from you: 답할 것 (the agent is asking), 검토할 것 (it changed files), 작업 중, 멈춤, 끝남. Project chips at the top filter to one project (`1`–`9`, `0` for all).
- **Projects set themselves up.** Adding a folder fills in its description from the README / package.json / Cargo.toml (with the stack, e.g. "Expo · TypeScript · …"), uses the repo's own logo (app icon, favicon, logo file) and picks the room color from it. Anything you change in settings stays yours.
- **Every project is a room.** Its color and icon paint the workspace frame, the header, the strip under the terminal, the terminal cursor, even the window title. Switching projects draws a thin line of the new color across the top of the room.
- **One place to type: the agent's own terminal.** 대화 is the real CLI, so `/rewind`, `!cmd` and slash commands work. The strip under it says whose room you're typing into ("엔터프라이즈 암호화에 입력 중") and what Enter does there. Desk catches the Enter, snapshots the worktree, then lets it through. On phones a plain input box replaces the terminal.
- **Undo right after sending.** For a few seconds the strip under the terminal turns the project's color and confirms where it went (nothing is covered); `⌘Z` (or `Esc` outside the terminal) stops the agent, restores the files to the snapshot, and tells the agent to ignore it. Every message in 기록 can be rolled back later.
- **Careful mode** (per project): thicker frame and `⌘↵` to send, so the Enter habit from another project can't fire an instruction here.
- **Your own shell, right there.** `⌃\`` opens a login shell in the task's folder under the agent's terminal. When the agent asks you to run something yourself (`npm login`, `gh auth login`…), those commands show up as chips under the terminal; a click puts the command on the shell's line for you to check and run. Desk's tokens never reach that shell.
- **Progress you can see.** The 진척 panel shows the agent's plan (TodoWrite / update_plan), every subagent with its own tool calls, and the main thread's recent tools. Rows in the list carry a plan bar and the number of running subagents.
- **관제탑 (`B`).** Every agent as a card: answer permission prompts with buttons read off the screen, reply in one line, watch a live mini screen and the plan, merge, stop, pin, and size cards S/M/L.
- **Several repos in one task.** Group projects (프로젝트 추가 → 여러 저장소 묶기) or add repos when starting a task. Each repo gets a worktree on the same branch inside one task folder; review groups files by repo; merge checks every repo for conflicts before touching any.
- **Review = instruction.** 변경 shows a Monaco diff. Hover a line and click `+` (or select lines and press `C`) to comment; comments go to the agent as one message with file and line references. Merge into the main checkout or open a PR from the header.
- **Files on demand.** 파일 opens a viewer, not an editor: `⌘P` to open, `⌘B` for the tree, and a version switch to compare the same file in this task, the main checkout, where the task started, or another task's worktree. Select lines and press `A` to point the agent at them. "VS Code" opens the exact file and line.

Keys: `N` new task · `B` list ⇄ 관제탑 · `⌃\`` shell · `J`/`K` move · `↵` focus input · `⌥1/2/3` 대화/변경/파일 · `⌘K` commands · `⌘Z` undo the last send.

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
