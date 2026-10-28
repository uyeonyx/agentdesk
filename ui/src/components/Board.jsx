import { useEffect, useRef, useState } from 'preact/hooks';
import { api } from '../api.js';
import { useStore, set, openModal, projectOf } from '../store.js';
import { roomVars, ago, mod, laneOf, LANES, progressOf, isBusy, ASK } from '../util.js';
import { choose, quickSend, openTask, resume, stop, setWidget, newTask, visibleTasks, archiveAsk, shelved } from '../actions.js';
import { Glyph, I, Spinner } from './bits.jsx';
import { PlanBar, SubChip, FEED_ICON } from './Progress.jsx';
import { Banner } from './Room.jsx';

const STATE = {
  needs_input: { label: '답할 것', icon: 'message-question', cls: 'needs' },
  review: { label: '검토할 것', icon: 'eye-check', cls: 'review' },
  working: { label: '작업 중', icon: null, cls: 'working' },
  starting: { label: '시작 중', icon: null, cls: 'working' },
  waiting: { label: '대기 중', icon: 'hourglass', cls: 'working' },
  exited: { label: '멈춤', icon: 'player-pause', cls: 'paused' },
  merged: { label: '머지됨', icon: 'git-merge', cls: 'done' },
  discarded: { label: '버림', icon: 'trash', cls: 'done' },
};
const PREVIEW_LINES = { s: 0, m: 7, l: 16 };

/**
 * 관제탑: every agent as a card. Answer permission prompts with a button, reply in one line,
 * watch the screen and the plan, and jump into the room when it needs more than that.
 */
export function Board() {
  const s = useStore((s) => ({ tasks: s.tasks, projects: s.projects, filter: s.filter, widgets: s.widgets, showDone: s.showDone, banner: s.banner, loaded: s.loaded }));
  const order = Object.fromEntries(LANES.map((l, i) => [l.key, i]));
  const list = visibleTasks(s)
    .filter((t) => s.showDone || !['merged', 'discarded'].includes(t.state))
    .sort((a, b) => (s.widgets[b.id]?.pinned ? 1 : 0) - (s.widgets[a.id]?.pinned ? 1 : 0) || order[laneOf(a)] - order[laneOf(b)] || b.updatedAt - a.updatedAt);
  const counts = LANES.filter((l) => l.key !== 'done')
    .map((l) => ({ ...l, n: list.filter((t) => laneOf(t) === l.key).length }))
    .filter((c) => c.key !== 'blocked' || c.n);
  const bannerTask = s.banner && s.tasks.find((t) => t.id === s.banner.taskId);
  const bannerProject = bannerTask && projectOf(s, bannerTask.projectId);

  return (
    <div class="board scroll">
      <div class="board-h">
        <h2>관제탑</h2>
        <div class="lanecount">
          {counts.map((c) => (
            <span key={c.key} class={`lc ${c.key}`}>
              {c.title} <b>{c.n}</b>
            </span>
          ))}
        </div>
        <span class="sp" />
        <label class="chk">
          <input type="checkbox" checked={s.showDone} onChange={(e) => set({ showDone: e.currentTarget.checked })} /> 끝난 것도 보기
        </label>
        <ShelfButton tasks={s.tasks} filter={s.filter} />
        <button class="btn sm" onClick={() => openModal('import', { projectId: s.filter })}>
          <I n="history" /> 세션 불러오기
        </button>
      </div>
      {s.loaded && !list.length && (
        <div class="empty" style="text-align:center">
          <h3>지켜볼 에이전트가 없어요</h3>
          <p>
            <kbd>N</kbd> 으로 새 작업을 시키거나, 다른 터미널에서 돌던 세션을 불러오세요.
          </p>
          <button class="btn" onClick={() => newTask()}>
            <I n="plus" /> 새 작업
          </button>
        </div>
      )}
      <div class="cards">
        {list.map((t) => (
          <Card key={t.id} t={t} p={projectOf(s, t.projectId)} w={s.widgets[t.id] || {}} />
        ))}
      </div>
      {s.banner && bannerProject && <Banner banner={s.banner} project={bannerProject} floating />}
    </div>
  );
}

