// Dictation control for any free-text field (SPEC §8 — the friction budget is the constraint).
//
// Renders nothing at all where the browser has no speech recognition, so the field it sits in
// never shows a control that cannot work.
import { Mic, Square } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { listen, speechSupported, type SpeechSession } from '@/platform/speech';
import { toast } from './Toast';

export function MicButton({
  onText,
  label = 'Dictate',
  className = '',
}: {
  /** Called as words arrive; `final` marks the end of the utterance. */
  onText: (text: string, final: boolean) => void;
  label?: string;
  className?: string;
}) {
  const [listening, setListening] = useState(false);
  const session = useRef<SpeechSession | null>(null);
  const supported = speechSupported();

  // A live microphone must not outlive the screen that opened it.
  useEffect(
    () => () => {
      session.current?.cancel();
      session.current = null;
    },
    [],
  );

  if (!supported) return null;

  const stop = () => {
    session.current?.stop();
    session.current = null;
    setListening(false);
  };

  const start = () => {
    const s = listen({
      onText,
      onEnd: () => {
        session.current = null;
        setListening(false);
      },
      onError: (message) => {
        session.current = null;
        setListening(false);
        toast(message);
      },
    });
    if (!s) {
      toast('Dictation is not available here.');
      return;
    }
    session.current = s;
    setListening(true);
  };

  return (
    <button
      type="button"
      aria-label={listening ? 'Stop dictating' : label}
      aria-pressed={listening}
      onClick={() => (listening ? stop() : start())}
      className={`flex h-11 w-11 items-center justify-center rounded-full transition-colors duration-200 ${
        listening ? 'bg-danger text-on-primary' : 'bg-surface-2 text-ink-2 active:bg-surface-3'
      } ${className}`}
    >
      {listening ? (
        <>
          <Square size={14} strokeWidth={3} aria-hidden />
          <span className="sr-only">Listening</span>
        </>
      ) : (
        <Mic size={18} strokeWidth={2.2} aria-hidden />
      )}
    </button>
  );
}
