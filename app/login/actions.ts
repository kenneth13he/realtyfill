// app/login/actions.ts
// Server Actions backing app/login/page.tsx. Each is reachable via a direct
// POST regardless of the UI (per Next's own Server Function security note),
// but there's nothing here a POST-only caller gains beyond what the form
// itself offers — these just create/verify a Supabase Auth session.

"use server";

import { redirect } from "next/navigation";
import { headers } from "next/headers";
import { createClient } from "@/lib/supabase/server";
import { checkRateLimit } from "@/lib/rateLimit";
import { safeRedirectTarget } from "@/lib/safeRedirect";
import { clientIpFrom } from "@/lib/clientIp";
import { logError } from "@/lib/logger";
import { checkPassword } from "@/lib/passwordPolicy";
import { authCallbackUrl } from "@/lib/siteOrigin";

// Both helpers below used to be defined here. They moved to lib/ because
// app/auth/callback/route.ts needed the redirect guard too and never had it —
// that gap was a live open redirect. See lib/safeRedirect.ts and
// lib/clientIp.ts for why each is shaped the way it is.
async function clientIp(): Promise<string> {
  return clientIpFrom(await headers());
}

// Google sign-in/sign-up (same action for both — OAuth creates the account
// on first use). Run server-side rather than from the browser client
// specifically because @supabase/ssr stores the PKCE code verifier in a
// cookie, and /auth/callback reads that same cookie back when exchanging the
// code for a session — doing this client-side would put the verifier
// somewhere the callback can't see it.
export async function signInWithGoogle(formData: FormData) {
  const redirectTo = safeRedirectTarget(formData.get("redirectTo"));

  const supabase = await createClient();
  const { data, error } = await supabase.auth.signInWithOAuth({
    provider: "google",
    options: {
      redirectTo: await authCallbackUrl(redirectTo),
      // Always show Google's account chooser. Without prompt=select_account
      // Google silently reuses the one session the browser already has, so
      // clicking "Continue with Google" signs you straight in with no way to
      // pick — and a realtor with a personal address and a brokerage one has
      // no signal about which they just used. Landing in the wrong account
      // means a different set of deals, or silently creating a second
      // account on first use, with no error to explain either.
      //
      // select_account, not consent: this asks which account, it does not
      // re-ask for permissions the user has already granted.
      queryParams: { prompt: "select_account" },
    },
  });

  if (error || !data?.url) {
    redirect(
      `/login?error=${encodeURIComponent(error?.message ?? "Could not start Google sign-in")}&redirectTo=${encodeURIComponent(redirectTo)}`
    );
  }
  // Google's consent screen — external by definition, so not run through
  // safeRedirectTarget (that guard is for user-supplied return paths).
  redirect(data.url);
}

export async function signIn(formData: FormData) {
  const redirectTo = safeRedirectTarget(formData.get("redirectTo"));

  if (!(await checkRateLimit(`signin:${await clientIp()}`, 10, 5 * 60 * 1000))) {
    redirect(`/login?error=${encodeURIComponent("Too many sign-in attempts — please wait a few minutes and try again.")}&redirectTo=${encodeURIComponent(redirectTo)}`);
  }

  const email = String(formData.get("email") ?? "");
  const password = String(formData.get("password") ?? "");

  const supabase = await createClient();
  const { error } = await supabase.auth.signInWithPassword({ email, password });
  if (error) {
    // Deliberately one message for every failure mode. Supabase distinguishes
    // "Invalid login credentials" from "Email not confirmed", and forwarding
    // that difference told an anonymous caller which addresses have accounts
    // here. The real reason still goes to the logs, where debugging it doesn't
    // cost the user's privacy — the same stance requestPasswordReset already
    // takes below.
    logError({ route: "signin", reason: error.message }, error);
    redirect(
      `/login?error=${encodeURIComponent("That email and password don't match an account.")}&redirectTo=${encodeURIComponent(redirectTo)}`
    );
  }
  redirect(redirectTo);
}

export async function signUp(formData: FormData) {
  const redirectTo = safeRedirectTarget(formData.get("redirectTo"));

  if (!(await checkRateLimit(`signup:${await clientIp()}`, 5, 15 * 60 * 1000))) {
    redirect(`/login?mode=signup&error=${encodeURIComponent("Too many sign-up attempts — please wait a while and try again.")}&redirectTo=${encodeURIComponent(redirectTo)}`);
  }

  const email = String(formData.get("email") ?? "");
  const password = String(formData.get("password") ?? "");

  const weak = checkPassword(password);
  if (weak) {
    redirect(`/login?mode=signup&error=${encodeURIComponent(weak)}&redirectTo=${encodeURIComponent(redirectTo)}`);
  }

  const supabase = await createClient();
  const { data, error } = await supabase.auth.signUp({
    email,
    password,
    options: {
      emailRedirectTo: await authCallbackUrl(redirectTo),
    },
  });
  if (error) {
    redirect(`/login?mode=signup&error=${encodeURIComponent(error.message)}&redirectTo=${encodeURIComponent(redirectTo)}`);
  }
  // Email confirmation is on for this project (confirmed against its own
  // Auth settings) — signUp succeeding does NOT mean a session exists yet.
  // Without this check, a brand-new account gets redirected straight to a
  // protected page with no real session and immediately bounced back here
  // by proxy.ts, looking like signup silently failed.
  if (!data.session) {
    redirect(`/login?message=${encodeURIComponent("Check your email to confirm your account, then sign in.")}`);
  }
  redirect(redirectTo);
}

