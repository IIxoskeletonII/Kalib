// SPEC §21 — the circle: a few people you invite, ranked on showing up and on beating their own
// past.
//
// The screen says what is shared before anyone shares it, because that is the thing a person
// should know first and the thing most social features bury: a handful of numbers a week, never
// the food, the weight or the workout.
import { CalendarCheck, ChevronLeft, Crown, Flame, KeyRound, LogOut, Users } from 'lucide-react';
import { useState } from 'react';
import { useNavigate } from 'react-router';
import { Explainer } from '@/components/Explainer';
import { toast } from '@/components/Toast';
import {
  Badge,
  Button,
  Card,
  Chip,
  EmptyState,
  IconButton,
  ListRow,
  SectionHeading,
  Sheet,
  Skeleton,
} from '@/components/ui';
import { daysLeftInWeek, RATING_START, SKIPS_PER_MONTH, type BoardRow } from '@/core/circle';
import { todayKey } from '@/core/dates';
import { useBack } from '@/hooks/useBack';
import { useBoard, useCircles, useCircleSettings, useMyWeeks } from '@/hooks/useCircle';
import { useMomentum } from '@/hooks/useMomentum';
import { shareText } from '@/platform/share';
import { circle, setHardMode, type CircleSummary, type Invite } from '@/services/circle';

const INPUT =
  'h-12 w-full rounded-full bg-surface-2 px-5 text-[16px] outline-none placeholder:text-muted focus:ring-2 focus:ring-accent';

type Open =
  | { kind: 'create' }
  | { kind: 'join' }
  | { kind: 'invite'; circle: CircleSummary }
  | { kind: 'member'; circle: CircleSummary; row: BoardRow }
  | { kind: 'rename'; circle: CircleSummary }
  | { kind: 'leave'; circle: CircleSummary }
  | null;

