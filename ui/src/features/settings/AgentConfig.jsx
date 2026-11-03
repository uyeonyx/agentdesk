// Claude Code's own settings, changed from here: MCP servers and permission rules. Every change is
// written where Claude Code keeps it (claude mcp add/remove, settings.json), never in Desk's config.
import { useEffect, useState } from 'preact/hooks';
import { api } from '../../api.js';
import { useStore, toast } from '../../store.js';
import { I, ago } from '../../ui/bits.jsx';
import { UsageRows, refreshUsage } from '../usage/Usage.jsx';

const SCOPE_LABEL = { user: '사용자 전체', project: '이 프로젝트 · 함께 쓰는 사람도', local: '이 프로젝트 · 나만' };
const SCOPE_FILE = { user: '~/.claude.json', project: '.mcp.json', local: '~/.claude.json (이 폴더만)' };

/** Which folder the settings are read for: user-wide only, or one project's. */
function ScopePick({ value, onChange }) {
  const projects = useStore((s) => s.projects.filter((p) => p.kind !== 'group' && p.path));
  return (
    <label class="ac-scope">
      <span>보는 곳</span>
      <span class="sel">
        <select class="field" value={value} onChange={(e) => onChange(e.currentTarget.value)} data-testid="ac-scope">
          <option value="">사용자 전체</option>
          {projects.map((p) => (
            <option key={p.id} value={p.id}>
              {p.name}
            </option>
          ))}
        </select>
        <I n="chevron-down" />
      </span>
    </label>
  );
}

const q = (project) => (project ? `?project=${encodeURIComponent(project)}` : '');

// ------------------------------------------------------------ MCP

export function McpTab() {
  const [project, setProject] = useState('');
  const [servers, setServers] = useState(null);
  const [check, setCheck] = useState(null);
  const [checking, setChecking] = useState(false);
  const [adding, setAdding] = useState(false);
  const load = () => api('GET', `/api/agentconfig/mcp${q(project)}`).then((r) => setServers(r.servers), (e) => toast(e.message, { kind: 'err' }));
  useEffect(() => {
    setServers(null);
    setCheck(null);
    load();
  }, [project]);
  const runCheck = async () => {
    setChecking(true);
    try {
      setCheck(await api('POST', '/api/agentconfig/mcp/check', { projectId: project || undefined }));
    } catch (e) {
      toast(e.message, { kind: 'err' });
    }
    setChecking(false);
  };
  const remove = async (s) => {
    try {
      const r = await api('POST', '/api/agentconfig/mcp', { op: 'remove', name: s.name, scope: s.scope, projectId: project || undefined });
      setServers(r.servers);
      toast(`${s.name}을(를) 뺐어요`);
    } catch (e) {
      toast(e.message, { kind: 'err' });
    }
  };
  const statusOf = (name) => check?.servers.find((x) => x.name === name);
  // claude.ai connectors and plugins only appear in the health check.
  const extra = (check?.servers || []).filter((x) => x.source && !(servers || []).some((s) => s.name === x.name));
  return (
    <>
      <section class="st-sec">
        <div class="ac-h">
          <p class="st-desc">에이전트가 쓰는 도구 서버예요. Claude Code의 설정에 그대로 저장돼요(claude mcp add·remove).</p>
          <span class="sp" />
          <button class="btn sm" onClick={runCheck} disabled={checking} data-tip="Claude Code가 서버를 하나씩 켜 보느라 30초쯤 걸릴 수 있어요" data-testid="mcp-check">
            {checking ? <span class="spin" /> : <I n="plug-connected" />} {checking ? '확인하는 중…' : '연결 확인'}
          </button>
          <button class="btn sm primary" onClick={() => setAdding(true)} disabled={adding} data-testid="mcp-add">
            <I n="plus" /> MCP 추가
          </button>
        </div>
        <ScopePick value={project} onChange={setProject} />
        {adding && (
          <McpForm
            project={project}
            onDone={(list) => {
              setAdding(false);
              if (list) setServers(list);
            }}
          />
        )}
        <div class="ac-list" data-testid="mcp-list">
          {servers == null && <span class="muted">읽는 중…</span>}
          {servers?.length === 0 && !extra.length && (
            <div class="ac-empty">
              <I n="plug-off" />
              <span>
                <b>{project ? '이 프로젝트에서 쓰는 MCP 서버가 없어요' : '등록된 MCP 서버가 없어요'}</b>
                <small>[MCP 추가]로 넣거나 터미널에서 claude mcp add로 넣으면 여기 보여요. claude.ai 커넥터는 [연결 확인]을 누르면 보여요.</small>
              </span>
            </div>
          )}
          {(servers || []).map((s) => (
            <McpRow key={`${s.scope}:${s.name}`} s={s} st={statusOf(s.name)} checked={!!check} onRemove={() => remove(s)} />
          ))}
          {extra.map((s) => (
            <McpRow key={`x:${s.name}`} s={{ name: s.name, target: s.target, kind: /^https?:/.test(s.target) ? 'http' : 'stdio', scope: s.source }} st={s} checked />
          ))}
        </div>
        {check && <p class="muted ac-foot">{ago(check.at)} 전에 확인했어요 · claude.ai 커넥터와 플러그인은 claude.ai·플러그인 설정에서 바꿔요</p>}
      </section>
    </>
  );
}

