import { describe, expect, it } from 'vitest';
import {
  LEVEL_ADVICE,
  normaliseSymptoms,
  screenRedFlags,
  worstLevel,
  type FlagId,
  type FlagLevel,
} from './redFlags';

const ids = (text: string, mode: 'person' | 'model' = 'person') =>
  screenRedFlags(text, mode).map((f) => f.id);

/** Each case: a description and the one flag it must raise (others may come with it). */
function expectFlag(cases: readonly (readonly [string, FlagId])[]) {
  for (const [text, id] of cases) {
    it(`"${text}" → ${id}`, () => {
      expect(ids(text)).toContain(id);
    });
  }
}

function expectClear(cases: readonly string[]) {
  for (const text of cases) {
    it(`"${text}" → nothing`, () => {
      expect(ids(text)).toEqual([]);
    });
  }
}

describe('normaliseSymptoms', () => {
  it('lower-cases, strips accents and straightens apostrophes', () => {
    expect(normaliseSymptoms('Non è  GONFIO — PERÒ fa male')).toBe('non e gonfio — pero fa male');
    expect(normaliseSymptoms('I can’t feel it')).toBe("i can't feel it");
  });
  it('spells every contraction one way', () => {
    expect(normaliseSymptoms('I cant, cannot, can not; dont doesnt isnt')).toBe(
      "i can't, can't, can't; don't doesn't isn't",
    );
  });
});

describe('emergencies (NHS: call 999 / go to A&E)', () => {
  expectFlag([
    ['I get chest pain when I bench', 'chest'],
    ['Sharp pain in my chest during deadlifts', 'chest'],
    ['there is a tight feeling in my chest', 'chest'],
    ['My chest feels tight and heavy', 'chest'],
    ['the pain spreads to my left arm', 'chest'],
    ['pain radiating into my jaw', 'chest'],
    ['Ho un dolore al petto quando corro', 'chest'],
    ['senso di peso sul petto', 'chest'],
    ['I get short of breath and dizzy', 'breathing'],
    ["I can't breathe properly after squats", 'breathing'],
    ['ho il fiato corto anche a riposo', 'breathing'],
    ['non riesco a respirare bene', 'breathing'],
    ['numbness around my groin since deadlifting', 'cauda_equina'],
    ['tingling in my inner thighs and genitals', 'cauda_equina'],
    ['my buttocks feel numb', 'cauda_equina'],
    ['saddle numbness', 'cauda_equina'],
    ['lower back pain and loss of bladder control', 'cauda_equina'],
    ["back hurts and I can't pee", 'cauda_equina'],
    ['I wet myself', 'cauda_equina'],
    ['difficulty urinating since the deadlift', 'cauda_equina'],
    ['some incontinence', 'cauda_equina'],
    ['mal di schiena e perdita del controllo della vescica', 'cauda_equina'],
    ['non riesco a fare pipì', 'cauda_equina'],
    ["intorpidimento all'inguine", 'cauda_equina'],
    ['numbness in both legs', 'both_legs'],
    ['weakness in my two legs', 'both_legs'],
    ['both legs keep giving way', 'both_legs'],
    ['formicolio a entrambe le gambe', 'both_legs'],
    ['I hit my head on the rack', 'head'],
    ['blacked out during a heavy squat', 'head'],
    ['I fainted after deadlifts', 'head'],
    ['felt faint and then the back went', 'head'],
    ['ho sbattuto la testa', 'head'],
    ['sono svenuto in palestra', 'head'],
    ['sudden severe headache while deadlifting', 'headache'],
    ['worst headache of my life', 'headache'],
    ['mal di testa improvviso durante lo stacco', 'headache'],
    ['my foot turned blue', 'circulation'],
    ['my fingers are white and cold', 'circulation'],
    ['the skin went grey', 'circulation'],
    ['la mano è diventata viola', 'circulation'],
    ['my finger is bent at an odd angle', 'deformity'],
    ['the shoulder popped out', 'deformity'],
    ['I think I dislocated my finger', 'deformity'],
    ['ho la spalla lussata', 'deformity'],
    ["it's out of place", 'deformity'],
    ['I heard a crack when I landed', 'crack'],
    ['heard a loud snap in my ankle', 'crack'],
    ['ho sentito un crack al polso', 'crack'],
  ]);
});

