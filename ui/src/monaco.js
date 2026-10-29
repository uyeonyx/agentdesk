// Monaco is big; load it only when a diff or file view first opens.
import { monacoTheme, onTheme } from './app/theme.js';
let ready;

export function loadMonaco() {
  if (!ready) {
    self.MonacoEnvironment = { getWorker: () => new Worker('/assets/editor.worker.js') };
    ready = Promise.all([import('monaco-editor/editor/editor.main.js'), import('monaco-editor/languages/definitions/register.all.js')]).then(([m]) => {
      // We only show code, so switch off the language services (they'd need their own big workers).
      const quiet = (d) => {
        try {
          d?.setModeConfiguration({});
          d?.setDiagnosticsOptions?.({ noSemanticValidation: true, noSyntaxValidation: true, noSuggestionDiagnostics: true, validate: false });
        } catch {}
      };
      quiet(m.typescript?.typescriptDefaults);
      quiet(m.typescript?.javascriptDefaults);
      quiet(m.json?.jsonDefaults);
      for (const k of ['cssDefaults', 'scssDefaults', 'lessDefaults']) quiet(m.css?.[k]);
      for (const k of ['htmlDefaults', 'handlebarDefaults', 'razorDefaults']) quiet(m.html?.[k]);
      // Colors come from the theme engine, and follow it when the theme changes.
      m.editor.defineTheme('desk', monacoTheme() || { base: 'vs-dark', inherit: true, rules: [], colors: {} });
      onTheme(() => {
        m.editor.defineTheme('desk', monacoTheme());
        m.editor.setTheme('desk');
      });
      return m;
    });
  }
  return ready;
}

export const editorOptions = {
  theme: 'desk',
  readOnly: true,
  fontFamily: "ui-monospace, 'SF Mono', 'Cascadia Mono', Menlo, Consolas, 'Desk Mono', monospace",
  fontSize: 13,
  lineHeight: 20,
  minimap: { enabled: false },
  scrollBeyondLastLine: false,
  renderLineHighlight: 'line',
  automaticLayout: true,
  glyphMargin: true,
  folding: false,
  padding: { top: 8 },
  smoothScrolling: true,
  stickyScroll: { enabled: false },
  scrollbar: { verticalScrollbarSize: 10, horizontalScrollbarSize: 10 },
  domReadOnly: false,
  contextmenu: false,
};
