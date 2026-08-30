"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";

/** Plan & billing now live under Settings → Account. Kept as a redirect for old links/bookmarks. */
export default function SubscriptionRedirectPage() {
  const router = useRouter();

  useEffect(() => {
    router.replace("/settings/account");
  }, [router]);

  return null;
}
