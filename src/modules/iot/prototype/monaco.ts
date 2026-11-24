export async function mountMonacoViewer(
  container: HTMLElement,
  code: string,
  filename: string
): Promise<() => void> {
  const monaco = await import('monaco-editor/editor/editor.api');
  // Load lightweight C++ syntax highlighting only on demand
  await import('monaco-editor/languages/definitions/cpp/cpp' as string).catch(() => {});

  const isDark =
    typeof window !== 'undefined' &&
    window.matchMedia?.('(prefers-color-scheme: dark)').matches;

  const language = filename.endsWith('.json')
    ? 'json'
    : filename.endsWith('.h') ||
        filename.endsWith('.cpp') ||
        filename.endsWith('.ino') ||
        filename.endsWith('.c')
      ? 'cpp'
      : 'plaintext';

  container.innerHTML = '';
  container.style.height = '320px';
  container.style.border = '1px solid var(--bd)';
  container.style.borderRadius = '10px';
  container.style.overflow = 'hidden';

  const editor = monaco.editor.create(container, {
    value: code,
    language,
    readOnly: true,
    automaticLayout: true,
    minimap: { enabled: false },
    scrollBeyondLastLine: false,
    fontSize: 13,
    theme: isDark ? 'vs-dark' : 'vs',
  });

  return () => {
    editor.dispose();
  };
}
