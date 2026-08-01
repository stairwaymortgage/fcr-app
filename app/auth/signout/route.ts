import { NextResponse, type NextRequest } from "next/server";

import { createClient } from "@/lib/supabase/server";

/**
 * Sign out — POST /auth/signout
 *
 * POST ONLY, DELIBERATELY. A GET sign-out can be triggered by any image tag or
 * link on any site, which is CSRF — harmless-looking, but it logs people out
 * mid-claim for no reason and is trivially avoidable.
 *
 * Next.js Server Actions carry their own CSRF protection (origin checking), and
 * so does this route by virtue of being POST-only with a same-origin form.
 */
export async function POST(request: NextRequest) {
  const supabase = createClient();
  await supabase.auth.signOut();
  return NextResponse.redirect(new URL("/", request.url), {
    // 303 so the browser follows with GET rather than repeating the POST.
    status: 303,
  });
}
