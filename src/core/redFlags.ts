// SPEC §20.16 — the symptoms that mean "see a doctor", found before anything is sent anywhere.
//
// Injury help suggests training changes for an ordinary ache. It must never be the thing that
// talks someone out of an emergency, so the description is screened here, deterministically and
// on the phone, before a model ever sees it; the Worker runs the same screen again on what it
// receives, and the model's answer is screened on the way back. Any hit replaces the advice
// with "see a doctor" and how urgently.
//
// The lists follow the public NHS pages that say when an ache stops being self-care, with the
// NICE red flags for back pain alongside:
//   - NHS, Sprains and strains (nhs.uk/conditions/sprains-and-strains): 999 or A&E if you heard a
//     crack, the part changed shape or points at an odd angle, it is numb, tingling or has pins
//     and needles, or the skin turned blue or grey or is cold; 111 for severe or worsening
//     pain, a large or growing swelling, not being able to put weight on it, or signs of
//     infection (a very high temperature, feeling hot, cold or shivery).
//   - NHS, Back pain (nhs.uk/conditions/back-pain): 999 or A&E for symptoms in both legs, loss of
//     feeling around the genitals or anus, changes in bladder or bowel control, changes in
//     sexual function, chest pain, or pain after a serious accident; urgent GP for feeling hot,
//     cold, shivery or unwell, or severe pain that starts suddenly or worsens quickly.
//   - NHS, Cauda equina syndrome; Chest pain; Head injury and concussion; Subarachnoid
//     haemorrhage (a sudden, severe "thunderclap" headache, which heavy lifting can provoke);
//     DVT (a swollen, warm, red or throbbing calf); Septic arthritis (a hot, swollen joint with a
//     temperature).
//   - NICE CKS, Back pain — low (without radiculopathy), red flags: a history of cancer,
//     unexplained weight loss, pain at night or at rest, osteoporosis, significant trauma.
//
// The screen is written to fail safe. A false alarm costs someone a doctor's visit they may not
// have needed; a miss could cost far more. So negation ("no numbness") is honoured only close to
// the symptom and within the same clause, and anything ambiguous counts.
//
// English and Italian, because those are the languages this app's people describe pain in.
// Text is lower-cased and stripped of accents first, so the Italian patterns are written
// without them ("e" for "è", "pipi" for "pipì").

export type FlagLevel = 'emergency' | 'urgent' | 'soon';

export type FlagId =
  | 'chest'
  | 'breathing'
  | 'cauda_equina'
  | 'both_legs'
  | 'head'
  | 'headache'
  | 'circulation'
  | 'deformity'
  | 'crack'
  | 'nerve'
  | 'fracture'
  | 'weight_bearing'
  | 'trauma'
  | 'infection'
  | 'severe_pain'
  | 'swelling'
  | 'rupture'
  | 'calf'
  | 'heart'
  | 'chest_ache'
  | 'night_pain'
  | 'weight_loss'
  | 'cancer'
  | 'osteoporosis'
  | 'model';

export interface RedFlag {
  id: FlagId;
  level: FlagLevel;
  /** What it is about, in words fit to show back to the person. */
  label: string;
}

interface FlagRule {
  id: FlagId;
  level: FlagLevel;
  label: string;
  patterns: RegExp[];
  /** Single words worth catching misspelt ("numbess", "formicolo"). Six letters or more. */
  words?: string[];
}

// Pieces reused across patterns. Written for normalised text: lower case, no accents,
// straight apostrophes, contractions spelled "can't", "don't".
const LIMB =
  '(?:foot|feet|toes?|leg|legs|hand|hands|fingers?|thumbs?|arm|arms|shin|calf|thigh|knee|knees|face|lips?|wrist|ankle|elbow|shoulder|heel)';
const IT_LIMB =
  '(?:piede|piedi|dita|dito|gamba|gambe|mano|mani|braccio|braccia|pollice|polpaccio|coscia|ginocchio|caviglia|polso|gomito|spalla|viso|labbra|tallone)';
const SADDLE =
  '(?:groin|genitals?|genital area|private parts|buttocks?|bum|anus|back passage|saddle|inner thighs?|perineum|crotch)';
const IT_SADDLE =
  '(?:inguine|genitali|glutei|natiche|sedere|ano|zona (?:della )?sella|interno (?:delle |della )?cosc(?:ia|e)|perineo)';
const W = "(?:[a-z']+ )"; // one word and its space
const W_IT = "(?:[a-z]+'|[a-z']+ )"; // or, in Italian, an elided article: "all'inguine"

