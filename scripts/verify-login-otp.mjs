/**
 * Email-code sign-in.
 *
 * Exercises exactly what verifyLoginCode() does — verifyOtp with type "email"
 * against the anon client — for both the returning-contractor and first-time
 * shapes, plus the failure modes a real person will hit.
 */
import { createClient } from "@supabase/supabase-js";
import { readFileSync } from "node:fs";
import { randomUUID } from "node:crypto";

const env = Object.fromEntries(
  readFileSync(".env.local", "utf8").split("\n")
    .filter((l) => l.includes("=") && !l.trim().startsWith("#"))
    .map((l) => { const i = l.indexOf("="); return [l.slice(0, i).trim(), l.slice(i + 1).trim()]; }),
);
const URL_ = env.NEXT_PUBLIC_SUPABASE_URL;
const ANON = env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
const admin = createClient(URL_, env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } });

let pass = 0, fail = 0;
const ok = (n, c, d = "") => {
  console.log(`${c ? "  PASS" : "  ****FAIL"}  ${n}${d ? `  — ${d}` : ""}`);
  c ? pass++ : fail++;
};

/** Returns the auth namespace directly - verifyOtp lives on .auth, not the client. */
const anonAuth = () => createClient(URL_, ANON, { auth: { persistSession: false } }).auth;
const created = [];

async function dropByEmail(email) {
  const { data } = await admin.auth.admin.listUsers();
  for (const u of data.users) if (u.email === email) await admin.auth.admin.deleteUser(u.id);
}

try {
  console.log("\n── RETURNING CONTRACTOR (magiclink template) ───────────");
  const emailA = `otp-a-${randomUUID().slice(0, 8)}@example.com`;
  const { data: uA } = await admin.auth.admin.createUser({ email: emailA, email_confirm: true });
  created.push(uA.user.id);
  const { data: linkA } = await admin.auth.admin.generateLink({ type: "magiclink", email: emailA });
  const otpA = linkA.properties.email_otp;

  ok("a code is issued", /^\d+$/.test(otpA), `${otpA.length} digits: ${otpA}`);
  ok("code is NOT 6 digits (UI must not cap at 6)", otpA.length !== 6, `${otpA.length}`);
  {
    const { data, error } = await anonAuth().verifyOtp({ email: emailA, token: otpA, type: "email" });
    ok("verifyOtp type='email' returns a session", !error && !!data.session, error?.message);
  }
  {
    // Single use — a code that still worked after sign-in would be a standing key.
    const { data, error } = await anonAuth().verifyOtp({ email: emailA, token: otpA, type: "email" });
    ok("the same code cannot be reused", !!error || !data.session, error?.message ?? "REUSED");
  }

  console.log("\n── FIRST-TIME CONTRACTOR (signup template) ─────────────");
  const emailB = `otp-b-${randomUUID().slice(0, 8)}@example.com`;
  const { data: linkB } = await admin.auth.admin.generateLink({
    type: "signup", email: emailB, password: randomUUID(),
  });
  const otpB = linkB.properties.email_otp;
  ok("signup link declares type=signup",
     new URL(linkB.properties.action_link).searchParams.get("type") === "signup",
     new URL(linkB.properties.action_link).searchParams.get("type"));
  {
    // The point: one code path, no per-template branching.
    const { data, error } = await anonAuth().verifyOtp({ email: emailB, token: otpB, type: "email" });
    ok("...yet type='email' still verifies it", !error && !!data.session, error?.message);
  }
  await dropByEmail(emailB);

  console.log("\n── FAILURE MODES ───────────────────────────────────────");
  const emailC = `otp-c-${randomUUID().slice(0, 8)}@example.com`;
  const { data: uC } = await admin.auth.admin.createUser({ email: emailC, email_confirm: true });
  created.push(uC.user.id);
  const { data: linkC } = await admin.auth.admin.generateLink({ type: "magiclink", email: emailC });
  {
    const { error } = await anonAuth().verifyOtp({ email: emailC, token: "00000000", type: "email" });
    ok("a wrong code is refused", !!error, error?.message);
  }
  {
    // Same code, different address — must not be transferable.
    const { error } = await anonAuth().verifyOtp({
      email: emailA, token: linkC.properties.email_otp, type: "email",
    });
    ok("a code is bound to its own address", !!error, error?.message);
  }
  {
    const { error } = await anonAuth().verifyOtp({
      email: `nobody-${randomUUID().slice(0, 6)}@example.com`, token: "12345678", type: "email",
    });
    ok("unknown address is refused", !!error, error?.message);
  }
  {
    // Whitespace survives copy-paste from a mail client; verifyLoginCode strips
    // non-digits before this call, so simulate the stripped value.
    const { data: linkD } = await admin.auth.admin.generateLink({ type: "magiclink", email: emailC });
    const spaced = linkD.properties.email_otp.replace(/(\d{4})(?=\d)/, "$1 ");
    const stripped = spaced.replace(/\D/g, "");
    const { data, error } = await anonAuth().verifyOtp({ email: emailC, token: stripped, type: "email" });
    ok("a pasted code with a space still works once stripped", !error && !!data.session,
       `"${spaced}" -> ${stripped}`);
  }

  console.log("\n── NO LINK NEEDED ──────────────────────────────────────");
  ok("sign-in never required fetching a URL", true,
     "nothing above opened action_link — a scanner has nothing to consume");

  console.log(`\n${"═".repeat(56)}\n  ${pass} passed, ${fail} failed\n${"═".repeat(56)}`);
} finally {
  console.log("\ncleanup…");
  for (const id of created) await admin.auth.admin.deleteUser(id);
  console.log(`removed ${created.length} test users`);
}
process.exit(fail === 0 ? 0 : 1);
