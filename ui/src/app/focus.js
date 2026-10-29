// Where "start typing" goes: the composer of the open task registers itself here.
let composer = null;
export function setComposer(el) {
  composer = el;
}
export function focusComposer() {
  if (composer?.isConnected) {
    composer.focus();
    return true;
  }
  return false;
}
