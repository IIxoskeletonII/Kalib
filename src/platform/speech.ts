// Dictation, behind an adapter like every other platform capability (CLAUDE.md layering).
//
// The Web Speech API is the one place a tracker can drop below the §8 friction budget without
// any new infrastructure: "three eggs, toast with butter and a flat white" is one sentence, and
// §9.4 already knows how to ground a sentence against the food database. Recognition runs in the
// browser's own service, so no audio reaches this app or its Worker.
//
// Support is real but uneven, and the API is still prefixed on WebKit. Everything here degrades
// to "the button is not shown", never to a broken control.

interface RecognitionAlternative {
  transcript: string;
}
interface RecognitionResult {
  readonly length: number;
  isFinal: boolean;
  [index: number]: RecognitionAlternative;
}
interface RecognitionResultList {
  readonly length: number;
  [index: number]: RecognitionResult;
}
interface RecognitionEvent {
  resultIndex: number;
  results: RecognitionResultList;
}
interface RecognitionErrorEvent {
  error: string;
}
interface SpeechRecognitionLike {
  lang: string;
  continuous: boolean;
  interimResults: boolean;
  maxAlternatives: number;
  start(): void;
  stop(): void;
  abort(): void;
  onresult: ((e: RecognitionEvent) => void) | null;
  onerror: ((e: RecognitionErrorEvent) => void) | null;
  onend: (() => void) | null;
}
type RecognitionCtor = new () => SpeechRecognitionLike;

function ctor(): RecognitionCtor | undefined {
  if (typeof window === 'undefined') return undefined;
  const w = window as unknown as {
    SpeechRecognition?: RecognitionCtor;
    webkitSpeechRecognition?: RecognitionCtor;
  };
  return w.SpeechRecognition ?? w.webkitSpeechRecognition;
}

export function speechSupported(): boolean {
  return ctor() !== undefined;
}

export interface SpeechSession {
  /** Stop listening and let the final result land. */
  stop(): void;
  /** Stop listening and discard whatever was heard. */
  cancel(): void;
}

export interface ListenOptions {
  /** Everything settled so far, plus whatever is still being said. */
  onText(text: string, final: boolean): void;
  onEnd(): void;
  onError(message: string): void;
  /** BCP-47 tag; defaults to the browser's own language. */
  lang?: string | undefined;
}

/** Plain-language reasons, since the API's error codes mean nothing to a person. */
export function speechErrorMessage(code: string): string {
  switch (code) {
    case 'not-allowed':
    case 'service-not-allowed':
      return 'Microphone access is blocked. Allow it in your browser settings.';
    case 'no-speech':
      return 'Nothing heard — try again.';
    case 'audio-capture':
      return 'No microphone found.';
    case 'network':
      return 'Dictation needs a connection.';
    case 'aborted':
      return '';
    default:
      return 'Dictation stopped unexpectedly.';
  }
}

/**
 * Start listening. Returns undefined when the browser cannot, so callers can hide the control
 * rather than offer something that will fail.
 */
export function listen(o: ListenOptions): SpeechSession | undefined {
  const Ctor = ctor();
  if (!Ctor) return undefined;
  let recognition: SpeechRecognitionLike;
  try {
    recognition = new Ctor();
  } catch {
    return undefined;
  }
  recognition.lang = o.lang ?? navigator.language ?? 'en-US';
  // Continuous dictation is unreliable across engines; one utterance at a time is predictable,
  // and a person naming a meal says it in one breath anyway.
  recognition.continuous = false;
  recognition.interimResults = true;
  recognition.maxAlternatives = 1;

  let settled = '';
  let cancelled = false;

  recognition.onresult = (e) => {
    let interim = '';
    for (let i = e.resultIndex; i < e.results.length; i++) {
      const result = e.results[i];
      const text = result?.[0]?.transcript ?? '';
      if (result?.isFinal) settled += text;
      else interim += text;
    }
    const combined = (settled + interim).trim();
    if (!cancelled) o.onText(combined, interim === '' && settled !== '');
  };
  recognition.onerror = (e) => {
    if (cancelled) return;
    const message = speechErrorMessage(e.error);
    if (message) o.onError(message);
  };
  recognition.onend = () => {
    if (!cancelled) o.onEnd();
  };

  try {
    recognition.start();
  } catch {
    return undefined;
  }

  return {
    stop: () => recognition.stop(),
    cancel: () => {
      cancelled = true;
      recognition.abort();
    },
  };
}
