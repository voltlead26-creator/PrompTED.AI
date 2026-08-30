import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { createServerClient } from "@supabase/ssr";
import type { EmailOtpType } from "@supabase/supabase-js";
import { cookies } from "next/headers";
import { safeInternalReturnPath } from "@/lib/auth-return";
import { getPublicSupabaseConfig } from "@/lib/supabase/public-config";

interface CookieToSet {
  name: string;
  value: string;
  options?: Record<string, unknown>;
}

export async function GET(request: NextRequest) {
  const { searchParams, origin } = new URL(request.url);
  const code = searchParams.get("code");
  const tokenHash = searchParams.get("token_hash");
  const type = searchParams.get("type") as EmailOtpType | null;
  const next = safeInternalReturnPath(searchParams.get("next"));
  const isRecovery = type === "recovery" || next === "/reset-password";
  const config = getPublicSupabaseConfig();

  const cookieStore = await cookies();
  const supabase = createServerClient(
    config.url,
    config.anonKey,
    {
      cookies: {
        getAll() {
          return cookieStore.getAll();
        },
        setAll(cookiesToSet: CookieToSet[]) {
          cookiesToSet.forEach(({ name, value, options }) =>
            cookieStore.set(name, value, options),
          );
        },
      },
    },
  );

  if (tokenHash && type) {
    const { error } = await supabase.auth.verifyOtp({ type, token_hash: tokenHash });
    if (!error) {
      return NextResponse.redirect(new URL(next, origin));
    }
  } else if (code) {
    const { error } = await supabase.auth.exchangeCodeForSession(code);
    if (!error) {
      return NextResponse.redirect(new URL(next, origin));
    }
  }

  if (isRecovery) {
    return NextResponse.redirect(new URL("/forgot-password?error=link_expired", origin));
  }
  return NextResponse.redirect(new URL("/sign-in?error=auth_callback_failed", origin));
}
