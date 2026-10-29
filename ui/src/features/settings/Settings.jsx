// Settings, as a screen: themes (with a gallery that previews the whole app), glass, sounds and
// notifications, shortcuts, agents, projects.
import { useEffect, useMemo, useRef, useState } from 'preact/hooks';
import { api, updateAction } from '../../api.js';
import { useStore, get, set, setSettings, toast, openModal, projectOf } from '../../store.js';
import { isMac, mod } from '../../util.js';
import { deriveTokens, detectAndImport, findTheme } from '../../theme/index.js';
import { themeList, chooseTheme, previewTheme, endPreview, savePref, saveUserTheme, removeUserTheme, currentThemeId } from '../../app/theme.js';
import { sound } from '../../app/sounds.js';
import { KEYS, keyLabel } from '../../app/keys.js';
import { Glyph, I, roomVars } from '../../ui/bits.jsx';

const TABS = [
  { key: 'theme', label: '테마', icon: 'palette' },
  { key: 'notify', label: '알림과 소리', icon: 'bell' },
  { key: 'keys', label: '단축키', icon: 'keyboard' },
  { key: 'agents', label: '에이전트', icon: 'terminal-2' },
  { key: 'projects', label: '프로젝트', icon: 'folders' },
  { key: 'about', label: '정보', icon: 'info-circle' },
];

export function Settings() {
  const tab = useStore((s) => s.settingsTab);
  return (
    <div class="settings">
      <nav class="st-nav glass" aria-label="설정">
        <h2>설정</h2>
        {TABS.map((t) => (
          <button key={t.key} class={`li ${tab === t.key ? 'on' : ''}`} onClick={() => set({ settingsTab: t.key })} aria-current={tab === t.key ? 'page' : undefined}>
            <I n={t.icon} />
            <span class="m">{t.label}</span>
            <span />
          </button>
        ))}
      </nav>
      <main class="st-main scroll">
        {tab === 'theme' && <ThemeTab />}
        {tab === 'notify' && <NotifyTab />}
        {tab === 'keys' && <KeysTab />}
        {tab === 'agents' && <AgentsTab />}
        {tab === 'projects' && <ProjectsTab />}
        {tab === 'about' && <AboutTab />}
      </main>
    </div>
  );
}

