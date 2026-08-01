/**
 * Persona detection for the diagnostic flow.
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * THIS FILE IS CLIENT-SAFE AND MUST STAY THAT WAY. It contains no entity names,
 * no routing, and no revenue logic — only the questions, the persona a set of
 * answers resolves to, and the copy the visitor reads.
 *
 * Entity routing lives in lib/lead-routing.ts, which is marked `server-only` so
 * that importing it from a client component fails the build. That split is what
 * makes "entity names never reach the browser" a structural guarantee rather
 * than a thing someone has to remember.
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * WHICH PERSONA SET. Three sources disagree. Build Brief §06 lists one set
 * (Quality Seeker / Major Project / Cash Project / Sell First / HELOC-Refi /
 * 203k / Reverse / Investor); Eight_Personas.docx and diagnostic_flow_v2.html
 * list another and agree with each other. The mockup is executable and matches
 * the persona document, so it wins. Flagged for Jim — the Build Brief §06 table
 * needs updating or the divergence explaining.
 *
 * Persona 8 (The Contractor Without an Online Presence) is deliberately absent:
 * it is a contractor-side persona reached from a different banner, not an
 * outcome of the homeowner diagnostic. Seven outcomes, not eight.
 */

/* ========================================================================== *
 * QUESTIONS
 * ========================================================================== */

export interface Choice {
  value: string;
  label: string;
}

export interface Question {
  id: number;
  /** Small line above the question. */
  eyebrow: string;
  prompt: string;
  choices: Choice[];
}

/**
 * The seven questions, verbatim option values from
 * _handoff/02_mockups_production/03_conversion_flow/diagnostic_flow_v2.html.
 *
 * Q1–Q3 determine the persona. Q4–Q7 do NOT — they add routing signals, which
 * is why they can be answered in any combination without changing the reframe
 * the visitor sees.
 */
export const QUESTIONS: readonly Question[] = [
  {
    id: 1,
    eyebrow: "Your situation",
    prompt: "Let's make sure you have the full picture.",
    choices: [
      { value: "own_renovating", label: "I own it and I'm planning a renovation" },
      { value: "buying_to_flip", label: "I'm buying it to fix up and sell" },
      { value: "just_bought_home", label: "I just bought it and I'm settling in" },
      { value: "considering_selling", label: "I'm considering selling" },
      { value: "researching", label: "I'm still researching — no decision yet" },
    ],
  },
  {
    id: 2,
    eyebrow: "Your plans",
    prompt: "A little about your plans.",
    choices: [
      { value: "forever", label: "This is my forever home" },
      { value: "long_term", label: "I'll be here a long time" },
      { value: "5_to_10", label: "Maybe five to ten years" },
      { value: "selling_soon", label: "I expect to sell soon" },
      { value: "investment", label: "It's an investment property" },
      { value: "just_moved", label: "I just moved in" },
    ],
  },
  {
    id: 3,
    eyebrow: "Your approach",
    prompt: "And about your approach.",
    choices: [
      { value: "cash", label: "Paying cash from savings" },
      { value: "preserve_savings", label: "I'd rather not touch my savings" },
      { value: "financing", label: "I'll need financing of some kind" },
      { value: "cant_afford", label: "Honestly, affording it is the problem" },
      { value: "fast_capital", label: "I need capital quickly" },
      { value: "not_thought", label: "I haven't thought about it yet" },
    ],
  },
  {
    id: 4,
    eyebrow: "Looking ahead",
    prompt: "In the next 12 months, do you expect to sell a property?",
    choices: [
      { value: "sell_this_house", label: "Yes — this house" },
      { value: "sell_different", label: "Yes — a different property" },
      { value: "sell_maybe", label: "Possibly" },
      { value: "sell_no", label: "No" },
    ],
  },
  {
    id: 5,
    eyebrow: "Looking ahead",
    prompt: "In the same 12 months, do you expect to take out a loan?",
    choices: [
      { value: "loan_renovation", label: "Yes — for the renovation" },
      { value: "loan_home_purchase", label: "Yes — to buy a home" },
      { value: "loan_business", label: "Yes — for a business" },
      { value: "loan_maybe", label: "Possibly" },
      { value: "loan_no", label: "No" },
    ],
  },
  {
    id: 6,
    eyebrow: "Something worth knowing",
    prompt: "A question many haven't thought about — do you have equity you could use?",
    choices: [
      { value: "equity_yes_here", label: "Yes, in this home" },
      { value: "equity_thought", label: "I've thought about it" },
      { value: "equity_learn", label: "I'd like to understand it better" },
      { value: "equity_no", label: "No, or I'd rather not" },
    ],
  },
  {
    id: 7,
    eyebrow: "Last one",
    prompt: "Are you considering buying an investment property?",
    choices: [
      { value: "invest_buy", label: "Yes — to hold and rent" },
      { value: "invest_flip", label: "Yes — to fix and sell" },
      { value: "invest_maybe", label: "Maybe someday" },
      { value: "invest_no", label: "No" },
    ],
  },
] as const;

