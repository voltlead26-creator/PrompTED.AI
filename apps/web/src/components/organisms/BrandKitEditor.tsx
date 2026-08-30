"use client";

import { useId, useRef, useState } from "react";
import { Button } from "@/components/atoms/Button";
import { Input } from "@/components/atoms/Input";
import { useToast } from "@/components/atoms/Toast";
import { createClient } from "@/lib/supabase/client";
import styles from "./BrandKitEditor.module.css";

interface BrandKitEditorProps {
  businessId: string;
  initial?: {
    logo_url?: string | null;
    primary_colour?: string;
    secondary_colour?: string | null;
    footer_text?: string | null;
  };
  onSave?: () => void;
}

/**
 * BrandKitEditor — logo upload, primary colour picker, footer text.
 * Saves to Supabase Storage (logo) and brand_kits table.
 */
export function BrandKitEditor({ businessId, initial, onSave }: BrandKitEditorProps) {
  const { showToast } = useToast();
  const fileInputId = useId();
  const fileRef = useRef<HTMLInputElement>(null);

  const [logoUrl, setLogoUrl] = useState(initial?.logo_url ?? null);
  const [primaryColour, setPrimaryColour] = useState(initial?.primary_colour ?? "#DC5430");
  const [secondaryColour, setSecondaryColour] = useState(initial?.secondary_colour ?? "");
  const [footerText, setFooterText] = useState(initial?.footer_text ?? "");
  const [uploading, setUploading] = useState(false);
  const [saving, setSaving] = useState(false);

  async function handleLogoUpload(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;

    if (file.size > 5 * 1024 * 1024) {
      showToast({ message: "Logo must be under 5 MB.", tone: "error" });
      return;
    }
    if (!file.type.startsWith("image/")) {
      showToast({ message: "Please upload an image file.", tone: "error" });
      return;
    }

    setUploading(true);
    const supabase = createClient();
    const ext = file.name.split(".").pop() ?? "png";
    const path = `brand-kits/${businessId}/logo.${ext}`;
    const { error } = await supabase.storage
      .from("assets")
      .upload(path, file, { upsert: true });

    if (error) {
      showToast({ message: "Logo upload failed. Please try again.", tone: "error" });
      setUploading(false);
      return;
    }

    const { data } = supabase.storage.from("assets").getPublicUrl(path);
    setLogoUrl(data.publicUrl);
    setUploading(false);
    showToast({ message: "Logo uploaded.", tone: "success" });
  }

  async function handleSave() {
    setSaving(true);
    const supabase = createClient();
    const { error } = await supabase.from("brand_kits").upsert(
      {
        business_id: businessId,
        logo_url: logoUrl,
        primary_colour: primaryColour,
        secondary_colour: secondaryColour || null,
        footer_text: footerText || null,
        updated_at: new Date().toISOString(),
      },
      { onConflict: "business_id" },
    );
    setSaving(false);

    if (error) {
      showToast({ message: "Could not save brand kit. Please try again.", tone: "error" });
      return;
    }

    showToast({ message: "Brand kit saved.", tone: "success" });
    onSave?.();
  }

  return (
    <section className={styles.editor} aria-label="Brand kit editor">
      <h2 className={styles.sectionHeading}>Brand Kit</h2>

      {/* Logo */}
      <div className={styles.field}>
        <span className={styles.label} id={`${fileInputId}-label`}>
          Logo
        </span>
        {logoUrl && (
          <div className={styles.logoPreview}>
            <img src={logoUrl} alt="Your brand logo" className={styles.logo} />
          </div>
        )}
        <input
          id={fileInputId}
          ref={fileRef}
          type="file"
          accept="image/*"
          className="sr-only"
          aria-labelledby={`${fileInputId}-label`}
          onChange={handleLogoUpload}
        />
        <Button
          variant="ghost"
          size="sm"
          loading={uploading}
          loadingLabel="Uploading logo…"
          onClick={() => fileRef.current?.click()}
        >
          {logoUrl ? "Replace logo" : "Upload logo"}
        </Button>
        {logoUrl && (
          <Button
            variant="text"
            size="sm"
            onClick={() => setLogoUrl(null)}
            aria-label="Remove logo"
          >
            Remove
          </Button>
        )}
        <p className={styles.hint}>PNG, JPG or SVG, max 5 MB.</p>
      </div>

      {/* Colours */}
      <div className={styles.colourRow}>
        <div className={styles.colourField}>
          <label className={styles.label} htmlFor="primary-colour">
            Primary colour
          </label>
          <div className={styles.colourInput}>
            <input
              id="primary-colour"
              type="color"
              value={primaryColour}
              onChange={(e) => setPrimaryColour(e.target.value)}
              className={styles.colourSwatch}
              aria-label="Primary colour picker"
            />
            <input
              type="text"
              value={primaryColour}
              onChange={(e) => setPrimaryColour(e.target.value)}
              className={styles.colourHex}
              maxLength={7}
              aria-label="Primary colour hex code"
              pattern="^#[0-9A-Fa-f]{6}$"
            />
          </div>
        </div>

        <div className={styles.colourField}>
          <label className={styles.label} htmlFor="secondary-colour">
            Secondary colour
            <span className={styles.optional}> (optional)</span>
          </label>
          <div className={styles.colourInput}>
            <input
              id="secondary-colour"
              type="color"
              value={secondaryColour || "#efe5d4"}
              onChange={(e) => setSecondaryColour(e.target.value)}
              className={styles.colourSwatch}
              aria-label="Secondary colour picker"
            />
            <input
              type="text"
              value={secondaryColour}
              onChange={(e) => setSecondaryColour(e.target.value)}
              className={styles.colourHex}
              maxLength={7}
              placeholder="#efe5d4"
              aria-label="Secondary colour hex code"
            />
          </div>
        </div>
      </div>

      {/* Footer text */}
      <Input
        label="Footer text"
        type="text"
        value={footerText}
        onChange={(e) => setFooterText(e.target.value)}
        hint="Appears at the bottom of every exported document."
        placeholder="© 2026 Acme Co. All rights reserved."
        maxLength={200}
        className={styles.field}
      />

      {/* Live preview */}
      <div className={styles.preview} aria-label="Brand kit preview">
        <div className={styles.previewHeader} style={{ background: primaryColour }}>
          {logoUrl ? (
            <img src={logoUrl} alt="" className={styles.previewLogo} aria-hidden="true" />
          ) : (
            <span className={styles.previewLogoPlaceholder}>Your logo here</span>
          )}
          <span className={styles.previewTitle} style={{ color: "#ffffff" }}>
            Sample Document
          </span>
        </div>
        <div className={styles.previewBody}>
          <p>Your document content will appear here with your brand applied.</p>
        </div>
        {footerText && (
          <div className={styles.previewFooter}>
            <p>{footerText}</p>
          </div>
        )}
      </div>

      <div className={styles.actions}>
        <Button
          onClick={handleSave}
          loading={saving}
          loadingLabel="Saving brand kit…"
        >
          Save brand kit
        </Button>
      </div>
    </section>
  );
}
