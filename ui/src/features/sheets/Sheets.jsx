// The few dialogs left: confirming what can't be undone, naming, bringing in a session, adding a
// project. Everything else happens in place.
import { useEffect, useMemo, useState } from 'preact/hooks';
import { api } from '../../api.js';
import { useStore, get, set, closeModal, toast, projectOf, taskOf } from '../../store.js';
import { fuzzyFilter, mod } from '../../util.js';
import { isBusy } from '../../core/status.js';
import { enterAction } from '../../core/sendPolicy.js';
import { merge, pr, discard, archive, archiveMany, rename, importSession, restore, openTask } from '../../actions.js';
import { Sheet } from '../../ui/Sheet.jsx';
import { Glyph, I, ago, useListNav } from '../../ui/bits.jsx';

export function SheetHost() {
  const m = useStore((s) => s.modal);
  if (!m) return null;
  switch (m.kind) {
    case 'merge':
      return <ConfirmMerge taskId={m.taskId} />;
    case 'pr':
      return <ConfirmPr taskId={m.taskId} />;
    case 'discard':
      return <ConfirmDiscard taskId={m.taskId} />;
    case 'archive':
      return <ConfirmArchive ids={m.taskIds} />;
    case 'rename':
      return <Rename taskId={m.taskId} />;
    case 'import':
      return <ImportSessions projectId={m.projectId} />;
    case 'addProject':
      return <AddProject />;
    case 'removeProject':
      return <RemoveProject projectId={m.projectId} />;
    default:
      return null;
  }
}

function useTP(taskId) {
  return useStore((s) => {
    const t = taskOf(s, taskId);
    return { t, p: t && projectOf(s, t.projectId) };
  });
}

/** A yes/no on something that can't be taken back: Enter (⌘Enter in careful projects) confirms. */
function Confirm({ p, title, sub, children, action, label, icon, danger }) {
  const [busy, setBusy] = useState(false);
  const careful = !!p?.careful;
  const run = async () => {
    if (busy) return;
    setBusy(true);
    await action();
    setBusy(false);
  };
  return (
    <Sheet label={title}>
      <div class="sheet-h">
        {p && <Glyph project={p} size={30} />}
        <div style="flex:1;min-width:0">
          <h2>{title}</h2>
          {sub && <div class="sub">{sub}</div>}
        </div>
      </div>
      <div class="sheet-b">{children}</div>
      <div class="sheet-f">
        <span class="sp" />
        <button class="btn ghost" onClick={closeModal}>
          취소
        </button>
        <button
          class={`btn ${danger ? 'danger solid' : 'primary'}`}
          onClick={run}
          disabled={busy}
          autofocus
          onKeyDown={(e) => {
            if (e.key === 'Enter' && enterAction(e, { careful }) !== 'send') e.preventDefault();
          }}
        >
          <I n={busy ? 'loader-2' : icon} /> {label} <kbd>{careful ? `${mod}↵` : '↵'}</kbd>
        </button>
      </div>
    </Sheet>
  );
}

function ConfirmMerge({ taskId }) {
  const { t, p } = useTP(taskId);
  if (!t || !p) return null;
  return (
    <Confirm p={p} title="메인 브랜치에 머지" sub={t.title} action={() => merge(taskId)} label="머지" icon="git-merge">
      <p class="muted">
        <code>{t.branch}</code>의 변경 {t.changes.files}개 파일 (<b class="a">+{t.changes.adds}</b> <b class="d">−{t.changes.dels}</b>)을 <b>{p.display}</b>에서 지금 체크아웃된 브랜치에 머지해요. 커밋 안 된 변경은 먼저 커밋하고, 끝나면 worktree를 정리해요.
      </p>
    </Confirm>
  );
}

function ConfirmPr({ taskId }) {
  const { t, p } = useTP(taskId);
  if (!t || !p) return null;
  return (
    <Confirm
      p={p}
      title="PR 만들기"
      sub={t.title}
      action={async () => {
        closeModal();
        await pr(taskId);
      }}
      label="PR 만들기"
      icon="git-pull-request"
    >
      <p class="muted">
        변경을 커밋하고 <code>{t.branch}</code> 브랜치를 origin에 올린 뒤 <code>gh pr create</code>로 PR을 만들어요. GitHub CLI(gh)가 로그인돼 있어야 해요.
      </p>
    </Confirm>
  );
}