function Section({ title, desc, children }) {
  return (
    <section class="st-sec">
      <h3>{title}</h3>
      {desc && <p class="muted">{desc}</p>}
      {children}
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
  const [q, setQ] = useState('');
  const [kind, setKind] = useState('all');
  const list = useMemo(() => themeList(), [s.userThemes]);
  const shown = list.filter((t) => (kind === 'all' || t.kind === kind) && (!q || t.name.toLowerCase().includes(q.toLowerCase())));
  const hover = useRef();
  const enter = (id) => {
    clearTimeout(hover.current);
    hover.current = setTimeout(() => previewTheme(id), 220);
  };
  const leave = () => {
    clearTimeout(hover.current);
    hover.current = setTimeout(endPreview, 120);
  };
  useEffect(() => () => (clearTimeout(hover.current), endPreview()), []);
  const slotOf = (t) => (pref.mode === 'fixed' ? (pref.fixed === t.id ? '사용 중' : '') : pref.light === t.id ? '밝을 때' : pref.dark === t.id ? '어두울 때' : '');
  return (
    <>
      <Section title="테마" desc="시스템 설정을 따라 밝을 때와 어두울 때 테마를 따로 고르거나, 하나로 고정해요. 카드에 마우스를 올리면 앱 전체로 미리 보여요.">
        <div class="st-row">
          <Seg value={pref.mode || 'system'} options={[['system', '시스템 따름'], ['fixed', '항상 이 테마']]} onChange={(v) => savePref({ mode: v, fixed: v === 'fixed' ? currentThemeId() : pref.fixed })} />
          {pref.mode !== 'fixed' && (
            <span class="slots muted">
              밝을 때 <b>{findTheme(pref.light, s.userThemes)?.name}</b> · 어두울 때 <b>{findTheme(pref.dark, s.userThemes)?.name}</b>
            </span>
          )}
        </div>
        <div class="st-row">
          <input class="field" placeholder="테마 찾기" value={q} onInput={(e) => setQ(e.currentTarget.value)} style="max-width:260px" />
          <Seg value={kind} options={[['all', '모두'], ['dark', '어두운'], ['light', '밝은']]} onChange={setKind} />
        </div>
        <div class="gallery" onMouseLeave={leave}>
          {shown.map((t) => (
            <ThemeCard key={t.id} t={t} slot={slotOf(t)} onEnter={() => enter(t.id)} onPick={() => chooseTheme(t.id)} />
          ))}
        </div>
      </Section>
      <ImportTheme />
      <Section title="유리와 빛" desc="떠 있는 막대와 카드가 뒤를 흐리게 비춰요. 느리거나 눈이 피로하면 줄여 주세요. macOS '투명도 줄이기'를 켜면 자동으로 꺼져요.">
        <div class="st-row">
          <span class="st-l">
            <b>유리 효과</b>
          </span>
          <Seg value={pref.glass || 'rich'} options={[['rich', '풍부하게'], ['light', '가볍게'], ['off', '끄기']]} onChange={(v) => savePref({ glass: v })} />
        </div>
        {isMac && <Switch on={pref.vibrancy !== false} onChange={(v) => savePref({ vibrancy: v })} label="창 뒤 비치기" desc="바탕화면 색이 창 뒤로 은은하게 비쳐요" />}
        <Switch on={pref.ambient !== false} onChange={(v) => savePref({ ambient: v })} label="오로라 움직임" desc="배경의 빛이 아주 천천히 흘러요. 창을 안 볼 때는 멈춰요" />
      </Section>
    </>
  );
}

function ThemeCard({ t, slot, onEnter, onPick }) {
  const style = useMemo(() => cardVars(t), [t.id]);
  return (
    <button class={`tcard ${slot ? 'on' : ''}`} style={style} onMouseEnter={onEnter} onFocus={onEnter} onClick={onPick} aria-pressed={!!slot} data-testid="theme-card" data-theme-id={t.id}>
      <span class="tc-mini" aria-hidden="true">
        <span class="tc-amb" />
        <span class="tc-rail">
          <i />
          <i class="hot" />
          <i />
        </span>
        <span class="tc-main">
          <i class="u" />
          <i class="r" />
          <i class="r short" />
          <span class="tc-card">
            <i class="a" />
            <i class="b" />
          </span>
        </span>
      </span>
      <span class="tc-name">
        {t.name}
        {t.user && <small> · 가져옴</small>}
      </span>
      {slot && <span class="tc-slot">{slot}</span>}
    </button>
  );
}

// A theme card paints its mini app with its own tokens, scoped to the card.
const cardCache = new Map();
function cardVars(t) {
  if (cardCache.has(t.id)) return cardCache.get(t.id);
  const th = findTheme(t.id, get().userThemes) || null;
  let v = {};
  try {
    const d = th ? deriveTokens(th, { glass: 'rich' }).vars : null;
    if (d) v = { '--c-app': d['--bg-app'], '--c-surface': d['--bg-surface'], '--c-raised': d['--bg-raised'], '--c-line': d['--line'], '--c-text': d['--text'], '--c-text2': d['--text-3'], '--c-accent': d['--accent'], '--c-warn': d['--warn'], '--c-amb1': d['--amb-1'], '--c-amb2': d['--amb-2'], '--c-tint': d['--glass-tint'] };
    else v = { '--c-app': t.preview.bg, '--c-surface': t.preview.bg, '--c-raised': t.preview.bg, '--c-line': 'rgba(127,127,127,.2)', '--c-text': t.preview.fg, '--c-text2': t.preview.fg, '--c-accent': t.preview.accent, '--c-warn': t.preview.warn, '--c-amb1': t.preview.amb[0], '--c-amb2': t.preview.amb[1], '--c-tint': t.preview.bg };
  } catch {}
  cardCache.set(t.id, v);
  return v;
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
    <Section title="테마 가져오기" desc="VS Code 테마(.json), Ghostty·kitty 색 구성, iTerm2(.itermcolors), Windows Terminal 색 구성을 가져올 수 있어요. 터미널 색만 있는 파일도 앱 전체에 맞게 채워요.">
      {found ? (
        <div class="imp-found glass-2">
          <span class="tc-mini small" style={cardVars({ id: '__x', preview: { bg: found.theme.base.bg, fg: found.theme.base.fg, accent: found.theme.base.accent || found.theme.ansi[4], warn: found.theme.ansi[3], amb: [found.theme.ansi[5], found.theme.ansi[6]] } })} />
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
      {s.p.logo && <Switch on={d.showLogo} onChange={(v) => up('showLogo', v)} label="저장소의 로고 쓰기" desc={`${s.p.logo}를 프로젝트 표시로 써요. 끄면 아이콘을 써요`} />}
      <label class="lbl">아이콘</label>
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
