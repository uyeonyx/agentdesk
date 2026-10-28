import { useEffect, useMemo, useRef, useState } from 'preact/hooks';
import { api } from '../api.js';
import { useStore, get, set, closeModal, openModal, toast, projectOf, taskOf, setView } from '../store.js';
import { roomVars, mod, fuzzyFilter, isLive, ago } from '../util.js';
import { createTask, merge, pr, discard, newTask, visibleTasks, select, openFileInTask, importSession, setRemote } from '../actions.js';
import { Glyph, I, Modal, Toggle, useAutoFocus } from './bits.jsx';
import { loadFiles } from './Files.jsx';
import { focusInput as focusComposer } from '../focus.js';

export function ModalHost() {
  const m = useStore((s) => s.modal);
  if (!m) return null;
  switch (m.kind) {
    case 'new':
      return <NewTask projectId={m.projectId} />;
    case 'add':
      return <AddProject />;
    case 'project':
      return <ProjectSettings id={m.id} fresh={m.fresh} initial={m.initial} />;
    case 'merge':
      return <ConfirmMerge taskId={m.taskId} />;
    case 'pr':
      return <ConfirmPr taskId={m.taskId} />;
    case 'discard':
      return <ConfirmDiscard taskId={m.taskId} />;
    case 'rename':
      return <Rename taskId={m.taskId} />;
    case 'palette':
      return <Palette />;
    case 'quick':
      return <QuickOpen taskId={m.taskId} />;
    case 'import':
      return <ImportSessions projectId={m.projectId} />;
    default:
      return null;
  }
}

// ------------------------------------------------------------ new task

function NewTask({ projectId: initial }) {
  const s = useStore((s) => ({ projects: s.projects, agents: s.agents, prefs: s.prefs }));
  const [pid, setPid] = useState(initial && s.projects.some((p) => p.id === initial) ? initial : s.projects.length === 1 ? s.projects[0].id : null);
  const p = s.projects.find((x) => x.id === pid);
  if (!s.projects.length) {
    return (
      <Modal>
        <div class="modal-h">
          <h2>먼저 프로젝트를 추가해요</h2>
        </div>
        <div class="modal-b">
          <AddProjectBody />
        </div>
      </Modal>
    );
  }
  return p ? <NewTaskWrite project={p} agents={s.agents} prefs={s.prefs} back={s.projects.length > 1 ? () => setPid(null) : null} /> : <NewTaskPick projects={s.projects} onPick={setPid} />;
}

function NewTaskPick({ projects, onPick }) {
  const [q, setQ] = useState('');
  const [i, setI] = useState(0);
  const input = useAutoFocus();
  const list = fuzzyFilter(q, projects, (p) => `${p.name} ${p.desc} ${p.display}`);
  useEffect(() => setI(0), [q]);
  const onKey = (e) => {
    if (e.isComposing || e.keyCode === 229) return;
    if (e.key === 'ArrowDown' || e.key === 'ArrowRight') {
      e.preventDefault();
      setI((x) => Math.min(list.length - 1, x + 1));
    } else if (e.key === 'ArrowUp' || e.key === 'ArrowLeft') {
      e.preventDefault();
      setI((x) => Math.max(0, x - 1));
    } else if (e.key === 'Enter' && list[i]) {
      e.preventDefault();
      onPick(list[i].id);
    } else if (!q && /^[1-9]$/.test(e.key) && list[+e.key - 1]) {
      e.preventDefault();
      onPick(list[+e.key - 1].id);
    }
  };
  return (
    <Modal class="wide" labelledBy="nt-h">
      <div class="modal-h">
        <h2 id="nt-h">어느 프로젝트에 시킬까요?</h2>
        <span class="sub">숫자키로 바로 골라요</span>
      </div>
      <div class="modal-b">
        <input ref={input} class="input" placeholder="프로젝트 찾기" value={q} onInput={(e) => setQ(e.currentTarget.value)} onKeyDown={onKey} style="margin-bottom:12px" />
        <div class="ptiles">
          {list.map((p, k) => (
            <button key={p.id} class={`ptile ${k === i ? 'on' : ''}`} style={roomVars(p.color)} onClick={() => onPick(p.id)} onMouseEnter={() => setI(k)}>
              <Glyph project={p} />
              <span style="min-width:0">
                <div class="nm">{p.name}</div>
                <div class="ds">{p.desc || p.display}</div>
              </span>
              {!q && k < 9 && <kbd>{k + 1}</kbd>}
            </button>
          ))}
        </div>
      </div>
    </Modal>
  );
}

