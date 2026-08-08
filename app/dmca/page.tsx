import type { Metadata } from "next";

import ContentPageLayout, {
  LegalBanner,
  SectionHeading,
} from "@/components/ContentPageLayout";
import { publicPageMetadata } from "@/lib/seo";

/**
 * DMCA Notice and Takedown — /dmca
 * Source: _handoff/02_mockups_production/07_legal_pages/dmca.html
 *
 * Attorney text, transcribed verbatim. See app/privacy/page.tsx for the rule.
 *
 * ===========================================================================
 * ⚠ INCOMPLETE FOR SAFE HARBOUR — EMAIL ONLY, NO AGENT PHONE NUMBER.
 *
 * The mockup read "(954) [PHONE]": the attorney left the number to be filled
 * in. Rather than invent one — a fabricated agent number earns no safe harbour
 * and is worse than none — the line was removed on 2026-07-31 and the listing
 * is email-based.
 *
 * WHAT THIS DOES AND DOES NOT ACHIEVE. It removes a visibly unfinished
 * placeholder from a live public page. It does NOT make the listing compliant.
 * 17 U.S.C. § 512(c)(2) enumerates what a designated-agent listing must
 * contain — "the name, address, phone number, and electronic mail address of
 * the agent" — so the phone number is required by statute, not optional when an
 * email is present. Removing it moved the gap from visible to invisible; it did
 * not close it.
 *
 * TWO THINGS REMAIN, BOTH LEGAL TASKS RATHER THAN BUILD TASKS:
 *   1. A real phone number for the designated agent, restored to the block
 *      below and included in the registration.
 *   2. Registration of the designated agent with the U.S. Copyright Office at
 *      dmca.copyright.gov. The on-site listing alone never qualified — § 512(c)
 *      conditions the safe harbour on the agent being registered with the
 *      Office, and the registration form itself requires a phone number.
 *
 * Until both are done, assume the § 512(c) safe harbour is unavailable and that
 * takedown notices must be handled on their merits rather than under it.
 * ===========================================================================
 */

/**
 * ⚠ REQUIRED, NOT DECORATION. Without it this page is FULLY static and its
 * "Data as of …" line — rendered by Header and Footer via dataAsOf() — is baked
 * in at build time and never updates again, including after a weekly DBPR
 * import.
 *
 * That became possible on 2026-08-07: dataAsOf() stopped reading cookies (see
 * lib/supabase/public.ts), which was the only thing keeping these content pages
 * dynamic. They went static as a side effect and would have frozen the date
 * permanently. lib/data-as-of.ts predicted exactly this failure in its docblock.
 *
 * 86400 matches the listing routes: DBPR publishes weekly, so a day is well
 * inside the window in which the date can actually change.
 */
export const revalidate = 86400;

export const metadata: Metadata = publicPageMetadata({
  title: "DMCA Notice and Takedown · Florida Contractor Registry",
  description:
    "How to report copyright infringement on FloridaContractorRegistry.com, what a valid DMCA notice must contain, and how we respond to one once it is received.",
  path: "/dmca",
});