function McpRow({ s, st, checked, onRemove }) {
  const own = ['user', 'project', 'local'].includes(s.scope);
  const tag = own ? SCOPE_LABEL[s.scope] : s.scope === 'claude.ai' ? 'claude.ai 커넥터' : '플러그인';
  const status = !checked ? null : !st ? { cls: 'off', text: '목록에 없음' } : st.status === 'ok' ? { cls: 'ok', text: '연결됨' } : st.status === 'auth' ? { cls: 'wait', text: '인증 필요' } : { cls: 'bad', text: st.text || '연결 안 됨' };
  return (
    <div class="mcp" data-testid="mcp-row">
      <span class="ico">
        <I n={s.kind === 'stdio' ? 'terminal-2' : 'world'} />
      </span>
      <div class="mcp-m">
        <div class="nm">{s.name}</div>
        <div class="sub mono" title={s.target}>
          {s.target}
        </div>
        <div class="tags">
          <span class="tag">{tag}</span>
          {s.env?.length > 0 && <span class="tag">환경 변수 {s.env.length}개</span>}
        </div>
      </div>
      {status && (
        <span class={`stt ${status.cls}`} title={status.text}>
          <i />
          {status.text}
        </span>
      )}
      {own ? (
        <button class="btn sm ghost" onClick={onRemove} data-tip={`${SCOPE_FILE[s.scope]}에서 빼요`}>
          빼기
        </button>
      ) : (
        <span />
      )}
    </div>
  );
}

function McpForm({ project, onDone }) {
  const [f, setF] = useState({ name: '', kind: 'stdio', target: '', scope: project ? 'local' : 'user' });
  const [busy, setBusy] = useState(false);
  const put = (k) => (e) => setF({ ...f, [k]: e.currentTarget.value });
  const preview = `claude mcp add --scope ${f.scope}${f.kind === 'http' ? ' --transport http' : ''} ${f.name || '<이름>'} ${f.kind === 'http' ? f.target || '<주소>' : `-- ${f.target || '<명령>'}`}`;
  const save = async () => {
    setBusy(true);
    try {
      const r = await api('POST', '/api/agentconfig/mcp', { op: 'add', ...f, projectId: project || undefined });
      toast(`${f.name}을(를) 추가했어요 · 새로 시작하는 세션부터 써요`);
      onDone(r.servers);
    } catch (e) {
      toast(e.message, { kind: 'err' });
    }
    setBusy(false);
  };
  return (
    <div class="ac-form" data-testid="mcp-form">
      <label>이름</label>
      <input class="field" value={f.name} onInput={put('name')} placeholder="sentry" autocomplete="off" />
      <label>연결 방식</label>
      <div class="seg">
        <button aria-pressed={f.kind === 'stdio'} onClick={() => setF({ ...f, kind: 'stdio' })}>
          명령 실행
        </button>
        <button aria-pressed={f.kind === 'http'} onClick={() => setF({ ...f, kind: 'http' })}>
          주소(HTTP)
        </button>
      </div>
      <label>{f.kind === 'http' ? '주소' : '명령'}</label>
      <input class="field mono" value={f.target} onInput={put('target')} placeholder={f.kind === 'http' ? 'https://mcp.example.com/mcp' : 'npx -y @sentry/mcp-server@latest'} autocomplete="off" />
      <label>범위</label>
      <span class="sel">
        <select class="field" value={f.scope} onChange={put('scope')}>
          <option value="user">사용자 전체</option>
          {project && <option value="project">이 프로젝트 · 함께 쓰는 사람도 (.mcp.json)</option>}
          {project && <option value="local">이 프로젝트 · 나만</option>}
        </select>
        <I n="chevron-down" />
      </span>
      <pre class="ac-pre">{preview}</pre>
      <div class="ac-act">
        <button class="btn sm ghost" onClick={() => onDone(null)} disabled={busy}>
          취소
        </button>
        <button class="btn sm primary" onClick={save} disabled={busy || !f.name.trim() || !f.target.trim()}>
          {busy ? '추가하는 중…' : '추가'}
        </button>
      </div>
    </div>
  );
}

// ------------------------------------------------------------ permissions

const KIND = [
  ['allow', '묻지 않고 허락', 'ok'],
  ['ask', '항상 묻기', 'info'],
  ['deny', '항상 거절', 'warn'],
];
const FILE_LABEL = { user: '사용자 전체', project: '이 프로젝트 · 함께 쓰는 사람도', local: '이 프로젝트 · 나만' };

