/**
 * TCPA consent text — ONE definition, rendered in both places it appears.
 *
 * This string is shown next to the consent checkbox on the diagnostic capture
 * form AND published as Section 3 of /sms-terms. It is also stored verbatim on
 * every lead that opts in (leads.sms_consent_text).
 *
 * THE THREE MUST BE THE SAME BYTES, AND A CONSTANT IS THE ONLY WAY TO GUARANTEE
 * IT. The evidentiary value of storing the text is that it proves what the
 * visitor actually saw. If the form said one thing, the published terms said
 * another, and the database recorded a third, the stored record proves nothing —
 * which is worse than not storing it, because it looks like proof.
 *
 * So: /sms-terms renders this constant, the form renders this constant, and the
 * server action writes this constant. Editing the wording is a single edit here,
 * and it should only ever happen on the attorney's instruction.
 *
 * WRITTEN WITH REAL TYPOGRAPHIC CHARACTERS, not HTML entities. React escapes on
 * render, so the page still displays correctly — but the value stored in the
 * database is the human-readable sentence rather than a string full of &rsquo;.
 */
export const SMS_CONSENT_TEXT =
  "I understand that a member of Florida Contractor Registry's advisory team " +
  "will reach out by phone, email, or text to discuss my situation. By checking " +
  "this box and providing my phone number, I expressly consent to receive " +
  "recurring text messages from Olga's Friends LLC at the number provided, " +
  "including messages sent using an automatic telephone dialing system or " +
  "pre-recorded voice. Consent is not a condition of any purchase. Message " +
  "frequency varies. Message and data rates may apply. Reply STOP to opt out at " +
  "any time. Reply HELP for help. See our SMS Terms and Privacy Policy.";

/**
 * CONSENT IS OPTIONAL AND THE FORM MUST WORK WITHOUT IT.
 *
 * /sms-terms Section 2 states that consent "is not a condition of receiving
 * advisory services, which can also be conducted entirely by phone or email at
 * your preference." A required checkbox would contradict the published terms and
 * undermine the position they exist to establish.
 *
 * Unchecked means the lead is still saved, with sms_consent false and both
 * sms_consent_text and sms_consent_timestamp left NULL — never an empty string,
 * so "no consent recorded" is distinguishable from "consent recorded as blank".
 */
export const CONSENT_IS_OPTIONAL = true;
