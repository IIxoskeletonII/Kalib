// Import a shared recipe from a link (#code) or a pasted code. Works without a profile so a
// link opened in Safari still shows the code to carry into the Home Screen app.
import { Check, ChefHat, ChevronLeft, Copy } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import { useLocation, useNavigate } from 'react-router';
import { useBack } from '@/hooks/useBack';
import { Badge, Button, Card, IconButton, ListRow, fmt } from '@/components/ui';
import { decodeShare, extractShareCode, type SharedRecipe } from '@/core/recipeShare';
import { useProfile } from '@/hooks/useData';
import { importRecipe, previewImport, type ImportPreview } from '@/services/recipes';

export default function RecipeImport() {
  const navigate = useNavigate();
  const back = useBack('/recipes');
  const location = useLocation();
  const profile = useProfile();
  const [text, setText] = useState('');
  const [code, setCode] = useState<string | undefined>(() =>
    extractShareCode(location.hash.replace(/^#/, '')),
  );
  const [loaded, setLoaded] = useState<ImportPreview | null>(null);
  const [pasteError, setPasteError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [busy, setBusy] = useState(false);

  // Decoding is derived from the code; only the async database preview touches state.
  const decoded = useMemo<{ shared: SharedRecipe } | { error: string } | null>(() => {
    if (!code) return null;
    try {
      return { shared: decodeShare(code) };
    } catch (err) {
      return { error: (err as Error).message };
    }
  }, [code]);

  useEffect(() => {
    if (!decoded || !('shared' in decoded)) return;
    let cancelled = false;
    void previewImport(decoded.shared).then((p) => {
      if (!cancelled) setLoaded(p);
    });
    return () => {
      cancelled = true;
    };
  }, [decoded]);

  const preview =
    loaded && decoded && 'shared' in decoded && loaded.shared === decoded.shared ? loaded : null;
  const error = decoded && 'error' in decoded ? decoded.error : pasteError;

  const paste = (v: string) => {
    setText(v);
    const c = extractShareCode(v);
    setCode(c);
    setPasteError(v.trim() && !c ? 'That does not look like a Kalib recipe code.' : null);
  };

  const add = async () => {
    if (!preview || busy) return;
    setBusy(true);
    try {
      const r = await importRecipe(preview.shared);
      navigate(`/recipes/${r.id}`, { replace: true });
    } finally {
      setBusy(false);
    }
  };

  const copyCode = async () => {
    if (!code) return;
    try {
      await navigator.clipboard.writeText(code);
      setCopied(true);
      setTimeout(() => setCopied(false), 1800);
    } catch {
      /* clipboard unavailable: the code is visible below */
    }
  };

  return (
    <div className="pb-32">
      <div className="flex items-center gap-1 pt-1">
        <IconButton icon={ChevronLeft} label="Back" onClick={back} />
        <div className="flex-1">
          <h1 className="text-[22px] leading-tight font-bold tracking-[-0.01em]">
            Import a recipe
          </h1>
          <p className="text-[13px] text-muted">From a link or a code someone shared.</p>
        </div>
      </div>

      {!code && (
        <textarea
          value={text}
          onChange={(e) => paste(e.target.value)}
          rows={3}
          autoFocus
          placeholder="Paste the link or the code here"
          className="mt-4 w-full resize-none rounded-[20px] bg-surface px-4 py-3 text-[15px] leading-snug outline-none placeholder:text-muted focus:ring-2 focus:ring-accent"
        />
      )}
      {error && <p className="mt-3 px-1 text-[13px] text-danger">{error}</p>}

      {preview && (
        <>
          <Card className="mt-5 px-5 py-4">
            <div className="flex items-center gap-2 text-[14px] font-semibold text-ink-2">
              <ChefHat size={16} className="text-accent" aria-hidden />
              {preview.shared.name}
            </div>
            <p className="mt-1 text-[13px] text-muted tabular">
              {preview.shared.items.length} ingredients · {preview.shared.portions} portions
              {preview.shared.yield_g ? ` · ${fmt(preview.shared.yield_g)} g cooked` : ''}
            </p>
          </Card>
          <Card className="mt-3 divide-y divide-line">
            {preview.shared.items.map((it, i) => (
              <ListRow
                key={i}
                wrapTitle
                title={it.n}
                badge={
                  preview.status[i] === 'found' ? (
                    <Badge tone="accent">in database</Badge>
                  ) : preview.status[i] === 'embedded' ? (
                    <Badge>becomes your food</Badge>
                  ) : (
                    <Badge tone="kcal">not available</Badge>
                  )
                }
                value={`${fmt(it.g)} g`}
              />
            ))}
          </Card>

          {profile === null ? (
            <Card className="mt-5 p-5">
              <p className="text-[15px] font-semibold">Open Kalib from your Home Screen</p>
              <p className="mt-1 text-[14px] leading-snug text-muted">
                Links open in Safari, which keeps its own data. Copy the code, open Kalib, go to
                Recipes → Import and paste it there.
              </p>
              <Button
                variant="primary"
                icon={copied ? Check : Copy}
                className="mt-4 w-full"
                onClick={copyCode}
              >
                {copied ? 'Copied' : 'Copy the code'}
              </Button>
              <p className="mt-3 break-all text-[11px] leading-snug text-muted">{code}</p>
            </Card>
          ) : (
            <div className="mt-5 flex gap-2">
              <Button size="lg" onClick={() => setCode(undefined)}>
                Different code
              </Button>
              <Button variant="primary" size="lg" className="flex-1" disabled={busy} onClick={add}>
                Add to my recipes
              </Button>
            </div>
          )}
        </>
      )}
    </div>
  );
}
