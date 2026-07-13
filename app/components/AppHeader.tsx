"use client";

import {
  ArrowLeftRight,
  Download,
  Languages,
  Pencil,
  RotateCcw,
  Undo2,
} from "lucide-react";
import { type GameId, type Locale, type MessageKey, t } from "../lib/i18n";

interface AppHeaderProps {
  game: GameId;
  locale: Locale;
  installAvailable: boolean;
  nativeAndroid: boolean;
  firstTurn: -1 | 1;
  onGameChange: (game: GameId) => void;
  onInstall: () => void;
  onToggleFirstTurn: () => void;
  onLocaleChange: (locale: Locale) => void;
  canUndo: boolean;
  editing: boolean;
  onUndo: () => void;
  onEdit: () => void;
  onReset: () => void;
}

const games: GameId[] = ["fanorona", "draughts", "morris"];

export function AppHeader({
  game,
  locale,
  installAvailable,
  nativeAndroid,
  firstTurn,
  onGameChange,
  onInstall,
  onToggleFirstTurn,
  onLocaleChange,
  canUndo,
  editing,
  onUndo,
  onEdit,
  onReset,
}: AppHeaderProps) {
  return (
    <header className="topbar">
      <div className="topbar-inner">
        <div className="topbar-primary">
          <div className="brand">
            <div className="brand-mark" aria-hidden="true" />
            <div className="brand-copy">
              <h1>{t(locale, "app.name")}</h1>
              <p>{t(locale, "app.subtitle")}</p>
            </div>
          </div>

          {nativeAndroid && (
            <button
              className="first-turn-button"
              type="button"
              aria-label={t(locale, "app.toggleFirstTurn")}
              title={t(locale, "app.toggleFirstTurn")}
              onClick={onToggleFirstTurn}
            >
              <ArrowLeftRight size={16} />
              <span>{t(locale, firstTurn === -1 ? "common.opponentFirst" : "common.selfFirst")}</span>
            </button>
          )}

          <div className="toolbar">
            <span className="engine-pill">
              <span className="engine-dot" />
              {t(locale, "app.localAi")}
            </span>
            <div className="language-switcher" aria-label={t(locale, "app.language")}>
              <Languages size={15} aria-hidden="true" />
              <button
                type="button"
                className={locale === "zh" ? "active" : ""}
                aria-pressed={locale === "zh"}
                onClick={() => onLocaleChange("zh")}
              >
                中
              </button>
              <button
                type="button"
                className={locale === "en" ? "active" : ""}
                aria-pressed={locale === "en"}
                onClick={() => onLocaleChange("en")}
              >
                EN
              </button>
            </div>
            {installAvailable && (
              <button
                className="icon-button"
                type="button"
                aria-label={t(locale, "app.install")}
                title={t(locale, "app.install")}
                onClick={onInstall}
              >
                <Download size={18} />
              </button>
            )}
            <button
              className="icon-button"
              type="button"
              aria-label={t(locale, "app.undo")}
              title={t(locale, "app.undo")}
              disabled={!canUndo || editing}
              onClick={onUndo}
            >
              <Undo2 size={18} />
            </button>
            <button
              className="icon-button"
              type="button"
              aria-label={t(locale, "app.edit")}
              title={t(locale, "app.edit")}
              disabled={editing}
              onClick={onEdit}
            >
              <Pencil size={17} />
            </button>
            <button
              className="icon-button"
              type="button"
              aria-label={t(locale, "app.reset")}
              title={t(locale, "app.reset")}
              onClick={onReset}
            >
              <RotateCcw size={18} />
            </button>
          </div>
        </div>

        <nav className="game-switcher" aria-label={t(locale, "app.game")}>
          {games.map((entry) => (
            <button
              type="button"
              className={game === entry ? "active" : ""}
              aria-current={game === entry ? "page" : undefined}
              onClick={() => onGameChange(entry)}
              key={entry}
            >
              {t(locale, `game.${entry}` as MessageKey)}
            </button>
          ))}
        </nav>
      </div>
    </header>
  );
}