function Card({ t, p, w }) {
  const size = w.size || (t.state === 'needs_input' || t.state === 'working' ? 'm' : 's');
  const st = t.ask && ASK[t.ask] ? { ...ASK[t.ask], cls: 'blocked' } : STATE[t.state] || STATE.exited;
  const pr = progressOf(t);
  const live = !['merged', 'discarded'].includes(t.state);
  const careful = !!p?.careful;
  const screen = useScreen(t, PREVIEW_LINES[size]);
  const menu = t.menu || screen?.menu || null;

  return (
    <article class={`card size-${size} ${st.cls} ${careful ? 'careful' : ''} ${w.pinned ? 'pinned' : ''}`} style={roomVars(p?.color)} aria-label={`${p?.name} · ${t.title}`}>
      <header class="ch" onDblClick={() => openTask(t.id)}>
        <Glyph project={p} size={30} />
        <div class="cid">
          <div class="cp">
            {p?.name}
            <I n={t.agent === 'codex' ? 'brand-openai' : 'sparkles'} class="ag" title={t.agent === 'codex' ? 'Codex' : 'Claude Code'} />
            {t.multi && <I n="stack-2" class="ag" title={`${t.repos.length}개 저장소`} />}
            {t.remote && <I n="device-mobile" class="rm" title={t.remoteUrl ? '폰과 연결됨' : '폰 연결 예약됨'} />}
            {t.watching && <span class="where">{t.watching.where}</span>}
          </div>
          <div class="ct" title={t.title}>
            {t.title}
          </div>
        </div>
        <span class={`stchip ${st.cls}`}>
          {st.icon ? <I n={st.icon} /> : <Spinner />}
          {st.label}
        </span>
      </header>

      <div class="cbody">
        {(t.state === 'working' || t.state === 'starting') && (
          <div class="cnow">
            <I n={FEED_ICON[(t.activity?.feedTail || []).slice(-1)[0]?.kind] || 'sparkles'} />
            <span>{pr.current || pr.doing?.text || '생각하는 중'}</span>
          </div>
        )}
        {t.state !== 'working' && t.state !== 'starting' && (t.reason || t.summary) && <div class="creason">{t.state === 'review' && t.summary ? t.summary : t.reason}</div>}

        {pr.total > 0 && (
          <div class="cplan">
            <PlanBar plan={pr.plan} />
            <span>
              {pr.done}/{pr.total}
              {pr.doing ? ` · ${pr.doing.text}` : ''}
            </span>
          </div>
        )}
        {pr.subs.length > 0 && (
          <div class="csubs">
            {pr.subs.slice(-(size === 'l' ? 8 : 4)).map((s) => (
              <SubChip key={s.id} s={s} />
            ))}
          </div>
        )}

        {menu && t.running && <MenuButtons t={t} menu={menu} careful={careful} />}

        {(size === 'l' || (size === 'm' && !(menu && t.running))) && (
          <pre class={`cscreen ${t.running ? '' : 'off'}`} aria-label="화면 미리보기">
            {screen?.lines?.length ? screen.lines.join('\n') : t.running ? '…' : '세션이 멈춰 있어요'}
          </pre>
        )}
      </div>

      <footer class="cf">
        {live && (t.watching ? <WatchRow t={t} p={p} careful={careful} /> : t.running ? <QuickReply t={t} p={p} careful={careful} /> : <ResumeRow t={t} />)}
        <div class="cmeta">
          {t.changes.files > 0 && (
            <span class="stat">
              {t.changes.files}개 파일 <span class="a">+{t.changes.adds}</span>
              <span class="d">−{t.changes.dels}</span>
            </span>
          )}
          <span class="sp" />
          {t.state === 'review' && !t.adopted && t.isolated && t.changes.files > 0 && (
            <button class="btn sm" onClick={() => openModal('merge', { taskId: t.id })}>
              <I n="git-merge" /> 머지
            </button>
          )}
          {t.running && isBusy(t) && (
            <button class="btn ghost sm icon" onClick={() => stop(t.id)} title="세션 중지" aria-label="세션 중지">
              <I n="player-stop" />
            </button>
          )}
          <span class="ago">{ago(t.updatedAt)}</span>
        <div class="ctools">
            <div class="sizes" role="group" aria-label="카드 크기">
              {['s', 'm', 'l'].map((k) => (
                <button key={k} class={size === k ? 'on' : ''} onClick={() => setWidget(t.id, { size: k })} aria-label={`크기 ${k.toUpperCase()}`} title={{ s: '작게', m: '보통', l: '크게' }[k]}>
                  {k.toUpperCase()}
                </button>
              ))}
            </div>
            <button class={`btn ghost sm icon ${w.pinned ? 'on' : ''}`} onClick={() => setWidget(t.id, { pinned: !w.pinned })} aria-label="고정" title={w.pinned ? '고정 풀기' : '맨 앞에 고정'}>
              <I n={w.pinned ? 'pinned' : 'pin'} />
            </button>
            <button class="btn ghost sm icon" onClick={() => archiveAsk(t.id)} aria-label="보관하기" title="보관하기 · worktree와 대화는 그대로 두고 목록에서 빼요 (E)">
              <I n="archive" />
            </button>
            <button class="btn ghost sm icon" onClick={() => openTask(t.id)} aria-label="방으로 들어가기" title="방으로 들어가기 (더블클릭)">
              <I n="arrows-maximize" />
            </button>
          </div>
        </div>
      </footer>
    </article>
  );
}

export function ShelfButton({ tasks, filter, class: cls = 'btn sm' }) {
  const n = shelved(tasks, filter).length;
  return (
    <button class={cls} onClick={() => openModal('shelf')} title="보관한 작업 · 꺼내면 같은 대화로 이어가요">
      <I n="archive" /> 보관함{n ? <b class="n">{n}</b> : null}
    </button>
  );
}