describe('urgent (NHS: 111 / urgent GP)', () => {
  expectFlag([
    ['numbness in my right hand when I curl', 'nerve'],
    ['my fingers go numb on pull-ups', 'nerve'],
    ['tingling down my leg when I deadlift', 'nerve'],
    ['pins and needles in my thumb', 'nerve'],
    ["I can't feel my toes", 'nerve'],
    ['weakness in my left arm', 'nerve'],
    ['my knee keeps giving way', 'nerve'],
    ['shooting pain down my leg', 'nerve'],
    ['formicolio alla mano sinistra', 'nerve'],
    ['non sento le dita', 'nerve'],
    ['debolezza alla gamba destra', 'nerve'],
    ['I think I broke my wrist', 'fracture'],
    ['could be a stress fracture in my shin', 'fracture'],
    ["maybe it's broken", 'fracture'],
    ['penso di essermi rotto il polso', 'fracture'],
    ['forse è rotto', 'fracture'],
    ["I can't put weight on my ankle", 'weight_bearing'],
    ["can't walk without limping badly", 'weight_bearing'],
    ["I can't straighten my knee", 'weight_bearing'],
    ["I'm unable to lift my arm above my head", 'weight_bearing'],
    ['non riesco a camminare', 'weight_bearing'],
    ['non riesco ad appoggiare il piede', 'weight_bearing'],
    ['I fell off my bike yesterday', 'trauma'],
    ['after a car accident last week', 'trauma'],
    ['dropped a dumbbell on my foot', 'trauma'],
    ['I fell.', 'trauma'],
    ['sono caduto dalle scale', 'trauma'],
    ['dopo un incidente in moto', 'trauma'],
    ['I have a fever and my knee is swollen', 'infection'],
    ['the joint is hot and swollen', 'infection'],
    ['feeling hot and shivery', 'infection'],
    ['ho la febbre e il ginocchio gonfio', 'infection'],
    ['il ginocchio è caldo e gonfio', 'infection'],
    ['severe pain in my lower back', 'severe_pain'],
    ['the pain is 9/10', 'severe_pain'],
    ['it is getting worse every day', 'severe_pain'],
    ['dolore lancinante alla spalla', 'severe_pain'],
    ['massive swelling on my ankle', 'swelling'],
    ['it swelled up straight away', 'swelling'],
    ['la caviglia è molto gonfia', 'swelling'],
    ['felt a pop in my knee', 'rupture'],
    ['I think I tore my hamstring', 'rupture'],
    ['felt like I was kicked in the calf', 'rupture'],
    ['ho sentito uno strappo al polpaccio', 'rupture'],
    ['my calf is swollen and hot', 'calf'],
    ['polpaccio gonfio e caldo', 'calf'],
    ['palpitations during cardio', 'heart'],
    ['my heart keeps racing at rest', 'heart'],
    ['ho le palpitazioni', 'heart'],
    ['my chest hurts', 'chest_ache'],
    ['mi fa male il petto', 'chest_ache'],
  ]);
});

describe('soon (NICE back-pain red flags)', () => {
  expectFlag([
    ['the pain wakes me up at night', 'night_pain'],
    ['my back is worse at night', 'night_pain'],
    ['constant pain even at rest', 'night_pain'],
    ['dolore notturno alla schiena', 'night_pain'],
    ['unexplained weight loss and back pain', 'weight_loss'],
    ['lost weight without trying', 'weight_loss'],
    ['perdita di peso inspiegabile', 'weight_loss'],
    ['I had cancer five years ago', 'cancer'],
    ['ho avuto un tumore', 'cancer'],
    ['I have osteoporosis', 'osteoporosis'],
  ]);
});

