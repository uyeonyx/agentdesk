import { useStore, set, openModal } from '../store.js';
import { roomVars, mod } from '../util.js';
import { newTask } from '../actions.js';
import { Glyph, I } from './bits.jsx';

export function Topbar() {
  const s = useStore((s) => ({ projects: s.projects, tasks: s.tasks, filter: s.filter, connected: s.connected, view: s.view }));
  const attention = (pid) => s.tasks.filter((t) => !t.archived && (!pid || t.projectId === pid) && (t.state === 'needs_input' || t.state === 'review')).length;
  const all = attention(null);
  const markColors = s.projects.slice(0, 4).map((p) => p.color);
  while (markColors.length < 4) markColors.push(['#3b404a', '#4a505c', '#2f333b', '#565d6a'][markColors.length]);

  return (
    <header class="topbar">
      <div class="mark" title="Desk">
        <span class="mark-glyph" aria-hidden="true">
          {markColors.map((c, i) => (
            <i key={i} style={{ background: c }} />
          ))}
        </span>
        <span>Desk</span>
      </div>
      <nav class="chips" aria-label="프로젝트 필터">
        <button class={`chip all ${!s.filter ? 'on' : ''}`} onClick={() => set({ filter: null })} title="모든 프로젝트 (0)">
          모두 {all > 0 && <span class="count">{all}</span>}
        </button>
        {s.projects.map((p, i) => {
          const n = attention(p.id);
          return (
            <button
              key={p.id}
              class={`chip ${s.filter === p.id ? 'on' : ''}`}
              style={roomVars(p.color)}
              onClick={() => set({ filter: s.filter === p.id ? null : p.id })}
              title={`${p.name}만 보기 (${i + 1})`}
            >
              <Glyph project={p} />
              {p.name}
              {n > 0 && <span class="count">{n}</span>}
            </button>
          );
        })}
      </nav>
      <button class="chip addp" onClick={() => openModal('add')} title="프로젝트 추가">
        <I n="plus" /> 프로젝트
      </button>
      <div class="seg viewseg" role="tablist" aria-label="화면">
        <button class={s.view !== 'board' ? 'on' : ''} onClick={() => set({ view: 'inbox' })} role="tab" aria-selected={s.view !== 'board'} title="목록과 방 (B)">
          <I n="layout-sidebar" /> <span class="lbl">목록</span>
        </button>
        <button class={s.view === 'board' ? 'on' : ''} onClick={() => set({ view: 'board' })} role="tab" aria-selected={s.view === 'board'} title="관제탑: 모든 에이전트를 카드로 (B)">
          <I n="layout-dashboard" /> <span class="lbl">관제탑</span>
        </button>
      </div>
      <div class="right">
        {!s.connected && <span style="font-size:12px;color:var(--muted)">다시 연결하는 중…</span>}
        <span class={`conn ${s.connected ? '' : 'off'}`} title={s.connected ? '연결됨' : '연결 끊김'} />
        <button class="btn ghost sm kbd-hint" onClick={() => openModal('palette')} title="명령">
          <kbd>{mod}</kbd>
          <kbd>K</kbd>
        </button>
        <button class="btn ghost sm" onClick={() => openModal('import', { projectId: s.filter })} title="다른 터미널이나 지난 대화의 세션을 불러와요">
          <I n="history" /> 불러오기
        </button>
        <button class="btn sm" onClick={() => newTask()} title="새 작업 (N)">
          <I n="plus" /> 새 작업 <kbd>N</kbd>
        </button>
      </div>
    </header>
  );
}
