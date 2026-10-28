import { focusTerminal } from './components/Terminal.jsx';
import { focusComposer } from './components/Composer.jsx';

/** Phones get the composer; everything wider types straight into the agent's terminal. */
export const narrow = () => window.matchMedia('(max-width: 860px)').matches;
export function focusInput() {
  (narrow() ? focusComposer : focusTerminal)();
}
