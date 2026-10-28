// Monaco is big; load it only when a diff or file view first opens.
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
      m.editor.defineTheme('desk', {
        base: 'vs-dark',
        inherit: true,
        rules: [{ token: 'comment', foreground: '7a8190', fontStyle: 'italic' }],
        colors: {
          'editor.background': '#1a1c21',
          'editor.lineHighlightBackground': '#22252b',
          'editorLineNumber.foreground': '#4d535e',
          'editorLineNumber.activeForeground': '#a3a9b4',
          'editorGutter.background': '#1a1c21',
          'editorIndentGuide.background1': '#262a31',
          'diffEditor.insertedTextBackground': '#4cc38a24',
          'diffEditor.removedTextBackground': '#f2706b22',
          'diffEditor.insertedLineBackground': '#4cc38a14',
          'diffEditor.removedLineBackground': '#f2706b12',
          'diffEditorGutter.insertedLineBackground': '#4cc38a22',
          'diffEditorGutter.removedLineBackground': '#f2706b20',
          'scrollbarSlider.background': '#3b404a80',
          'editorWidget.background': '#272a31',
          'editorOverviewRuler.border': '#00000000',
        },
      });
      return m;
    });
  }
  return ready;
}

export const editorOptions = {
  theme: 'desk',
  readOnly: true,
  fontFamily: "'SF Mono', ui-monospace, Menlo, 'JetBrains Mono', D2Coding, 'Sarasa Mono K', 'Noto Sans Mono CJK KR', monospace",
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