function NewTaskWrite({ project, agents, prefs, back }) {
  const projects = useStore((s) => s.projects);
  const avail = Object.entries(agents).filter(([, a]) => a.available).map(([k]) => k);
  const [extra, setExtra] = useState([]);
  const [remoteOn, setRemoteOn] = useState(typeof project.remote === 'boolean' ? project.remote : !!prefs.remote);
  const group = project.kind === 'group';
  const members = group ? (project.members || []).map((id) => projects.find((p) => p.id === id)).filter(Boolean) : [];
  const others = !group && project.isGit ? projects.filter((p) => p.id !== project.id && p.kind !== 'group' && p.isGit) : [];
  const toggleExtra = (id) => setExtra((x) => (x.includes(id) ? x.filter((y) => y !== id) : [...x, id]));
  const repoCount = group ? members.length : 1 + extra.length;
  const [agent, setAgent] = useState(avail.includes(prefs.lastAgent) ? prefs.lastAgent : avail[0] || 'claude');
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  const [nudge, setNudge] = useState(0);
  const [sweep, setSweep] = useState(1);
  const ta = useAutoFocus(project.id);
  useEffect(() => setSweep((n) => n + 1), [project.id]);
  const careful = !!project.careful;

  async function go() {
    if (!text.trim() || busy) return;
    if ('Notification' in window && Notification.permission === 'default') Notification.requestPermission().catch(() => {});
    setBusy(true);
    api('PATCH', '/api/prefs', { lastAgent: agent }).catch(() => {});
    const t = await createTask(project.id, agent, text.trim(), { extraProjectIds: extra, remote: agents[agent]?.remote ? remoteOn : false });
    setBusy(false);
    if (t) setTimeout(focusComposer, 50);
  }
  const onKey = (e) => {
    if (e.isComposing || e.keyCode === 229) return;
    if (e.key === 'Tab' && !e.shiftKey && avail.length > 1) {
      e.preventDefault();
      setAgent((a) => avail[(avail.indexOf(a) + 1) % avail.length]);
      return;
    }
    if (e.key === 'Backspace' && !text && back) {
      e.preventDefault();
      back();
      return;
    }
    if (e.key !== 'Enter' || e.shiftKey) return;
    const withMod = e.metaKey || e.ctrlKey;
    if (careful && !withMod) return setNudge((n) => n + 1);
    e.preventDefault();
    go();
  };
  return (
    <Modal class={`wide roomed ${careful ? 'careful' : ''}`} style={roomVars(project.color)} labelledBy="ntw-h">
      <div key={sweep} class="room-cue go" />
      <div class="modal-h">
        <Glyph project={project} />
        <div style="min-width:0;flex:1">
          <h2 id="ntw-h">{project.name}</h2>
          <div class="sub">{project.desc || project.display}</div>
        </div>
        {careful && (
          <span class="careful-badge">
            <I n="shield-lock" /> 신중
          </span>
        )}
      </div>
      <div class="modal-b" style="padding-top:14px">
        <div class="agent-pick" role="radiogroup" aria-label="에이전트">
          {Object.entries(agents).map(([k, a]) => (
            <button key={k} class={agent === k ? 'on' : ''} disabled={!a.available} onClick={() => setAgent(k)} role="radio" aria-checked={agent === k} title={a.available ? '' : `${a.label} CLI가 설치돼 있지 않아요`}>
              <I n={k === 'codex' ? 'brand-openai' : 'sparkles'} /> {a.label}
              {!a.available && <small style="font-weight:500;color:var(--faint)">설치 안 됨</small>}
            </button>
          ))}
        </div>
        <textarea
          ref={ta}
          class="input bigtext"
          style="margin-top:12px"
          placeholder={`${project.name}에게 시킬 일…`}
          value={text}
          onInput={(e) => setText(e.currentTarget.value)}
          onKeyDown={onKey}
          spellcheck={false}
        />
        {(group || others.length > 0) && (
          <div class="repo-pick">
            <span class="lbl">
              <I n="stack-2" /> {group ? '함께 고치는 저장소' : '다른 저장소도 같이 고치기'}
            </span>
            {group
              ? members.map((m) => (
                  <span key={m.id} class="rchip on fixed" style={roomVars(m.color)}>
                    <Glyph project={m} size={18} /> {m.name}
                  </span>
                ))
              : others.map((m) => (
                  <button key={m.id} class={`rchip ${extra.includes(m.id) ? 'on' : ''}`} style={roomVars(m.color)} onClick={() => toggleExtra(m.id)} aria-pressed={extra.includes(m.id)}>
                    <Glyph project={m} size={18} /> {m.name}
                    {extra.includes(m.id) && <I n="check" />}
                  </button>
                ))}
          </div>
        )}
        {agents[agent]?.remote && (
          <label class="remote-pick">
            <input type="checkbox" checked={remoteOn} onChange={(e) => setRemoteOn(e.currentTarget.checked)} />
            <I n="device-mobile" /> 폰(Claude 앱)에서도 보고 이어서 시키기
            <small>Remote Control · Claude 앱의 Code 탭에 이 세션이 떠요</small>
          </label>
        )}
        <p style="color:var(--muted);font-size:12.5px;margin:10px 0 0">
          {repoCount > 1
            ? `저장소 ${repoCount}개에 같은 이름의 브랜치와 worktree를 만들고, 한 작업 폴더에 모아 에이전트를 돌려요. 머지는 전부 충돌 검사 후 한꺼번에 해요.`
            : project.isGit
              ? '새 브랜치와 worktree에서 시작해요. 메인 체크아웃은 건드리지 않아요.'
              : 'git 저장소가 아니라서 이 폴더에서 바로 작업해요. 되돌리기와 머지는 쓸 수 없어요.'}
        </p>
      </div>
      <div class="modal-f">
        {back && (
          <button class="btn ghost sm" onClick={back}>
            <I n="arrow-left" /> 다른 프로젝트
          </button>
        )}
        <button class="btn ghost sm" onClick={() => openModal('import', { projectId: group ? null : project.id })}>
          <I n="history" /> 있던 세션 불러오기
        </button>
        <span class="sp" />
        <span key={nudge} class={`hint ${nudge ? 'nudge' : ''}`} style="font-size:12px;color:var(--faint)">
          {avail.length > 1 && (
            <>
              <kbd>Tab</kbd> 에이전트 ·{' '}
            </>
          )}
          {careful ? (
            <>
              신중 모드 · <kbd>{mod}</kbd>
              <kbd>↵</kbd>
            </>
          ) : (
            <kbd>↵</kbd>
          )}
        </span>
        <button class="btn primary" disabled={!text.trim() || busy || !avail.includes(agent)} onClick={go}>
          <I n={busy ? 'loader-2' : 'player-play'} /> {project.name}에서 시작
        </button>
      </div>
    </Modal>
  );
}