describe('misspellings', () => {
  expectFlag([
    ['some numbess in my hand', 'nerve'],
    ['tingeling in my fingers', 'nerve'],
    ['a bit of formicolo', 'nerve'],
    ['feeling feverrish', 'infection'],
    ['I think it is dislocted', 'deformity'],
    ['incontinance since yesterday', 'cauda_equina'],
    ['stress fractrue', 'fracture'],
  ]);
  it('does not stretch short words into symptoms', () => {
    // One letter from "fever", and the reason short words are matched exactly or not at all.
    expect(ids('I have never had this, and fewer reps help')).toEqual([]);
  });
  it('does not read an injection as an infection', () => {
    expect(ids('I had a cortisone injection in my shoulder last year')).toEqual([]);
  });
});

describe('negation', () => {
  expectClear([
    'no numbness or tingling, just a dull ache in my elbow',
    'No numbness, tingling, or weakness',
    "I don't have any numbness",
    'there is no swelling',
    'no fever',
    'not numb at all',
    'never fainted',
    'without any tingling',
    'nessun formicolio, solo dolore al gomito',
    'non ho febbre',
    'senza intorpidimento',
    'no pins and needles',
    'numbness: none',
    "no chest pain, it's my shoulder",
  ]);

  it('stops at a clause break', () => {
    expect(ids('no fever, but my foot is numb')).toContain('nerve');
    expect(ids('no swelling. My fingers are tingling')).toContain('nerve');
    expect(ids('niente febbre ma ho formicolio alla mano')).toContain('nerve');
  });
  it('does not reach across an unrelated clause after a comma', () => {
    expect(ids('I have no fever, my leg is numb')).toContain('nerve');
  });
  it('does not reach far', () => {
    expect(ids('no pain in my knee today and then my foot went numb')).toContain('nerve');
  });
  it('treats inability as the symptom, not a negation', () => {
    expect(ids('non riesco a camminare')).toContain('weight_bearing');
    expect(ids('I am not able to walk')).toContain('weight_bearing');
  });
  it('treats uncertainty as a yes', () => {
    expect(ids("I'm not sure if it's numb")).toContain('nerve');
  });
  it('fails safe on an answer given in a separate sentence', () => {
    // "No." on its own is a clause of its own, so the question before it still counts. A false
    // alarm here costs a doctor's visit; the reverse could cost much more.
    expect(ids('tingling at the bottom of the squat? no. just an ache')).toContain('nerve');
  });
  it('one negated mention does not hide another that is not', () => {
    expect(ids('No numbness yesterday. Today my hand is numb.')).toContain('nerve');
  });
});

describe('the ordinary aches it leaves alone', () => {
  expectClear([
    'my left shoulder aches at the bottom of a bench press',
    'lower back is sore after deadlifts',
    'knee hurts on deep squats, fine on leg press',
    'elbow pain when I do skull crushers',
    'tight hamstrings',
    'my wrist is a bit sore on front squats',
    'DOMS in my quads after leg day',
    'mild ache in my right hip when I lunge',
    'my chest is sore after bench',
    'pain in my shoulder for two weeks, getting a little better',
    'tennis elbow on curls',
    'mi fa male la spalla quando faccio panca',
    'dolore al ginocchio negli squat profondi',
    'ho la schiena indolenzita dopo lo stacco',
    'My form fell apart on the last set and my back aches',
    'I broke my PR and now my back hurts',
    'my knee clicks when I squat',
    'the chest press machine hurts my shoulder',
    'shoulder pain in the overhead press, pain is about 3 out of 10',
    'blue band on my knee sleeve',
    'I accidentally overdid it',
  ]);
});

