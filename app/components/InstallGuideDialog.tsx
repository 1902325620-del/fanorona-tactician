"use client";

import { useEffect, useId, useRef } from "react";
import { Globe2, Share, SquarePlus, X } from "lucide-react";
import { type Locale, t } from "../lib/i18n";
import { type IosInstallGuide } from "../lib/pwaInstall";

interface InstallGuideDialogProps {
  locale: Locale;
  mode: IosInstallGuide | null;
  open: boolean;
  onClose: () => void;
}

export function InstallGuideDialog({
  locale,
  mode,
  open,
  onClose,
}: InstallGuideDialogProps) {
  const titleId = useId();
  const dialog = useRef<HTMLElement>(null);
  const closeButton = useRef<HTMLButtonElement>(null);
  const previousFocus = useRef<HTMLElement | null>(null);

  useEffect(() => {
    if (!open) return;

    previousFocus.current = document.activeElement instanceof HTMLElement
      ? document.activeElement
      : null;
    closeButton.current?.focus();
    const handleKeyboard = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        onClose();
        return;
      }
      if (event.key !== "Tab") return;

      const focusable = dialog.current?.querySelectorAll<HTMLButtonElement>(
        "button:not(:disabled)",
      );
      if (!focusable || focusable.length === 0) return;

      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    };
    window.addEventListener("keydown", handleKeyboard);
    return () => {
      window.removeEventListener("keydown", handleKeyboard);
      previousFocus.current?.focus();
      previousFocus.current = null;
    };
  }, [onClose, open]);

  if (!open || mode === null) return null;

  return (
    <div
      className="install-guide-overlay"
      onClick={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <section
        ref={dialog}
        className="install-guide-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
      >
        <div className="install-guide-heading">
          <div>
            <p className="eyebrow">{t(locale, "app.installGuideEyebrow")}</p>
            <h2 id={titleId}>{t(locale, "app.installGuideTitle")}</h2>
          </div>
          <button
            ref={closeButton}
            className="icon-button"
            type="button"
            aria-label={t(locale, "common.close")}
            title={t(locale, "common.close")}
            onClick={onClose}
          >
            <X size={19} />
          </button>
        </div>

        {mode !== "safari" && (
          <div className="install-guide-browser-note">
            <Globe2 size={20} aria-hidden="true" />
            <p>
              {t(
                locale,
                mode === "wechat"
                  ? "app.installWechatHint"
                  : "app.installOtherBrowserHint",
              )}
            </p>
          </div>
        )}

        <p className="install-guide-intro">{t(locale, "app.installGuideIntro")}</p>
        <ol className="install-guide-steps">
          <li>
            <span className="install-guide-step-icon" aria-hidden="true">
              <Share size={20} />
            </span>
            <span>{t(locale, "app.installShareStep")}</span>
          </li>
          <li>
            <span className="install-guide-step-icon" aria-hidden="true">
              <SquarePlus size={20} />
            </span>
            <span>{t(locale, "app.installHomeStep")}</span>
          </li>
          <li>
            <span className="install-guide-step-number" aria-hidden="true">3</span>
            <span>{t(locale, "app.installAddStep")}</span>
          </li>
        </ol>

        <p className="install-guide-offline-note">
          {t(locale, "app.installOfflineNote")}
        </p>
        <button className="primary-button install-guide-done" type="button" onClick={onClose}>
          {t(locale, "common.close")}
        </button>
      </section>
    </div>
  );
}
