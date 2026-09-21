// Back that behaves like a native app: pop history when there is somewhere to go, otherwise
// land on the screen this one logically belongs to — never push a fresh copy of it.
import { useNavigate } from 'react-router';

export function useBack(fallback: string): () => void {
  const navigate = useNavigate();
  return () => {
    const idx = (window.history.state as { idx?: number } | null)?.idx ?? 0;
    if (idx > 0) navigate(-1);
    else navigate(fallback, { replace: true });
  };
}
