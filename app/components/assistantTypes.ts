import { type GameId, type Locale } from "../lib/i18n";

export interface AssistantNavigationProps {
  active: boolean;
  game: GameId;
  locale: Locale;
  installAvailable: boolean;
  nativeAndroid: boolean;
  onGameChange: (game: GameId) => void;
  onInstall: () => void;
  onLocaleChange: (locale: Locale) => void;
}