function ConfirmDiscard({ taskId }) {
  const { t, p } = useTP(taskId);
  if (!t || !p) return null;
  return t.adopted ? (
    <Confirm p={p} title="Desk에서 빼기" sub={t.title} action={() => discard(taskId)} label="빼기" icon="logout">
      <p class="muted">에이전트를 멈추고 Desk에서 빼요. 불러온 세션이라 {t.worktree}의 파일과 브랜치는 하나도 건드리지 않아요. 대화는 나중에 다시 불러올 수 있어요.</p>
    </Confirm>
  ) : (
    <Confirm p={p} title="작업 버리기" sub={t.title} action={() => discard(taskId)} label="버리기" icon="trash" danger>
      <p class="muted">
        에이전트를 멈추고 이 작업의 worktree와 브랜치({t.branch || '없음'}){t.multi ? `를 저장소 ${t.repos.length}개 모두에서` : '를'} 지워요. 머지하지 않은 변경은 사라져요.
      </p>
    </Confirm>
  );
}

function ConfirmArchive({ ids }) {
  const s = useStore((s) => ({ tasks: s.tasks, projects: s.projects }));
  const ts = ids.map((id) => s.tasks.find((t) => t.id === id)).filter(Boolean);
  const busy = ts.filter((t) => t.running && isBusy(t));
  const one = ts.length === 1 ? ts[0] : null;
  const p = one && projectOf(s, one.projectId);
  const go = async () => {
    closeModal();
    if (one) await archive(one.id);
    else await archiveMany(ids, { confirmed: true });
  };
  return (
    <Confirm p={p} title={one ? '작업 중인 에이전트 보관' : `${ts.length}개 보관`} sub={one ? one.title : `그중 ${busy.length}개는 에이전트가 아직 작업 중이에요`} action={go} label={one ? '멈추고 보관' : '멈추고 모두 보관'} icon="archive">
      {!one && (
        <ul class="arch-list">
          {busy.map((t) => {
            const tp = projectOf(s, t.projectId);
            return (
              <li key={t.id}>
                <Glyph project={tp} size={20} />
                <span class="m">{t.title}</span>
                <span class="dim">{t.state === 'waiting' ? '백그라운드 대기 중' : '작업 중'}</span>
              </li>
            );
          })}
        </ul>
      )}
      <p class="muted">
        {one?.state === 'waiting' ? '에이전트가 백그라운드 작업을 기다리고 있어요. 보관하면 그 작업도 함께 멈춰요.' : '보관하면 하던 일을 멈춰요.'} worktree·브랜치·대화는 그대로라 보관함에서 꺼내면 같은 대화로 이어서 시킬 수 있어요.
      </p>
    </Confirm>
  );
}

function Rename({ taskId }) {
  const { t } = useTP(taskId);
  const [v, setV] = useState(t?.title || '');
  if (!t) return null;
  const save = () => {
    rename(taskId, v);
    closeModal();
  };
  return (
    <Sheet label="이름 바꾸기">
      <div class="sheet-h">
        <h2>이름 바꾸기</h2>
      </div>
      <div class="sheet-b">
        <input class="field" autofocus value={v} maxLength={120} onInput={(e) => setV(e.currentTarget.value)} onKeyDown={(e) => !e.isComposing && e.keyCode !== 229 && e.key === 'Enter' && save()} />
      </div>
      <div class="sheet-f">
        <span class="sp" />
        <button class="btn ghost" onClick={closeModal}>
          취소
        </button>
        <button class="btn primary" onClick={save} disabled={!v.trim()}>
          바꾸기 <kbd>↵</kbd>
        </button>
      </div>
    </Sheet>
  );
}

function RemoveProject({ projectId }) {
  const p = useStore((s) => projectOf(s, projectId));
  if (!p) return null;
  return (
    <Confirm
      p={p}
      title="Desk에서 빼기"
      sub={p.display}
      label="빼기"
      icon="logout"
      danger
      action={async () => {
        try {
          await api('DELETE', `/api/projects/${projectId}`);
          closeModal();
          if (get().filter === projectId) set({ filter: null });
        } catch (e) {
          toast(e.message, { kind: 'err' });
        }
      }}
    >
      <p class="muted">{p.name}을(를) Desk 목록에서 빼요. 폴더와 파일은 그대로 남아요.</p>
    </Confirm>
  );
}

// ------------------------------------------------------------ 세션 불러오기