export default function Circle() {
  const back = useBack('/train');
  const navigate = useNavigate();
  const { state, reload } = useCircles();
  const [chosen, setChosen] = useState<string | undefined>();
  const [version, setVersion] = useState(0);
  const [open, setOpen] = useState<Open>(null);

  const circles = state.kind === 'ready' ? state.circles : [];
  const current = circles.find((c) => c.id === chosen) ?? circles[0];
  const board = useBoard(current?.id, version);
  const refresh = async () => {
    await reload();
    setVersion((v) => v + 1);
  };

  return (
    <div className="pb-8">
      <header className="flex items-start gap-1 pt-1">
        <IconButton icon={ChevronLeft} label="Back" onClick={back} />
        <div className="min-w-0 flex-1 pt-1">
          <p className="text-[14px] font-medium text-muted">Training with friends</p>
          <h1 className="mt-0.5 text-[24px] leading-none font-extrabold tracking-[-0.03em]">
            Circle
          </h1>
        </div>
      </header>

      {state.kind === 'unconfigured' && (
        <EmptyState
          icon={Users}
          title="Circles need an account"
          body="This copy of Kalib has no server to share through. Everything else works without one."
        />
      )}

      {state.kind === 'signed-out' && (
        <>
          <EmptyState
            icon={Users}
            title="Sign in to start a circle"
            body="A circle shares a few numbers a week with people you invite — never your food, your weight or your workouts."
            action={
              <Button variant="primary" onClick={() => navigate('/settings')}>
                Open Settings
              </Button>
            }
          />
          <WhatIsShared />
        </>
      )}

      {state.kind === 'loading' && (
        <div className="mt-7 space-y-3" aria-busy="true">
          <Skeleton className="h-[72px] w-full rounded-[24px]" />
          <Skeleton className="h-[200px] w-full rounded-[24px]" />
        </div>
      )}

      {state.kind === 'error' && (
        <EmptyState
          icon={Users}
          title="The circle did not load"
          body={state.message}
          action={<Button onClick={() => void refresh()}>Try again</Button>}
        />
      )}

      {state.kind === 'ready' && circles.length === 0 && (
        <>
          <EmptyState
            icon={Users}
            title="No circle yet"
            body="Start one and invite people with a code, or join one with a code you were given."
          />
          <div className="flex gap-3">
            <Button
              variant="primary"
              className="flex-1"
              onClick={() => setOpen({ kind: 'create' })}
            >
              Start a circle
            </Button>
            <Button className="flex-1" onClick={() => setOpen({ kind: 'join' })}>
              Join with a code
            </Button>
          </div>
          <YourWeek />
          <WhatIsShared />
        </>
      )}

      {state.kind === 'ready' && current && (
        <>
          {circles.length > 1 && (
            <div
              className="-mx-4 mt-5 flex gap-2 overflow-x-auto px-4"
              role="group"
              aria-label="Circles"
            >
              {circles.map((c) => (
                <Chip key={c.id} active={c.id === current.id} onClick={() => setChosen(c.id)}>
                  {c.name}
                </Chip>
              ))}
            </div>
          )}

          <section className="mt-6" aria-label="Board">
            <SectionHeading
              trailing={`${current.members} ${current.members === 1 ? 'person' : 'people'}`}
            >
              {current.name}
            </SectionHeading>
            <Board
              state={board}
              circle={current}
              onRow={(row) =>
                row.is_me
                  ? setOpen({ kind: 'rename', circle: current })
                  : current.role === 'owner'
                    ? setOpen({ kind: 'member', circle: current, row })
                    : undefined
              }
            />
            <p className="mt-2 px-1 text-[13px] text-muted">
              Score over the last four weeks.{' '}
              {daysLeftInWeek(todayKey()) === 0
                ? 'This week is judged tonight.'
                : `This week is judged in ${daysLeftInWeek(todayKey())} ${
                    daysLeftInWeek(todayKey()) === 1 ? 'day' : 'days'
                  }.`}
            </p>
          </section>

          {current.role === 'owner' && current.members === 1 && (
            <Card className="mt-4 p-5">
              <p className="text-[15px] font-semibold">Just you so far</p>
              <p className="mt-1 text-[14px] text-muted">
                Make a code and send it to the people you want here. It works for a week.
              </p>
            </Card>
          )}

          <div className="mt-4 flex gap-3">
            {current.role === 'owner' && (
              <Button
                variant="primary"
                icon={KeyRound}
                className="flex-1"
                onClick={() => setOpen({ kind: 'invite', circle: current })}
              >
                Invite
              </Button>
            )}
            <Button className="flex-1" onClick={() => setOpen({ kind: 'join' })}>
              Join another
            </Button>
          </div>

          <YourWeek />

          <section className="mt-7">
            <Explainer
              id="circle-score"
              summary="Ranked on showing up and on beating your own past — never on how much you lift."
            >
              <p>
                <strong className="font-semibold text-ink-2">
                  Showing up is 60% of the score:
                </strong>{' '}
                the days you trained against your weekly aim — the same aim as your run. Going over
                scores nothing extra, and an easier week counts as kept.
              </p>
              <p>
                <strong className="font-semibold text-ink-2">Getting stronger is the rest:</strong>{' '}
                your best lifts this month against your own a month before, adjusted for bodyweight
                with DOTS, so holding strength on a cut counts as the gain it is. Holding steady
                scores 50.
              </p>
              <p>
                A jump far bigger than training usually allows is left out until a second session
                matches it. Nobody else is told.
              </p>
            </Explainer>
          </section>

          <div className="mt-6">
            <Button
              variant="danger"
              icon={LogOut}
              className="w-full"
              onClick={() => setOpen({ kind: 'leave', circle: current })}
            >
              Leave {current.name}
            </Button>
          </div>
        </>
      )}

      <Sheets
        open={open}
        setOpen={setOpen}
        onChanged={async (id) => {
          if (id) setChosen(id);
          await refresh();
        }}
      />
    </div>
  );
}