export default function DmcaPage() {
  return (
    <ContentPageLayout
      slug="/dmca"
      kicker="DMCA Notice and Takedown Procedure"
      h1Plain="DMCA notice and"
      h1Em="takedown."
      lede="How to report copyright infringement on FloridaContractorRegistry.com, and how we respond."
      readMinutes={5}
      metaLabel="Effective"
      isLegal
    >
      <LegalBanner label="Designated DMCA Agent">
        Olga&rsquo;s Friends LLC &middot; Attn: DMCA Agent &middot; 1520 E Sunrise
        Blvd, Fort Lauderdale, FL 33304
        <br />
        Notices should be sent by email to{" "}
        <strong>dmca@floridacontractorregistry.com</strong>.
      </LegalBanner>

      <SectionHeading num={1}>Our policy</SectionHeading>
      <p>
        Olga&rsquo;s Friends LLC (&ldquo;we,&rdquo; &ldquo;us,&rdquo; or
        &ldquo;our&rdquo;) respects the intellectual property rights of others and
        expects users of FloridaContractorRegistry.com (the &ldquo;Site&rdquo;) to
        do the same. In accordance with the Digital Millennium Copyright Act of
        1998 (the &ldquo;DMCA&rdquo;), 17 U.S.C. &sect; 512, we respond
        expeditiously to claims of copyright infringement that are reported to our
        designated DMCA agent.
      </p>

      <SectionHeading num={2}>Designated DMCA agent</SectionHeading>
      <p>
        Notices of claimed copyright infringement should be sent by email to{" "}
        <strong>dmca@floridacontractorregistry.com</strong>, or by mail to the
        Designated DMCA Agent at the address shown above. Email is the fastest
        route and is the preferred method. Notices sent to any other address may
        not receive a timely response.
      </p>

      <SectionHeading num={3}>
        How to file a notice of claimed infringement
      </SectionHeading>
      <p>
        To file a notice of claimed infringement, you must provide a written
        communication that includes substantially all of the following
        information, as required by 17 U.S.C. &sect; 512(c)(3):
      </p>
      <ol>
        <li>
          A physical or electronic signature of the copyright owner or person
          authorized to act on their behalf
        </li>
        <li>
          Identification of the copyrighted work claimed to have been infringed
          (or, if multiple works at a single online site are covered by a single
          notification, a representative list)
        </li>
        <li>
          Identification of the material claimed to be infringing and information
          reasonably sufficient to locate it on the Site (a URL is preferred)
        </li>
        <li>
          Contact information for the complaining party (name, address, telephone
          number, email)
        </li>
        <li>
          A statement that the complaining party has a good faith belief that use
          of the material in the manner complained of is not authorized by the
          copyright owner, its agent, or the law
        </li>
        <li>
          A statement that the information in the notification is accurate, and
          under penalty of perjury, that the complaining party is authorized to
          act on behalf of the copyright owner
        </li>
      </ol>
      <p>
        Notices that do not include this information may be invalid under the DMCA
        and may not result in removal.
      </p>

      <SectionHeading num={4}>How we respond</SectionHeading>
      <p>
        When we receive a valid notice of claimed infringement, we will:
      </p>
      <ul>
        <li>
          Remove or disable access to the allegedly infringing material
          expeditiously
        </li>
        <li>Notify the user who uploaded the material that we have done so</li>
        <li>Provide the user a copy of the notice</li>
        <li>Inform the user of their right to file a counter-notice</li>
      </ul>

      <SectionHeading num={5}>Counter-notification</SectionHeading>
      <p>
        If you believe content you uploaded was removed in error, you may submit a
        counter-notification. To be effective, a counter-notification must include:
      </p>
      <ol>
        <li>Your physical or electronic signature</li>
        <li>
          Identification of the material that has been removed and the location
          where it appeared before removal
        </li>
        <li>
          A statement under penalty of perjury that you have a good faith belief
          the material was removed in error or misidentification
        </li>
        <li>
          Your name, address, telephone number, and consent to the jurisdiction of
          the federal district court for the judicial district in which you reside
          (or, if you reside outside the U.S., for any judicial district in which
          we may be found)
        </li>
        <li>
          A statement that you will accept service of process from the original
          complainant or their agent
        </li>
      </ol>
      <p>
        After receiving a valid counter-notification, we will forward it to the
        original complainant and inform them that we may restore the material in
        10 to 14 business days unless they notify us that they have filed a court
        action.
      </p>

      <SectionHeading num={6}>Repeat infringers</SectionHeading>
      <p>
        Consistent with the DMCA and other applicable laws, we maintain a policy
        of terminating, in appropriate circumstances, the accounts of users who
        are repeat infringers.
      </p>

      <SectionHeading num={7}>Misrepresentations</SectionHeading>
      <p>
        Under the DMCA, any person who knowingly materially misrepresents that
        material is infringing &mdash; or that material was removed by mistake
        &mdash; may be liable for damages. Do not submit a notice or
        counter-notice unless you genuinely believe what you are stating.
      </p>

      <SectionHeading num={8}>Contact</SectionHeading>
      <p>
        DMCA notices and counter-notices must be sent to the Designated DMCA
        Agent. Other questions about copyright on the Site can be sent to{" "}
        <strong>legal@floridacontractorregistry.com</strong>.
      </p>
    </ContentPageLayout>
  );
}
