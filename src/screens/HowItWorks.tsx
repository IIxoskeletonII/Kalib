// The one page that explains the premise, on demand and never interrupting.
//
// Everything surprising about this app follows from a single idea — that it measures your burn
// instead of guessing it. The in-place explainers (components/Explainer.tsx) cover each surprise
// where it happens; this is the long version for someone who wants to understand the whole
// thing at once, usually a second person picking up a phone that is already set up.
//
// Prose, not cards. The house rule is that cards are for things you tap, and there is nothing
// to tap here.
import { ChevronLeft } from 'lucide-react';
import { IconButton } from '@/components/ui';
import { useBack } from '@/hooks/useBack';

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="mt-7">
      <h2 className="text-[17px] font-bold tracking-[-0.01em]">{title}</h2>
      <div className="mt-2 space-y-3 text-[15px] leading-relaxed text-ink-2">{children}</div>
    </section>
  );
}

export default function HowItWorks() {
  const back = useBack('/settings');

  return (
    <div className="pb-24">
      <div className="flex items-center gap-1 pt-1">
        <IconButton icon={ChevronLeft} label="Back" onClick={back} />
        <div className="flex-1">
          <h1 className="text-[22px] leading-tight font-bold tracking-[-0.01em]">
            How Kalib works
          </h1>
          <p className="text-[13px] text-muted">One idea, and what follows from it.</p>
        </div>
      </div>

      <Section title="It measures your burn rather than guessing it">
        <p>
          Almost every calorie app asks your age, height, weight and how active you are, then puts
          those into a formula. The answer is an average for people like you, and it can be several
          hundred calories away from the truth for any particular person.
        </p>
        <p>
          Kalib starts with that formula too, because on day one there is nothing else. But it then
          watches what actually happens: what you ate, and what the scale did. If you eat 2,500 a
          day for a few weeks and your weight holds steady, you burn about 2,500 a day. That is not
          a guess about you — it is a measurement of you.
        </p>
        <p>
          Once it has enough to go on, the measurement replaces the formula, and it keeps updating
          as you change.
        </p>
      </Section>

      <Section title="Why your target says “provisional” at first">
        <p>
          Because until there are a couple of weeks of weigh-ins and logged days, the formula is all
          there is. The app says so rather than pretending otherwise.
        </p>
        <p>
          The first ten days of any change are water and glycogen rather than fat, so they would
          make the measurement badly wrong. They never count toward it.
        </p>
      </Section>

      <Section title="Why the target moves slowly">
        <p>
          When the measurement does arrive, it is phased in by at most 150 calories a week. A target
          that lurched by 400 calories because of one heavy weekend would be unusable, and most of
          what looks like a sudden change is noise rather than signal.
        </p>
      </Section>

      <Section title="Why your weight bounces and the trend does not">
        <p>
          Day-to-day scale weight moves with salt, carbohydrate, sleep and the bathroom. None of
          that is fat. The trend line is the smoothed version — it is what the app makes decisions
          from, and it is what you should read.
        </p>
        <p>
          Weigh in daily if you can. More readings make the trend steadier, and a missed day costs
          nothing.
        </p>
      </Section>

      <Section title="Why the gym does not earn you extra calories">
        <p>This is the one that surprises people, and it follows directly from the first idea.</p>
        <p>
          Apps that guess your burn have to add your workout on top, because their guess knows
          nothing about today. Kalib measured yours from weeks that already contained your training
          — so the gym is already inside the number.
        </p>
        <p>
          Adding a workout again would count the same session twice. Instead, if you switch it on,
          the app shifts calories toward the days you train and away from the days you do not. The
          weekly total is identical; you just eat more when you are hungry.
        </p>
      </Section>

      <Section title="What the app is confident about, and what it is not">
        <p>
          A food scanned from a barcode or taken from a national food table is solid. A meal
          described in a sentence and estimated is not, and it is marked as an estimate so the
          difference stays visible.
        </p>
        <p>
          The same honesty applies to the calories a workout costs: nobody can measure that
          accurately for lifting, so it is shown as a range rather than a confident figure.
        </p>
      </Section>

      <Section title="Training">
        <p>
          Set cells are pre-filled in grey with what you did last time. Tap the tick to accept them,
          or type over them. That is the number worth beating — not a record from a year ago.
        </p>
        <p>
          An exercise sets no records the first time you do it. Otherwise everything would be a
          personal best on day one, which would make the idea worthless.
        </p>
      </Section>

      <Section title="Everything stays on your phone">
        <p>
          Your data lives on this device and works with no connection at all. Signing in adds a
          private copy so a second phone can see the same thing — nothing is shared with anyone, and
          you can export or delete all of it from Settings at any time.
        </p>
      </Section>

      <p className="mt-8 text-[13px] leading-snug text-muted">
        Not medical advice. The targets are general-population formulas until your own data replaces
        them; if you have a medical condition or take medication, have them looked at by a
        clinician.
      </p>
    </div>
  );
}
