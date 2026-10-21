// SPEC §20.16 — where the agreement to injury help can be seen and taken back.
import { useNavigate } from 'react-router';
import { toast } from '@/components/Toast';
import { Button, Card, SectionHeading } from '@/components/ui';
import { useInjuryConsent } from '@/hooks/useInjury';
import { giveInjuryConsent, withdrawInjuryConsent } from '@/services/injuryConsent';

export function InjuryConsentCard() {
  const consent = useInjuryConsent();
  const navigate = useNavigate();
  if (consent === undefined) return null;

  return (
    <section aria-label="Injury help">
      <SectionHeading trailing={consent ? 'agreed' : 'off'}>Injury help</SectionHeading>
      <Card className="space-y-3 p-5">
        <p className="text-[14px] leading-snug text-muted">
          {consent
            ? `You agreed on ${new Date(consent.at).toLocaleDateString(undefined, { day: 'numeric', month: 'long', year: 'numeric' })}. What you describe about an ache, and the names of the exercises you ask about, go to an AI model to suggest training changes. Nothing is kept.`
            : 'Off. Kalib asks before anything about an injury leaves your phone.'}
        </p>
        <div className="flex gap-2">
          <Button className="flex-1" onClick={() => navigate('/train/injury')}>
            Something hurts?
          </Button>
          {consent && (
            <Button
              variant="danger"
              onClick={async () => {
                const was = consent;
                await withdrawInjuryConsent();
                toast('Injury help is off', {
                  label: 'Undo',
                  run: () => giveInjuryConsent(new Date(was.at)),
                });
              }}
            >
              Withdraw
            </Button>
          )}
        </div>
      </Card>
    </section>
  );
}
