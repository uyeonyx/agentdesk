// The right side of the focus view: what's left to do, what changed, the last half hour, and the
// session's settings. Everything here is already in the task view; the file list is fetched.
import { useEffect, useState } from 'preact/hooks';
import { api } from '../../api.js';
import { setView } from '../../store.js';
import { modeOf, effortOf, modelName, ctxPct, tokens } from '../../core/session.js';
import { Strip } from '../overview/Strip.jsx';
import { I, ago, useNow } from '../../ui/bits.jsx';

export function FocusSide({ task }) {
  const now = useNow(30000);
  const plan = task.activity?.plan || [];
  const done = plan.filter((x) => x.status === 'done').length;
  const c = task.changes || {};
  const [files, setFiles] = useState([]);
  useEffect(() => {
    if (!c.files) return setFiles([]);
    let off = false;
    api('GET', `/api/tasks/${task.id}/changes`).then(
      (r) => !off && setFiles(r.files || []),
      () => {}
    );
    return () => {
      off = true;
    };
  }, [task.id, c.files, c.adds, c.dels]);
  const claude = task.agent !== 'codex';
  const pct = ctxPct(task.ctx);
  return (
    <aside class="fside" aria-label="세션 정보" data-testid="focus-side">
      {plan.length > 0 && (
        <section class="fs">
          <h3 class="lbl">
            할 일 <span class="num">{done}/{plan.length}</span>
          </h3>
          <span class="pbar wide">
            {plan.slice(0, 20).map((x, i) => (
              <i key={i} class={x.status === 'done' ? 'on' : x.status === 'active' ? 'cur' : ''} />
            ))}
          </span>
          {plan.slice(0, 20).map((x, i) => (
            <div key={i} class={`todo ${x.status}`}>
              <span class="cb">{x.status === 'done' && <I n="check" />}</span>
              <span>{x.text}</span>
            </div>
          ))}
        </section>
      )}
      <section class="fs">
        <h3 class="lbl">
          바뀐 파일{' '}
          {c.files > 0 && (
            <span class="num">
              {c.files}개 · <span class="a">+{c.adds}</span> <span class="d">−{c.dels}</span>
            </span>
          )}
        </h3>
        {c.files > 0 ? (
          files.slice(0, 12).map((f) => {
            const i = f.path.lastIndexOf('/');
            return (
              <button key={f.path} class="fs-file" onClick={() => setView(task.id, 'review')} data-tip={f.path}>
                <span class="p">
                  <bdi>
                    <span class="dir">{f.path.slice(0, i + 1)}</span>
                    {f.path.slice(i + 1)}
                  </bdi>
                </span>
                <span class="n num">
                  <span class="a">+{f.adds}</span> <span class="d">−{f.dels}</span>
                </span>
              </button>
            );
          })
        ) : (
          <span class="empty">아직 바뀐 파일이 없어요</span>
        )}
        {files.length > 12 && (
          <button class="btn sm ghost" onClick={() => setView(task.id, 'review')}>
            {files.length - 12}개 더 · 변경 보기
          </button>
        )}
      </section>
      <section class="fs">
        <h3 class="lbl">
          활동 <span>최근 30분</span>
        </h3>
        <Strip t={task} class="big" />
        <div class="axis">
          <span>30분 전</span>
          <span>지금</span>
        </div>
        <div class="legend">
          <span>
            <i class="k-read" />
            읽기·찾기
          </span>
          <span>
            <i class="k-edit" />
            수정
          </span>
          <span>
            <i class="k-cmd" />
            명령
          </span>
          <span>
            <i class="k-web" />
            웹
          </span>
          <span>
            <i class="wait" />
            나를 기다림
          </span>
        </div>
      </section>
      <section class="fs">
        <h3 class="lbl">세션</h3>
        <dl class="facts">
          {task.branch && (
            <>
              <dt>브랜치</dt>
              <dd class="mono">{task.branch}</dd>
            </>
          )}
          <dt>에이전트</dt>
          <dd>{claude ? 'Claude Code' : 'Codex'}</dd>
          {claude && task.model && (
            <>
              <dt>모델</dt>
              <dd>{modelName(task.model)}</dd>
            </>
          )}
          {claude && task.mode && (
            <>
              <dt>권한 모드</dt>
              <dd>{modeOf(task.mode).label}</dd>
            </>
          )}
          {claude && effortOf(task.effort) && (
            <>
              <dt>노력</dt>
              <dd>{effortOf(task.effort).label}</dd>
            </>
          )}
          {task.ctx && (
            <>
              <dt>문맥</dt>
              <dd class="num">
                {pct == null ? '압축함 · 다음 답에서 다시 세요' : `${tokens(task.ctx.used)} / ${tokens(task.ctx.limit)} · ${pct}%`}
              </dd>
            </>
          )}
          <dt>시작</dt>
          <dd>{ago(task.createdAt, now)} 전</dd>
        </dl>
      </section>
    </aside>
  );
}
