import { useEffect, useRef, useState } from 'preact/hooks';
import { useStore } from '../store.js';
import { pasteAttachments, removeComment, removeRef, setRemote } from '../actions.js';
import { mod, undoKey } from '../util.js';
import { focusTerminal } from './Terminal.jsx';
import { runInShell } from './Shell.jsx';
import { Glyph, I } from './bits.jsx';

/**
 * The strip under the terminal: whose room you're typing into, how Enter behaves here,
 * the tray of review comments / file refs waiting to go in, and the phone link.
 */
export function TermBar({ task, project }) {
  const comments = useStore((s) => s.comments[task.id] || []);
  const refs = useStore((s) => s.refs[task.id] || []);
  const nudge = useStore((s) => s.nudge);
  const agents = useStore((s) => s.agents);
  const careful = !!project.careful;
  const [shake, setShake] = useState(0);
  const first = useRef(nudge);
  useEffect(() => {
    if (nudge !== first.current) setShake((n) => n + 1);
  }, [nudge]);

  const tray = comments.length + refs.length;
  const canRemote = !!agents[task.agent]?.remote;

  return (
    <div class={`termbar ${careful ? 'careful' : ''}`}>
      <div class="who">
        <Glyph project={project} size={22} />
        <span>
          <b>{project.name}</b>
          <span class="dim">{task.running ? '에 입력 중' : ' · 멈춤'}</span>
        </span>
      </div>

      {tray > 0 && (
        <div class="tray" aria-label="보낼 코멘트와 참고 위치">
          {comments.map((c) => (
            <span class="pill" key={c.id} title={c.text}>
              <I n="message-2" />
              <span class="p">
                {c.path.split('/').pop()}:{c.start}
              </span>
              <span class="x">{c.text}</span>
              <button onClick={() => removeComment(task.id, c.id)} aria-label="코멘트 빼기">
                <I n="x" />
              </button>
            </span>
          ))}
          {refs.map((r) => (
            <span class="pill" key={r.id}>
              <I n="code" />
              <span class="p">
                {r.path.split('/').pop()}:{r.start}
                {r.end !== r.start ? `–${r.end}` : ''}
              </span>
              <button onClick={() => removeRef(task.id, r.id)} aria-label="참고 위치 빼기">
                <I n="x" />
              </button>
            </span>
          ))}
          <button
            class="btn primary sm"
            disabled={!task.running}
            title="에이전트 입력창에 넣어요. 확인하고 ↵ 로 보내요."
            onClick={async () => {
              if (await pasteAttachments(task.id)) setTimeout(focusTerminal, 0);
            }}
          >
            <I n="corner-down-left" /> 입력창에 넣기 {tray}
          </button>
        </div>
      )}

      {tray === 0 && task.commands?.length > 0 && (
        <div class="cmds" aria-label="에이전트가 직접 실행하라고 한 명령어">
          {task.commands.map((c) => (
            <button key={c} class="cmdchip" onClick={() => runInShell(task.id, c)} title={`셸에 넣기 (실행은 ↵ 로 직접): ${c}`}>
              <I n="terminal-2" />
              <code>{c}</code>
            </button>
          ))}
        </div>
      )}

      <span class="sp" />

      {canRemote && <RemoteChip task={task} />}

      <span key={shake} class={`keys ${shake ? 'nudge' : ''}`}>
        {careful ? (
          <>
            <I n="shield-lock" /> 신중 모드 · <kbd>{mod}</kbd>
            <kbd>↵</kbd> 보내기
          </>
        ) : (
          <>
            <kbd>↵</kbd> 보내기 · <kbd>⇧↵</kbd> 줄바꿈
          </>
        )}{' '}
        · <kbd>{undoKey}</kbd> 방금 보낸 것 되돌리기
      </span>
    </div>
  );
}

function RemoteChip({ task }) {
  if (!task.remote) {
    return (
      <button class="btn ghost sm remote-off" onClick={() => setRemote(task.id, true)} title="Claude 앱(폰)에서 이 세션을 같이 보고 이어서 시켜요">
        <I n="device-mobile" /> 폰에서 이어하기
      </button>
    );
  }
  const linked = !!task.remoteUrl;
  return linked ? (
    <a class="remote-chip on" href={task.remoteUrl} target="_blank" rel="noopener noreferrer" title="Claude 앱 · Code 탭에 이 세션이 떠요. 폰에서 보낸 지시도 여기 기록되고 되돌릴 수 있어요.">
      <span class="dot" /> <I n="device-mobile" /> 폰 연결됨
    </a>
  ) : (
    <span class="remote-chip" title={task.running ? 'Remote Control을 켜는 중이에요' : '다음에 세션을 시작할 때 연결돼요'}>
      <I n="device-mobile" /> {task.running ? '폰 연결 중…' : '폰 연결 예약됨'}
    </span>
  );
}