function Board({
  state,
  circle: c,
  onRow,
}: {
  state: ReturnType<typeof useBoard>;
  circle: CircleSummary;
  onRow: (row: BoardRow) => void;
}) {
  if (state.kind === 'loading') return <Skeleton className="h-[136px] w-full rounded-[24px]" />;
  if (state.kind === 'error') {
    return (
      <Card className="p-5">
        <p className="text-[14px] text-muted">{state.message}</p>
      </Card>
    );
  }
  return (
    <Card className="divide-y divide-line">
      {state.rows.map((row, i) => {
        const tappable = row.is_me || c.role === 'owner';
        return (
          <ListRow
            key={row.member_id}
            className="rise-in"
            style={{ animationDelay: `${Math.min(i, 8) * 40}ms` }}
            leading={
              <span
                className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-full text-[15px] font-bold tabular ${
                  row.rank === 1 ? 'bg-accent/15 text-accent' : 'bg-surface-2 text-ink-2'
                }`}
                aria-label={row.rank ? `Rank ${row.rank}` : 'Not ranked yet'}
              >
                {row.rank ?? '–'}
              </span>
            }
            title={row.display_name}
            badge={
              <>
                {row.is_me && <Badge tone="accent">You</Badge>}
                {row.is_owner && (
                  <span className="text-muted" aria-label="Owner">
                    <Crown size={14} aria-hidden />
                  </span>
                )}
                {row.hard && (
                  <span className="text-kcal" aria-label="Hard mode">
                    <Flame size={14} aria-hidden />
                  </span>
                )}
              </>
            }
            subtitle={
              row.weeks === 0 && row.planned === 0
                ? 'Nothing shared yet'
                : `${row.done} of ${row.planned} this week${row.rating != null ? ` · rating ${row.rating}` : ''}`
            }
            value={row.score ?? '–'}
            valueSub={row.score != null ? 'score' : 'new'}
            {...(tappable ? { onClick: () => onRow(row), chevron: true } : {})}
          />
        );
      })}
    </Card>
  );
}

/**
 * What the aim row says about where this week's number came from. The aim is the streak's
 * (§20.15), set by your training days (§20.17) — one number for the run, the circle and the
 * schedule — so it is changed where the days are chosen.
 */
function aimSource(source: 'set' | 'inferred' | 'default' | undefined): string {
  if (source === 'set') return 'Your training days';
  if (source === 'inferred') return 'Auto, from your last four weeks';
  return 'Auto, one a week for now';
}

/** Your own numbers, exactly as the circle sees them, and the two settings that shape them. */
function YourWeek() {
  const navigate = useNavigate();
  const settings = useCircleSettings();
  const weeks = useMyWeeks();
  const momentum = useMomentum();
  const now = weeks?.at(-1);
  if (!settings) return null;
  const hard = settings.hard_since != null;
  const thisWeek = momentum?.streak.this_week;
  const skips = momentum?.streak.skips.left;

  return (
    <section className="mt-7" aria-label="Your week">
      <SectionHeading
        trailing={
          now
            ? `${now.done} of ${now.planned} ${now.planned === 1 ? 'day' : 'days'} so far`
            : undefined
        }
      >
        Your week
      </SectionHeading>
      <Card className="divide-y divide-line">
        <ListRow
          icon={CalendarCheck}
          title="Days a week"
          subtitle={aimSource(thisWeek?.aim_source)}
          value={thisWeek?.aim ?? '–'}
          onClick={() => navigate('/train/schedule')}
          chevron
        />

        <button
          type="button"
          role="switch"
          aria-checked={hard}
          onClick={() => {
            void setHardMode(!hard);
            toast(
              hard
                ? 'Hard mode off — the rating is forgotten'
                : `Hard mode on — ${SKIPS_PER_MONTH} skips a month, as on your run`,
            );
          }}
          className="flex w-full items-center justify-between gap-3 px-4 py-3 text-left"
        >
          <span className="flex items-center gap-3">
            <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-kcal/15 text-kcal">
              <Flame size={18} strokeWidth={2.2} aria-hidden />
            </span>
            <span>
              <span className="block text-[16px] font-medium">Hard mode</span>
              <span className="block text-[13px] text-muted">
                {hard
                  ? `Rating ${now?.rating ?? RATING_START} · ${skips ?? SKIPS_PER_MONTH} ${
                      skips === 1 ? 'skip' : 'skips'
                    } left this month`
                  : `A rating that a missed day costs, after your ${SKIPS_PER_MONTH} skips a month`}
              </span>
            </span>
          </span>
          <Toggle on={hard} />
        </button>

        {now && (
          <div className="flex items-baseline justify-between px-4 py-3">
            <span className="text-ink-2">What the circle sees</span>
            <span className="text-right text-[14px] tabular text-muted">
              score <span className="font-semibold text-ink">{now.score}</span>
              {now.progress != null && (
                <>
                  {' '}
                  · progress <span className="font-semibold text-ink">{now.progress}</span>
                </>
              )}
            </span>
          </div>
        )}
        {now && now.flagged > 0 && (
          <p className="px-4 py-3 text-[13px] text-muted">
            {now.flagged === 1 ? 'One session best is' : `${now.flagged} session bests are`} left
            out until a second session matches — a jump that size usually takes longer than a month.
            If it was a typo, fix the set and it goes away.
          </p>
        )}
      </Card>
    </section>
  );
}

function WhatIsShared() {
  return (
    <section className="mt-7" aria-label="What is shared">
      <SectionHeading>What a circle sees</SectionHeading>
      <Card className="p-5 text-[14px] leading-relaxed text-ink-2">
        <p>
          For each week: the sessions you planned and did, three scores out of 100, how many unusual
          jumps were left out of them, and your rating if hard mode is on. And a name you choose for
          each circle.
        </p>
        <p className="mt-2 text-muted">
          Never your food, your weight, your lifts, your notes, the days you trained or your email.
          Leave your last circle and what you shared is deleted.
        </p>
      </Card>
    </section>
  );
}

function Toggle({ on }: { on: boolean }) {
  return (
    <span
      className={`relative inline-block h-7 w-12 shrink-0 rounded-full transition-colors duration-200 ${on ? 'bg-accent' : 'bg-surface-3'}`}
    >
      <span
        className={`absolute top-0.5 left-0.5 h-6 w-6 rounded-full bg-white shadow transition-transform duration-200 ease-[var(--ease-out-soft)] ${on ? 'translate-x-5' : ''}`}
      />
    </span>
  );
}

// ---- sheets ---------------------------------------------------------------------------------

function Sheets({
  open,
  setOpen,
  onChanged,
}: {
  open: Open;
  setOpen: (o: Open) => void;
  onChanged: (id?: string) => Promise<void>;
}) {
  const close = () => setOpen(null);
  return (
    <>
      <Sheet open={open?.kind === 'create'} onClose={close} title="Start a circle">
        <NamesForm
          first={{ label: 'Circle name', placeholder: 'Home, Gym, Tuesday lot…', max: 40 }}
          submit="Start circle"
          run={async (name, me) => {
            const id = await circle.create(name, me);
            await onChanged(id);
            const mine = await circle.mine();
            const made = mine.find((c) => c.id === id);
            setOpen(made ? { kind: 'invite', circle: made } : null);
          }}
        />
      </Sheet>

      <Sheet open={open?.kind === 'join'} onClose={close} title="Join a circle">
        <NamesForm
          first={{ label: 'Code', placeholder: 'ABCDE-23456', max: 11, code: true }}
          submit="Join circle"
          run={async (code, me) => {
            const id = await circle.join(code, me);
            await onChanged(id);
            close();
            toast('You’re in');
          }}
        />
      </Sheet>

      {open?.kind === 'invite' && (
        <InviteSheet key={open.circle.id} circle={open.circle} onClose={close} />
      )}

      {open?.kind === 'member' && (
        <Sheet open onClose={close} title={open.row.display_name}>
          <p className="mb-4 text-[14px] text-muted">
            Removing someone takes them off this board. If this was their only circle, what they
            shared is deleted.
          </p>
          <Busy
            variant="danger"
            label={`Remove ${open.row.display_name}`}
            run={async () => {
              await circle.remove(open.circle.id, open.row.member_id);
              await onChanged();
              close();
            }}
          />
        </Sheet>
      )}

      {open?.kind === 'rename' && (
        <Sheet open onClose={close} title="Your name here">
          <SingleNameForm
            initial={open.circle.display_name}
            run={async (name) => {
              await circle.rename(open.circle.id, name);
              await onChanged();
              close();
            }}
          />
        </Sheet>
      )}

      {open?.kind === 'leave' && (
        <Sheet open onClose={close} title={`Leave ${open.circle.name}?`}>
          <p className="mb-4 text-[14px] text-muted">
            {open.circle.role === 'owner' && open.circle.members > 1
              ? 'The person who has been in it longest becomes its owner. '
              : open.circle.members === 1
                ? 'You are its only member, so the circle goes too. '
                : ''}
            If it is your last circle, everything you shared is deleted.
          </p>
          <Busy
            variant="danger"
            label="Leave circle"
            run={async () => {
              await circle.leave(open.circle.id);
              await onChanged();
              close();
            }}
          />
        </Sheet>
      )}
    </>
  );
}

function NamesForm({
  first,
  submit,
  run,
}: {
  first: { label: string; placeholder: string; max: number; code?: boolean };
  submit: string;
  run: (first: string, me: string) => Promise<void>;
}) {
  const [a, setA] = useState('');
  const [me, setMe] = useState('');
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<string | null>(null);
  const ready = a.trim().length > 0 && me.trim().length > 0 && !busy;
  const go = async () => {
    if (!ready) return;
    setBusy(true);
    setNote(null);
    try {
      await run(a.trim(), me.trim());
    } catch (err) {
      setNote(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className="space-y-3">
      <label className="block">
        <span className="mb-1.5 block px-1 text-[13px] font-semibold text-muted">
          {first.label}
        </span>
        <input
          value={a}
          maxLength={first.max}
          placeholder={first.placeholder}
          onChange={(e) => setA(first.code ? e.target.value.toUpperCase() : e.target.value)}
          className={`${INPUT} ${first.code ? 'font-mono tracking-[0.12em]' : ''}`}
          {...(first.code
            ? { autoCapitalize: 'characters', autoComplete: 'off', spellCheck: false }
            : { autoComplete: 'off' })}
        />
      </label>
      <label className="block">
        <span className="mb-1.5 block px-1 text-[13px] font-semibold text-muted">
          Your name in it
        </span>
        <input
          value={me}
          maxLength={24}
          placeholder="First name or a nickname"
          autoComplete="nickname"
          onChange={(e) => setMe(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') void go();
          }}
          className={INPUT}
        />
      </label>
      <p className="px-1 text-[13px] text-muted">
        The people in the circle see this name, never your email.
      </p>
      <Button
        variant="primary"
        size="lg"
        className="w-full"
        disabled={!ready}
        onClick={() => void go()}
      >
        {busy ? 'One moment…' : submit}
      </Button>
      {note && (
        <p className="px-1 text-[13px] text-danger" role="alert">
          {note}
        </p>
      )}
    </div>
  );
}

function SingleNameForm({
  initial,
  run,
}: {
  initial: string;
  run: (name: string) => Promise<void>;
}) {
  const [name, setName] = useState(initial);
  const [note, setNote] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  return (
    <div className="space-y-3">
      <input
        value={name}
        maxLength={24}
        aria-label="Your name in this circle"
        autoComplete="nickname"
        onChange={(e) => setName(e.target.value)}
        className={INPUT}
      />
      <Button
        variant="primary"
        size="lg"
        className="w-full"
        disabled={busy || name.trim().length === 0 || name.trim() === initial}
        onClick={async () => {
          setBusy(true);
          try {
            await run(name.trim());
          } catch (err) {
            setNote(err instanceof Error ? err.message : String(err));
          } finally {
            setBusy(false);
          }
        }}
      >
        Save name
      </Button>
      {note && (
        <p className="px-1 text-[13px] text-danger" role="alert">
          {note}
        </p>
      )}
    </div>
  );
}

function InviteSheet({ circle: c, onClose }: { circle: CircleSummary; onClose: () => void }) {
  const [invite, setInvite] = useState<Invite | undefined>();
  const [note, setNote] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const make = async () => {
    setBusy(true);
    setNote(null);
    try {
      setInvite(await circle.invite(c.id));
    } catch (err) {
      setNote(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Sheet open onClose={onClose} title={`Invite to ${c.name}`}>
      {!invite ? (
        <div className="space-y-3">
          <p className="text-[14px] text-muted">
            A code works for seven days. Making a new one retires the last, so only one is ever out
            there.
          </p>
          <Button
            variant="primary"
            size="lg"
            className="w-full"
            disabled={busy}
            onClick={() => void make()}
          >
            {busy ? 'One moment…' : 'Make a code'}
          </Button>
        </div>
      ) : (
        <div className="space-y-4">
          <p
            className="rounded-[20px] bg-surface-2 py-5 text-center font-mono text-[28px] font-bold tracking-[0.14em]"
            aria-label={`Code ${invite.code.split('').join(' ')}`}
          >
            {invite.code}
          </p>
          <p className="text-center text-[13px] text-muted">
            Good until{' '}
            {new Date(invite.expires_at).toLocaleDateString(undefined, {
              weekday: 'long',
              day: 'numeric',
              month: 'long',
            })}
            . It is shown once — Kalib keeps only a fingerprint of it.
          </p>
          <Button
            variant="primary"
            size="lg"
            className="w-full"
            onClick={async () => {
              const outcome = await shareText(
                `Join ${c.name} on Kalib`,
                `Join my circle "${c.name}" on Kalib: Train → Circle → Join with a code → ${invite.code}`,
              );
              if (outcome === 'copied') toast('Copied');
            }}
          >
            Share code
          </Button>
          <Button
            variant="ghost"
            className="w-full"
            onClick={async () => {
              try {
                await circle.revokeInvites(c.id);
                setInvite(undefined);
                toast('Code stopped');
              } catch (err) {
                setNote(err instanceof Error ? err.message : String(err));
              }
            }}
          >
            Stop this code
          </Button>
        </div>
      )}
      {note && (
        <p className="mt-3 px-1 text-[13px] text-danger" role="alert">
          {note}
        </p>
      )}
    </Sheet>
  );
}

function Busy({
  label,
  run,
  variant,
}: {
  label: string;
  run: () => Promise<void>;
  variant: 'danger' | 'primary';
}) {
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<string | null>(null);
  return (
    <>
      <Button
        variant={variant}
        size="lg"
        className={`w-full ${variant === 'danger' ? 'bg-danger/10' : ''}`}
        disabled={busy}
        onClick={async () => {
          setBusy(true);
          try {
            await run();
          } catch (err) {
            setNote(err instanceof Error ? err.message : String(err));
          } finally {
            setBusy(false);
          }
        }}
      >
        {busy ? 'One moment…' : label}
      </Button>
      {note && (
        <p className="mt-3 px-1 text-[13px] text-danger" role="alert">
          {note}
        </p>
      )}
    </>
  );
}
