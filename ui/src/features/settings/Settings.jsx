// Settings, as a screen: the screen (light, dark, system), accent and code·terminal themes, sounds
// and notifications, shortcuts, agents, projects.
import { useEffect, useMemo, useRef, useState } from 'preact/hooks';
import { api, updateAction } from '../../api.js';
import { useStore, get, set, setSettings, toast, openModal, projectOf } from '../../store.js';
import { isMac, mod } from '../../util.js';
import { detectAndImport, ACCENTS } from '../../theme/index.js';
import { themeList, chooseTheme, savePref, saveUserTheme, removeUserTheme, screenKind } from '../../app/theme.js';
import { sound } from '../../app/sounds.js';
import { KEYS, keyLabel } from '../../app/keys.js';
import { Glyph, I, roomVars } from '../../ui/bits.jsx';
import { uploadLogo, pickLogo, clearLogo } from '../../logos.js';
import { McpTab, PermTab, UsageTab } from './AgentConfig.jsx';

const TABS = [
  { key: 'theme', label: '테마', icon: 'palette' },
  { key: 'notify', label: '알림과 소리', icon: 'bell' },
  { key: 'keys', label: '단축키', icon: 'keyboard' },
  { key: 'agents', label: '에이전트', icon: 'terminal-2' },
  { key: 'mcp', label: 'MCP 서버', icon: 'plug' },
  { key: 'perm', label: '권한', icon: 'shield-check' },
  { key: 'usage', label: '사용량', icon: 'gauge' },
  { key: 'projects', label: '프로젝트', icon: 'folders' },
  { key: 'about', label: '정보', icon: 'info-circle' },
];

export function Settings() {
  const tab = useStore((s) => s.settingsTab);
  return (
    <div class="settings">
      <nav class="st-nav" aria-label="설정">
        <h1>설정</h1>
        {TABS.map((t) => (
          <button key={t.key} class={`li ${tab === t.key ? 'on' : ''}`} onClick={() => set({ settingsTab: t.key })} aria-current={tab === t.key ? 'page' : undefined}>
            <I n={t.icon} />
            <span class="m">{t.label}</span>
            <span />
          </button>
        ))}
      </nav>
      <main class="st-main scroll">
        <h2 class="st-title">{TABS.find((t) => t.key === tab)?.label}</h2>
        {tab === 'theme' && <ThemeTab />}
        {tab === 'notify' && <NotifyTab />}
        {tab === 'keys' && <KeysTab />}
        {tab === 'agents' && <AgentsTab />}
        {tab === 'mcp' && <McpTab />}
        {tab === 'perm' && <PermTab />}
        {tab === 'usage' && <UsageTab />}
        {tab === 'projects' && <ProjectsTab />}
        {tab === 'about' && <AboutTab />}
      </main>
    </div>
  );
}

function Section({ title, desc, tools, children }) {
  return (
    <section class="st-sec">
      <header class="st-sh">
        <h3>{title}</h3>
        {tools}
      </header>
      {desc && <p class="st-desc">{desc}</p>}
      <div class="card st-card">{children}</div>
    </section>
  );
}

function Seg({ value, options, onChange }) {
  return (
    <div class="seg">
      {options.map(([v, label]) => (
        <button key={v} aria-pressed={value === v} onClick={() => onChange(v)}>
          {label}
        </button>
      ))}
    </div>
  );
}

function Switch({ on, onChange, label, desc }) {
  return (
    <label class="st-row">
      <span class="st-l">
        <b>{label}</b>
        {desc && <small>{desc}</small>}
      </span>
      <button class="switch" role="switch" aria-checked={!!on} onClick={() => onChange(!on)} aria-label={label} />
    </label>
  );
}

// ------------------------------------------------------------ 테마

