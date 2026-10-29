// 차례로: everything waiting on me, one at a time, in the real task view. Answer with a digit,
// reply with R, skip with S; it moves on by itself after each answer.
import { useStore } from '../../store.js';
import { stepTriage, endTriage } from '../../actions.js';
import { focusComposer } from '../../app/focus.js';
import { I } from '../../ui/bits.jsx';

export function TriageBar() {
  const tr = useStore((s) => s.triage);
  if (!tr) return null;
  return (
    <div class="triagebar glass" role="toolbar" aria-label="차례로 처리" data-testid="triage">
      <span class="tr-n num">
        차례로 <b>{Math.min(tr.at + 1, tr.queue.length)}</b>/{tr.queue.length}
      </span>
      <span class="tr-bar" aria-hidden="true">
        <i style={{ width: `${(tr.at / Math.max(1, tr.queue.length)) * 100}%` }} />
      </span>
      <span class="tr-keys">
        <kbd>1</kbd>–<kbd>9</kbd> 고르기 <kbd>R</kbd> 답장 <kbd>S</kbd> 넘기기
      </span>
      <span class="sp" />
      <button class="btn sm ghost" onClick={() => stepTriage(-1, null)} disabled={tr.at === 0} aria-label="이전">
        <I n="arrow-left" />
      </button>
      <button class="btn sm ghost" onClick={() => focusComposer()}>
        답장 <kbd>R</kbd>
      </button>
      <button class="btn sm" onClick={() => stepTriage(1, 'skipped')}>
        넘기기 <kbd>S</kbd>
      </button>
      <button class="btn sm ghost" onClick={endTriage}>
        끝내기 <kbd>Esc</kbd>
      </button>
    </div>
  );
}

/** The end of a round: what was done, then back to where I was. */
export function TriageDone() {
  const tr = useStore((s) => s.triage);
  if (!tr?.done) return null;
  const t = tr.tally;
  const parts = [t.answered && `허락·선택 ${t.answered}`, t.denied && `거절 ${t.denied}`, t.replied && `답장 ${t.replied}`, t.skipped && `넘김 ${t.skipped}`].filter(Boolean);
  return (
    <div class="triage-done" role="status">
      <div class="td-card glass-2">
        <span class="td-ic">
          <I n="circle-check" />
        </span>
        <h2>다 처리했어요</h2>
        <p class="num">{parts.join(' · ') || '기다리던 작업을 모두 봤어요'}</p>
        <button class="btn primary" onClick={endTriage} autofocus>
          돌아가기 <kbd>↵</kbd>
        </button>
      </div>
    </div>
  );
}