/** Answers keyed by question id. Partial while the wizard is in progress. */
export type Answers = Partial<Record<number, string>>;

/* ========================================================================== *
 * CAPTURE-STEP FIELDS
 * ========================================================================== */

/**
 * Four data points GoHighLevel has fields for that the seven questions never
 * produced: contact.budget, contact.timeline, contact.insurance and
 * contact.contact_preference. Until now they could only ever be blank, because
 * nothing on the site asked for them.
 *
 * THEY LIVE ON THE CAPTURE STEP, NOT AS NEW QUESTIONS. Three extra full-screen
 * questions in a seven-question funnel is a real cost to completion; four
 * compact selects beside name/email/phone is close to none, and the visitor is
 * already committed by the time they reach that screen.
 *
 * SOURCING. The budget bands are verbatim from Eight_Personas.docx (Persona 1,
 * Question 2 — "Under $15,000 / $15,000–$40,000 / $40,000–$100,000 / Over
 * $100,000 / Not sure yet"). The timeline bands mirror the taxonomy already used
 * by the GHL location's own contact.timeline_to_buy field, so the values read
 * consistently against the rest of the CRM. The insurance and contact-preference
 * options are NOT from any source document — no spec defines them. They are
 * deliberately minimal and neutral; change the wording freely.
 *
 * Stored in leads.diagnostic_answers alongside the numbered answers, under these
 * string keys. That is why no migration was needed: the column is jsonb.
 */
export interface CaptureField {
  /** Key in diagnostic_answers, and the name of the form control. */
  key: "budget" | "timeline" | "insurance" | "contact_preference";
  label: string;
  choices: readonly Choice[];
}

export const CAPTURE_FIELDS: readonly CaptureField[] = [
  {
    key: "budget",
    label: "Estimated project cost",
    choices: [
      { value: "under_15k", label: "Under $15,000" },
      { value: "15k_40k", label: "$15,000 – $40,000" },
      { value: "40k_100k", label: "$40,000 – $100,000" },
      { value: "over_100k", label: "Over $100,000" },
      { value: "budget_not_sure", label: "Not sure yet" },
    ],
  },
  {
    key: "timeline",
    label: "When do you want the work done",
    choices: [
      { value: "ready_now", label: "Ready now (0–30 days)" },
      { value: "1_3_months", label: "1–3 months" },
      { value: "3_6_months", label: "3–6 months" },
      { value: "6_12_months", label: "6–12 months" },
      { value: "just_exploring", label: "Just exploring" },
    ],
  },
  {
    key: "insurance",
    label: "Homeowners insurance",
    choices: [
      { value: "insured", label: "Yes, currently insured" },
      { value: "not_insured", label: "No, not currently insured" },
      { value: "insurance_not_sure", label: "Not sure" },
    ],
  },
  {
    key: "contact_preference",
    label: "Best way to reach you",
    choices: [
      { value: "phone", label: "Phone call" },
      { value: "text", label: "Text message" },
      { value: "email", label: "Email" },
    ],
  },
] as const;

/** Capture-step answers, keyed by CaptureField.key. */
export type CaptureAnswers = Partial<Record<string, string>>;

/* ========================================================================== *
 * PERSONAS
 * ========================================================================== */

export type PersonaId = 1 | 2 | 3 | 4 | 5 | 6 | 7;

export interface Persona {
  id: PersonaId;
  /** Stored in leads.primary_persona. Stable — do not rename casually. */
  slug: string;
  /** Internal label. Shown to the concierge, never to the visitor. */
  name: string;
  /** Heading on the reframe screen. */
  headline: string;
  /** Reframe body, from Eight_Personas.docx "The Reframe" (Variant A). */
  body: readonly string[];
  /** Capture heading and blurb, from "The Capture". */
  captureHeading: string;
  captureBody: string;
}

