// Recaps in one place: what each session's own Claude Code wrote about where it stands. Opens by
// itself when I come back to the window after a while and new ones came in meanwhile.
import { useEffect } from 'preact/hooks';
import { useStore, set, get, projectOf } from '../../store.js';
import { isLive, isBlocked, compareTasks } from '../../core/status.js';
import { openTask } from '../../actions.js';
import { StateChip } from '../overview/Overview.jsx';
import { Glyph, I, ago } from '../../ui/bits.jsx';

const AWAY_MS = 2 * 60_000;

/** Remember when the window was left; on return, show what came in since, if anything did. */
export function useAway() {
  useEffect(() => {
    const leave = () => !get().awayAt && set({ awayAt: Date.now() });
    const back = () => {
      const s = get();
      const at = s.awayAt;
      if (!at) return;
      set({ awayAt: 0 });
      if (Date.now() - at < AWAY_MS || s.board) return;
      if (s.tasks.some((t) => !t.archived && t.recap?.at > at)) set({ board: 'away', boardSince: at });
    };
    const vis = () => (document.hidden ? leave() : back());
    window.addEventListener('blur', leave);
    window.addEventListener('focus', back);
    document.addEventListener('visibilitychange', vis);
    return () => {
      window.removeEventListener('blur', leave);
      window.removeEventListener('focus', back);
      document.removeEventListener('visibilitychange', vis);
    };
  }, []);
}

export function Board() {
  const s = useStore((s) => ({ board: s.board, since: s.boardSince, tasks: s.tasks, projects: s.projects }));
  useEffect(() => {
    if (!s.board) return;
    const key = (e) => {
      if (e.key === 'Escape' || (e.key === 'Enter' && !e.target.closest?.('button'))) {
        e.preventDefault();
        e.stopPropagation();
        set({ board: null });
      }
    };
    window.addEventListener('keydown', key, true);
    return () => window.removeEventListener('keydown', key, true);
  }, [!!s.board]);
  if (!s.board) return null;
  const away = s.board === 'away';
  const list = s.tasks
    .filter((t) => !t.archived && isLive(t) && t.recap?.text && (!away || t.recap.at > s.since || isBlocked(t)))
    .sort(compareTasks);
  const close = () => set({ board: null });
  return (
    <div class="board" onMouseDown={(e) => e.target === e.currentTarget && close()} data-testid="board">
      <div class="board-w glass-3" role="dialog" aria-label="세션 요약">
        <header class="bd-h">
          <div>
            <h3>{away ? `자리 비운 ${ago(s.since)} 동안` : '세션 요약'}</h3>
            <p>Claude Code가 세션마다 남긴 요약(recap)을 그대로 모았어요. 나를 기다리는 것부터 보여 줘요.</p>
          </div>
          <button class="ibtn" onClick={close} aria-label="닫기">
            <I n="x" />
          </button>
        </header>
        <div class="bd-b">
          {list.map((t) => {
            const p = projectOf(s, t.projectId);
            const c = t.changes || {};
            return (
              <div key={t.id} class={`bc ${isBlocked(t) ? 'b' : ''}`}>
                <div class="bc-h">
                  <Glyph project={p} size={28} task={t} />
                  <div class="tt">
                    <b>{t.title}</b>
                    <span>
                      {p?.name} · {t.agent === 'codex' ? 'Codex' : 'Claude Code'}
                    </span>
                  </div>
                  <StateChip t={t} />
                </div>
                <p>{t.recap.text}</p>
                <div class="bc-f">
                  <span class="num">
                    {c.files ? (
                      <>
                        파일 {c.files}개 <span class="a">+{c.adds}</span> <span class="d">−{c.dels}</span> ·{' '}
                      </>
                    ) : null}
                    요약 {ago(t.recap.at)} 전
                  </span>
                  <span class="sp" />
                  <button
                    class="btn sm"
                    onClick={() => {
                      close();
                      openTask(t.id);
                    }}
                  >
                    열기
                  </button>
                </div>
              </div>
            );
          })}
          {!list.length && <span class="empty">{away ? '그사이 새 요약이 없어요' : '아직 요약이 없어요 · Claude Code는 자리를 비웠다 돌아오면 요약을 남겨요'}</span>}
        </div>
        <footer class="bd-f">
          <span class="hint">요약은 Claude Code가 직접 써요. 끄려면 Claude Code의 /config에서 recap을 꺼요.</span>
          <span class="sp" />
          <button class="btn primary" onClick={close}>
            모두 확인 <kbd>↵</kbd>
          </button>
        </footer>
      </div>
    </div>
  );
}
