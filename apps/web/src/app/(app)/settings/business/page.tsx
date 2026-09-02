"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/atoms/Button";
import { Input } from "@/components/atoms/Input";
import { BrandKitEditor } from "@/components/organisms/BrandKitEditor";
import { useToast } from "@/components/atoms/Toast";
import { useAuth } from "@/components/providers";
import {
  captureOwnerDispatch,
  ownerDispatchIsCurrent,
} from "@/lib/browser-principal-state";
import { withOwnerSupabase } from "@/lib/supabase/owner-client";
import type { Business, BrandKit } from "@prompted/shared";
import styles from "../settings.module.css";

export default function BusinessPage() {
  const { user, loading } = useAuth();
  const router = useRouter();
  const { showToast } = useToast();

  const [business, setBusiness] = useState<Business | null>(null);
  const [brandKit, setBrandKit] = useState<BrandKit | null>(null);
  const [fetched, setFetched] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const [tradingName, setTradingName] = useState("");
  const [legalName, setLegalName] = useState("");
  const [abn, setAbn] = useState("");
  const [industry, setIndustry] = useState("");
  const [website, setWebsite] = useState("");
  const [email, setEmail] = useState("");

  useEffect(() => {
    if (!user || fetched) return;
    let requestContext;
    try {
      requestContext = captureOwnerDispatch(user.id);
    } catch {
      setLoadError("Your signed-in account changed while this page was loading.");
      setFetched(true);
      return;
    }
    void withOwnerSupabase(requestContext, async (supabase) => {
      const { data: profile, error: profileError } = await supabase
        .from("profiles")
        .select("business_id")
        .eq("id", requestContext.expectedUserId)
        .single();
      if (profileError) throw profileError;
      if (!profile?.business_id) return { business: null, brandKit: null };
      const [businessResult, brandKitResult] = await Promise.all([
        supabase.from("businesses").select("*").eq("id", profile.business_id).single(),
        supabase.from("brand_kits").select("*").eq("business_id", profile.business_id).maybeSingle(),
      ]);
      if (businessResult.error) throw businessResult.error;
      if (brandKitResult.error) throw brandKitResult.error;
      if (businessResult.data.owner_user_id !== requestContext.expectedUserId) {
        throw new Error("BUSINESS_OWNER_MISMATCH");
      }
      return { business: businessResult.data, brandKit: brandKitResult.data };
    }).then(({ business: nextBusiness, brandKit: nextBrandKit }) => {
      if (!ownerDispatchIsCurrent(requestContext)) return;
      if (nextBusiness) {
        const biz = nextBusiness as Business;
        setBusiness(biz);
        setTradingName(biz.trading_name ?? "");
        setLegalName(biz.legal_name ?? "");
        setAbn(biz.abn ?? "");
        setIndustry(biz.industry ?? "");
        setWebsite(biz.website ?? "");
        setEmail(biz.email ?? "");
      }
      if (nextBrandKit) setBrandKit(nextBrandKit as BrandKit);
      setLoadError(null);
      setFetched(true);
    }).catch(() => {
      if (ownerDispatchIsCurrent(requestContext)) {
        setLoadError("TED could not confirm your business profile. Retry before creating or editing it.");
        setFetched(true);
        showToast({ message: "Could not load the business profile.", tone: "error" });
      }
    });
  }, [fetched, showToast, user]);

  useEffect(() => {
    if (!loading && !user) router.replace("/sign-in");
  }, [loading, router, user]);

  if (loading || (!fetched && user)) return null;
  if (!user) return null;
  if (loadError) {
    return (
      <main className={styles.page}>
        <header className={styles.header}>
          <h1 className={styles.heading}>Business & Brand</h1>
        </header>
        <p role="alert">{loadError}</p>
        <div>
          <Button
            type="button"
            onClick={() => {
              setLoadError(null);
              setFetched(false);
            }}
          >
            Retry
          </Button>
        </div>
      </main>
    );
  }
  const ownerId = user.id;

  async function handleSave(e: React.FormEvent) {
    e.preventDefault();
    const requestContext = captureOwnerDispatch(ownerId);
    setSaving(true);
    try {
      const persistedBusiness = await withOwnerSupabase(requestContext, async (supabase) => {
        if (business) {
          const { data, error } = await supabase
            .from("businesses")
            .update({
              trading_name: tradingName.trim(),
              legal_name: legalName.trim() || null,
              abn: abn.trim() || null,
              industry: industry.trim() || null,
              website: website.trim() || null,
              email: email.trim() || null,
              updated_at: new Date().toISOString(),
            })
            .eq("id", business.id)
            .eq("owner_user_id", requestContext.expectedUserId)
            .select("*")
            .single();
          if (error || !data) throw error ?? new Error("BUSINESS_UPDATE_UNCONFIRMED");
          return data;
        }
        const { data, error } = await supabase.rpc("create_and_link_own_business", {
          p_trading_name: tradingName.trim(),
          p_legal_name: legalName.trim() || null,
          p_abn: abn.trim() || null,
          p_industry: industry.trim() || null,
          p_website: website.trim() || null,
          p_email: email.trim() || null,
        });
        if (error || typeof data !== "string") {
          throw error ?? new Error("BUSINESS_CREATE_UNCONFIRMED");
        }
        const { data: created, error: createdError } = await supabase
          .from("businesses")
          .select("*")
          .eq("id", data)
          .eq("owner_user_id", requestContext.expectedUserId)
          .single();
        if (createdError || !created) {
          throw createdError ?? new Error("BUSINESS_CREATE_UNCONFIRMED");
        }
        return created;
      });
      requestContext.assertCurrent();
      setBusiness(persistedBusiness as Business);
      showToast({ message: "Business profile saved.", tone: "success" });
    } catch {
      if (ownerDispatchIsCurrent(requestContext)) {
        showToast({ message: "Could not save business profile.", tone: "error" });
      }
    } finally {
      if (ownerDispatchIsCurrent(requestContext)) setSaving(false);
    }
  }

  return (
    <main className={styles.page}>
      <header className={styles.header}>
        <h1 className={styles.heading}>Business & Brand</h1>
      </header>

      <form onSubmit={handleSave} aria-label="Business profile" style={{ display: "flex", flexDirection: "column", gap: "var(--space-4)" }}>
        <Input
          label="Trading name"
          type="text"
          value={tradingName}
          maxLength={200}
          onChange={(e) => setTradingName(e.target.value)}
          hint="The name customers know you by."
          required
        />
        <Input
          label="Legal name"
          type="text"
          value={legalName}
          maxLength={240}
          onChange={(e) => setLegalName(e.target.value)}
          hint="Optional. Used in legal documents."
        />
        <Input
          label="ABN"
          type="text"
          value={abn}
          maxLength={40}
          onChange={(e) => setAbn(e.target.value)}
          hint="Australian Business Number."
        />
        <Input
          label="Industry"
          type="text"
          value={industry}
          maxLength={160}
          onChange={(e) => setIndustry(e.target.value)}
        />
        <Input
          label="Website"
          type="url"
          value={website}
          maxLength={500}
          onChange={(e) => setWebsite(e.target.value)}
        />
        <Input
          label="Business email"
          type="email"
          value={email}
          maxLength={320}
          onChange={(e) => setEmail(e.target.value)}
        />
        <div style={{ display: "flex", justifyContent: "flex-end", gap: "var(--space-3)" }}>
          <Button variant="ghost" type="button" onClick={() => router.back()}>
            Cancel
          </Button>
          <Button type="submit" loading={saving} loadingLabel="Saving…" disabled={!tradingName.trim()}>
            Save business profile
          </Button>
        </div>
      </form>

      {business && (
        <BrandKitEditor
          key={`${ownerId}:${business.id}`}
          ownerUserId={ownerId}
          businessId={business.id}
          initial={brandKit ?? undefined}
          onSave={setBrandKit}
        />
      )}
    </main>
  );
}