/**
 * ═══════════════════════════════════════════════════════════════════════════
 * ⚠ PRIORITY ORDER IS A BUSINESS DECISION — JIM TO CONFIRM.
 *   Wrong order routes high-value leads to the wrong entity.
 *
 * A visitor's answers can satisfy several personas at once. Detection walks
 * this array in order and takes the FIRST match, so this array — and nothing
 * else — decides who wins an overlap. Reordering it reroutes revenue.
 *
 * This is the order implemented in diagnostic_flow_v2.html, kept as the default
 * so the build is not blocked. Three consequences Jim should weigh:
 *
 *   1. INVESTOR BEATS EVERYTHING. `q3 = fast_capital` alone resolves to
 *      Fix-and-Flip even when q1 says "I own it and I'm planning a renovation".
 *      A homeowner who needs money quickly is classified as an investor.
 *
 *   2. SENIOR IS CHECKED BEFORE LONG-TERM, and persona 7's condition
 *      (forever + preserve_savings) is a subset of persona 6's. So 6 only ever
 *      fires on long_term + preserve_savings. NOTHING IN THE FLOW ASKS AGE —
 *      the reverse-mortgage route has no 62+ eligibility signal at all, so it
 *      will generate unqualified leads.
 *
 *   3. URGENT OWNER IS THE CATCH-ALL. Any unmatched combination lands there.
 *
 * Changing the order is a one-line edit to this array.
 * ═══════════════════════════════════════════════════════════════════════════
 */
export const PERSONA_PRIORITY: readonly PersonaId[] = [4, 5, 3, 7, 6, 2, 1];

/**
 * What each persona requires. Evaluated in PERSONA_PRIORITY order.
 * Persona 1 has no matcher — it is the fallback.
 */
const MATCHERS: Record<Exclude<PersonaId, 1>, (a: Answers) => boolean> = {
  4: (a) => a[1] === "buying_to_flip" || a[2] === "investment" || a[3] === "fast_capital",
  5: (a) => a[1] === "just_bought_home" || a[2] === "just_moved",
  3: (a) => a[1] === "considering_selling" || a[2] === "selling_soon" || a[3] === "cant_afford",
  7: (a) => a[2] === "forever" && a[3] === "preserve_savings",
  6: (a) => a[3] === "preserve_savings" && (a[2] === "long_term" || a[2] === "forever"),
  2: (a) => a[3] === "cash" || a[1] === "researching",
};

/**
 * Reframe and capture copy, transcribed from Eight_Personas.docx.
 *
 * ONE DELIBERATE EDIT. Persona 7's capture copy in the source document names an
 * affiliated entity and its parent lender to the visitor, which contradicts the
 * Build Brief's own hard rule ("Entity names never visible to public... Visitors
 * only see 'our advisory team'"). That clause is removed here. Flagged for Jim:
 * Eight_Personas.docx needs the same correction, or someone will reintroduce it.
 *
 * The entity is not named even in this comment. THIS FILE IS IMPORTED BY THE
 * CLIENT BUNDLE, and while minification strips comments, relying on that is a
 * weaker guarantee than simply not writing the name in a client-reachable file.
 *
 * Variants B–D from Reframe_Variants.docx are NOT implemented. Their trigger
 * conditions reference per-persona question sets ("Q2: Under $15,000 project
 * size") that this shared seven-question flow does not ask, so none of them can
 * fire. Wiring them needs either those questions added or the triggers rewritten
 * against these answers — a content decision, not a build one.
 */
