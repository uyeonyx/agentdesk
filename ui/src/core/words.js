// One word per action, everywhere in the app. A test greps the UI for the words these replaced.
export const W = {
  resume: '재개',
  stop: '중지', // end the session (the conversation is kept)
  interrupt: '중단', // stop the current turn only
  archive: '보관',
  unarchive: '꺼내기',
  remove: '빼기', // off the list, files untouched (adopted sessions, projects)
  discard: '버리기', // worktree and branch deleted
  importSession: '세션 불러오기',
  undo: '되돌리기',
  cancel: '취소', // only to dismiss a dialog
  allow: '허락',
  deny: '거절',
  reply: '답장',
  review: '검토',
};

/** Words that used to mean the same things, banned from UI copy (see test/ui-core.test.js). */
export const BANNED = ['목록에서 치우기', '이어서 열기', '여기서 이어가기', '이미 있는 세션', '있던 세션', '이 전으로'];
