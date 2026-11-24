export interface Capabilities {
  webSerial: boolean;
  speech: boolean;
  touch: boolean;
  standalone: boolean;
}

export function detectCapabilities(): Capabilities {
  const hasNav = typeof navigator !== 'undefined';
  const hasWin = typeof window !== 'undefined';
  const match =
    hasWin && typeof window.matchMedia === 'function'
      ? (query: string) => window.matchMedia(query).matches
      : () => false;

  return {
    webSerial: hasNav && 'serial' in navigator,
    speech:
      hasWin && ('SpeechRecognition' in window || 'webkitSpeechRecognition' in window),
    touch: match('(pointer:coarse)'),
    standalone: match('(display-mode: standalone)'),
  };
}

export const caps: Capabilities = detectCapabilities();
