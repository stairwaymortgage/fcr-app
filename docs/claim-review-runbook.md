# Reviewing a claim

## → Use **/admin/claims**. That is the whole process.

Sign in as an admin and open `/admin/claims`. Every pending claim is listed with
the name on the claim beside `qualifying_agent_name` from DBPR, the ID photo
already displayed (the page mints the short-lived signed URL for you), and
**Approve** / **Reject** buttons. Rejecting takes a reason, which the contractor
sees verbatim.

You never need the SQL below, and you never need to generate a signed URL by
hand.

**Approve does both writes in one transaction** — `approve_claim()` marks the
claim and links `contractors.claimed_by_user_id`. The half-approved state this
document used to warn about is no longer reachable from the UI.

### Getting admin access

`app_metadata` cannot be set from the client — that is what makes it
trustworthy. Run once, in the SQL editor:

```sql
UPDATE auth.users
   SET raw_app_meta_data = raw_app_meta_data || '{"role":"admin"}'::jsonb
 WHERE email = 'jimb@nexamortgage.com';
```

Then **sign out and back in.** The claim lands on the next token refresh, not
immediately. Until then `/admin/claims` returns 404 — which is also what a
non-admin and a signed-out visitor get, deliberately, so the route never
announces itself.

Verified by `scripts/verify-admin-claims.mjs`.

---

# Fallback: doing it by hand in Supabase

Only needed if the app is down. Everything below is verified by
`scripts/verify-claim-approval.mjs`.

## 1. See the pending queue

**SQL Editor:**

```sql
SELECT c.id,
       c.created_at,
       c.claimant_name,
       c.claimant_role,
       c.claimant_email,
       c.claimant_phone,
       c.id_photo_url            AS storage_path,
       k.business_name,
       k.license_number,
       k.qualifying_agent_name,      -- what the ID must match
       k.city,
       k.claimed_by_user_id          -- non-null means already claimed
  FROM claims c
  LEFT JOIN contractors k ON k.dbpr_sync_key = c.contractor_dbpr_sync_key
 WHERE c.status = 'pending'
 ORDER BY c.created_at;
```

`claimant_user_id` is also the **folder name** the ID photo sits in.

---

## 2. View the ID photo

**Easy way — Storage → `id-photos` → folder named for `claimant_user_id` → click
the file.** The dashboard authenticates as the service role, so this works with
no admin UI and without making anything public.

**Signed URL (to open outside the dashboard, or on a phone).** SQL cannot mint
these — signing happens in the storage API, not the database — so use Node:

```js
// node - from the repo root, with .env.local present
const { createClient } = require("@supabase/supabase-js");
const s = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL,
                       process.env.SUPABASE_SERVICE_ROLE_KEY);
const { data } = await s.storage.from("id-photos")
  .createSignedUrl("<storage_path>", 300);   // 300s = 5 minutes
console.log(data.signedUrl);
```

Keep the TTL short. **Anyone holding that URL can see the ID until it expires** —
it authenticates by token, not by who you are. Don't paste one into Slack.

---

## 3. What to check

| Check | Against |
|---|---|
| Name on the ID | `contractors.qualifying_agent_name` (DBPR's record) |
| `claimant_name` typed on the form | The name on the ID |
| Photo is legible, unexpired, government-issued | The image itself |
| `claimant_role` | Plausible for the person shown |

**What an ID can and cannot prove.** It proves the person is who they say. It
does **not** prove they control the licence. If `qualifying_agent_name` is
"MARTINEZ, ANTONIO" and the ID says "Maria Martinez", that is not fraud — it is
usually a spouse or business partner, and it is the single most common
rejection. Reject with a reason that says so, or ask the qualifying agent to
claim it instead.

**Contested profiles.** Two people may hold pending claims on one profile — this
is deliberate (blocking it would let whoever submits first freeze out the real
owner). Approve one, then explicitly reject the other so the record shows a
decision rather than an abandoned row.

---

## 4. Approve — **BOTH statements, or the approval does nothing**

```sql
-- 1. record the decision
UPDATE claims
   SET status              = 'approved',
       reviewed_at         = now(),
       reviewed_by_user_id = '<your-user-id>',
       admin_notes         = 'ID matches qualifying agent on DBPR record'
 WHERE id = '<claim-id>';

-- 2. hand over the profile  ← THE ONE THAT ACTUALLY GRANTS ACCESS
UPDATE contractors
   SET claimed_by_user_id = '<claimant_user_id>',
       claimed_at         = now()
 WHERE dbpr_sync_key = '<contractor_dbpr_sync_key>';
```

### Why statement 2 is the real one

Every capability the contractor gains keys off `contractors.claimed_by_user_id`,
not off claim status:

```sql
-- 03_rls_policies.sql
"contractor updates own profile"   USING (claimed_by_user_id = auth.uid())
"contractor reads own inquiries"   USING (contractor_dbpr_sync_key IN (
                                     SELECT dbpr_sync_key FROM contractors
                                      WHERE claimed_by_user_id = auth.uid()))
```

Run statement 1 alone and — verified, not assumed — the claim reads `approved`
while the contractor still cannot edit their profile and still cannot see a
single inquiry. They get an approval email, sign in, find nothing, and report
what looks like an auth bug. **Always run both.**

A trigger should replace this the moment the admin UI is built.

### Applying what they proposed

The claim carries `proposed_business_description` and
`proposed_business_website` — unverified text typed before anyone checked who
they were. Read them first, then apply if reasonable:

```sql
UPDATE contractors k
   SET custom_about_text  = COALESCE(c.proposed_business_description, k.custom_about_text),
       custom_website_url = COALESCE(c.proposed_business_website,     k.custom_website_url)
  FROM claims c
 WHERE c.id = '<claim-id>' AND k.dbpr_sync_key = c.contractor_dbpr_sync_key;
```

---

## 5. Reject

```sql
UPDATE claims
   SET status              = 'rejected',
       reviewed_at         = now(),
       reviewed_by_user_id = '<your-user-id>',
       rejection_reason    = 'The photo was too blurry to read the name.'
 WHERE id = '<claim-id>';
```

`rejection_reason` is shown **verbatim** to the contractor on `/claim/rejected`
and again on the claim form. Write it for them to read, not as an internal note
— `admin_notes` is the internal field.

**Rejection is not a lockout.** The uniqueness rule covers pending claims only,
so they can submit again straight away. `/claim/rejected` tells them so and
links back to the form.

---

## 6. After the decision

- The ID photo stays in the private bucket. `id_photo_expires_at` says when it
  should be deleted (90 days).
- ⚠ **Nothing deletes it yet.** The purge job is not built. Until it is, the
  90-day promise in the table comment and on the claim page is not being kept.
  Delete manually from Storage if a claim needs purging now.

---

## Quick reference

```sql
-- everything about one claim
SELECT c.*, k.business_name, k.qualifying_agent_name, k.claimed_by_user_id
  FROM claims c JOIN contractors k ON k.dbpr_sync_key = c.contractor_dbpr_sync_key
 WHERE c.id = '<claim-id>';

-- did the handover actually happen?
SELECT c.status, k.claimed_by_user_id, c.claimant_user_id,
       (k.claimed_by_user_id = c.claimant_user_id) AS linked_correctly
  FROM claims c JOIN contractors k ON k.dbpr_sync_key = c.contractor_dbpr_sync_key
 WHERE c.status = 'approved';
-- linked_correctly = false (or null) on any row means step 2 was missed.
```