describe('screening what the model said', () => {
  it('catches advice that should have come from a clinician', () => {
    expect(ids('This could be a torn rotator cuff, so rest it.', 'model')).toContain('model');
    expect(ids('Seek immediate medical attention.', 'model')).toContain('model');
    expect(ids('Go to A&E.', 'model')).toContain('model');
    expect(ids('Call 112 if it worsens quickly.', 'model')).toEqual(['model']);
    expect(ids('It sounds like a herniated disc.', 'model')).toContain('model');
    expect(ids('Kalib would diagnose this as tendinopathy.', 'model')).toContain('model');
  });
  it('still sees the symptom words', () => {
    expect(ids('The numbness suggests a nerve is involved.', 'model')).toContain('nerve');
  });
  it('reads cautions and conditions as cautions', () => {
    expect(ids('If you feel numbness or tingling, stop.', 'model')).toEqual([]);
    expect(ids('Stop and rest it should the pain become severe.', 'model')).toEqual([]);
    expect(ids('Avoid any movement that causes sharp pain.', 'model')).toEqual([]);
    expect(ids("I can't diagnose this; keep the load light.", 'model')).toEqual([]);
  });
  it('lets ordinary training advice through', () => {
    for (const ok of [
      'Use a neutral grip and stop two reps short of failure.',
      'Reduce the range so the bar stops an inch above your chest.',
      'Swap to the dumbbell version and go lighter.',
      'Keep this one: it does not load the shoulder.',
      'See a physiotherapist if it has not eased in two weeks.',
    ]) {
      expect(ids(ok, 'model'), ok).toEqual([]);
    }
  });
  it('does not apply the model rule to a person', () => {
    expect(ids('my physio said it could be a tear')).toEqual([]);
  });
});

describe('ordering and levels', () => {
  it('lists the most urgent first, one entry per kind', () => {
    const flags = screenRedFlags('numbness and tingling in my hand, chest pain, and a fever');
    expect(flags.map((f) => f.id)).toEqual(['chest', 'nerve', 'infection']);
    expect(flags[0]!.level).toBe('emergency');
  });
  it('picks the worst level', () => {
    const levels = (text: string): FlagLevel | undefined => worstLevel(screenRedFlags(text));
    expect(levels('wakes me at night')).toBe('soon');
    expect(levels('wakes me at night and it is numb')).toBe('urgent');
    expect(levels('wakes me at night, numb, and I fainted')).toBe('emergency');
    expect(levels('just sore')).toBeUndefined();
  });
  it('has words for every level, with numbers for the places this is used', () => {
    expect(LEVEL_ADVICE.emergency.body).toMatch(/112/);
    expect(LEVEL_ADVICE.emergency.body).toMatch(/911/);
    expect(LEVEL_ADVICE.emergency.body).toMatch(/9999/);
    for (const level of ['emergency', 'urgent', 'soon'] as const) {
      expect(LEVEL_ADVICE[level].title.length).toBeGreaterThan(5);
    }
  });
  it('gives every flag a label fit to show', () => {
    const all = screenRedFlags(
      'chest pain, short of breath, saddle numbness, numb in both legs, hit my head, worst headache, foot turned blue, odd angle, heard a crack, numb, fracture, cannot walk, car accident, fever, severe pain, massive swelling, felt a pop, calf swollen and hot, palpitations, wakes me at night, unexplained weight loss, cancer, osteoporosis',
    );
    expect(all.length).toBeGreaterThanOrEqual(20);
    for (const f of all) expect(f.label).toMatch(/^[a-z]/);
  });
  it('copes with empty and enormous input', () => {
    expect(screenRedFlags('')).toEqual([]);
    expect(screenRedFlags('   \n  ')).toEqual([]);
    const long = 'my shoulder aches a little. '.repeat(400);
    const t0 = Date.now();
    expect(screenRedFlags(long)).toEqual([]);
    expect(Date.now() - t0).toBeLessThan(1500);
  });
});
