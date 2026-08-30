"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";

export default function SignOutPage() {
  const router = useRouter();

  useEffect(() => {
    const supabase = createClient();
    supabase.auth.signOut().then(() => {
      router.replace("/home");
    });
  }, [router]);

  return (
    <div role="status" aria-live="polite" style={{ padding: "2rem", textAlign: "center" }}>
      Signing out…
    </div>
  );
}
