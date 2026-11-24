export interface SpeechSession {
  stop(): void;
}

interface SpeechRecognitionInstance {
  lang: string;
  interimResults: boolean;
  continuous: boolean;
  onresult: ((event: any) => void) | null;
  onerror: ((event: any) => void) | null;
  onend: (() => void) | null;
  start(): void;
  stop(): void;
}

export function getSpeechConstructor(): (new () => SpeechRecognitionInstance) | null {
  if (typeof window === 'undefined') return null;
  const win = window as any;
  return win.SpeechRecognition || win.webkitSpeechRecognition || null;
}

export function startSpeechDictation(
  lang: string,
  callbacks: {
    onTranscript: (text: string) => void;
    onError: (message: string) => void;
    onEnd: () => void;
  }
): SpeechSession | null {
  const Ctor = getSpeechConstructor();
  if (!Ctor) return null;

  const recognition = new Ctor();
  recognition.lang = lang || 'ar-SA';
  recognition.interimResults = false;
  recognition.continuous = false;

  recognition.onresult = (event: any) => {
    const results = event?.results;
    if (!results) return;
    let transcript = '';
    for (let i = event.resultIndex || 0; i < results.length; i++) {
      const item = results[i];
      if (item?.[0]?.transcript) {
        transcript += item[0].transcript + ' ';
      }
    }
    const clean = transcript.trim();
    if (clean) callbacks.onTranscript(clean);
  };

  recognition.onerror = (event: any) => {
    const err = event?.error || '';
    if (err === 'not-allowed' || err === 'service-not-allowed') {
      callbacks.onError('الرجاء السماح بصلاحية الميكروفون للإملاء الصوتي');
    } else if (err !== 'aborted' && err !== 'no-speech') {
      callbacks.onError('تعذّر الإملاء الصوتي (' + err + ')');
    }
  };

  recognition.onend = () => {
    callbacks.onEnd();
  };

  try {
    recognition.start();
    return {
      stop: () => {
        try {
          recognition.stop();
        } catch {
          // ignore stop errors when already stopped
        }
      },
    };
  } catch {
    callbacks.onError('تعذّر بدء الإملاء الصوتي');
    return null;
  }
}