function ImportSessions({ projectId }) {
  const s = useStore((s) => ({ projects: s.projects, tasks: s.tasks }));
  const [list, setList] = useState(null);
  const [q, setQ] = useState('');
  const [onlyProject, setOnlyProject] = useState(!!projectId);
  const [busy, setBusy] = useState(null);
  const [refreshing, setRefreshing] = useState(false);
  const scope = projectId && projectOf(s, projectId);
  // What Desk already knows shows at once; a fresh look (running sessions included) follows.
  const load = async (fresh) => {
    if (fresh) setRefreshing(true);
    try {
      const r = await api('GET', `/api/sessions${fresh ? '?fresh=1' : ''}`);
      setList(r.sessions);
    } catch (e) {
      toast(e.message, { kind: 'err' });
      setList((l) => l || []);
    }
    if (fresh) setRefreshing(false);
  };
  useEffect(() => {
    load(false).then(() => load(true));
  }, []);
  // Sessions Desk already runs are in the rail; only show them when searched for.
  const scoped = (list || []).filter((x) => (!onlyProject || !scope || x.projectId === scope.id) && (!x.taskId || q));
  const found = fuzzyFilter(q, scoped, (x) => `${x.title} ${x.first} ${x.lastPrompt || ''} ${x.cwdShort} ${x.live?.name || ''}`, 120);
  const live = found.filter((x) => x.live || x.recent);
  const past = found.filter((x) => !x.live && !x.recent);
  const flat = [...live, ...past];
  const defaultMode = (x) => (x.live?.kind === 'background' ? 'takeover' : x.live || x.recent ? 'watch' : 'auto');
  const act = async (x, mode) => {
    if (x.taskId) {
      closeModal();
      if (taskOf(get(), x.taskId)?.archived) return restore(x.taskId);
      return openTask(x.taskId);
    }
    setBusy(x.sessionId);
    await importSession(x, mode);
    setBusy(null);
  };
  const [i, setI, onNav] = useListNav(flat.length, (k) => !busy && act(flat[k], defaultMode(flat[k])));
  useEffect(() => setI(0), [q, onlyProject]);

  const row = (x) => {
    const k = flat.indexOf(x);
    const p = x.projectId && projectOf(s, x.projectId);
    const sub = x.lastPrompt && x.lastPrompt !== x.first ? `마지막: ${x.lastPrompt}` : x.first && x.first !== x.title ? x.first : x.last;
    const tk = x.taskId && taskOf(s, x.taskId);
    return (
      <div key={x.agent + x.sessionId} class={`srow ${k === i ? 'on' : ''}`} onMouseEnter={() => setI(k)}>
        {p ? (
          <Glyph project={p} size={28} />
        ) : (
          <span class="nofolder">
            <I n="folder" />
          </span>
        )}
        <div class="sr-m">
          <div class="sr-t">
            <I n="terminal-2" /> {x.title}
          </div>
          {sub && <div class="sr-s">{sub}</div>}
          <div class="sr-meta">
            <span class="mono">{x.cwdShort}</span>
            <span>{ago(x.updatedAt)} 전</span>
            {!p && <span>프로젝트로 추가돼요</span>}
            {x.live ? (
              <span class="live">
                <span class="d" />
                {x.live.kind === 'background' ? '백그라운드에서 실행 중' : `${x.live.where || '다른 터미널'}에서 실행 중`}
              </span>
            ) : x.recent ? (
              <span class="live">
                <span class="d" />
                방금까지 활동 · 실행 중일 수 있어요
              </span>
            ) : null}
          </div>
        </div>
        <div class="sr-a">
          {tk ? (
            <button class="btn sm" onClick={() => act(x)}>
              <I n={tk.archived ? 'archive-off' : 'arrow-right'} /> {tk.archived ? '꺼내기' : 'Desk에서 열려 있음'}
            </button>
          ) : x.live?.kind === 'background' ? (
            <>
              <button class="btn sm ghost" disabled={busy} onClick={() => act(x, 'watch')} data-tip="그대로 돌게 두고, 대화와 진척을 여기서 실시간으로 봐요">
                <I n="eye" /> 보기
              </button>
              <button class="btn sm primary" disabled={busy} onClick={() => act(x, 'takeover')} data-tip="백그라운드 세션을 멈추고 같은 대화를 여기서 이어가요">
                이어받기
              </button>
            </>
          ) : x.live || x.recent ? (
            <>
              <button class="btn sm ghost" disabled={busy} onClick={() => act(x, x.agent === 'codex' ? 'auto' : 'fork')} data-tip={x.agent === 'codex' ? '여기서 이어서 열어요' : '원래 세션은 그대로 두고 복사본을 열어요'}>
                {x.agent === 'codex' ? '여기서 재개' : '복사본'}
              </button>
              <button class="btn sm primary" disabled={busy} onClick={() => act(x, 'watch')} data-tip="돌고 있는 그대로 대화·도구·진척을 여기서 실시간으로 봐요">
                <I n="eye" /> 보기
              </button>
            </>
          ) : (
            <button class="btn sm primary" disabled={busy} onClick={() => act(x)}>
              <I n="player-play" /> 재개
            </button>
          )}
        </div>
      </div>
    );
  };

  return (
    <Sheet wide label="세션 불러오기">
      <div class="sheet-h">
        <div style="flex:1;min-width:0">
          <h2>세션 불러오기</h2>
          <div class="sub">VS Code·터미널·백그라운드에서 돌고 있는 세션은 실시간으로 보고, 지난 대화는 여기서 이어가요</div>
        </div>
        <button class="ibtn" onClick={() => load(true)} data-tip="새로 찾기" aria-label="새로 찾기" disabled={refreshing}>
          <I n={refreshing ? 'loader-2' : 'refresh'} />
        </button>
      </div>
      <div class="sheet-b" style="padding-bottom:8px">
        <div class="row-gap">
          <input class="field" autofocus placeholder="제목, 첫 지시, 폴더로 찾기" value={q} onInput={(e) => setQ(e.currentTarget.value)} onKeyDown={onNav} />
          {scope && (
            <button class={`btn sm ${onlyProject ? 'on' : 'ghost'}`} onClick={() => setOnlyProject((v) => !v)} aria-pressed={onlyProject}>
              <Glyph project={scope} size={16} /> {scope.name}만
            </button>
          )}
        </div>
      </div>
      <div class="sheet-b scroll sessions">
        {list === null && <div class="none">세션을 찾는 중…</div>}
        {list && !flat.length && <div class="none">{q ? '맞는 세션이 없어요' : '찾은 세션이 없어요. Claude Code나 Codex로 한 번이라도 대화한 폴더가 있으면 여기 떠요.'}</div>}
        {live.length > 0 && <h4>지금 실행 중</h4>}
        {live.map(row)}
        {past.length > 0 && <h4>지난 대화</h4>}
        {past.map(row)}
      </div>
      <div class="sheet-f">
        <small class="muted">불러온 세션은 새 worktree 없이 원래 폴더에서 이어가요. 보내는 지시마다 스냅샷을 남겨서 되돌릴 수 있어요.</small>
      </div>
    </Sheet>
  );
}

