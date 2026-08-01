/**
 * OTP sign-in, end to end, against a running app.
 *
 * The unit-level checks live in verify-login-otp.mjs. This one answers the
 * question that actually matters: does the session verifyOtp hands back open
 * the pages it is supposed to — including /admin/claims for an admin — and
 * does a scanner fetching every URL in the email get anywhere.
 *
 * Requires the dev server on :3000.
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
const APP = "http://localhost:3000";
const admin = createClient(URL_, env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } });
const ref = new URL(URL_).hostname.split(".")[0];

let pass = 0, fail = 0;
const ok = (n, c, d = "") => {
  console.log(`${c ? "  PASS" : "  ****FAIL"}  ${n}${d ? `  — ${d}` : ""}`);
  c ? pass++ : fail++;
};

/** Encode a session the way @supabase/ssr writes it, so the app reads it. */
function cookieFor(session) {
  const payload = "base64-" + Buffer.from(JSON.stringify(session)).toString("base64");
  const name = `sb-${ref}-auth-token`;
  const chunks = [];
  for (let i = 0; i < payload.length; i += 3180) chunks.push(payload.slice(i, i + 3180));
  return chunks.length === 1
    ? `${name}=${chunks[0]}`
    : chunks.map((v, i) => `${name}.${i}=${v}`).join("; ");
}

const created = [];
try {
  const email = `e2e-${randomUUID().slice(0, 8)}@example.com`;
  const { data: u } = await admin.auth.admin.createUser({
    email, email_confirm: true, app_metadata: { role: "admin" },
  });
  created.push(u.user.id);
  console.log(`\nadmin test user: ${email}\n`);

  console.log("── SCENARIO A: TEMPLATE STILL CONTAINS A LINK ─────────");
  console.log("   (todays state - proves the template edit IS the fix)");
  {
    const { data: link } = await admin.auth.admin.generateLink({ type: "magiclink", email });
    const code = link.properties.email_otp;
    ok("Supabase issues a code AND a link from one request",
       /^\d+$/.test(code) && !!link.properties.action_link, `${code.length}-digit code`);

    // Exactly what a mail scanner does: GET every URL in the message.
    const scan = await fetch(link.properties.action_link, { redirect: "manual" });
    ok("a scanner fetches the link", scan.status >= 200, `HTTP ${scan.status}`);

    const auth = createClient(URL_, ANON, { auth: { persistSession: false } }).auth;
    const { error } = await auth.verifyOtp({ email, token: code, type: "email" });
    ok("THE CODE IS NOW DEAD TOO - same token behind both",
       !!error, error?.message ?? "code still worked (unexpected)");
    console.log("   -> shipping the OTP UI while the template still has a link fixes NOTHING.");
  }

  console.log("\n── SCENARIO B: TEMPLATE IS CODE-ONLY ───────────────────");
  console.log("   (after the template edit - no URL exists to fetch)");
  {
    const { data: link } = await admin.auth.admin.generateLink({ type: "magiclink", email });
    const code = link.properties.email_otp;
    // Nothing is fetched. A code-only email gives a scanner no URL at all.
    const auth = createClient(URL_, ANON, { auth: { persistSession: false } }).auth;
    const { data, error } = await auth.verifyOtp({ email, token: code, type: "email" });
    ok("the code signs the contractor in", !error && !!data.session, error?.message);
    if (!data?.session) throw new Error("no session; cannot continue");

    console.log("\n── THAT SESSION OPENS THE APP ──────────────────────────");
    const cookie = cookieFor(data.session);
    for (const path of ["/dashboard", "/admin/claims", "/claim/approved"]) {
      const r = await fetch(`${APP}${path}`, { headers: { cookie }, redirect: "manual" });
      ok(`${path} opens for the signed-in admin`, r.status === 200, `HTTP ${r.status}`);
    }
    {
      const r = await fetch(`${APP}/admin/claims`, { redirect: "manual" });
      ok("/admin/claims still 404s without that cookie", r.status === 404, `HTTP ${r.status}`);
    }
    {
      const r = await fetch(`${APP}/admin/claims`, { headers: { cookie } });
      const html = await r.text();
      ok("the review queue renders", html.includes("Claim review queue"), "heading present");
    }
  }

  console.log(`\n${"═".repeat(56)}\n  ${pass} passed, ${fail} failed\n${"═".repeat(56)}`);
} finally {
  console.log("\ncleanup…");
  for (const id of created) await admin.auth.admin.deleteUser(id);
  console.log(`removed ${created.length} test user`);
}
process.exit(fail === 0 ? 0 : 1);