// ------------------------------------------------------------ add project

function AddProject() {
  const gits = useStore((s) => s.projects.filter((p) => p.kind !== 'group' && p.isGit));
  const [tab, setTab] = useState('folder');
  return (
    <Modal class="wide" labelledBy="ap-h">
      <div class="modal-h">
        <h2 id="ap-h">프로젝트 추가</h2>
        <span class="sp" style="flex:1" />
        <div class="seg" role="tablist">
          <button class={tab === 'folder' ? 'on' : ''} onClick={() => setTab('folder')} role="tab" aria-selected={tab === 'folder'}>
            <I n="folder-plus" /> 폴더
          </button>
          <button class={tab === 'group' ? 'on' : ''} onClick={() => setTab('group')} role="tab" aria-selected={tab === 'group'} disabled={gits.length < 2} title={gits.length < 2 ? 'git 저장소 프로젝트가 2개 이상 있어야 해요' : ''}>
            <I n="stack-2" /> 여러 저장소 묶기
          </button>
        </div>
      </div>
      <div class="modal-b">{tab === 'folder' ? <AddProjectBody /> : <GroupBody gits={gits} />}</div>
    </Modal>
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
      openModal('project', { id: proj.id, fresh: true, initial: proj });
    } catch (e) {
      toast(e.message, { kind: 'err' });
    }
    setBusy(false);
  }
  return (
    <div>
      <p style="color:var(--muted);margin:0 0 12px;font-size:13px">
        프론트·백엔드처럼 늘 같이 고치는 저장소들을 하나로 묶어요. 묶음에 시킨 작업은 저장소마다 같은 이름의 브랜치를 만들고, 한 작업 폴더에서 에이전트가 전부 보면서 일해요.
      </p>
      <div class="list">
        {gits.map((g) => (
          <button key={g.id} class={`li ${sel.includes(g.id) ? 'on' : ''}`} onClick={() => toggle(g.id)} role="checkbox" aria-checked={sel.includes(g.id)} style={roomVars(g.color)}>
            <Glyph project={g} />
            <span class="m">
              {g.name}
              <small>{g.display}</small>
            </span>
            <span class="r">
              <I n={sel.includes(g.id) ? 'square-check' : 'square'} style={sel.includes(g.id) ? 'color:var(--room)' : ''} />
            </span>
          </button>
        ))}
      </div>
      <label class="field">
        <span>묶음 이름</span>
        <input class="input" value={name} placeholder={picked.map((p) => p.name).join(' + ') || '예: 쇼핑몰 전체'} onInput={(e) => setName(e.currentTarget.value)} maxLength={60} />
      </label>
      <div style="display:flex;justify-content:flex-end">
        <button class="btn primary" disabled={sel.length < 2 || busy} onClick={save}>
          <I n="stack-2" /> {sel.length < 2 ? '2개 이상 고르세요' : `${sel.length}개 묶기`}
        </button>
      </div>
    </div>
  );
}

