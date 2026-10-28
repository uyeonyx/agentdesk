# Agent Desk

All your coding agents in one inbox, across every project. Claude Code and Codex run as real CLIs in their own git worktrees; you answer, review, and merge from one browser tab.

## Install

```bash
npm install -g ./agentdesk-0.2.6.tgz
agentdesk
```

`agentdesk` starts a small background service on your machine and opens your browser through a one-time login link. Run it again any time to reopen the tab (each link works once, for two minutes).

Needs Node 20+, git, and at least one of `claude` (Claude Code) or `codex` on your PATH. PRs need `gh` signed in.

## How it works

- **Inbox, not tabs.** Tasks are grouped by what they need from you: 답할 것 (the agent is asking), 검토할 것 (it changed files), 작업 중, 멈춤, 끝남. Project chips at the top filter to one project (`1`–`9`, `0` for all).
- **Projects set themselves up.** Adding a folder fills in its description from the README / package.json / Cargo.toml (with the stack, e.g. "Expo · TypeScript · …"), uses the repo's own logo (app icon, favicon, logo file) and picks the room color from it. Anything you change in settings stays yours.
- **Every project is a room.** Its color and icon paint the workspace frame, the header, the strip under the terminal, the terminal cursor, even the browser tab icon. Switching projects draws a thin line of the new color across the top of the room.
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

- **Local only.** The service listens on `127.0.0.1`, and every request must carry a loopback `Host` header, which blocks DNS rebinding.
- **Two-part login.** A one-time link (2 minutes) creates a session made of an HttpOnly cookie plus a page key. The key travels only in the URL fragment and is then kept in this origin's storage. Browsers send localhost cookies to every port, so the cookie alone opens nothing; every API call and the WebSocket also need the key. Only hashes of both are stored, in `~/.agentdesk/auth.json` (`0600`).
- **Exact Origin checks.** Anything that changes state, and every WebSocket, must come from this page's exact `Origin`. Requests from other localhost ports are refused.
- **CLI talks only to the real service.** Before sending its secret, the CLI makes the service prove it knows that secret. A stale port taken over by another program gets nothing.
- **One token per task.** Each agent reports status with its own token, so one agent can't report for another task.
- **No control bytes in typed text.** Anything typed into a terminal is stripped of control bytes, so file names or pasted text can't inject keystrokes.
- **File access stays in the worktree.** Reads and undo never leave the task's worktree, including through symlinks.
- **Text, not HTML.** The UI ships a strict CSP with no inline scripts, and agent output is always rendered as text.
- **Other sessions are read, never driven.** Session discovery reads Claude Code's and Codex's own files; only a session you pick is resumed, copied, or (background only, on request) stopped. Session ids are validated as UUIDs and every CLI value is passed as `--flag=value`.

`npm test` runs these attack scenarios, plus regressions for each finding of an independent review.

**Limitation:** agents run as your macOS user, so a hostile agent could read `~/.agentdesk` like any other file of yours. Agent Desk doesn't add a sandbox; rely on each agent's own permission settings for that.

## Commands

```
agentdesk           start (if needed) and open the browser
agentdesk stop      stop the service (running agents stop too)
agentdesk status    is it running, on which port
agentdesk fg        run in the foreground with logs
```

Data lives in `~/.agentdesk`. Worktrees are created under `<repo>/.agentdesk/worktrees/` and hidden from the main checkout's `git status`.