// ------------------------------------------------------------ 프로젝트 추가

function AddProject() {
  const gits = useStore((s) => s.projects.filter((p) => p.kind !== 'group' && p.isGit));
  const [tab, setTab] = useState('folder');
  return (
    <Sheet wide label="프로젝트 추가">
      <div class="sheet-h">
        <h2 style="flex:1">프로젝트 추가</h2>
        <div class="seg" role="tablist">
          <button role="tab" aria-selected={tab === 'folder'} onClick={() => setTab('folder')}>
            <I n="folder-plus" /> 폴더
          </button>
          <button role="tab" aria-selected={tab === 'group'} onClick={() => setTab('group')} disabled={gits.length < 2} data-tip={gits.length < 2 ? 'git 저장소 프로젝트가 2개 이상 있어야 해요' : undefined}>
            <I n="stack-2" /> 여러 저장소 묶기
          </button>
        </div>
      </div>
      <div class="sheet-b">{tab === 'folder' ? <AddProjectBody /> : <GroupBody gits={gits} />}</div>
    </Sheet>
  );
}

export function AddProjectBody({ onAdded }) {
  const [path, setPath] = useState('');
  const [dirs, setDirs] = useState([]);
  const [di, setDi] = useState(-1);
  const [found, setFound] = useState(null);
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    api('GET', '/api/discover')
      .then((r) => setFound(r.repos))
      .catch(() => setFound([]));
  }, []);
  useEffect(() => {
    if (!path) return setDirs([]);
    const t = setTimeout(() => api('GET', `/api/dirs?q=${encodeURIComponent(path)}`).then((r) => setDirs(r.dirs)).catch(() => {}), 90);
    return () => clearTimeout(t);
  }, [path]);

  async function add(p) {
    if (busy) return;
    setBusy(true);
    try {
      const proj = await api('POST', '/api/projects', { path: p });
      setPath('');
      setFound((f) => f?.filter((x) => x.path !== proj.path));
      if (get().modal?.kind === 'addProject') closeModal();
      onAdded?.(proj);
      toast(`${proj.name} 추가했어요${proj.desc ? ` · ${proj.desc}` : ''}`, { projectId: proj.id, ms: 6000, action: { label: '꾸미기', run: () => set({ screen: 'settings', settingsTab: 'projects', settingsProject: proj.id }) } });
    } catch (e) {
      toast(e.message, { kind: 'err' });
    }
    setBusy(false);
  }
  const onKey = (e) => {
    if (e.isComposing || e.keyCode === 229) return;
    if (e.key === 'ArrowDown' && dirs.length) {
      e.preventDefault();
      setDi((i) => Math.min(dirs.length - 1, i + 1));
    } else if (e.key === 'ArrowUp' && dirs.length) {
      e.preventDefault();
      setDi((i) => Math.max(-1, i - 1));
    } else if (e.key === 'Tab' && dirs.length) {
      e.preventDefault();
      setPath(dirs[Math.max(0, di)].display);
      setDi(-1);
    } else if (e.key === 'Enter') {
      e.preventDefault();
      if (di >= 0 && dirs[di]) {
        setPath(dirs[di].display);
        setDi(-1);
      } else if (path.trim()) add(path.trim().replace(/\/$/, ''));
    }
  };
  return (
    <div class="addp">
      <label class="lbl">폴더 경로</label>
      <div class="row-gap rel">
        <input class="field mono" autofocus placeholder="~/projects/todo-app" value={path} onInput={(e) => (setPath(e.currentTarget.value), setDi(-1))} onKeyDown={onKey} spellcheck={false} autocomplete="off" />
        <button class="btn" disabled={!path.trim() || busy} onClick={() => add(path.trim().replace(/\/$/, ''))}>
          추가
        </button>
        {dirs.length > 0 && (
          <div class="dd glass-3">
            {dirs.map((d, i) => (
              <button key={d.path} class={`li ${i === di ? 'on' : ''}`} onMouseDown={(e) => (e.preventDefault(), setPath(d.display))}>
                <I n={d.git ? 'git-branch' : 'folder'} />
                <span class="m mono">{d.display}</span>
                <span class="r">{d.git ? 'git' : ''}</span>
              </button>
            ))}
          </div>
        )}
      </div>
      <small class="muted">
        <kbd>Tab</kbd> 자동완성 · <kbd>↵</kbd> 추가
      </small>
      <label class="lbl">찾은 git 저장소</label>
      {found === null && <div class="muted">찾는 중…</div>}
      {found && !found.length && <div class="muted">홈 폴더 근처에서 찾지 못했어요. 위에 경로를 직접 입력해 주세요.</div>}
      <div class="list">
        {(found || []).slice(0, 14).map((r) => (
          <button key={r.path} class="li" onClick={() => add(r.path)} disabled={busy}>
            <I n="git-branch" />
            <span class="m">
              {r.name}
              <small>{r.display}</small>
            </span>
            <I n="plus" />
          </button>
        ))}
      </div>
    </div>
  );
}