function ThemeTab() {
  const s = useStore((s) => ({ theme: s.theme, userThemes: s.userThemes }));
  const pref = s.theme || {};
  const now = screenKind();
  const mode = pref.mode === 'fixed' ? now : pref.mode || 'system';
  const list = useMemo(() => themeList(), [s.userThemes]);
  const kinds = now === 'light' ? ['light', 'dark'] : ['dark', 'light'];
  const accent = ACCENTS.some((a) => a.id === pref.accent) ? pref.accent : 'blue';
  return (
    <>
      <Section title="화면과 강조색" desc="앱 화면은 밝은 것과 어두운 것 두 벌이에요. 테마는 터미널·코드·바뀐 내용의 색에만 써요.">
        <div class="st-row">
          <span class="st-l">
            <b>화면</b>
            <small>시스템을 고르면 macOS·Windows 설정을 따라 바뀌어요</small>
          </span>
          <div class="seg" role="radiogroup" aria-label="화면">
            {[
              ['system', '시스템 따라'],
              ['light', '밝게'],
              ['dark', '어둡게'],
            ].map(([v, label]) => (
              <button key={v} role="radio" aria-checked={mode === v} aria-pressed={mode === v} onClick={() => savePref({ mode: v })} data-testid={`screen-${v}`}>
                {label}
              </button>
            ))}
          </div>
        </div>
        <div class="st-row">
          <span class="st-l">
            <b>강조색</b>
            <small>주 버튼, 고른 항목, 작업 중 표시에 써요</small>
          </span>
          <div class="accents" role="radiogroup" aria-label="강조색">
            {ACCENTS.map((a) => (
              <button key={a.id} class={`acc ${accent === a.id ? 'on' : ''}`} role="radio" aria-checked={accent === a.id} onClick={() => savePref({ accent: a.id })} aria-label={a.name} data-tip={a.name}>
                <span class="dot" style={{ background: now === 'light' ? a.light : a.dark }} />
              </button>
            ))}
          </div>
        </div>
      </Section>
      {kinds.map((k) => (
        <Section key={k} title={`코드·터미널 테마 · ${k === 'light' ? '밝은 화면' : '어두운 화면'}`} desc={k === now ? '지금 화면에 쓰는 테마예요.' : `${k === 'light' ? '밝은' : '어두운'} 화면으로 바꾸면 쓰는 테마예요.`}>
          <div class="gallery" data-kind={k}>
            {list
              .filter((t) => t.kind === k)
              .map((t) => (
                <ThemeCard key={t.id} t={t} on={pref[k] === t.id} onPick={() => chooseTheme(t.id)} />
              ))}
          </div>
        </Section>
      ))}
      <ImportTheme />
    </>
  );
}

/** A code·terminal theme as it will look: a few lines of a session in its own colors. */
function ThemeCard({ t, on, onPick }) {
  const c = t.preview;
  return (
    <button class={`tcard ${on ? 'on' : ''}`} onClick={onPick} aria-pressed={on} data-testid="theme-card" data-theme-id={t.id}>
      <span class="tc-code" style={{ background: c.bg, color: c.fg }} aria-hidden="true">
        <span>
          <i style={{ color: c.accent }}>$</i> pnpm test
        </span>
        <span>
          <i style={{ color: c.ok }}>✓</i> 12 passed
        </span>
        <span>
          <i style={{ color: c.danger }}>✗</i> <i style={{ color: c.warn }}>coupon</i>.test.ts
        </span>
      </span>
      <span class="tc-name">
        {t.name}
        {t.user && <small>가져옴</small>}
        {on && <I n="check" />}
      </span>
    </button>
  );
}

