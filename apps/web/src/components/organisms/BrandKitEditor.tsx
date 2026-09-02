"use client";

import { useEffect, useId, useRef, useState } from "react";
import { Button } from "@/components/atoms/Button";
import { Input } from "@/components/atoms/Input";
import { useToast } from "@/components/atoms/Toast";
import { useAuth } from "@/components/providers";
import type { BrandKit } from "@prompted/shared";
import {
  ApiError,
  saveBrandKitOperation,
} from "@prompted/shared/api-client";
import {
  captureOwnerDispatch,
  ownerDispatchIsCurrent,
  type OwnerDispatchLease,
} from "@/lib/browser-principal-state";
import styles from "./BrandKitEditor.module.css";

interface BrandKitEditorProps {
  ownerUserId: string;
  businessId: string;
  initial?: BrandKit;
  onSave?: (brandKit: BrandKit) => void;
}

const ALLOWED_LOGO_TYPES = new Set(["image/png", "image/jpeg", "image/webp"]);
const MAX_LOGO_BYTES = 5 * 1024 * 1024;

/**
 * BrandKitEditor — local logo preview, colours, and footer text. Selection is
 * deliberately side-effect free; Save submits one durable server operation.
 */
export function BrandKitEditor({ ownerUserId, businessId, initial, onSave }: BrandKitEditorProps) {
  const { user } = useAuth();
  const { showToast } = useToast();
  const fileInputId = useId();
  const fileRef = useRef<HTMLInputElement>(null);
  const saveActionRef = useRef<OwnerDispatchLease | null>(null);

  const [authoritative, setAuthoritative] = useState<BrandKit | null>(initial ?? null);
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [logoAction, setLogoAction] = useState<"keep" | "replace" | "remove">("keep");
  const [primaryColour, setPrimaryColour] = useState(initial?.primary_colour ?? "#DC5430");
  const [secondaryColour, setSecondaryColour] = useState(initial?.secondary_colour ?? "");
  const [footerText, setFooterText] = useState(initial?.footer_text ?? "");
  const [saving, setSaving] = useState(false);
  const [dirty, setDirty] = useState(false);
  const logoUrl = logoAction === "remove"
    ? null
    : previewUrl ?? authoritative?.logo_url ?? null;

  useEffect(() => {
    return () => {
      if (previewUrl) URL.revokeObjectURL(previewUrl);
    };
  }, [previewUrl]);

  function handleLogoSelection(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;

    if (file.size < 1 || file.size > MAX_LOGO_BYTES) {
      showToast({ message: "Logo must be under 5 MB.", tone: "error" });
      return;
    }
    if (!ALLOWED_LOGO_TYPES.has(file.type)) {
      showToast({ message: "Please upload a PNG, JPG or WebP image.", tone: "error" });
      return;
    }
    if (!user?.id || user.id.trim().toLowerCase() !== ownerUserId.trim().toLowerCase()) return;
    try {
      const nextPreviewUrl = URL.createObjectURL(file);
      setSelectedFile(file);
      setPreviewUrl(nextPreviewUrl);
      setLogoAction("replace");
      setDirty(true);
      showToast({ message: "Logo selected. Save brand kit to apply it.", tone: "success" });
    } catch {
      showToast({ message: "The logo preview could not be prepared.", tone: "error" });
    }
  }

  async function handleSave() {
    if (!user?.id || user.id.trim().toLowerCase() !== ownerUserId.trim().toLowerCase()) return;
    let requestContext: OwnerDispatchLease;
    try {
      requestContext = captureOwnerDispatch(ownerUserId);
    } catch {
      showToast({ message: "Your signed-in account changed. Please save again.", tone: "error" });
      return;
    }
    saveActionRef.current = requestContext;
    setSaving(true);
    try {
      const saved = await saveBrandKitOperation({
        businessId,
        expectedRevision: authoritative?.revision ?? 0,
        logoAction,
        primaryColour,
        secondaryColour: secondaryColour || null,
        footerText: footerText || null,
        file: logoAction === "replace" ? selectedFile : null,
      }, requestContext);
      requestContext.assertCurrent();
      setAuthoritative(saved);
      setPrimaryColour(saved.primary_colour);
      setSecondaryColour(saved.secondary_colour ?? "");
      setFooterText(saved.footer_text ?? "");
      setSelectedFile(null);
      setPreviewUrl(null);
      setLogoAction("keep");
      setDirty(false);
      showToast({ message: "Brand kit saved.", tone: "success" });
      onSave?.(saved);
    } catch (error) {
      if (ownerDispatchIsCurrent(requestContext)) {
        const message = error instanceof ApiError && error.code === "BRAND_KIT_REVISION_CONFLICT"
          ? "The brand kit changed. Reload it before saving again."
          : "Could not save brand kit safely. Please try the same save again.";
        showToast({ message, tone: "error" });
      }
    } finally {
      if (saveActionRef.current === requestContext) {
        saveActionRef.current = null;
        setSaving(false);
      }
    }
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
          accept="image/png,image/jpeg,image/webp"
          className="sr-only"
          aria-labelledby={`${fileInputId}-label`}
          onChange={handleLogoSelection}
        />
        <Button
          variant="ghost"
          size="sm"
          onClick={() => fileRef.current?.click()}
          disabled={saving}
        >
          {logoUrl ? "Replace logo" : "Upload logo"}
        </Button>
        {logoUrl && (
          <Button
            variant="text"
            size="sm"
            onClick={() => {
              setSelectedFile(null);
              setPreviewUrl(null);
              setLogoAction("remove");
              setDirty(true);
            }}
            disabled={saving}
            aria-label="Remove logo"
          >
            Remove
          </Button>
        )}
        <p className={styles.hint}>PNG, JPG or WebP, max 5 MB.</p>
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
              onChange={(e) => {
                setPrimaryColour(e.target.value);
                setDirty(true);
              }}
              className={styles.colourSwatch}
              aria-label="Primary colour picker"
            />
            <input
              type="text"
              value={primaryColour}
              onChange={(e) => {
                setPrimaryColour(e.target.value);
                setDirty(true);
              }}
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
              onChange={(e) => {
                setSecondaryColour(e.target.value);
                setDirty(true);
              }}
              className={styles.colourSwatch}
              aria-label="Secondary colour picker"
            />
            <input
              type="text"
              value={secondaryColour}
              onChange={(e) => {
                setSecondaryColour(e.target.value);
                setDirty(true);
              }}
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
        onChange={(e) => {
          setFooterText(e.target.value);
          setDirty(true);
        }}
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
        <p className={styles.hint} role="status">
          {dirty ? "Unsaved brand kit changes." : "Brand kit is saved."}
        </p>
        <Button
          onClick={handleSave}
          loading={saving}
          loadingLabel="Saving brand kit…"
          disabled={!dirty}
        >
          Save brand kit
        </Button>
      </div>
    </section>
  );
}
