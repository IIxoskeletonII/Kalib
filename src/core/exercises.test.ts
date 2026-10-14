import { describe, expect, it } from 'vitest';
import { autoAliases, isCameraVariant, loadTypeFor, usesReps, usesWeight } from './exercises';
import type { ExerciseCategory } from './types';

const lt = (name: string, equipment: string, category: ExerciseCategory = 'strength') =>
  loadTypeFor({ name, equipment, category });

describe('loadTypeFor', () => {
  it('asks for weight and reps for ordinary loaded work', () => {
    expect(lt('Barbell Bench Press', 'barbell')).toBe('weight_reps');
    expect(lt('Cable Lateral Raise', 'cable')).toBe('weight_reps');
    expect(lt('Lever Seated Reverse Fly', 'leverage machine')).toBe('weight_reps');
  });

  it('asks for reps alone when the load is you', () => {
    expect(lt('Bodyweight Squat', 'body weight')).toBe('bodyweight_reps');
    expect(lt('Inverted Row With Straps', 'body weight')).toBe('bodyweight_reps');
  });

  it('allows added weight on the movements people actually load', () => {
    expect(lt('Pull-up', 'body weight')).toBe('weighted_bodyweight');
    expect(lt('Chin-up', 'body weight')).toBe('weighted_bodyweight');
    expect(lt('Weighted Close Grip Chin-Up On Dip Cage', 'weighted')).toBe('weighted_bodyweight');
    expect(lt('Push-up', 'body weight')).toBe('weighted_bodyweight');
  });

  it('counts an assisted machine in reps, because the stack takes weight off you', () => {
    // Logging 30 kg of assistance as 30 kg of volume would be backwards: less is better.
    expect(lt('Assisted Pull-up', 'assisted')).toBe('bodyweight_reps');
  });

  it('times anything held rather than repeated', () => {
    expect(lt('Plank', 'body weight')).toBe('time');
    expect(lt('Weighted Plank', 'weighted')).toBe('time');
    expect(lt('Dead Hang', 'body weight')).toBe('time');
    expect(lt('Wall Sit', 'body weight')).toBe('time');
  });

  it('times stretches, mobility and balance whatever the equipment', () => {
    expect(lt('Posterior Tibialis Stretch', 'rope', 'stretching')).toBe('time');
    expect(lt('Hip Circles', 'body weight', 'mobility')).toBe('time');
    expect(lt('Single Leg Stand', 'bosu ball', 'balance')).toBe('time');
  });

  it('separates cardio that reports a distance from cardio that does not', () => {
    expect(lt('Stationary Bike Run', 'stationary bike', 'cardio')).toBe('distance_time');
    expect(lt('Ski Erg', 'skierg machine', 'cardio')).toBe('distance_time');
    expect(lt('Jumping Jack', 'body weight', 'cardio')).toBe('time');
  });

  it('agrees with itself about which fields a set needs', () => {
    expect(usesWeight('weight_reps')).toBe(true);
    expect(usesWeight('weighted_bodyweight')).toBe(true);
    expect(usesWeight('bodyweight_reps')).toBe(false);
    expect(usesWeight('time')).toBe(false);
    expect(usesReps('bodyweight_reps')).toBe(true);
    expect(usesReps('time')).toBe(false);
    expect(usesReps('distance_time')).toBe(false);
  });
});

describe('autoAliases', () => {
  it('drops the leading equipment word', () => {
    expect(autoAliases('Barbell Bench Press')).toContain('bench press');
  });

  it('shortens the words a gym shortens', () => {
    const a = autoAliases('Barbell Bent Over Row');
    expect(a).toContain('bent over row');
    expect(a).toContain('bb bent over row');
  });

  it('calls a Lever machine a machine', () => {
    expect(autoAliases('Lever Seated Row')).toContain('machine seated row');
  });

  it('drops a parenthesised qualifier', () => {
    expect(autoAliases('Cable Squat Row (with Rope Attachment)')).toContain('cable squat row');
  });

  it('never repeats the name itself', () => {
    for (const n of ['Pull-up', 'Barbell Bench Press', 'Plank']) {
      expect(autoAliases(n)).not.toContain(n.toLowerCase());
    }
  });

  it('returns nothing for a name with no shorthand in it', () => {
    expect(autoAliases('Pull-up')).toEqual([]);
  });

  it('produces no empty or duplicated entries', () => {
    for (const n of [
      'Barbell Bench Press',
      'Dumbbell Alternating Bicep Curl With Leg Raised On Exercise Ball',
      'Sled 45° Leg Press',
      'Ez Barbell Reverse Grip Bent Over Row',
    ]) {
      const a = autoAliases(n);
      expect(a.every((x) => x.length > 0)).toBe(true);
      expect(new Set(a).size).toBe(a.length);
    }
  });
});

describe('isCameraVariant', () => {
  it('spots the duplicate angles', () => {
    expect(isCameraVariant('Barbell Full Squat (back Pov)')).toBe(true);
    expect(isCameraVariant('Sled 45° Leg Press (side Pov)')).toBe(true);
    expect(isCameraVariant('Barbell Full Squat')).toBe(false);
    expect(isCameraVariant('Cable Squat Row (with Rope Attachment)')).toBe(false);
  });
});
