import { useEffect, useState } from 'preact/hooks';
import { api } from '../api.js';
import { set } from '../store.js';
import { ago, progressOf } from '../util.js';
import { I, Spinner } from './bits.jsx';

export const FEED_ICON = { cmd: 'terminal', edit: 'pencil', read: 'file-text', search: 'search', web: 'world', agent: 'users', plan: 'list-check', tool: 'tool' };
const PLAN_ICON = { done: 'circle-check', active: 'progress', pending: 'circle-dashed' };

/** Plan as a segmented bar: one segment per step, filled when done, pulsing while in progress. */
export function PlanBar({ plan, compact }) {
  if (!plan.length) return null;
  return (
    <div class={`planbar ${compact ? 'compact' : ''}`} role="img" aria-label={`할 일 ${plan.filter((p) => p.status === 'done').length}/${plan.length}`}>
      {plan.slice(0, 24).map((p) => (
        <i key={p.id} class={p.status} title={p.text} />
      ))}
    </div>
  );
}

export function SubChip({ s }) {
  return (
    <span class={`subchip ${s.status}`} title={`${s.type}${s.desc ? ' · ' + s.desc : ''}${s.last ? '\n지금: ' + s.last : ''}`}>
      {s.status === 'running' ? <Spinner /> : <I n={s.status === 'failed' ? 'alert-circle' : 'check'} />}
      <span class="nm">{s.desc || s.type}</span>
      {s.tools > 0 && <span class="n">{s.tools}</span>}
    </span>
  );
}

/**
 * What the agent is doing, in the room: the plan it keeps, each subagent it started (with
 * its own tool calls), and the main thread's recent tool calls.
 */
export function ProgressPanel({ task }) {
  const [full, setFull] = useState(null);
  const [open, setOpen] = useState({});
  const sig = `${task.id}|${task.activity?.feedTail?.map((f) => f.id + f.st).join(',')}|${task.activity?.subagents?.map((s) => s.status + s.tools).join(',')}|${task.state}`;

  useEffect(() => {
    let alive = true;
    api('GET', `/api/tasks/${task.id}/activity`)
      .then((a) => alive && setFull(a))
      .catch(() => {});
    return () => {
      alive = false;
    };
  }, [sig]);

  const pr = progressOf(task);
  const a = full || { plan: pr.plan, subagents: pr.subs, feed: task.activity?.feedTail || [] };
  const subs = [...(a.subagents || [])].reverse();
  const feed = [...(a.feed || [])].filter((f) => !f.by).reverse().slice(0, 30);
  const empty = !a.plan?.length && !subs.length && !feed.length;

  return (
    <aside class="progress scroll" aria-label="진척">
      <div class="ph">
        <b>진척</b>
        <span class="sp" />
        <button class="btn ghost sm icon" onClick={() => set({ progressOpen: false })} aria-label="진척 닫기" title="진척 닫기">
          <I n="layout-sidebar-right-collapse" />
        </button>
      </div>

      {(task.state === 'working' || task.state === 'starting') && (
        <div class="now">
          <Spinner />
          <span>{pr.current || (pr.doing ? pr.doing.text : '생각하는 중')}</span>
        </div>
      )}

      {empty && <p class="none">에이전트가 할 일을 정리하거나 도구를 쓰면 여기에 쌓여요.</p>}

      {a.plan?.length > 0 && (
        <section>
          <h4>
            할 일 <span class="n">
              {pr.done}/{pr.total}
            </span>
          </h4>
          <PlanBar plan={a.plan} />
          <ol class="plan">
            {a.plan.map((p) => (
              <li key={p.id} class={p.status}>
                <I n={PLAN_ICON[p.status] || 'circle-dashed'} />
                <span>{p.text}</span>
              </li>
            ))}
          </ol>
        </section>
      )}

      {subs.length > 0 && (
        <section>
          <h4>
            서브에이전트 <span class="n">{pr.running ? `${pr.running}개 진행 중` : `${subs.length}개`}</span>
          </h4>
          {subs.map((s) => {
            const isOpen = open[s.id] ?? s.status === 'running';
            return (
              <div key={s.id} class={`subag ${s.status}`}>
                <button class="sh" onClick={() => setOpen((o) => ({ ...o, [s.id]: !isOpen }))} aria-expanded={isOpen}>
                  {s.status === 'running' ? <Spinner /> : <I n={s.status === 'failed' ? 'alert-circle' : 'circle-check'} />}
                  <span class="sd">
                    <b>{s.desc || s.type}</b>
                    <small>
                      {s.type} · 도구 {s.tools}번 · {s.status === 'running' ? `${ago(s.startedAt)}째` : `${ago(s.endedAt || s.startedAt)} 전 끝남`}
                    </small>
                  </span>
                  <I n="chevron-down" class={isOpen ? 'up' : ''} />
                </button>
                {isOpen && (
                  <div class="sb">
                    {s.last && <div class="last">{s.status === 'running' ? '지금: ' : '마지막: '}{s.last}</div>}
                    {(s.plan || []).length > 0 && <PlanBar plan={s.plan} compact />}
                    <Feed items={[...(s.feed || [])].reverse().slice(0, 12)} />
                  </div>
                )}
              </div>
            );
          })}
        </section>
      )}

      {feed.length > 0 && (
        <section>
          <h4>도구 사용</h4>
          <Feed items={feed} />
        </section>
      )}
    </aside>
  );
}

function Feed({ items }) {
  if (!items.length) return null;
  return (
    <ul class="feed">
      {items.map((f) => (
        <li key={f.id} class={f.st}>
          <I n={FEED_ICON[f.kind] || 'tool'} />
          <span class="tx">{f.text}</span>
          <span class="st">{f.st === 'run' ? <Spinner /> : f.st === 'err' ? <I n="x" /> : ago(f.at)}</span>
        </li>
      ))}
    </ul>
  );
}