export function AddProjectBody() {
  const [path, setPath] = useState('');
  const [dirs, setDirs] = useState([]);
  const [di, setDi] = useState(-1);
  const [found, setFound] = useState(null);
  const [busy, setBusy] = useState(false);
  const input = useAutoFocus();

  useEffect(() => {
    api('GET', '/api/discover').then((r) => setFound(r.repos)).catch(() => setFound([]));
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
      // Name, description, logo and color are filled from the repo; nothing to set up by hand.
      if (get().modal?.kind === 'add') closeModal();
      toast(`${proj.name} 추가했어요${proj.desc ? ` · ${proj.desc}` : ''}`, { kind: 'room', projectId: proj.id, ms: 6000, action: { label: '바꾸기', run: () => openModal('project', { id: proj.id, initial: proj }) } });
    } catch (e) {
      toast(e.message, { kind: 'err' });
    }
    setBusy(false);
  }

  const onKey = (e) => {
    if (e.isComposing) return;
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
    <div>
      <label class="field rel">
        <span>폴더 경로</span>
        <div style="display:flex;gap:8px">
          <input
            ref={input}
            class="input"
            placeholder="~/projects/todo-app"
            value={path}
            onInput={(e) => {
              setPath(e.currentTarget.value);
              setDi(-1);
            }}
            onKeyDown={onKey}
            spellcheck={false}
            autocomplete="off"
            style="font-family:var(--mono);font-size:13px"
          />
          <button class="btn" style="height:38px" disabled={!path.trim() || busy} onClick={() => add(path.trim().replace(/\/$/, ''))}>
            추가
          </button>
        </div>
        {dirs.length > 0 && (
          <div class="dd">
            {dirs.map((d, i) => (
              <button
                key={d.path}
                class={`li ${i === di ? 'on' : ''}`}
                onMouseDown={(e) => {
                  e.preventDefault();
                  setPath(d.display);
                  input.current?.focus();
                }}
              >
                <I n={d.git ? 'git-branch' : 'folder'} />
                <span class="m" style="font-family:var(--mono);font-size:12.5px">
                  {d.display}
                </span>
                <span class="r">{d.git ? 'git' : ''}</span>
              </button>
            ))}
          </div>
        )}
        <small style="color:var(--faint);font-size:12px;display:block;margin-top:6px">
          <kbd>Tab</kbd> 자동완성 · <kbd>↵</kbd> 추가
        </small>
      </label>
      <div class="field">
        <span>찾은 git 저장소</span>
        {found === null && <div style="color:var(--faint);font-size:13px">찾는 중…</div>}
        {found && !found.length && <div style="color:var(--faint);font-size:13px">홈 폴더 근처에서 찾지 못했어요. 위에 경로를 직접 입력하세요.</div>}
        <div class="list">
          {(found || []).slice(0, 14).map((r) => (
            <button key={r.path} class="li" onClick={() => add(r.path)} disabled={busy}>
              <I n="git-branch" />
              <span class="m">
                {r.name}
                <small>{r.display}</small>
              </span>
              <span class="r">
                <I n="plus" />
              </span>
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}

// ------------------------------------------------------------ project settings

function ProjectSettings({ id, fresh, initial }) {
  const s = useStore((s) => ({ p: projectOf(s, id) || initial, palette: s.palette, icons: s.icons }));
  const pick = (p) => ({ name: p.name, desc: p.desc, color: p.color, icon: p.icon, careful: p.careful, remote: !!p.remote, showLogo: p.showLogo !== false });
  const all = useStore((s) => s.projects);
  const [d, setD] = useState(() => (s.p ? pick(s.p) : null));
  // The API reply can arrive before the live state that contains the new project.
  useEffect(() => {
    if (!d && s.p) setD(pick(s.p));
  }, [!!s.p]);
  const nameRef = useAutoFocus(!!d);
  if (!s.p || !d) return null;
  const up = (k, v) => setD((x) => ({ ...x, [k]: v }));
  const preview = { ...s.p, ...d };
  const icons = s.icons.includes(d.icon) ? s.icons : [d.icon, ...s.icons];

  async function save() {
    try {
      await api('PATCH', `/api/projects/${id}`, { ...d, manual: true });
      closeModal();
      if (fresh) toast(`${d.name} 준비됐어요 · N 을 눌러 첫 작업을 시켜보세요`, { kind: 'room', projectId: id, ms: 6000 });
    } catch (e) {
      toast(e.message, { kind: 'err' });
    }
  }
  async function remove() {
    if (!confirm(`${s.p.name}을(를) 목록에서 지울까요? 폴더와 파일은 그대로 남아요.`)) return;
    try {
      await api('DELETE', `/api/projects/${id}`);
      closeModal();
      if (get().filter === id) set({ filter: null });
    } catch (e) {
      toast(e.message, { kind: 'err' });
    }
  }

  return (
    <Modal class="wide roomed" style={roomVars(d.color)} labelledBy="ps-h">
      <div class="modal-h">
        <Glyph project={preview} />
        <div style="flex:1;min-width:0">
          <h2 id="ps-h">{fresh ? `${d.name || '프로젝트'} 꾸미기` : `${d.name} 설정`}</h2>
          <div class="sub">{fresh ? '프로젝트마다 확실히 다르게 해두면 헷갈릴 일이 없어요' : s.p.display}</div>
        </div>
      </div>
      <div class="modal-b" style="display:grid;grid-template-columns:minmax(0,1fr) 300px;gap:20px">
        <div>
          <label class="field">
            <span>이름</span>
            <input ref={nameRef} class="input" value={d.name} onInput={(e) => up('name', e.currentTarget.value)} maxLength={60} />
          </label>
          <label class="field">
            <span>한 줄 설명 · 저장소의 README·package.json에서 자동으로 채워요</span>
            <div style="display:flex;gap:8px">
              <input class="input" value={d.desc} placeholder="Rust · FIPS 140-3 · 고객사 납품용" onInput={(e) => up('desc', e.currentTarget.value)} maxLength={120} />
              {s.p.kind !== 'group' && (
                <button
                  class="btn"
                  style="height:38px"
                  title="저장소에서 설명·로고를 다시 읽어요"
                  onClick={async () => {
                    try {
                      const p2 = await api('POST', `/api/projects/${id}/autofill`);
                      setD((x) => ({ ...x, desc: p2.desc, icon: p2.icon, showLogo: true }));
                    } catch (e) {
                      toast(e.message, { kind: 'err' });
                    }
                  }}
                >
                  <I n="wand" /> 다시 채우기
                </button>
              )}
            </div>
          </label>
          <div class="field">
            <span>색</span>
            <div class="swatches">
              {s.palette.map((c) => (
                <button key={c} class={`sw ${d.color === c ? 'on' : ''}`} style={{ background: c }} onClick={() => up('color', c)} aria-label={c} />
              ))}
            </div>
          </div>
          {s.p.logo && (
            <div class="field">
              <Toggle on={d.showLogo} onChange={(v) => up('showLogo', v)} title="저장소의 로고 쓰기" desc={`${s.p.logo} 를 프로젝트 표시로 써요. 끄면 아래 아이콘을 써요.`} />
            </div>
          )}
          <div class="field">
            <span>아이콘</span>
            <div class="icons">
              {icons.map((ic) => (
                <button key={ic} class={d.icon === ic ? 'on' : ''} onClick={() => up('icon', ic)} aria-label={ic}>
                  <I n={ic} />
                </button>
              ))}
            </div>
          </div>
          <div class="field">
            <Toggle
              on={d.careful}
              onChange={(v) => up('careful', v)}
              title="신중 모드"
              desc={`실수하면 큰일 나는 프로젝트용. 테두리가 두꺼워지고 ${mod}↵ 로만 보내져요. 다른 프로젝트에서 하던 손버릇(↵)으로는 안 보내져요.`}
            />
          </div>
          <div class="field">
            <Toggle on={d.remote} onChange={(v) => up('remote', v)} title="폰(Claude 앱)에서도 이어하기" desc="새 Claude 작업을 Remote Control로 시작해요. 폰의 Claude 앱 · Code 탭에서 같은 세션을 보고 지시할 수 있고, 폰에서 보낸 지시도 여기 기록되고 되돌릴 수 있어요." />
          </div>
          {s.p.kind === 'group' && (
            <div class="field">
              <span>묶인 저장소</span>
              <div class="repo-pick" style="margin:0">
                {(s.p.members || []).map((id) => {
                  const m = all.find((x) => x.id === id);
                  return m ? (
                    <span key={id} class="rchip on fixed" style={roomVars(m.color)}>
                      <Glyph project={m} size={18} /> {m.name}
                    </span>
                  ) : null;
                })}
              </div>
            </div>
          )}
        </div>
        <div>
          <div class="field">
            <span>미리보기</span>
          </div>
          <div class={`preview ${d.careful ? 'careful' : ''}`}>
            <div class="room-h">
              <Glyph project={preview} />
              <div class="room-id">
                <div class="room-name">
                  <h1 style="font-size:16px">{d.name || '이름'}</h1>
                </div>
                <div class="room-sub" style="color:var(--muted);font-size:12px">
                  {d.desc || '한 줄 설명'}
                </div>
              </div>
            </div>
            <div class="composer">
              <div class="composer-box">
                <Glyph project={preview} />
                <div style="padding:6px 0;color:var(--room-text);opacity:.75;font-weight:550;font-size:14px">{d.name || '이름'}에게 지시하기…</div>
                <span />
              </div>
            </div>
          </div>
        </div>
      </div>
      <div class="modal-f">
        {!fresh && (
          <button class="btn ghost sm danger" onClick={remove}>
            <I n="trash" /> 목록에서 지우기
          </button>
        )}
        <span class="sp" />
        <button class="btn ghost" onClick={closeModal}>
          {fresh ? '나중에' : '취소'}
        </button>
        <button class="btn primary" onClick={save}>
          저장
        </button>
      </div>
    </Modal>
  );
}

// ------------------------------------------------------------ confirms

function useTP(taskId) {
  return useStore((s) => {
    const t = taskOf(s, taskId);
    return { t, p: t && projectOf(s, t.projectId) };
  });
}

function Confirm({ t, p, title, children, action, label, icon, danger }) {
  const [busy, setBusy] = useState(false);
  const careful = !!p.careful;
  const running = useRef(false);
  const run = async () => {
    if (running.current) return;
    running.current = true;
    setBusy(true);
    await action();
    running.current = false;
    setBusy(false);
  };
  useEffect(() => {
    const h = (e) => {
      if (e.key === 'Enter' && (!careful || e.metaKey || e.ctrlKey)) {
        e.preventDefault();
        run();
      }
    };
    window.addEventListener('keydown', h);
    return () => window.removeEventListener('keydown', h);
  });
  return (
    <Modal class={`roomed ${careful ? 'careful' : ''}`} style={roomVars(p.color)}>
      <div class="modal-h">
        <Glyph project={p} />
        <div style="min-width:0;flex:1">
          <h2>{p.name}</h2>
          <div class="sub">{title}</div>
        </div>
      </div>
      <div class="modal-b" style="padding-top:14px;font-size:14px;line-height:1.65">
        <div style="font-weight:600;margin-bottom:6px">{t.title}</div>
        {children}
      </div>
      <div class="modal-f">
        <span class="sp" />
        <button class="btn ghost" onClick={closeModal}>
          취소
        </button>
        <button class={`btn ${danger ? 'danger' : 'primary'}`} onClick={run} disabled={busy}>
          <I n={busy ? 'loader-2' : icon} /> {label} {careful ? <kbd>{mod}↵</kbd> : <kbd>↵</kbd>}
        </button>
      </div>
    </Modal>
  );
}

function ConfirmMerge({ taskId }) {
  const { t, p } = useTP(taskId);
  if (!t || !p) return null;
  return (
    <Confirm t={t} p={p} title="메인 체크아웃에 머지" action={() => merge(taskId)} label="머지" icon="git-merge">
      <p style="margin:0;color:var(--muted)">
        <code>{t.branch}</code>의 변경 {t.changes.files}개 파일 (<span style="color:var(--ok)">+{t.changes.adds}</span> <span style="color:var(--danger)">−{t.changes.dels}</span>)을 <b style="color:var(--text)">{p.display}</b>에서 지금 체크아웃된 브랜치에 머지해요. 커밋 안 된 변경은 먼저 커밋하고, 끝나면 worktree를 정리해요.
      </p>
    </Confirm>
  );
}

function ConfirmPr({ taskId }) {
  const { t, p } = useTP(taskId);
  if (!t || !p) return null;
  return (
    <Confirm
      t={t}
      p={p}
      title="Pull request 만들기"
      action={async () => {
        closeModal();
        await pr(taskId);
      }}
      label="PR 만들기"
      icon="git-pull-request"
    >
      <p style="margin:0;color:var(--muted)">
        변경을 커밋하고 <code>{t.branch}</code> 브랜치를 origin에 올린 뒤 <code>gh pr create</code>로 PR을 만들어요. GitHub CLI(gh)가 로그인돼 있어야 해요.
      </p>
    </Confirm>
  );
}

function ConfirmDiscard({ taskId }) {
  const { t, p } = useTP(taskId);
  if (!t || !p) return null;
  return (
    t.adopted ? (
      <Confirm t={t} p={p} title="목록에서 빼기" action={() => discard(taskId)} label="빼기" icon="logout">
        <p style="margin:0;color:var(--muted)">에이전트를 멈추고 Desk 목록에서 빼요. 불러온 세션이라 {t.worktree}의 파일과 브랜치는 하나도 건드리지 않아요. 대화는 나중에 다시 불러올 수 있어요.</p>
      </Confirm>
    ) : (
      <Confirm t={t} p={p} title="작업 버리기" action={() => discard(taskId)} label="버리기" icon="trash" danger>
        <p style="margin:0;color:var(--muted)">
          에이전트를 멈추고 이 작업의 worktree와 브랜치({t.branch || '없음'}){t.multi ? `를 저장소 ${t.repos.length}개 모두에서` : '를'} 지워요. 머지하지 않은 변경은 사라져요.
        </p>
      </Confirm>
    )
  );
}

function Rename({ taskId }) {
  const { t, p } = useTP(taskId);
  const [v, setV] = useState(t?.title || '');
  const ref = useAutoFocus();
  if (!t || !p) return null;
  const save = async () => {
    await api('POST', `/api/tasks/${taskId}/rename`, { title: v }).catch((e) => toast(e.message, { kind: 'err' }));
    closeModal();
  };
  return (
    <Modal class="roomed" style={roomVars(p.color)}>
      <div class="modal-h">
        <Glyph project={p} />
        <h2>작업 이름</h2>
      </div>
      <div class="modal-b" style="padding-top:14px">
        <input ref={ref} class="input" value={v} onInput={(e) => setV(e.currentTarget.value)} onKeyDown={(e) => !e.isComposing && e.key === 'Enter' && save()} maxLength={80} />
      </div>
      <div class="modal-f">
        <span class="sp" />
        <button class="btn primary" onClick={save}>
          저장
        </button>
      </div>
    </Modal>
  );
}

// ------------------------------------------------------------ command palette

function Palette() {
  const s = useStore((s) => ({ tasks: s.tasks, projects: s.projects, selected: s.selected }));
  const [q, setQ] = useState('');
  const [i, setI] = useState(0);
  const input = useAutoFocus();
  const cur = taskOf(s, s.selected);
  const curP = cur && projectOf(s, cur.projectId);

  const items = useMemo(() => {
    const out = [];
    const cmd = (icon, label, run, hint) => out.push({ kind: 'cmd', icon, label, run, hint });
    cmd('plus', '새 작업', () => newTask(), 'N');
    cmd('folder-plus', '프로젝트 추가', () => openModal('add'));
    cmd('history', '이미 있는 세션 불러오기 · 다른 터미널, 지난 대화', () => openModal('import', { projectId: get().filter }));
    cmd('layout-dashboard', get().view === 'board' ? '목록으로' : '관제탑 · 모든 에이전트를 카드로', () => set({ view: get().view === 'board' ? 'inbox' : 'board' }), 'B');
    cmd('list-check', '진척 패널 열고 닫기', () => set({ progressOpen: !get().progressOpen }));
    if (cur) {
      cmd('terminal-2', '대화 보기', () => setView(cur.id, 'chat'), '⌥1');
      cmd('git-compare', '변경 보기', () => setView(cur.id, 'review'), '⌥2');
      cmd('files', '파일 보기', () => setView(cur.id, 'files'), '⌥3');
      cmd('search', '파일 열기', () => openModal('quick', { taskId: cur.id }), `${mod}P`);
      if (cur.isolated && !cur.adopted && cur.changes.files) cmd('git-merge', `${curP?.name} · 머지`, () => openModal('merge', { taskId: cur.id }));
      if (curP) cmd('settings', `${curP.name} 설정`, () => openModal('project', { id: curP.id }));
      if (cur.agent === 'claude' && isLive(cur)) cmd('device-mobile', cur.remote ? `${curP?.name} · 폰 연결 끄기` : `${curP?.name} · 폰(Claude 앱)에서 이어하기`, () => setRemote(cur.id, !cur.remote));
    }
    if ('Notification' in window && Notification.permission !== 'granted')
      cmd('bell', '알림 켜기 · 에이전트가 기다릴 때 알려줘요', () => Notification.requestPermission().then((r) => toast(r === 'granted' ? '알림을 켰어요' : '브라우저에서 알림이 막혀 있어요')));
    for (const p of s.projects) out.push({ kind: 'proj', p, label: `${p.name}에 새 작업`, run: () => newTask(p.id) });
    for (const t of s.tasks.filter((t) => !t.archived)) {
      const p = projectOf(s, t.projectId);
      out.push({ kind: 'task', t, p, label: `${p?.name || ''} ${t.title}`, run: () => select(t.id) });
    }
    return out;
  }, [s.tasks, s.projects, s.selected]);

  const list = fuzzyFilter(q, items, (x) => x.label, 40);
  useEffect(() => setI(0), [q]);
  const run = (x) => {
    closeModal();
    setTimeout(x.run, 0);
  };
  return (
    <Modal>
      <input
        ref={input}
        class="palette-input"
        placeholder="명령, 프로젝트, 작업 찾기"
        value={q}
        onInput={(e) => setQ(e.currentTarget.value)}
        onKeyDown={(e) => {
          if (e.isComposing || e.keyCode === 229) return;
          if (e.key === 'ArrowDown') {
            e.preventDefault();
            setI((x) => Math.min(list.length - 1, x + 1));
          } else if (e.key === 'ArrowUp') {
            e.preventDefault();
            setI((x) => Math.max(0, x - 1));
          } else if (e.key === 'Enter' && list[i]) {
            e.preventDefault();
            run(list[i]);
          }
        }}
      />
      <div class="modal-b scroll" style="padding:6px">
        <div class="list">
          {list.map((x, k) => (
            <button key={k} class={`li ${k === i ? 'on' : ''}`} onMouseEnter={() => setI(k)} onClick={() => run(x)} style={x.p ? roomVars(x.p.color) : undefined}>
              {x.kind === 'cmd' ? <I n={x.icon} /> : <Glyph project={x.p} />}
              <span class="m">
                {x.kind === 'task' ? (
                  <>
                    {x.t.title}
                    <small>{x.p?.name}</small>
                  </>
                ) : (
                  x.label
                )}
              </span>
              <span class="r">{x.hint ? <kbd>{x.hint}</kbd> : x.kind === 'task' ? x.t.state.replace('_', ' ') : ''}</span>
            </button>
          ))}
        </div>
      </div>
    </Modal>
  );
}

// ------------------------------------------------------------ quick open (⌘P)

function QuickOpen({ taskId }) {
  const { t, p } = useTP(taskId);
  const [files, setFiles] = useState([]);
  const [q, setQ] = useState('');
  const [i, setI] = useState(0);
  const input = useAutoFocus();
  useEffect(() => {
    loadFiles(taskId).then(setFiles).catch((e) => toast(e.message, { kind: 'err' }));
  }, [taskId]);
  const list = fuzzyFilter(q, files, (f) => f, 50);
  useEffect(() => setI(0), [q]);
  if (!t || !p) return null;
  const open = (f) => {
    closeModal();
    openFileInTask(taskId, f, 1);
  };
  return (
    <Modal class="roomed" style={roomVars(p.color)}>
      <div style="display:flex;align-items:center;gap:10px;padding:0 0 0 14px;border-bottom:1px solid var(--room-line)">
        <Glyph project={p} size={24} />
        <input
          ref={input}
          class="palette-input"
          style="border:0;padding-left:4px"
          placeholder={`${p.name}에서 파일 찾기`}
          value={q}
          onInput={(e) => setQ(e.currentTarget.value)}
          onKeyDown={(e) => {
            if (e.isComposing || e.keyCode === 229) return;
            if (e.key === 'ArrowDown') {
              e.preventDefault();
              setI((x) => Math.min(list.length - 1, x + 1));
            } else if (e.key === 'ArrowUp') {
              e.preventDefault();
              setI((x) => Math.max(0, x - 1));
            } else if (e.key === 'Enter' && list[i]) {
              e.preventDefault();
              open(list[i]);
            }
          }}
        />
      </div>
      <div class="modal-b scroll" style="padding:6px">
        <div class="list">
          {list.map((f, k) => (
            <button key={f} class={`li ${k === i ? 'on' : ''}`} onMouseEnter={() => setI(k)} onClick={() => open(f)}>
              <I n="file" />
              <span class="m">
                {f.split('/').pop()}
                <small>{f.split('/').slice(0, -1).join('/')}</small>
              </span>
              <span />
            </button>
          ))}
        </div>
      </div>
    </Modal>
  );
}

// ------------------------------------------------------------ import existing sessions

function ImportSessions({ projectId }) {
  const s = useStore((s) => ({ projects: s.projects, tasks: s.tasks }));
  const [list, setList] = useState(null);
  const [q, setQ] = useState('');
  const [onlyProject, setOnlyProject] = useState(!!projectId);
  const [i, setI] = useState(0);
  const [busy, setBusy] = useState(null);
  const input = useAutoFocus();
  const scope = projectId && projectOf(s, projectId);

  const [refreshing, setRefreshing] = useState(false);
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

  // Sessions Desk already runs are in the inbox; only show them when searched for.
  const scoped = (list || []).filter((x) => (!onlyProject || !scope || x.projectId === scope.id) && (!x.taskId || q));
  const found = fuzzyFilter(q, scoped, (x) => `${x.title} ${x.first} ${x.lastPrompt || ''} ${x.cwdShort} ${x.live?.name || ''}`, 120);
  const live = found.filter((x) => x.live || x.recent);
  const past = found.filter((x) => !x.live && !x.recent);
  const flat = [...live, ...past];
  useEffect(() => setI(0), [q, onlyProject]);

  const act = async (x, mode) => {
    if (x.taskId) {
      closeModal();
      return set({ selected: x.taskId, view: 'inbox' });
    }
    setBusy(x.sessionId);
    await importSession(x, mode);
    setBusy(null);
  };
  const defaultMode = (x) => (x.live?.kind === 'background' ? 'takeover' : x.live || x.recent ? 'watch' : 'auto');

  const row = (x) => {
    const k = flat.indexOf(x);
    const p = x.projectId && projectOf(s, x.projectId);
    const sub = x.lastPrompt && x.lastPrompt !== x.first ? `마지막: ${x.lastPrompt}` : x.first && x.first !== x.title ? x.first : x.last;
    return (
      <div key={x.agent + x.sessionId} class={`srow ${k === i ? 'on' : ''}`} style={p ? roomVars(p.color) : undefined} onMouseEnter={() => setI(k)}>
        {p ? <Glyph project={p} /> : <span class="nofolder"><I n="folder" /></span>}
        <div class="sm">
          <div class="st">
            <I n={x.agent === 'codex' ? 'brand-openai' : 'sparkles'} class="ag" />
            {x.title}
          </div>
          {sub && <div class="sx">{sub}</div>}
          <div class="smeta">
            <span class="cwd">{x.cwdShort}</span>
            <span>{ago(x.updatedAt)} 전</span>
            {!p && <span class="note">프로젝트로 추가돼요</span>}
            {!x.live && x.recent && (
              <span class="livebadge">
                <span class="dot" />
                방금까지 활동 · 실행 중일 수 있어요
              </span>
            )}
            {x.live && (
              <span class={`livebadge ${x.live.kind}`}>
                <span class="dot" />
                {x.live.kind === 'background' ? '백그라운드에서 실행 중' : `${x.live.where || '다른 터미널'}에서 실행 중`}
                {x.live.status ? ` · ${x.live.status}` : ''}
              </span>
            )}
          </div>
        </div>
        <div class="sa">
          {x.taskId ? (
            <button class="btn sm" onClick={() => act(x)}>
              <I n="arrow-right" /> Desk에서 열려 있음
            </button>
          ) : x.live?.kind === 'background' ? (
            <>
              <button class="btn sm ghost" disabled={busy} onClick={() => act(x, 'watch')} title="그대로 돌게 두고, 대화와 진척을 여기서 실시간으로 봐요">
                <I n="eye" /> 보기
              </button>
              <button class="btn sm primary" disabled={busy} onClick={() => act(x, 'takeover')} title="백그라운드 세션을 멈추고 같은 대화를 여기서 이어가요">
                <I n={busy === x.sessionId ? 'loader-2' : 'download'} /> 이어받기
              </button>
            </>
          ) : x.live || x.recent ? (
            <>
              <button class="btn sm ghost" disabled={busy} onClick={() => act(x, x.agent === 'codex' ? 'auto' : 'fork')} title={x.agent === 'codex' ? '여기서 이어서 열어요' : '원래 세션은 그대로 두고 복사본(--fork-session)을 열어요'}>
                {x.agent === 'codex' ? '이어서 열기' : '복사본'}
              </button>
              <button class="btn sm primary" disabled={busy} onClick={() => act(x, 'watch')} title={`${x.live?.where || '다른 터미널'}에서 돌고 있는 그대로, 대화·도구·진척을 여기서 실시간으로 봐요${x.agent === 'codex' ? '. 지시는 codex queue로 넣을 수 있어요' : '. 거기서 닫으면 여기서 이어받을 수 있어요'}`}>
                <I n={busy === x.sessionId ? 'loader-2' : 'eye'} /> 보기 · 동기화
              </button>
            </>
          ) : (
            <button class="btn sm primary" disabled={busy} onClick={() => act(x)}>
              <I n={busy === x.sessionId ? 'loader-2' : 'player-play'} /> 이어서 열기
            </button>
          )}
        </div>
      </div>
    );
  };

  return (
    <Modal class="wide" labelledBy="imp-h">
      <div class="modal-h">
        <div style="flex:1;min-width:0">
          <h2 id="imp-h">이미 있는 세션 불러오기</h2>
          <div class="sub">VS Code·터미널·백그라운드에서 돌고 있는 세션은 실시간으로 보고, 지난 대화는 여기서 이어가요</div>
        </div>
        <button class="btn ghost sm icon" onClick={() => load(true)} title="새로 찾기" aria-label="새로 찾기" disabled={refreshing}>
          <I n={refreshing ? 'loader-2' : 'refresh'} class={refreshing ? 'spinning' : ''} />
        </button>
      </div>
      <div class="modal-b" style="padding-bottom:6px">
        <div style="display:flex;gap:8px;align-items:center">
          <input
            ref={input}
            class="input"
            placeholder="제목, 첫 지시, 폴더로 찾기"
            value={q}
            onInput={(e) => setQ(e.currentTarget.value)}
            onKeyDown={(e) => {
              if (e.isComposing || e.keyCode === 229) return;
              if (e.key === 'ArrowDown') {
                e.preventDefault();
                setI((x) => Math.min(flat.length - 1, x + 1));
              } else if (e.key === 'ArrowUp') {
                e.preventDefault();
                setI((x) => Math.max(0, x - 1));
              } else if (e.key === 'Enter' && flat[i] && !busy) {
                e.preventDefault();
                act(flat[i], defaultMode(flat[i]));
              }
            }}
          />
          {scope && (
            <button class={`chip ${onlyProject ? 'on' : ''}`} style={roomVars(scope.color)} onClick={() => setOnlyProject((v) => !v)} aria-pressed={onlyProject}>
              <Glyph project={scope} /> {scope.name}만
            </button>
          )}
        </div>
      </div>
      <div class="modal-b scroll sessions" style="padding-top:4px">
        {list === null && <div class="none">세션을 찾는 중…</div>}
        {list && !flat.length && <div class="none">{q ? '맞는 세션이 없어요' : '찾은 세션이 없어요. Claude Code나 Codex로 한 번이라도 대화한 폴더가 있으면 여기 떠요.'}</div>}
        {live.length > 0 && <h4>지금 실행 중</h4>}
        {live.map(row)}
        {past.length > 0 && <h4>지난 대화</h4>}
        {past.map(row)}
      </div>
      <div class="modal-f">
        <small style="color:var(--faint);font-size:12px">불러온 세션은 새 worktree 없이 원래 폴더에서 이어가요. 보내는 지시마다 스냅샷을 찍어서 되돌릴 수 있어요.</small>
        <span class="sp" />
        <kbd>↵</kbd>
      </div>
    </Modal>
  );
}
