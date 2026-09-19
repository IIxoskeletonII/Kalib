import { useNavigate } from 'react-router';
import { ProfileForm } from '@/components/ProfileForm';
import { todayKey } from '@/core/dates';
import { saveProfileSnapshot } from '@/db/repo/profiles';
import { upsertWeighIn } from '@/db/repo/weighIns';
import { refreshTargetForDate } from '@/services/targets';

export default function Onboarding() {
  const navigate = useNavigate();
  return (
    <div className="space-y-5 pb-8">
      <div>
        <h1 className="text-2xl font-semibold">Kalib</h1>
        <p className="mt-1 text-sm text-muted">
          These numbers seed a provisional target. After two weeks of weigh-ins and logging, your
          real maintenance calories are measured from your own data and replace them.
        </p>
      </div>
      <ProfileForm
        askWeight
        submitLabel="Start"
        onSubmit={async ({ weight_kg, ...profile }) => {
          await saveProfileSnapshot(profile);
          const today = todayKey();
          if (weight_kg != null) await upsertWeighIn(today, weight_kg);
          await refreshTargetForDate(today);
          navigate('/', { replace: true });
        }}
      />
      <p className="text-xs text-muted">
        Not medical advice. Targets are general-population formulas; review them with a clinician if
        any medical condition or medication applies.
      </p>
    </div>
  );
}