const RULES: FlagRule[] = [
  // ---- emergency: call an ambulance or go to an emergency department ----
  {
    id: 'chest',
    level: 'emergency',
    label: 'chest pain or pressure',
    patterns: [
      /\bchest (?:pain|pains|tightness|pressure|discomfort|ache)\b/,
      /\bpains? (?:in|across|on|around|through) (?:the |my )?(?:middle of (?:my |the )?)?chest\b/,
      /\b(?:tight|tightness|heavy|heaviness|crushing|squeezing|pressure)(?: feeling| sensation)? (?:in|on|across) (?:my |the )?chest\b/,
      /\bchest (?:feels|is|was|felt|went|gets|got) (?:really |very |all )?(?:tight|heavy|crushed|crushing|squeezed)\b/,
      /\b(?:spread\w*|radiat\w*|goes|going|moving|shoot\w*) (?:to|into|down|up)(?: my| the)? (?:jaw|left arm)\b/,
      /\bheart attack\b|\bangina\b/,
      /\bdolor[ei] (?:al|nel|sul|in|del) petto\b|\bdolore toracico\b/,
      /\b(?:oppressione|pressione|peso|costrizione|senso di peso) (?:al|sul|nel) petto\b/,
      /\binfarto\b/,
    ],
  },
  {
    id: 'breathing',
    level: 'emergency',
    label: 'trouble breathing',
    patterns: [
      /\bshort(?:ness)? of breath\b/,
      /\bcan't (?:catch my )?breathe?\b/,
      /\b(?:difficulty|trouble|struggling to|struggle to|hard to|hard time) (?:breathing|breathe)\b/,
      /\bgasping\b/,
      /\bfiato corto\b|\bmancanza (?:di|del) (?:fiato|respiro|aria)\b/,
      /\b(?:non riesco a|difficolta a|fatica a) respirare\b/,
    ],
  },
  {
    id: 'cauda_equina',
    level: 'emergency',
    label: 'numbness around the groin, or changes in bladder or bowel control',
    patterns: [
      new RegExp(
        `\\b(?:numb\\w*|tingl\\w*|pins and needles|no feeling|lost (?:all )?(?:feeling|sensation)|loss of (?:feeling|sensation)|altered (?:feeling|sensation)|can't feel) ${W}{0,3}${SADDLE}\\b`,
      ),
      new RegExp(`\\b${SADDLE} ${W}{0,3}(?:numb\\w*|tingl\\w*)`),
      /\bsaddle (?:numbness|anaesthesia|anesthesia)\b/,
      /\b(?:loss of|lost|losing|no) (?:bladder|bowel) (?:control|function)\b/,
      /\b(?:bladder|bowel) (?:control|incontinence)\b/,
      /\bincontinen(?:ce|t)\b/,
      /\b(?:peed|wet|pooed|soiled|pooped) (?:myself|my pants|my trousers)\b/,
      /\bcan't (?:pee|wee|urinate|empty my bladder|control my (?:bladder|bowels?))\b/,
      /\b(?:difficulty|trouble|problems?|struggling|struggle) (?:peeing|urinating|weeing|to pee|to urinate|going to the toilet)\b/,
      /\bleak(?:ing)? (?:urine|pee|wee)\b/,
      /\b(?:erectile|erection|sexual function|sexual sensation)\b/,
      /\bincontinen\w+\b/,
      /\bperdita (?:di |del )?controllo (?:della |dell'|degli |delle )?(?:vescica|intestino|sfinteri|urina|feci)\b/,
      /\b(?:non riesco a|difficolta a|fatica a) (?:urinare|fare (?:la )?pipi)\b/,
      new RegExp(
        `\\b(?:intorpidit\\w+|intorpidimento|formicoli\\w+|insensibil\\w+|non sento) ${W_IT}{0,3}${IT_SADDLE}`,
      ),
      /\banestesia a sella\b/,
      /\b(?:perdo|ho perso|perdite di) (?:urina|pipi|feci)\b/,
      /\bdisfunzione erettile\b/,
    ],
    words: ['incontinence', 'incontinent', 'incontinenza'],
  },
  {
    id: 'both_legs',
    level: 'emergency',
    label: 'symptoms in both legs',
    patterns: [
      /\b(?:numb\w*|tingl\w*|weak\w*|pins and needles)\b(?: [a-z']+){0,4} (?:both|my two) legs\b/,
      /\bboth legs\b(?: [a-z']+){0,3} (?:numb\w*|tingl\w*|weak\w*|giving way|give way|gave way)/,
      /\b(?:intorpidit\w+|intorpidimento|formicoli\w+|debol\w+)\b(?: [a-z']+){0,4} (?:entrambe|tutte e due|ambedue|tutte due) (?:le )?gambe\b/,
    ],
  },
  {
    id: 'head',
    level: 'emergency',
    label: 'a blow to the head, or fainting',
    patterns: [
      /\b(?:hit|banged|bumped|smacked|knocked|whacked) (?:my|his|her) head\b/,
      /\bhead injury\b|\bconcussion\b|\bconcussed\b/,
      /\b(?:knocked|passed|blacked) out\b/,
      /\bfaint(?:ed|ing)\b|\b(?:felt|feel|feeling|went) faint\b|\blost consciousness\b|\bseizure\b/,
      /\b(?:battuto|sbattuto|picchiato) (?:la )?testa\b|\btrauma cranico\b|\bcommozione\b/,
      /\bsvenut[oa]\b|\bsvenimento\b|\bperso (?:i sensi|conoscenza)\b|\bconvulsion\w+/,
    ],
    words: ['concussion', 'fainted', 'svenuto', 'svenuta', 'commozione'],
  },
  {
    id: 'headache',
    level: 'emergency',
    label: 'a sudden, severe headache',
    patterns: [
      /\b(?:sudden|severe|worst|explosive|thunderclap|blinding|splitting|excruciating)(?: [a-z']+)? headache\b/,
      /\bheadache\b(?: [a-z']+){0,3} (?:suddenly|out of nowhere|worst)\b/,
      /\b(?:mal di testa|cefalea) (?:\w+ )?(?:improvvis\w+|fortissim\w+|violent\w+|lancinante|esplosiv\w+)/,
      /\b(?:improvviso|fortissimo|violento|terribile) mal di testa\b/,
    ],
  },
  {
    id: 'circulation',
    level: 'emergency',
    label: 'skin turning blue, grey or pale, or going cold',
    patterns: [
      new RegExp(`\\b(?:blue|grey|gray|white|pale|purple|black) (?:and \\w+ )?${LIMB}\\b`),
      new RegExp(
        `\\b${LIMB} (?:is |are |feels |feel |felt |looks |look |turned |went |going |gone |has gone |have gone |has turned |have turned )+(?:\\w+ )?(?:blue|grey|gray|white|pale|purple|black)\\b`,
      ),
      /\bcold (?:and|&) (?:blue|grey|gray|white|pale|numb)\b/,
      /\b(?:turned|gone|going|went) (?:blue|grey|gray|purple)\b/,
      new RegExp(
        `\\b${IT_LIMB} (?:e |sono |e diventat[oaie] |diventat[oaie] |si (?:e|sono) fatt[oaie] )?(?:blu|viola|grigi[oaie]|bianc[oaie]|livid[oaie]|pallid[oaie])\\b`,
      ),
      /\bfredd[oaie] e (?:blu|viola|bianc\w+|intorpidit\w+|livid\w+)/,
    ],
  },
  {
    id: 'deformity',
    level: 'emergency',
    label: 'a joint or limb out of shape',
    patterns: [
      /\b(?:odd|wrong|funny|strange|weird|unnatural) (?:angle|shape)\b/,
      /\bout of (?:place|its socket|the socket|joint)\b/,
      /\b(?:looks|is|was) (?:bent|crooked|deformed|misshapen)\b/,
      /\bdeform(?:ed|ity)\b/,
      /\bbone (?:is )?(?:sticking|poking|coming) (?:out|through)\b/,
      /\bdislocat\w+/,
      /\bpopped out\b/,
      /\bdeform\w+|\blussa\w+|\bfuori (?:posto|sede)\b/,
      /\bosso (?:che )?(?:sporge|esce)\b/,
      /\b(?:angolo|posizione|forma) (?:strano|strana|innaturale)\b/,
    ],
    words: [
      'dislocated',
      'dislocation',
      'deformed',
      'deformity',
      'lussazione',
      'lussato',
      'lussata',
    ],
  },
  {
    id: 'crack',
    level: 'emergency',
    label: 'a crack or snap when it happened',
    patterns: [
      /\b(?:heard|hear|hearing) (?:a |an |this |some |something )?(?:[a-z']+ )?(?:crack|cracking|snap|snapping|crunch)\b/,
      /\b(?:sentito|udito) (?:un |uno )?(?:crack|crac|schiocco|scricchiolio forte|rumore di rottura)\b/,
    ],
  },

  // ---- urgent: seen by a doctor today, before training on it ----
  {
    id: 'nerve',
    level: 'urgent',
    label: 'numbness, tingling or weakness',
    patterns: [
      /\bnumb(?:ness|ed|ing)?\b/,
      /\btingl(?:e|es|ed|ing|y)\b/,
      /\bpins (?:and|&) needles\b/,
      new RegExp(`\\bcan't feel (?:my |the |his |her )?(?:left |right )?(?:[a-z']+ )?${LIMB}\\b`),
      /\b(?:lost|loss of|losing|no) (?:feeling|sensation) (?:in|on)\b/,
      new RegExp(
        `\\bweak(?:ness)? (?:in|of) (?:my |the )?(?:left |right )?(?:[a-z']+ )?(?:${LIMB}|grip)\\b`,
      ),
      /\b(?:foot drop|drop foot)\b/,
      /\b(?:leg|knee|ankle|legs|knees) (?:keeps |kept )?(?:giving|gives|gave|giving) (?:way|out)\b/,
      /\belectric(?:al)? (?:shocks?|feeling|sensation)\b/,
      /\bshooting (?:pain )?(?:down|into|through) (?:my |the )?(?:arm|leg|hand|foot)\b/,
      /\bintorpidi\w+|\bformicoli\w+|\binsensibil\w+|\bperdita di sensibilita\b/,
      new RegExp(`\\bnon sento (?:piu )?(?:il |la |le |i |l'|gli )?${IT_LIMB}\\b`),
      new RegExp(
        `\\bdebolezza (?:al|alla|alle|ai|agli|nel|nella|nelle|nei|negli|del|della) (?:\\w+ )?${IT_LIMB}\\b`,
      ),
      /\b(?:il ginocchio|la gamba|la caviglia|le gambe) (?:mi )?(?:cede|cedono|ha ceduto|hanno ceduto)\b/,
      /\bscoss[ae] elettric[ah]e?\b|\bpiede cadente\b/,
    ],
    words: [
      'numbness',
      'tingling',
      'tingles',
      'intorpidimento',
      'intorpidito',
      'intorpidita',
      'formicolio',
      'formicolii',
    ],
  },
  {
    id: 'fracture',
    level: 'urgent',
    label: 'a possible broken bone',
    patterns: [
      /\bfractur\w+/,
      /\bbroken (?:bone|arm|wrist|hand|finger|toe|foot|ankle|leg|ribs?|collarbone|clavicle|nose|elbow|kneecap|hip|shin|jaw|thumb|knuckle)\b/,
      /\bbroke (?:my |a |the |his |her )?(?:bone|arm|wrist|hand|finger|toe|foot|ankle|leg|ribs?|collarbone|clavicle|nose|elbow|kneecap|hip|shin|jaw|thumb|knuckle)\b/,
      /\b(?:i think|might be|may be|could be|maybe|probably|worried) (?:it'?s |it is |is |its )?broken\b/,
      /\bfrattur\w+|\bosso rotto\b/,
      /\b(?:mi sono |ho )?rott[oa] (?:il |la |l'|un |una |le |i )?(?:osso|braccio|polso|mano|dito|piede|caviglia|gamba|costol[ae]|clavicola|naso|gomito|rotula|anca|tibia|pollice)\b/,
      /\b(?:credo|penso|forse|temo) (?:che )?(?:sia |e )?rott[oa]\b/,
    ],
    words: ['fracture', 'fractured', 'frattura', 'fratturato', 'fratturata'],
  },
  {
    id: 'weight_bearing',
    level: 'urgent',
    label: 'not being able to put weight on it or move it',
    patterns: [
      /\bcan't (?:put|bear|take|stand) (?:any )?weight\b/,
      /\b(?:can't|unable to|not able to|couldn't) (?:walk|stand|stand up)\b/,
      new RegExp(
        `\\b(?:can't|unable to|not able to|couldn't) (?:bend|straighten|move|raise|lift|turn|rotate|use) (?:my|the) (?:left |right )?(?:[a-z']+ )?(?:${LIMB}|neck|back|hip)\\b`,
      ),
      /\bnon (?:riesco|posso|riuscivo) (?:a |ad )?(?:camminare|appoggiar\w*|stare in piedi|caricar\w*)\b/,
      new RegExp(
        `\\bnon (?:riesco|posso|riuscivo) (?:a |ad )?(?:muovere|piegare|alzare|raddrizzare|girare|usare) (?:il |la |le |i |l'|gli )?(?:${IT_LIMB}|collo|schiena|anca)\\b`,
      ),
    ],
  },
  {
    id: 'trauma',
    level: 'urgent',
    label: 'a fall or an accident',
    patterns: [
      /\b(?:car|road|bike|cycling|motorbike|motorcycle|scooter|skiing|traffic) (?:accident|crash|collision)\b/,
      /\bhit by (?:a )?(?:car|bike|vehicle|van|truck|bus)\b/,
      /\bafter (?:a|the|my) (?:bad |big |hard |nasty )?(?:fall|crash|accident|collision)\b/,
      /\bi fell\b(?! (?:apart|behind|short|asleep|ill|in love|for))/,
      /\bfell (?:off|over|down|from|onto|on|backwards|forwards|forward|hard|awkwardly)\b/,
      /\b(?:had|took) a (?:bad |big |hard |nasty |heavy )?(?:fall|tumble)\b/,
      /\bslipped and (?:fell|landed)\b/,
      /\bdropped (?:a |the |my )?(?:[a-z']+ )?(?:weight|dumbbell|plate|bar|barbell|kettlebell) on\b/,
      /\b(?:accident|crash|collision)\b/,
      /\b(?:sono |e )?cadut[oa]\b|\bcaduta\b/,
      /\bincidente\b|\binvestit[oa]\b/,
      /\bscivolat[oa] e\b/,
      /\bmi e caduto (?:\w+ ){0,3}(?:addosso|sul|sulla|sui|sulle)\b/,
    ],
  },
  {
    id: 'infection',
    level: 'urgent',
    label: 'a fever, or a hot, swollen joint',
    patterns: [
      /\bfever\w*|\bfeaver\b|\bfevre\b/,
      /\bhigh temperature\b|\b(?:have|got|running|with|had) a temperature\b/,
      /\btemperature of (?:3[89]|4\d|10\d)\b/,
      /\b(?:hot|cold) and shivery\b|\bshivery\b|\bshivering\b|\bchills\b/,
      /\b(?:red|redness) and (?:hot|warm)\b/,
      /\b(?:hot|warm)(?: to (?:the )?touch)?,? and (?:red|swollen)\b/,
      /\bswollen and (?:hot|warm)\b/,
      /\bfeel(?:ing)? (?:generally |really |very )?unwell\b/,
      /\binfect\w+|\bpus\b/,
      /\bfebbre\b|\bfebbricitante\b|\bbrividi\b/,
      /\b(?:caldo|calda) e (?:gonfi[oa]|arrossat[oa]|ross[oa])\b/,
      /\b(?:gonfi[oa]|arrossat[oa]|ross[oa]) e (?:caldo|calda)\b/,
      /\binfezion\w+|\binfett\w+|\bmalessere generale\b/,
    ],
    // Not 'infection' or 'infected': one letter from 'injection' and 'injected'.
    words: ['feverish', 'shivering', 'febbre'],
  },
  {
    id: 'severe_pain',
    level: 'urgent',
    label: 'severe pain, or pain getting worse fast',
    patterns: [
      /\b(?:severe|unbearable|excruciating|agoni[sz]ing|intense|extreme|crippling|horrible|terrible|awful|debilitating)(?: [a-z']+)? pain\b/,
      /\bpain (?:is |was )?(?:severe|unbearable|excruciating|agoni[sz]ing)\b/,
      /\b(?:9|10|nine|ten) ?(?:\/|out of) ?(?:10|ten)\b/,
      /\bworst pain\b/,
      /\b(?:getting|got|gets) (?:much |a lot |rapidly |quickly )?worse (?:quickly|fast|every day|each day|by the (?:day|hour)|and worse)\b/,
      /\bworse and worse\b/,
      /\bdolore (?:molto )?(?:fortissimo|insopportabile|lancinante|atroce|terribile|tremendo|forte|intenso)\b/,
      /\b(?:peggiora|sta peggiorando) (?:sempre di piu|rapidamente|velocemente|ogni giorno|di giorno in giorno)\b/,
    ],
  },
  {
    id: 'swelling',
    level: 'urgent',
    label: 'heavy or fast swelling or bruising',
    patterns: [
      /\b(?:huge|massive|severe|lots of|a lot of|large|big|significant|serious|enormous)(?: amount of)? (?:swelling|bruising|bruise)\b/,
      /\b(?:very|really|badly|extremely|hugely|massively) (?:swollen|bruised)\b/,
      /\bswell(?:ed|s|ing)? up (?:straight away|immediately|right away|instantly|fast|quickly|straightaway)\b/,
      /\bswelling (?:is )?(?:getting worse|spreading|growing|increasing|keeps growing)\b/,
      /\bswollen like a\b/,
      /\b(?:molto|tanto|tantissimo|enormemente) (?:gonfi[oa]|livid[oa])\b/,
      /\bgonfiore (?:enorme|grande|grave|importante|notevole|forte|che aumenta|che peggiora)\b/,
      /\b(?:si e |e )?gonfiat[oa] (?:subito|immediatamente|tantissimo|molto)\b/,
      /\b(?:ematoma|livido) (?:enorme|grande|esteso)\b/,
    ],
  },
  {
    id: 'rupture',
    level: 'urgent',
    label: 'a pop or tear when it happened',
    patterns: [
      /\b(?:felt|heard|had|there was) (?:a |an |this |some |something )?(?:[a-z']+ )?(?:pop|popping|snap|tearing|rip|ripping|tear)(?: sound| noise| sensation| feeling)?\b/,
      /\b(?:snapped|ruptured|torn|tore|ripped) (?:my |a |the |his |her )?(?:[a-z']+ )?(?:tendon|achilles|acl|mcl|ligament|bicep|biceps|pec|pecs|pectoral|hamstring|quad|quads|tricep|triceps|meniscus|rotator cuff|calf)\b/,
      /\brupture\w*/,
      /\b(?:as if|like) (?:i was |i'd been |i had been |someone )?(?:kicked|shot|hit|struck) (?:in|on) (?:the |my )?(?:calf|heel|back of)/,
      /\b(?:sentito|avvertito) (?:uno |un )?(?:strappo|schiocco|pop|crack|crac)\b/,
      /\brottura (?:del |dell'|della |dei )?(?:tendine|achille|legamento|crociato|bicipite|pettorale|menisco|cuffia)\b/,
      /\b(?:rotto|rotta|strappato|lesionato) (?:il |l'|la )?(?:tendine|achille|legamento|crociato|bicipite|pettorale|menisco)\b/,
    ],
    words: ['ruptured', 'rupture'],
  },
  {
    id: 'calf',
    level: 'urgent',
    label: 'a swollen, hot or red calf',
    patterns: [
      /\bcalf\b(?: [a-z']+){0,3} (?:swollen|swelling|red|hot|throbbing|warm and)\b/,
      /\b(?:swollen|swelling in|red|hot|throbbing) (?:[a-z']+ ){0,2}calf\b/,
      /\bpolpaccio (?:\w+ ){0,2}(?:gonfi[oa]|caldo|arrossato|rosso|pulsante)\b/,
      /\b(?:gonfiore|arrossamento) (?:al|del) polpaccio\b/,
    ],
  },
  {
    id: 'heart',
    level: 'urgent',
    label: 'a racing or irregular heartbeat',
    patterns: [
      /\bpalpitations?\b/,
      /\b(?:heart|chest) (?:is |was |keeps |kept )?(?:racing|pounding|fluttering|skipping)\b/,
      /\birregular heart\w*/,
      /\bpalpitazion\w+|\btachicardia\b|\baritmia\b/,
      /\bcuore (?:che )?(?:batte forte|accelera|salta)\b/,
    ],
    words: ['palpitations', 'palpitazioni'],
  },
  {
    // An aching chest after a bench session is usually the muscle. Usually is not enough to
    // send someone back under the bar without a doctor having said so.
    id: 'chest_ache',
    level: 'urgent',
    label: 'pain in the chest',
    patterns: [
      /\bchest (?:really |still )?hurts\b|\bmy chest hurt\b/,
      /\b(?:mi )?fa male (?:il|al) petto\b|\bpetto (?:che )?(?:mi )?fa male\b/,
    ],
  },

  // ---- soon: worth a doctor's appointment before training through it ----
  {
    id: 'night_pain',
    level: 'soon',
    label: 'pain at night or at rest',
    patterns: [
      /\b(?:wakes|woke|waking|keeps|kept) me (?:up )?(?:at night|during the night|in the night|every night)\b/,
      /\b(?:worse|worst|bad|pain|painful|aches?|hurts?) (?:at|during the|in the) night\b/,
      /\bnight (?:pain|time pain)\b/,
      /\bcan't sleep\b(?: [a-z']+){0,3} (?:pain|because|it)\b/,
      /\bconstant pain\b|\bpain (?:even )?(?:at rest|when resting|while resting|lying still)\b/,
      /\b(?:mi )?sveglia (?:di|la|durante la) notte\b|\bdolore (?:notturno|di notte|costante|a riposo|anche a riposo)\b/,
      /\bpeggiora di notte\b/,
    ],
  },
  {
    id: 'weight_loss',
    level: 'soon',
    label: 'weight loss you can’t explain',
    patterns: [
      /\b(?:unexplained|unintentional|unintended|unexpected) weight loss\b/,
      /\b(?:losing|lost|lose) weight without (?:trying|dieting|meaning to)\b/,
      /\b(?:lost|losing) weight for no reason\b/,
      /\b(?:perdita|calo) di peso (?:inspiegabile|involontari[oa]|improvvis[oa]|senza motivo)\b/,
      /\b(?:dimagrit[oa]|perso peso) senza (?:motivo|volerlo|dieta|ragione)\b/,
    ],
  },
  {
    id: 'cancer',
    level: 'soon',
    label: 'a history of cancer',
    patterns: [
      /\bcancer\b|\btumou?r\b|\bmalignan\w+|\bchemo\w*|\boncolog\w+/,
      /\bcancro\b|\btumore\b|\bneoplasia\b|\bchemioterapia\b/,
    ],
  },
  {
    id: 'osteoporosis',
    level: 'soon',
    label: 'osteoporosis',
    patterns: [/\bosteoporo\w+/, /\bosteopenia\b/],
    words: ['osteoporosis', 'osteoporosi'],
  },
];

/**
 * Language that is only a red flag when an assistant says it: a model telling someone to go to
 * A&E, or guessing at a tear, has stepped outside what this feature is for, whatever it adds.
 */
const MODEL_RULE: FlagRule = {
  id: 'model',
  level: 'urgent',
  label: 'something only a doctor can judge',
  patterns: [
    /\b(?:seek|get|requires?|needs?|warrants?) (?:immediate|urgent|emergency|prompt|right away) (?:medical )?(?:care|attention|help|treatment|evaluation|assessment)\b/,
    /\b(?:seek|get) (?:medical )?(?:care|attention|help) (?:immediately|urgently|right away|now)\b/,
    /\bemergency (?:room|department|services|care)\b|\ba ?& ?e\b|\ba and e\b|\burgent care\b/,
    /\bcall (?:911|112|999|9999|an ambulance|emergency)\b/,
    /\b(?:could|may|might|can|would) (?:be|indicate|suggest|signal|mean) (?:a |an )?(?:[a-z']+ ){0,2}(?:fracture|break|rupture|tear|torn|dislocation|herniat\w+|disc|disk|nerve|infection|clot|dvt|thrombosis|cardiac|heart)\b/,
    /\b(?:sounds|looks) like (?:a |an )?(?:[a-z']+ ){0,2}(?:fracture|break|rupture|tear|dislocation|herniat\w+|infection|clot)\b/,
    /\bdiagnos\w+/,
  ],
};

// ---------------------------------------------------------------------------------------------

/** Lower case, no accents, straight apostrophes, one spelling of each contraction. */
export function normaliseSymptoms(text: string): string {
  return text
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[‘’‛`´]/g, "'")
    .replace(/\bcan ?not\b/g, "can't")
    .replace(
      /\b(can|don|doesn|isn|wasn|didn|haven|hasn|hadn|aren|weren|won|couldn|wouldn)'?t\b/g,
      "$1't",
    )
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Clause boundaries. A negation never reaches across one: "no fever, but my foot is numb" is
 * about a numb foot.
 */
const CLAUSE_BREAK =
  /[.;!?\n()]+|\s[-–—]\s|\b(?:but|however|although|though|except|whereas|yet|apart from|ma|pero|tuttavia|eppure|anche se|tranne|invece)\b/;

/** Words that negate what follows them, in the person's own description. */
const NEGATORS = new Set([
  'no',
  'not',
  'never',
  'without',
  'none',
  'nor',
  'neither',
  'denies',
  "don't",
  "doesn't",
  "didn't",
  "isn't",
  "wasn't",
  "aren't",
  "weren't",
  "haven't",
  "hasn't",
  "hadn't",
  'non',
  'nessun',
  'nessuna',
  'nessuno',
  'senza',
  'mai',
  'neanche',
  'nemmeno',
  'neppure',
]);

/** In the model's answer, a condition is advice about what to watch for, not a symptom. */
const HYPOTHETICAL = new Set([
  'if',
  'should',
  'unless',
  'whether',
  'watch',
  'signs',
  'case',
  'avoid',
  "can't",
  'cannot',
  "won't",
  'se',
  'qualora',
]);

/**
 * Words after which a negator is about ability, not about the symptom: "non riesco a camminare"
 * is the symptom itself, as is "not able to walk". These leave the negator inert.
 */
const NOT_A_NEGATION_AFTER = new Set([
  'riesco',
  'posso',
  'riuscivo',
  'able',
  'only',
  'sure',
  'stop',
]);

/** Joining words that may sit inside a list a negation covers: "no numbness, tingling or …". */
const LIST_GLUE = new Set(['or', 'and', 'nor', 'o', 'e', 'ne', 'any', 'or any']);

/** How far back from a symptom a negator can sit and still reach it. */
const NEGATION_REACH = 5;

/** Post-negation: "numbness — none", "tingling: no". */
const AFTER_NEGATORS =
  /^\s*(?:[,:]\s*)?(?:none|nope|nothing|absent|assente|assenti|niente|nessuno)\b/;

interface Token {
  text: string;
  /** A comma, kept so a negation does not wander across an unrelated clause. */
  comma: boolean;
}

function tokensBefore(clause: string, end: number): Token[] {
  const out: Token[] = [];
  for (const m of clause.slice(0, end).matchAll(/[a-z0-9']+|,/g)) {
    out.push({ text: m[0], comma: m[0] === ',' });
  }
  return out;
}

/** Every rule word, so a list of symptoms after a negator stays inside its reach. */
const SYMPTOM_WORDS = new Set([
  'numbness',
  'numb',
  'tingling',
  'tingles',
  'weakness',
  'fever',
  'swelling',
  'bruising',
  'pain',
  'pins',
  'needles',
  'chills',
  'deformity',
  'intorpidimento',
  'formicolio',
  'febbre',
  'gonfiore',
  'debolezza',
  'dolore',
]);

function negated(clause: string, start: number, end: number, model: boolean): boolean {
  const before = tokensBefore(clause, start);
  let reach = 0;
  let segment: Token[] = [];
  for (let i = before.length - 1; i >= 0 && reach < NEGATION_REACH; i--) {
    const t = before[i]!;
    if (t.comma) {
      // Crossing a comma only continues a list of symptoms: "no numbness, tingling, or …".
      const listy = segment.every((s) => LIST_GLUE.has(s.text) || SYMPTOM_WORDS.has(s.text));
      if (!listy) return false;
      segment = [];
      continue;
    }
    segment.push(t);
    reach++;
    const next = before[i + 1]?.text;
    if (NEGATORS.has(t.text) && !(next && NOT_A_NEGATION_AFTER.has(next))) return true;
    if (model && HYPOTHETICAL.has(t.text)) return true;
  }
  return AFTER_NEGATORS.test(clause.slice(end));
}

// ---- misspellings ----

/** Optimal string alignment distance, capped: only "is it within one or two" matters. */
function editDistance(a: string, b: string, cap: number): number {
  if (Math.abs(a.length - b.length) > cap) return cap + 1;
  const prev2 = new Array<number>(b.length + 1).fill(0);
  let prev = Array.from({ length: b.length + 1 }, (_, j) => j);
  for (let i = 1; i <= a.length; i++) {
    const cur = [i];
    let rowMin = i;
    for (let j = 1; j <= b.length; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      let v = Math.min(prev[j]! + 1, cur[j - 1]! + 1, prev[j - 1]! + cost);
      if (i > 1 && j > 1 && a[i - 1] === b[j - 2] && a[i - 2] === b[j - 1]) {
        v = Math.min(v, prev2[j - 2]! + 1);
      }
      cur.push(v);
      if (v < rowMin) rowMin = v;
    }
    if (rowMin > cap) return cap + 1;
    for (let j = 0; j <= b.length; j++) prev2[j] = prev[j]!;
    prev = cur;
  }
  return prev[b.length]!;
}

/**
 * A word close enough to a rule word to be a slip of the thumb. Same first letter, six letters
 * or more on both sides — "fever" against "never" and "fewer" is exactly the confusion this
 * must not make, so short words are matched exactly or not at all.
 */
function misspelt(token: string, word: string): boolean {
  if (token === word || token.length < 6 || word.length < 6) return false;
  if (token[0] !== word[0]) return false;
  return editDistance(token, word, word.length >= 9 ? 2 : 1) <= (word.length >= 9 ? 2 : 1);
}

// ---------------------------------------------------------------------------------------------

const LEVEL_RANK: Record<FlagLevel, number> = { emergency: 0, urgent: 1, soon: 2 };

/**
 * The red flags in a description, most urgent first, one per kind. `mode: 'model'` screens an
 * assistant's answer instead: it adds the rule for advice only a clinician should give, and it
 * reads "if you feel numbness, stop" as the caution it is.
 */
export function screenRedFlags(text: string, mode: 'person' | 'model' = 'person'): RedFlag[] {
  const model = mode === 'model';
  const rules = model ? [...RULES, MODEL_RULE] : RULES;
  const clauses = normaliseSymptoms(text).split(CLAUSE_BREAK);
  const found = new Map<FlagId, RedFlag>();

  for (const raw of clauses) {
    const clause = (raw ?? '').trim();
    if (!clause) continue;
    for (const rule of rules) {
      if (found.has(rule.id)) continue;
      let hit = false;
      for (const p of rule.patterns) {
        const re = new RegExp(p.source, 'g');
        for (const m of clause.matchAll(re)) {
          if (!negated(clause, m.index, m.index + m[0].length, model)) {
            hit = true;
            break;
          }
        }
        if (hit) break;
      }
      if (!hit && rule.words) {
        for (const m of clause.matchAll(/[a-z']+/g)) {
          if (rule.words.some((w) => misspelt(m[0], w))) {
            if (!negated(clause, m.index, m.index + m[0].length, model)) {
              hit = true;
              break;
            }
          }
        }
      }
      if (hit) found.set(rule.id, { id: rule.id, level: rule.level, label: rule.label });
    }
  }
  return [...found.values()].sort((a, b) => LEVEL_RANK[a.level] - LEVEL_RANK[b.level]);
}

/** The most urgent level among some flags, or undefined for none. */
export function worstLevel(flags: readonly RedFlag[]): FlagLevel | undefined {
  let worst: FlagLevel | undefined;
  for (const f of flags) {
    if (!worst || LEVEL_RANK[f.level] < LEVEL_RANK[worst]) worst = f.level;
  }
  return worst;
}

/** What to do, by level. Emergency numbers for where the people using this live and travel. */
export const LEVEL_ADVICE: Record<FlagLevel, { title: string; body: string }> = {
  emergency: {
    title: 'Get help now',
    body: 'Call your emergency number (112 in Italy and across Europe, 911 in the US, 9999 in Oman) or go to an emergency department. Don’t train.',
  },
  urgent: {
    title: 'See a doctor today',
    body: 'Get this looked at today, by your doctor or an urgent care service, before you train on it.',
  },
  soon: {
    title: 'See a doctor first',
    body: 'Book a doctor’s appointment before you train through this. It is worth checking even when the pain itself is mild.',
  },
};