function ImportTheme() {
  const [drag, setDrag] = useState(false);
  const [paste, setPaste] = useState(false);
  const [text, setText] = useState('');
  const [found, setFound] = useState(null); // { theme, warnings, format }
  const fileRef = useRef();
  const read = (src, name) => {
    try {
      const r = detectAndImport(src, name);
      setFound(r);
    } catch (e) {
      toast(e.message || '테마 파일을 읽을 수 없어요', { kind: 'err' });
    }
  };
  const onFiles = async (files) => {
    const f = files?.[0];
    if (!f) return;
    if (f.size > 1_000_000) return toast('테마 파일은 1MB 이하만 가져올 수 있어요', { kind: 'err' });
    read(await f.text(), f.name);
  };
  const save = async () => {
    try {
      await saveUserTheme(found.theme);
      chooseTheme(found.theme.id);
      toast(`${found.theme.name} 테마를 가져왔어요`);
      setFound(null);
      setText('');
      setPaste(false);
    } catch (e) {
      toast(e.message, { kind: 'err' });
    }
  };
  const userThemes = useStore((s) => s.userThemes);
  const FORMAT = { vscode: 'VS Code', ghostty: 'Ghostty', iterm: 'iTerm2', wterm: 'Windows Terminal', kitty: 'kitty' };
  return (
    <Section title="테마 가져오기" desc="VS Code 테마(.json), Ghostty·kitty 색 구성, iTerm2(.itermcolors), Windows Terminal 색 구성을 가져올 수 있어요. 가져온 테마는 터미널·코드·바뀐 내용에 써요.">
      {found ? (
        <div class="imp-found">
          <span class="tc-code small" style={{ background: found.theme.base.bg, color: found.theme.base.fg }} aria-hidden="true">
            <span>
              <i style={{ color: found.theme.ansi[4] }}>$</i> pnpm test
            </span>
            <span>
              <i style={{ color: found.theme.ansi[2] }}>✓</i> 12 passed
            </span>
          </span>
          <div class="if-m">
            <b>{found.theme.name}</b>
            <small class="muted">
              {FORMAT[found.format]} · {found.theme.kind === 'dark' ? '어두운 테마' : '밝은 테마'}
            </small>
            {found.warnings.length > 0 && <small class="muted">{found.warnings.join(' · ')}</small>}
          </div>
          <button class="btn ghost" onClick={() => setFound(null)}>
            취소
          </button>
          <button class="btn primary" onClick={save}>
            가져와서 쓰기
          </button>
        </div>
      ) : (
        <div
          class={`drop ${drag ? 'on' : ''}`}
          onDragOver={(e) => (e.preventDefault(), setDrag(true))}
          onDragLeave={() => setDrag(false)}
          onDrop={(e) => {
            e.preventDefault();
            setDrag(false);
            onFiles(e.dataTransfer?.files);
          }}
        >
          <I n="file-import" />
          <span>테마 파일을 여기로 끌어다 놓거나</span>
          <button class="btn sm" onClick={() => fileRef.current?.click()}>
            파일 고르기
          </button>
          <button class="btn sm ghost" onClick={() => setPaste(!paste)}>
            내용 붙여넣기
          </button>
          <input ref={fileRef} type="file" hidden accept=".json,.jsonc,.itermcolors,.conf,.txt,*" onChange={(e) => onFiles(e.currentTarget.files)} />
        </div>
      )}
      {paste && !found && (
        <div class="imp-paste">
          <textarea class="field mono" rows={6} placeholder="테마 파일 내용을 붙여넣어 주세요" value={text} onInput={(e) => setText(e.currentTarget.value)} />
          <div class="row-end">
            <button class="btn sm primary" disabled={!text.trim()} onClick={() => read(text, '')}>
              읽기
            </button>
          </div>
        </div>
      )}
      {userThemes.length > 0 && (
        <div class="list">
          {userThemes.map((t) => (
            <div key={t.id} class="li static">
              <I n={t.kind === 'dark' ? 'moon' : 'sun'} />
              <span class="m">{t.name}</span>
              <button class="ibtn sm" onClick={() => removeUserTheme(t.id)} data-tip="지우기" aria-label={`${t.name} 지우기`}>
                <I n="trash" />
              </button>
            </div>
          ))}
        </div>
      )}
    </Section>
  );
}