export const PERSONAS: Record<PersonaId, Persona> = {
  1: {
    id: 1,
    slug: "urgent_owner",
    name: "Urgent Owner",
    headline: "You're moving fast. Here's the part most people miss.",
    body: [
      "Based on what you told us, you are about to start a project on a tight timeline using cash or short-term credit. Here is what most homeowners in your situation discover the hard way.",
      "Renovation budgets run over 40% of the time. The most common cause is not bad contractors — it is hidden conditions revealed during demo (rotted framing, outdated wiring, plumbing surprises). When that happens mid-project, you have three bad options: pause the work, accept whatever financing you can get fast, or eat the overrun on credit cards.",
      "There is a fourth option most people do not consider: get a HELOC pre-approved before the project starts. It costs nothing to have in place. You only pay interest if you draw on it. If the project comes in on budget, you never use it and you owe nothing.",
      "Think of it as renovation insurance. Free until you need it. Available the moment you do.",
    ],
    captureHeading: "Talk to a licensed advisor — free, no pressure, no commitment.",
    captureBody:
      "A licensed advisor will reach out within one business day to walk you through whether a pre-approved HELOC makes sense for your specific situation. If it does not, you have lost 15 minutes. If it does, you have just bought yourself peace of mind for the entire project.",
  },
  2: {
    id: 2,
    slug: "quality_seeker",
    name: "Quality-Seeker",
    headline: "You're doing it the right way. Here's the one signal most people skip.",
    body: [
      "You are doing it the right way. Interviewing multiple contractors. Looking at reviews. Asking the right questions. Here is what most quality-seekers do not realize.",
      "Reviews are easy to fake. References only show you the contractor's three happiest customers. The single most reliable signal of whether a contractor will actually finish your job is their permit history — every permit they have pulled, in every county, with the final inspection status visible. That data is public but most people never look at it.",
      "Before you sign anything, get the hiring checklist. It walks you through the seven things to verify — and three things to never accept — before you write a check. We also include a script for the reference conversation that gets you past the cherry-picked answers.",
    ],
    captureHeading: "Get the Florida Contractor Hiring Checklist — free.",
    captureBody:
      "We will send it to your email along with a permit lookup guide for your county. If you want a second opinion on the specific contractor you are considering, a licensed advisor can review their permit history with you on a free call. No commitment.",
  },
  3: {
    id: 3,
    slug: "tax_distressed",
    name: "Tax-Distressed / Considering Selling",
    headline: "There are more options here than most people realize.",
    body: [
      "Thank you for trusting us with that. We understand this is a difficult situation, and we are not here to pressure you in any direction.",
      "Most homeowners in your position think their only option is to fix up the house and list it. That can work — but it requires money you may not have right now, time you may not have either, and a successful sale before the deadline. That is a lot of variables.",
      "Here are options most homeowners do not know about. An investor group may buy your home directly, with no renovations required, no showings, and a closing date that protects you from foreclosure or tax sale. Some investors will fund the renovation in exchange for the listing — you stay in the home during the work and split the upside. Some will structure a creative buyout that lets you walk away with cash in hand instead of foreclosure on your record.",
      "None of these options are right for everyone. But knowing they exist means you can make the right decision for your situation instead of the only decision you thought you had.",
    ],
    captureHeading: "Talk to a specialist — free, private, no pressure.",
    captureBody:
      "A specialist who handles situations like yours every day will reach out privately to walk you through your specific options. There is no commitment, no obligation, and the conversation is confidential.",
  },
  4: {
    id: 4,
    slug: "fix_and_flip",
    name: "Fix-and-Flip Investor",
    headline: "The deal that gets won is the one that closes fastest.",
    body: [
      "Based on what you told us, here is what most flippers learn the expensive way.",
      "The deal that gets won is the one that closes fastest. In Florida's competitive markets, sellers — especially distressed sellers — accept the offer they trust will close, not necessarily the highest one. A flipper who can show proof of funds and a 7-day close beats a flipper offering 5% more with conventional financing every time.",
      "Hard money is built for exactly this. Funds in your control before you submit the offer. Closing in days, not weeks. Underwriting based on the deal, not your tax returns. Yes, the rate is higher than conventional — but on a 4-month flip, the higher rate costs you a few thousand. Losing the deal costs you the entire profit.",
      "Before your next offer, get pre-approved. It is free, fast, and gives you something most flippers do not have: confidence that you can close on whatever you find.",
    ],
    captureHeading: "Get pre-approved — free, fast, no commitment.",
    captureBody:
      "A licensed lender will reach out to walk you through your eligibility, terms, and rates. Pre-approval costs nothing. Having it in your back pocket means the next time the right deal comes up, you can move.",
  },
  5: {
    id: 5,
    slug: "new_to_town",
    name: "New-to-Town",
    headline: "Welcome to Florida. Here's what most new buyers don't know.",
    body: [
      "Welcome to Florida. Here is what most out-of-state buyers do not know about the renovation.",
      "There is a type of mortgage called a 203k renovation loan. It folds the cost of the renovation into your mortgage — one loan, one closing, one monthly payment. You do not have to drain your savings, you do not have to wait until you have built up equity, and you do not have to pay HELOC rates on top of your mortgage.",
      "The catch is timing. If you have already closed on the home with a conventional mortgage, you may have missed the window for a 203k. But there are alternatives — including construction-to-permanent loans and a renovation refinance — that can still get you there.",
      "Before you write a check for the renovation, talk to a licensed advisor. Fifteen minutes can save you tens of thousands of dollars and months of cash flow stress.",
    ],
    captureHeading: "Talk to a Florida loan advisor — free, no commitment.",
    captureBody:
      "A licensed advisor will walk you through your specific timing and which financing makes the most sense. They will tell you honestly whether you missed the 203k window or whether there is still a path. Either way, you will know your options.",
  },
  6: {
    id: 6,
    slug: "long_term_owner",
    name: "Long-Term Owner",
    headline: "Here's the math most long-term owners never run.",
    body: [
      "Based on what you told us, here is the math most long-term owners never run.",
      "If you have a mortgage rate under 5% and you refinance to today's rates to fund a renovation, you may pay an extra $200,000 in interest over the life of the new loan. That is the renovation cost twice over. The renovation you wanted just got a lot more expensive.",
      "There is a better way. A HELOC is a separate loan, secured by your equity, that sits behind your existing mortgage. Your low rate stays intact. You only pay interest on what you actually draw. When the renovation is paid off, you close the HELOC and you are back where you started — with the upgraded home and the original mortgage still in place.",
      "Run the numbers. The difference is usually staggering.",
    ],
    captureHeading: "Get a personalized analysis — free, no commitment.",
    captureBody:
      "A licensed advisor will calculate exactly what a HELOC would cost compared to refinancing for your specific situation. The conversation takes 15 minutes. The decision affects the next 20 years of your finances.",
  },
  7: {
    id: 7,
    slug: "senior_equity",
    name: "Senior with Equity",
    headline: "There may be a way to do this without touching your savings.",
    body: [
      "Based on what you shared, here is what most homeowners in your situation do not know.",
      "You have owned your home for a long time. You want to stay in it. You would rather not deplete your savings. And you may have a mortgage payment you would love to eliminate.",
      "There is a federally-backed product called a reverse mortgage — specifically the HECM program, insured by HUD — that may allow you to fund a renovation with no out-of-pocket cost, eliminate your existing monthly mortgage payment, stay in your home as long as you live there, and never make a payment back on the loan while you remain in the home.",
      "Reverse mortgages have a reputation problem. Decades ago, the product was poorly regulated and aggressive operators damaged its reputation. Today's reverse mortgages are heavily regulated, require HUD-approved counseling before you can even apply, and protect the homeowner in ways that did not exist before.",
      "Before you spend savings or take on a loan you will struggle to repay, talk to a licensed advisor. The consultation is free. There is no pressure to apply. They will walk you through your specific numbers and tell you honestly whether this applies to your situation.",
    ],
    captureHeading: "Talk to a licensed advisor — free, no pressure.",
    captureBody:
      "A licensed advisor will reach out within one business day. They will walk you through your specific situation and tell you honestly whether this is a fit for you. HUD-approved counseling is required before any application can move forward, so you will never be pressured into a decision.",
  },
};

/**
 * Resolve a persona from the answers.
 *
 * First match in PERSONA_PRIORITY order wins; persona 1 is the fallback. Pure
 * and synchronous so it can run on the client for the reframe screen and again
 * on the server for the stored value, without the two disagreeing.
 */
export function detectPersona(answers: Answers): Persona {
  for (const id of PERSONA_PRIORITY) {
    if (id === 1) break;
    if (MATCHERS[id as Exclude<PersonaId, 1>](answers)) return PERSONAS[id];
  }
  return PERSONAS[1];
}

/** Every persona a set of answers matches, for diagnostics and tests. */
export function allMatchingPersonas(answers: Answers): PersonaId[] {
  const out: PersonaId[] = [];
  for (const id of [2, 3, 4, 5, 6, 7] as const) {
    if (MATCHERS[id](answers)) out.push(id);
  }
  return out;
}
