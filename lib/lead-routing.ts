import "server-only";

import type { Answers, PersonaId } from "@/lib/personas";

/**
 * Persona and answer signals → affiliated entities.
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * ⚠ THIS FILE NAMES THE ENTITIES. IT MUST NEVER REACH THE BROWSER.
 *
 * `import "server-only"` on line 1 is the enforcement, not a comment: if any
 * Client Component imports this module — directly or through a chain — the
 * build FAILS. The bundle is never produced. That is why the entity names live
 * here and nowhere else, and why lib/personas.ts (which the wizard does import)
 * contains none of them.
 *
 * Build Brief §09, verbatim: "Entity names never visible to public. Concierge
 * model. Visitors only see 'our advisory team' / 'a licensed Florida
 * professional.' Never expose Stairway / Realty / BBC / Capital / Builders in
 * any public-facing route or copy."
 *
 * The routing result is written to leads.routed_entities for the concierge. It
 * is never returned to the client, never rendered, and never placed in a hidden
 * field.
 * ═══════════════════════════════════════════════════════════════════════════
 */

export type Entity =
  | "Stairway Mortgage"
  | "Blackburn Realty Group"
  | "Blackburn Business Capital"
  | "Blackburn Capital"
  | "Blackburn Builders";

/** Primary destination per persona, from Eight_Personas.docx "Routing". */
const PRIMARY_BY_PERSONA: Record<PersonaId, { entity: Entity; reason: string }> = {
  1: { entity: "Stairway Mortgage", reason: "HELOC pre-approval (renovation backup)" },
  2: { entity: "Stairway Mortgage", reason: "Renovation financing consultation" },
  3: { entity: "Blackburn Capital", reason: "Off-market purchase / equity preservation" },
  4: { entity: "Blackburn Business Capital", reason: "Hard money / fix-and-flip financing" },
  5: { entity: "Stairway Mortgage", reason: "203k / HomeStyle renovation loan" },
  6: { entity: "Stairway Mortgage", reason: "HELOC (preserves low mortgage rate)" },
  7: { entity: "Stairway Mortgage", reason: "Reverse mortgage (HECM)" },
};

export interface Route {
  entity: Entity;
  priority: "PRIMARY" | "SECONDARY";
  reasons: string[];
}

/**
 * Merge persona and answer signals into one route set.
 *
 * Map<Entity, Set<Reason>> per Build Brief §06 — an entity appears once with
 * every reason attached, rather than several times. The concierge sees a single
 * lead carrying all the reasons and decides the order of hand-offs.
 *
 * The hard rules from §06 are applied on top of the persona's primary route,
 * which is why Q4–Q7 matter even though they do not change the persona:
 *
 *   "Every sell-intent lead routes to Realty. No exceptions."
 *   "Every purchase-intent lead routes to Realty."
 *   "Every investment-intent lead routes to Realty."
 *   "Every loan-intent lead routes to Stairway. Unless it's investor-specific,
 *    in which case BBC takes priority."
 */
export function determineRouting(persona: PersonaId, answers: Answers): Route[] {
  const routes = new Map<Entity, Route>();

  const add = (entity: Entity, reason: string, primary = false) => {
    const existing = routes.get(entity);
    if (existing) {
      if (!existing.reasons.includes(reason)) existing.reasons.push(reason);
      if (primary) existing.priority = "PRIMARY";
      return;
    }
    routes.set(entity, {
      entity,
      priority: primary ? "PRIMARY" : "SECONDARY",
      reasons: [reason],
    });
  };

  const primary = PRIMARY_BY_PERSONA[persona];
  add(primary.entity, primary.reason, true);

  // Q4 — sell intent. "Aldo gets every homeowner planning to sell."
  const sell = answers[4];
  if (sell === "sell_this_house" || sell === "sell_different") {
    add("Blackburn Realty Group", "Sell intent within 12 months");
  } else if (sell === "sell_maybe") {
    add("Blackburn Realty Group", "Possible sale within 12 months");
  }

  // Q5 — loan intent. Investor-specific borrowing goes to BBC, not Stairway.
  const loan = answers[5];
  if (loan === "loan_renovation") add("Stairway Mortgage", "Renovation loan intent");
  if (loan === "loan_home_purchase") {
    add("Stairway Mortgage", "Purchase loan intent");
    add("Blackburn Realty Group", "Purchase intent");
  }
  if (loan === "loan_business") {
    add("Blackburn Business Capital", "Business loan intent");
  }

  // Q6 — equity. A HELOC / refi signal regardless of persona.
  const equity = answers[6];
  if (equity === "equity_yes_here") add("Stairway Mortgage", "Equity available in current home");
  if (equity === "equity_thought" || equity === "equity_learn") {
    add("Stairway Mortgage", "Open to an equity conversation");
  }

  // Q7 — investment intent. Realty for acquisition, BBC for the financing.
  const invest = answers[7];
  if (invest === "invest_buy" || invest === "invest_flip") {
    add("Blackburn Realty Group", "Investment acquisition intent");
    add("Blackburn Business Capital", "Investment financing intent");
  } else if (invest === "invest_maybe") {
    add("Blackburn Realty Group", "Possible future investment purchase");
  }

  return Array.from(routes.values());
}

/** Shape written to leads.routed_entities — { entity: [reasons] }. */
export function routesToJson(routes: Route[]): Record<string, string[]> {
  return Object.fromEntries(routes.map((r) => [r.entity, r.reasons]));
}