/** Permission prompts read off the agent's screen, as buttons. Careful rooms need a second press. */
function MenuButtons({ t, menu, careful }) {
  const [armed, setArmed] = useState(null);
  useEffect(() => {
    if (!armed) return;
    const x = setTimeout(() => setArmed(null), 3000);
    return () => clearTimeout(x);
  }, [armed]);
  return (
    <div class="cmenu" role="group" aria-label={menu.question || '선택'}>
      {menu.question && <div class="q">{menu.question}</div>}
      <div class="opts">
        {menu.options.map((o) => (
          <button
            key={o.key}
            title={o.desc || o.label}
            class={`opt ${o.selected ? 'sel' : ''} ${armed === o.key ? 'armed' : ''} ${/^no\b|아니|거절|cancel/i.test(o.label) ? 'no' : ''}`}
            onClick={() => {
              if (careful && armed !== o.key) return setArmed(o.key);
              setArmed(null);
              choose(t.id, o.key);
            }}
          >
            <kbd>{o.key}</kbd>
            <span class="ol">
              {armed === o.key ? '한 번 더 눌러 확정' : o.label}
              {o.desc && armed !== o.key && <small>{o.desc}</small>}
            </span>
          </button>
        ))}
      </div>
    </div>
  );
}

function QuickReply({ t, p, careful }) {
  const [v, setV] = useState('');
  const [nudge, setNudge] = useState(0);
  const [busy, setBusy] = useState(false);
  const go = async () => {
    if (!v.trim() || busy) return;
    setBusy(true);
    if (await quickSend(t.id, v.trim())) setV('');
    setBusy(false);
  };
  return (
    <div class={`qr ${careful ? 'careful' : ''}`}>
      <Glyph project={p} size={20} />
      <input
        value={v}
        placeholder={`${p?.name || ''}에게 답장…`}
        aria-label={`${p?.name || ''}에게 답장`}
        onInput={(e) => setV(e.currentTarget.value)}
        onKeyDown={(e) => {
          if (e.isComposing || e.keyCode === 229 || e.key !== 'Enter') return;
          e.preventDefault();
          if (careful && !(e.metaKey || e.ctrlKey)) return setNudge((n) => n + 1);
          go();
        }}
      />
      <span key={nudge} class={`hint ${nudge ? 'nudge' : ''}`}>{careful ? `${mod}↵` : '↵'}</span>
    </div>
  );
}

/** A session running in VS Code / a terminal: Codex takes queued messages, Claude can be taken over. */
function WatchRow({ t, p, careful }) {
  const w = t.watching;
  if (w.canSend && w.status !== 'gone') return <QuickReply t={t} p={p} careful={careful} />;
  return (
    <div class="qr off">
      <span>
        <I n="eye" /> {w.status === 'gone' ? `${w.where}에서 닫혔어요` : `${w.where}에서 실행 중 · 보기만`}
      </span>
      {w.status === 'gone' ? (
        <button class="btn primary sm" onClick={() => resume(t.id)}>
          <I n="player-play" /> 여기서 이어가기
        </button>
      ) : (
        <button class={`btn sm ${w.autoTakeover ? 'on' : ''}`} onClick={() => api('POST', `/api/tasks/${t.id}/watch`, { autoTakeover: !w.autoTakeover })} title={`${w.where}에서 닫으면 여기서 바로 이어받아요`}>
          <I n={w.autoTakeover ? 'check' : 'arrow-bar-to-down'} /> {w.autoTakeover ? '이어받기 예약됨' : '닫히면 이어받기'}
        </button>
      )}
    </div>
  );
}

function ResumeRow({ t }) {
  return (
    <div class="qr off">
      <span>{t.reason || '세션이 멈춰 있어요'}</span>
      <button class="btn primary sm" onClick={() => resume(t.id)}>
        <I n="player-play" /> 재개
      </button>
    </div>
  );
}

/** The last lines of the agent's screen, refreshed while the card is on screen. */
function useScreen(t, lines) {
  const [screen, setScreen] = useState(null);
  const alive = useRef(true);
  useEffect(() => {
    alive.current = true;
    if (!t.running || (!lines && t.state !== 'needs_input')) {
      setScreen(null);
      return;
    }
    let timer;
    const tick = async () => {
      if (!document.hidden) {
        try {
          const r = await api('GET', `/api/tasks/${t.id}/screen?lines=${lines || 6}`);
          if (alive.current) setScreen(r);
        } catch {}
      }
      if (alive.current) timer = setTimeout(tick, t.state === 'working' ? 1200 : 2500);
    };
    tick();
    return () => {
      alive.current = false;
      clearTimeout(timer);
    };
  }, [t.id, t.running, t.state, lines]);
  return screen;
}