// ------------------------------------------------------------ 알림과 소리

function NotifyTab() {
  const st = useStore((s) => s.settings);
  return (
    <>
      <Section title="알림" desc="창을 안 보고 있을 때 시스템 알림으로 알려요. 허락이나 선택을 기다리는 알림은 누를 때까지 남아요.">
        <Seg
          value={st.notify}
          options={[
            ['yours', '내 차례가 될 때마다'],
            ['blocked', '허락·선택이 필요할 때만'],
            ['off', '끄기'],
          ]}
          onChange={(v) => setSettings({ notify: v })}
        />
      </Section>
      <Section title="에이전트 아일랜드" desc="다른 앱을 쓰는 동안 화면 위쪽 가운데에 작은 막대로 떠서, 누가 일하는지와 나를 기다리는 일을 보여 줘요. Desk 창을 보고 있을 때는 숨어요.">
        <Switch on={st.island !== false} onChange={(v) => setSettings({ island: v })} label="아일랜드 띄우기" />
        <Switch on={st.islandAuto !== false} onChange={(v) => setSettings({ islandAuto: v })} label="허락 요청이 오면 펼쳐서 바로 답하기" />
      </Section>
      <Section title="효과음" desc="에이전트가 나를 기다릴 때, 일이 끝났을 때, 보내고 답할 때 작은 소리를 내요.">
        <Switch on={st.sounds} onChange={(v) => setSettings({ sounds: v })} label="효과음" />
        <label class="st-row">
          <span class="st-l">
            <b>크기</b>
          </span>
          <input type="range" min="0" max="1" step="0.05" value={st.volume} onInput={(e) => setSettings({ volume: Number(e.currentTarget.value) })} onChange={() => sound('arrive', { force: true })} aria-label="효과음 크기" />
        </label>
        <div class="row-gap">
          {[
            ['arrive', '기다림'],
            ['done', '끝남'],
            ['sent', '보냄'],
            ['answered', '답함'],
          ].map(([k, l]) => (
            <button key={k} class="btn sm" onClick={() => sound(k, { force: true })}>
              <I n="volume" /> {l}
            </button>
          ))}
        </div>
      </Section>
    </>
  );
}

// ------------------------------------------------------------ 단축키