/** A group is a project made of several repos: every task in it gets a worktree in each. */
function GroupBody({ gits }) {
  const [sel, setSel] = useState([]);
  const [name, setName] = useState('');
  const [busy, setBusy] = useState(false);
  const toggle = (id) => setSel((x) => (x.includes(id) ? x.filter((y) => y !== id) : [...x, id]));
  const picked = sel.map((id) => gits.find((g) => g.id === id)).filter(Boolean);
  async function save() {
    setBusy(true);
    try {
      const proj = await api('POST', '/api/projects', { kind: 'group', members: sel, name: name.trim() });
      closeModal();
      set({ screen: 'settings', settingsTab: 'projects', settingsProject: proj.id });
    } catch (e) {
      toast(e.message, { kind: 'err' });
    }
    setBusy(false);
  }
  return (
    <div class="addp">
      <p class="muted">프론트·백엔드처럼 늘 같이 고치는 저장소들을 하나로 묶어요. 묶음에 시킨 작업은 저장소마다 같은 이름의 브랜치를 만들고, 한 작업 폴더에서 에이전트가 전부 보면서 일해요.</p>
      <div class="list">
        {gits.map((g) => (
          <button key={g.id} class={`li ${sel.includes(g.id) ? 'on' : ''}`} onClick={() => toggle(g.id)} role="checkbox" aria-checked={sel.includes(g.id)}>
            <Glyph project={g} size={20} />
            <span class="m">
              {g.name}
              <small>{g.display}</small>
            </span>
            <I n={sel.includes(g.id) ? 'square-check-filled' : 'square'} />
          </button>
        ))}
      </div>
      <label class="lbl">묶음 이름</label>
      <input class="field" value={name} placeholder={picked.map((p) => p.name).join(' + ') || '예: 쇼핑몰 전체'} onInput={(e) => setName(e.currentTarget.value)} maxLength={60} />
      <div class="row-end">
        <button class="btn primary" disabled={sel.length < 2 || busy} onClick={save}>
          <I n="stack-2" /> {sel.length < 2 ? '2개 이상 골라 주세요' : `${sel.length}개 묶기`}
        </button>
      </div>
    </div>
  );
}
