"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/atoms/Button";
import { Input } from "@/components/atoms/Input";
import { BrandKitEditor } from "@/components/organisms/BrandKitEditor";
import { useToast } from "@/components/atoms/Toast";
import { useAuth } from "@/components/providers";
import { createClient } from "@/lib/supabase/client";
import type { Business, BrandKit } from "@prompted/shared";
import styles from "../settings.module.css";

export default function BusinessPage() {
  const { user, loading } = useAuth();
  const router = useRouter();
  const { showToast } = useToast();

  const [business, setBusiness] = useState<Business | null>(null);
  const [brandKit, setBrandKit] = useState<BrandKit | null>(null);
  const [fetched, setFetched] = useState(false);
  const [saving, setSaving] = useState(false);

  const [tradingName, setTradingName] = useState("");
  const [legalName, setLegalName] = useState("");
  const [abn, setAbn] = useState("");
  const [industry, setIndustry] = useState("");
  const [website, setWebsite] = useState("");
  const [email, setEmail] = useState("");

  useEffect(() => {
    if (!user || fetched) return;
    const supabase = createClient();

    supabase
      .from("profiles")
      .select("business_id")
      .eq("id", user.id)
      .single()
      .then(async ({ data: profile }) => {
        if (profile?.business_id) {
          const [{ data: biz }, { data: bk }] = await Promise.all([
            supabase.from("businesses").select("*").eq("id", profile.business_id).single(),
            supabase.from("brand_kits").select("*").eq("business_id", profile.business_id).single(),
          ]);

          if (biz) {
            setBusiness(biz as Business);
            setTradingName(biz.trading_name ?? "");
            setLegalName(biz.legal_name ?? "");
            setAbn(biz.abn ?? "");
            setIndustry(biz.industry ?? "");
            setWebsite(biz.website ?? "");
            setEmail(biz.email ?? "");
          }
          if (bk) setBrandKit(bk as BrandKit);
        }
        setFetched(true);
      });
  }, [user, fetched]);

  if (loading || (!fetched && user)) return null;
  if (!user) {
    router.replace("/sign-in");
    return null;
  }

  async function handleSave(e: React.FormEvent) {
    e.preventDefault();
    setSaving(true);
    const supabase = createClient();

    if (business) {
      const { error } = await supabase
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
        .eq("id", business.id);

      if (error) {
        showToast({ message: "Could not save business profile.", tone: "error" });
        setSaving(false);
        return;
      }
    } else {
      const { data: businessId, error } = await supabase.rpc(
        "create_and_link_own_business",
        {
          p_trading_name: tradingName.trim(),
          p_legal_name: legalName.trim() || null,
          p_abn: abn.trim() || null,
          p_industry: industry.trim() || null,
          p_website: website.trim() || null,
          p_email: email.trim() || null,
        },
      );

      if (error || typeof businessId !== "string") {
        showToast({ message: "Could not create business profile.", tone: "error" });
        setSaving(false);
        return;
      }

      setBusiness({
        id: businessId,
        owner_user_id: user!.id,
        trading_name: tradingName.trim(),
        legal_name: legalName.trim() || null,
        abn: abn.trim() || null,
        address: null,
        phone: null,
        email: email.trim() || null,
        website: website.trim() || null,
        industry: industry.trim() || null,
        voice_descriptor: null,
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      });
    }

    setSaving(false);
    showToast({ message: "Business profile saved.", tone: "success" });
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
          businessId={business.id}
          initial={brandKit ?? undefined}
        />
      )}
    </main>
  );
}