function KeysTab() {
  const [rec, setRec] = useState(false);
  const [sc, setSc] = useState(null);
  useEffect(() => {
    window.desk?.shortcut?.('state').then(setSc, () => {});
  }, []);
  useEffect(() => {
    if (!rec) return;
    const onKey = (e) => {
      e.preventDefault();
      e.stopPropagation();
      if (e.key === 'Escape') return setRec(false);
      if (['Meta', 'Control', 'Alt', 'Shift'].includes(e.key)) return;
      const parts = [];
      if (e.ctrlKey) parts.push('Control');
      if (e.altKey) parts.push('Alt');
      if (e.shiftKey) parts.push('Shift');
      if (e.metaKey) parts.push(isMac ? 'Command' : 'Super');
      if (!parts.length) return;
      const k = e.code === 'Space' ? 'Space' : /^Key[A-Z]$/.test(e.code) ? e.code.slice(3) : /^Digit\d$/.test(e.code) ? e.code.slice(5) : e.key.length === 1 ? e.key.toUpperCase() : e.code;
      parts.push(k);
      setRec(false);
      window.desk?.shortcut?.('set', parts.join('+')).then((r) => {
        setSc(r);
        if (!r?.ok) toast(r?.reason || '이 단축키는 쓸 수 없어요 · 다른 앱이 쓰고 있을 수 있어요', { kind: 'err', ms: 6000 });
        else toast('바꿨어요 · 지금 한 번 눌러 보세요. 빠른 창이 안 뜨면 다른 앱이 쓰고 있는 거예요', { ms: 6000 });
      });
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, [rec]);
  const groups = [...new Set(KEYS.map((k) => k.group))];
  return (
    <>
      <Section title="빠른 창" desc="어느 앱에서든 이 단축키로 빠른 창을 띄워 기다리는 작업에 바로 답해요. 메뉴 막대 아이콘을 눌러도 돼요.">
        <div class="st-row">
          <span class="st-l">
            <b>전역 단축키</b>
            {sc && !sc.ok && <small class="warn">{sc.reason || '등록하지 못했어요 · 다른 앱이 쓰고 있을 수 있어요'}</small>}
          </span>
          <button class={`btn ${rec ? 'armed' : ''}`} onClick={() => setRec(!rec)}>
            {rec ? '누를 조합을 기다려요 · Esc 취소' : <kbd>{pretty(sc?.accel || 'Alt+Space')}</kbd>}
          </button>
          {sc?.accel !== 'Control+Alt+D' && (
            <button class="btn ghost sm" onClick={() => window.desk?.shortcut?.('set', 'Control+Alt+D').then(setSc)}>
              {isMac ? '⌃⌥D' : 'Ctrl+Alt+D'}로 바꾸기
            </button>
          )}
        </div>
      </Section>
      {groups.map((g) => (
        <Section key={g} title={g}>
          <div class="keylist">
            {KEYS.filter((k) => k.group === g && k.label).map((k) => (
              <div key={k.id} class="kl">
                <span>{k.label}</span>
                <kbd>{keyLabel(k.id)}</kbd>
              </div>
            ))}
          </div>
        </Section>
      ))}
    </>
  );
}

const pretty = (accel) => (isMac ? accel.replace(/Command\+?/g, '⌘').replace(/Control\+?/g, '⌃').replace(/Alt\+?/g, '⌥').replace(/Shift\+?/g, '⇧') : accel);

// ------------------------------------------------------------ 에이전트

function AgentsTab() {
  const s = useStore((s) => ({ agents: s.agents, prefs: s.prefs, settings: s.settings }));
  const [nq, setNq] = useState('');
  const quick = s.settings.quickReplies || [];
  return (
    <>
      <Section title="에이전트" desc="이 컴퓨터에서 찾은 CLI예요. 새 작업은 기본 에이전트로 시작하고, ⌘K에서 @로 바꿀 수 있어요.">
        {Object.entries(s.agents || {}).map(([k, a]) => (
          <label key={k} class="st-row">
            <span class="st-l">
              <b>
                <I n="terminal-2" /> {a.label}
              </b>
              <small>{a.available ? '사용할 수 있어요' : '설치되지 않았어요'}</small>
            </span>
            <button class={`btn sm ${(s.prefs.agent || 'claude') === k ? 'primary' : ''}`} disabled={!a.available} onClick={() => api('PATCH', '/api/prefs', { agent: k })}>
              {(s.prefs.agent || 'claude') === k ? '기본' : '기본으로'}
            </button>
          </label>
        ))}
      </Section>
      <Section title="빠른 답장" desc="내 차례일 때 입력창 위에 뜨는 버튼이에요. 누르면 바로 보내요.">
        <div class="chips">
          {quick.map((q) => (
            <span key={q} class="chip">
              {q}
              <button onClick={() => setSettings({ quickReplies: quick.filter((x) => x !== q) })} aria-label={`${q} 빼기`}>
                <I n="x" />
              </button>
            </span>
          ))}
        </div>
        <div class="row-gap">
          <input class="field" placeholder="새 빠른 답장" value={nq} onInput={(e) => setNq(e.currentTarget.value)} onKeyDown={(e) => e.key === 'Enter' && !e.isComposing && nq.trim() && (setSettings({ quickReplies: [...quick, nq.trim()] }), setNq(''))} style="max-width:320px" />
          <button class="btn sm" disabled={!nq.trim()} onClick={() => (setSettings({ quickReplies: [...quick, nq.trim()] }), setNq(''))}>
            추가
          </button>
        </div>
      </Section>
    </>
  );
}

// ------------------------------------------------------------ 프로젝트

function ProjectsTab() {
  const s = useStore((s) => ({ projects: s.projects, id: s.settingsProject }));
  const id = s.id && s.projects.some((p) => p.id === s.id) ? s.id : s.projects[0]?.id;
  return (
    <div class="st-projects">
      <div class="stp-list">
        {s.projects.map((p) => (
          <button key={p.id} class={`li ${p.id === id ? 'on' : ''}`} onClick={() => set({ settingsProject: p.id })}>
            <Glyph project={p} size={20} />
            <span class="m">
              {p.name}
              <small>{p.display}</small>
            </span>
            <span />
          </button>
        ))}
        <button class="li" onClick={() => openModal('addProject')}>
          <I n="plus" />
          <span class="m">프로젝트 추가</span>
          <span />
        </button>
      </div>
      {id ? <ProjectEditor key={id} id={id} /> : <div class="empty">프로젝트가 아직 없어요</div>}
    </div>
  );
}

function ProjectEditor({ id }) {
  const s = useStore((s) => ({ p: projectOf(s, id), palette: s.palette, icons: s.icons, all: s.projects }));
  const pick = (p) => ({ name: p.name, desc: p.desc || '', color: p.color, icon: p.icon, careful: !!p.careful, remote: !!p.remote, showLogo: p.showLogo !== false });
  const [d, setD] = useState(() => pick(s.p));
  const [dirty, setDirty] = useState(false);
  if (!s.p) return null;
  const up = (k, v) => {
    setD((x) => ({ ...x, [k]: v }));
    setDirty(true);
  };
  const preview = { ...s.p, ...d };
  const icons = s.icons.includes(d.icon) ? s.icons : [d.icon, ...s.icons];
  const save = async () => {
    try {
      await api('PATCH', `/api/projects/${id}`, { ...d, manual: true });
      setDirty(false);
      toast('저장했어요', { projectId: id });
    } catch (e) {
      toast(e.message, { kind: 'err' });
    }
  };
  return (
    <div class="stp-edit" style={roomVars(d.color)}>
      <div class="stp-h">
        <Glyph project={preview} size={40} />
        <div>
          <h3>{d.name || '이름'}</h3>
          <small class="muted mono">{s.p.display}</small>
        </div>
        <span class="sp" />
        <button class="btn primary" onClick={save} disabled={!dirty}>
          저장
        </button>
      </div>
      <label class="lbl">이름</label>
      <input class="field" value={d.name} onInput={(e) => up('name', e.currentTarget.value)} maxLength={60} />
      <label class="lbl">한 줄 설명 · 저장소의 README·package.json에서 자동으로 채워요</label>
      <div class="row-gap">
        <input class="field" value={d.desc} onInput={(e) => up('desc', e.currentTarget.value)} maxLength={120} />
        {s.p.kind !== 'group' && (
          <button
            class="btn"
            onClick={async () => {
              try {
                const p2 = await api('POST', `/api/projects/${id}/autofill`);
                setD((x) => ({ ...x, desc: p2.desc, icon: p2.icon, showLogo: true }));
                setDirty(true);
              } catch (e) {
                toast(e.message, { kind: 'err' });
              }
            }}
          >
            <I n="wand" /> 다시 채우기
          </button>
        )}
      </div>
      <label class="lbl">색</label>
      <div class="swatches">
        {s.palette.map((c) => (
          <button key={c} class={`sw ${d.color === c ? 'on' : ''}`} style={{ background: c }} onClick={() => up('color', c)} aria-label={c} />
        ))}
      </div>
      <label class="lbl">로고</label>
      <LogoPicker p={preview} />
      {s.p.logo && !s.p.customLogo && <Switch on={d.showLogo} onChange={(v) => up('showLogo', v)} label="저장소의 로고 쓰기" desc={`${s.p.logo}를 프로젝트 표시로 써요. 끄면 아이콘을 써요`} />}
      <label class="lbl">아이콘 · 로고가 없을 때 써요</label>
      <div class="icons">
        {icons.map((ic) => (
          <button key={ic} class={d.icon === ic ? 'on' : ''} onClick={() => up('icon', ic)} aria-label={ic}>
            <I n={ic} />
          </button>
        ))}
      </div>
      <Switch on={d.careful} onChange={(v) => up('careful', v)} label="신중 모드" desc={`실수하면 큰일 나는 프로젝트용. ${mod}↵로만 보내고, 허락·승인은 두 번 눌러야 해요`} />
      <Switch on={d.remote} onChange={(v) => up('remote', v)} label="폰(Claude 앱)에서도 이어하기" desc="새 Claude 작업을 Remote Control로 시작해요. 폰에서 보낸 지시도 여기 기록되고 되돌릴 수 있어요" />
      {s.p.kind === 'group' && (
        <>
          <label class="lbl">묶인 저장소</label>
          <div class="chips">
            {(s.p.members || []).map((mid) => {
              const m = s.all.find((x) => x.id === mid);
              return m ? (
                <span key={mid} class="chip">
                  <Glyph project={m} size={16} /> {m.name}
                </span>
              ) : null;
            })}
          </div>
        </>
      )}
      <div class="stp-danger">
        <button class="btn danger sm" onClick={() => openModal('removeProject', { projectId: id })}>
          <I n="logout" /> Desk에서 빼기
        </button>
        <small class="muted">폴더와 파일은 그대로 남아요</small>
      </div>
    </div>
  );
}

/** The project's logo: pick or drop an image; it shows everywhere the project does. */
function LogoPicker({ p }) {
  const [over, setOver] = useState(false);
  const done = () => toast('로고를 바꿨어요', { projectId: p.id });
  const fail = (e) => toast(e.message, { kind: 'err' });
  const drop = (e) => {
    e.preventDefault();
    setOver(false);
    const f = [...(e.dataTransfer?.files || [])].find((x) => x.type.startsWith('image/'));
    if (f) uploadLogo(p.id, f).then(done, fail);
    else toast('이미지 파일을 놓아 주세요', { kind: 'err' });
  };
  const source = p.customLogo ? '직접 고른 이미지' : p.logo && p.showLogo !== false && p.kind !== 'group' ? `저장소의 ${p.logo}` : '아이콘';
  return (
    <div
      class={`logo-pick ${over ? 'over' : ''}`}
      onDragOver={(e) => {
        e.preventDefault();
        setOver(true);
      }}
      onDragLeave={() => setOver(false)}
      onDrop={drop}
    >
      <Glyph project={p} size={56} />
      <span class="lp-m">
        <b>{source}</b>
        <small>이미지를 여기에 끌어다 놓거나 골라요 · PNG, JPG, WebP, SVG</small>
      </span>
      <button class="btn" onClick={() => pickLogo(p.id, { onDone: done, onError: fail })}>
        <I n="photo" /> 이미지 고르기
      </button>
      {p.customLogo && (
        <button class="btn ghost" onClick={() => clearLogo(p.id).then(() => toast('고른 로고를 지웠어요', { projectId: p.id }), fail)}>
          지우기
        </button>
      )}
    </div>
  );
}

// ------------------------------------------------------------ 정보

function AboutTab() {
  const s = useStore((s) => ({ version: s.version, update: s.update }));
  return (
    <Section title="Agent Desk" desc={`버전 ${s.version}`}>
      <div class="row-gap">
        <button class="btn" onClick={() => updateAction('check')}>
          <I n="refresh" /> 업데이트 확인
        </button>
        {s.update?.state === 'none' && <span class="muted">최신 버전이에요</span>}
      </div>
    </Section>
  );
}
