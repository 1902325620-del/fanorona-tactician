"use client";

import { Eye, RotateCcw } from "lucide-react";
import { useState } from "react";
import { type Locale, t } from "../lib/i18n";

interface GameOverNoticeProps {
  locale: Locale;
  won: boolean;
  detail: string;
  onRestart: () => void;
}

export function GameOverNotice({
  locale,
  won,
  detail,
  onRestart,
}: GameOverNoticeProps) {
  const [visible, setVisible] = useState(true);
  if (!visible) return null;

  const title = won ? t(locale, "common.win") : t(locale, "common.loss");

  return (
    <div className="gameover-overlay">
      <section
        className="gameover-dialog"
        role="alertdialog"
        aria-modal="true"
        aria-label={title}
      >
        <p className="eyebrow">{t(locale, "common.gameOver")}</p>
        <h2 className="gameover-title">{title}</h2>
        <p className="gameover-detail">{detail}</p>
        <div className="gameover-actions">
          <button type="button" className="secondary-button" onClick={() => setVisible(false)}>
            <Eye size={17} /> {t(locale, "common.viewBoard")}
          </button>
          <button type="button" className="primary-button" onClick={onRestart}>
            <RotateCcw size={17} /> {t(locale, "common.playAgain")}
          </button>
        </div>
      </section>
    </div>
  );
}