export function PermTab() {
  const [project, setProject] = useState('');
  const [data, setData] = useState(null);
  const [find, setFind] = useState('');
  const [nr, setNr] = useState({ rule: '', kind: 'allow', scope: 'user' });
  useEffect(() => {
    setData(null);
    setNr((x) => ({ ...x, scope: project ? 'local' : 'user' }));
    api('GET', `/api/agentconfig/perm${q(project)}`).then(setData, (e) => toast(e.message, { kind: 'err' }));
  }, [project]);
  const edit = async (body) => {
    try {
      setData(await api('POST', '/api/agentconfig/perm', { ...body, projectId: project || undefined }));
      return true;
    } catch (e) {
      toast(e.message, { kind: 'err' });
      return false;
    }
  };
  const needle = find.trim().toLowerCase();
  return (
    <section class="st-sec">
      <div class="ac-h">
        <p class="st-desc">에이전트가 묻지 않고 해도 되는 일과 절대 하면 안 되는 일이에요. 질문에 "다시 묻지 않기"로 답하면 여기에 쌓여요.</p>
      </div>
      <ScopePick value={project} onChange={setProject} />
      <div class="ac-add">
        <input class="field mono" value={nr.rule} onInput={(e) => setNr({ ...nr, rule: e.currentTarget.value })} placeholder="Bash(pnpm test:*) · Edit(docs/**) · WebFetch(domain:github.com)" data-testid="perm-rule" />
        <span class="sel">
          <select class="field" value={nr.kind} onChange={(e) => setNr({ ...nr, kind: e.currentTarget.value })}>
            {KIND.map(([k, l]) => (
              <option key={k} value={k}>
                {l}
              </option>
            ))}
          </select>
          <I n="chevron-down" />
        </span>
        <span class="sel">
          <select class="field" value={nr.scope} onChange={(e) => setNr({ ...nr, scope: e.currentTarget.value })}>
            <option value="user">사용자 전체</option>
            {project && <option value="project">이 프로젝트 · 함께</option>}
            {project && <option value="local">이 프로젝트 · 나만</option>}
          </select>
          <I n="chevron-down" />
        </span>
        <button class="btn sm primary" disabled={!nr.rule.trim()} onClick={async () => (await edit({ op: 'add', ...nr })) && setNr({ ...nr, rule: '' })} data-testid="perm-add">
          추가
        </button>
      </div>
      <input class="field ac-find" value={find} onInput={(e) => setFind(e.currentTarget.value)} placeholder="규칙 찾기" />
      {!data && <span class="muted">읽는 중…</span>}
      {data?.files.map((f) => (
        <div key={f.scope} class="perm-file" data-testid="perm-file">
          <h4>
            {FILE_LABEL[f.scope]} <span class="mono">{f.path.replace(/^\/Users\/[^/]+/, '~')}</span>
            {f.defaultMode && <span class="tag">기본 모드 {f.defaultMode}</span>}
          </h4>
          {!f.exists && <p class="muted">아직 파일이 없어요 · 규칙을 추가하면 만들어요</p>}
          {KIND.map(([k, label, tone]) => {
            const rules = f[k].filter((r) => !needle || r.toLowerCase().includes(needle));
            if (!f[k].length) return null;
            return (
              <div key={k} class="perm-k">
                <div class="perm-kh">
                  <span class={`tag ${tone}`}>{label}</span>
                  <span class="muted num">{needle ? `${rules.length}/${f[k].length}` : f[k].length}개</span>
                </div>
                <div class="rules">
                  {rules.slice(0, needle ? 200 : 40).map((r) => (
                    <div key={r} class="rule">
                      <code title={r}>{r}</code>
                      <button class="btn sm ghost" onClick={() => edit({ op: 'remove', scope: f.scope, kind: k, rule: r })}>
                        지우기
                      </button>
                    </div>
                  ))}
                </div>
                {!needle && rules.length > 40 && <p class="muted">{rules.length - 40}개 더 · 찾기로 좁혀 보세요</p>}
              </div>
            );
          })}
        </div>
      ))}
    </section>
  );
}

// ------------------------------------------------------------ usage

export function UsageTab() {
  const u = useStore((s) => s.usage);
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    refreshUsage();
  }, []);
  return (
    <section class="st-sec">
      <div class="ac-h">
        <p class="st-desc">5시간·주간 사용량은 돌고 있는 세션의 상태 줄로 실시간으로 받아요. 모델별 한도와 추가 크레딧은 Claude Code의 /usage 결과를 30분마다 읽어요. 모델을 부르지 않아 사용량이 늘지 않아요.</p>
        <span class="sp" />
        <button
          class="btn sm"
          disabled={busy}
          onClick={async () => {
            setBusy(true);
            await refreshUsage(true);
            setBusy(false);
          }}
        >
          {busy ? <span class="spin" /> : <I n="refresh" />} 새로 읽기
        </button>
      </div>
      <div class="usage-big">
        <UsageRows u={u} />
      </div>
    </section>
  );
}