// Step 1 of password recovery: email a recovery link. The link lands on
// /auth/callback (which already exchanges the code for a session) and is
// then forwarded to /reset-password to actually set the new password.
// Always reports success, even for an unknown address — telling an
// anonymous caller whether an email is registered would leak who has an
// account here.
export async function requestPasswordReset(formData: FormData) {
  const email = String(formData.get("email") ?? "");
  const done = `/login?message=${encodeURIComponent("If that email has an account, a reset link is on its way.")}`;

  if (!(await checkRateLimit(`reset:${await clientIp()}`, 5, 15 * 60 * 1000))) {
    redirect(`/login?mode=reset&error=${encodeURIComponent("Too many reset requests — please wait a while and try again.")}`);
  }

  const supabase = await createClient();
  await supabase.auth.resetPasswordForEmail(email, {
    redirectTo: await authCallbackUrl("/reset-password"),
  });
  redirect(done);
}

// Step 2: set the new password. Relies on the recovery session created by
// /auth/callback — without it there's nobody to update, hence the auth check.
export async function updatePassword(formData: FormData) {
  const password = String(formData.get("password") ?? "");
  const weak = checkPassword(password);
  if (weak) {
    redirect(`/reset-password?error=${encodeURIComponent(weak)}`);
  }

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    redirect(`/login?error=${encodeURIComponent("That reset link is invalid or has expired — request a new one.")}`);
  }

  const { error } = await supabase.auth.updateUser({ password });
  if (error) {
    redirect(`/reset-password?error=${encodeURIComponent(error.message)}`);
  }
  redirect("/dashboard");
}

/**
 * Change the password of an already-signed-in user, from Settings.
 *
 * Distinct from `updatePassword` above, which serves the emailed-recovery
 * flow: there, possession of the link IS the proof of identity, and there is
 * no old password to check because the point is that the user has forgotten
 * it. Here the user is already signed in, so the session alone proves
 * nothing about who is at the keyboard — an unlocked laptop would otherwise
 * be enough to lock the owner out of their own account. Hence the
 * re-authentication below. Supabase can enforce this server-side too
 * ("Secure password change" in Auth settings); this does not depend on that
 * being switched on, and does no harm if it is.
 *
 * Returns its result instead of redirecting because Settings is a page the
 * user is already on and should stay on — a redirect back to itself would
 * throw away the rest of the form's unsaved state.
 */
export type ChangePasswordState = { ok: boolean; message: string } | null;

export async function changePassword(
  _prevState: ChangePasswordState,
  formData: FormData
): Promise<ChangePasswordState> {
  const fail = (message: string) => ({ ok: false, message });

  if (!(await checkRateLimit(`changepw:${await clientIp()}`, 10, 15 * 60 * 1000))) {
    return fail("Too many attempts — please wait a while and try again.");
  }

  const currentPassword = String(formData.get("current_password") ?? "");
  const newPassword = String(formData.get("new_password") ?? "");
  const confirmPassword = String(formData.get("confirm_password") ?? "");

  if (newPassword !== confirmPassword) {
    return fail("The two new passwords don't match.");
  }
  const weak = checkPassword(newPassword);
  if (weak) {
    return fail(weak);
  }
  if (newPassword === currentPassword) {
    return fail("That's already your password — pick a different one.");
  }

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user?.email) {
    return fail("You're signed out — sign in again and retry.");
  }

  // Re-authenticate. This writes a fresh session cookie for the same user,
  // so the caller stays signed in either way.
  const { error: reauthError } = await supabase.auth.signInWithPassword({
    email: user.email,
    password: currentPassword,
  });
  if (reauthError) {
    logError({ route: "changepw", reason: reauthError.message }, reauthError);
    return fail("That current password isn't right.");
  }

  const { error } = await supabase.auth.updateUser({ password: newPassword });
  if (error) {
    logError({ route: "changepw", reason: error.message }, error);
    return fail(error.message);
  }
  return { ok: true, message: "Password updated." };
}

export async function signOut() {
  const supabase = await createClient();
  await supabase.auth.signOut();
  redirect("/login");
}
