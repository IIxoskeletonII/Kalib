import { useNavigate } from 'react-router';
import { ProfileForm } from '@/components/ProfileForm';
import { todayKey } from '@/core/dates';
import { saveProfileSnapshot } from '@/db/repo/profiles';
import { setSetting } from '@/db/repo/settings';
import { upsertWeighIn } from '@/db/repo/weighIns';
import { refreshTargetForDate } from '@/services/targets';

export default function Onboarding() {
  const navigate = useNavigate();
  return (
    <div className="space-y-6 pb-10">
      <header className="pt-2">
        <img src="/icons/icon.svg" alt="" width={44} height={44} className="mb-5 rounded-xl" />
        <h1 className="text-[28px] font-semibold leading-tight tracking-[-0.01em]">
          Welcome to Kalib
        </h1>
        <p className="mt-2 text-[15px] leading-relaxed text-ink-2">
          These numbers seed a <span className="text-ink">provisional</span> target. After two weeks
          of weigh-ins and logging, your real maintenance calories are measured from your own data
          and replace it.
        </p>
      </header>
      <ProfileForm
        askWeight
        submitLabel="Start tracking"
        onSubmit={async ({ weight_kg, name, ...profile }) => {
          await saveProfileSnapshot(profile);
          await setSetting('name', name);
          const today = todayKey();
          if (weight_kg != null) await upsertWeighIn(today, weight_kg);
          await refreshTargetForDate(today);
          navigate('/', { replace: true });
        }}
      />
      <p className="text-[12px] leading-relaxed text-muted">
        Not medical advice. Targets are general-population formulas; review them with a clinician if
        any medical condition or medication applies.
      </p>
    </div>
  );
}
