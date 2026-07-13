"use client";

import { useCallback, useEffect, useState } from "react";
import { type GameId, type Locale } from "../lib/i18n";
import { DraughtsAssistant } from "./DraughtsAssistant";
import { FanoronaAssistant } from "./FanoronaAssistant";
import { MorrisAssistant } from "./MorrisAssistant";

export interface WorkerFactories {
  fanorona: () => Worker;
  draughts: () => Worker;
  morris: () => Worker;
}

interface TacticianAppProps {
  workers: WorkerFactories;
  nativeAndroid?: boolean;
}

interface InstallPromptEvent extends Event {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: "accepted" | "dismissed" }>;
}

function isGameId(value: string | null): value is GameId {
  return value === "fanorona" || value === "draughts" || value === "morris";
}

function isLocale(value: string | null): value is Locale {
  return value === "zh" || value === "en";
}

export function TacticianApp({ workers, nativeAndroid = false }: TacticianAppProps) {
  const [game, setGame] = useState<GameId>("fanorona");
  const [locale, setLocale] = useState<Locale>("zh");
  const [visited, setVisited] = useState<Set<GameId>>(() => new Set(["fanorona"]));
  const [installPrompt, setInstallPrompt] = useState<InstallPromptEvent | null>(null);

  const changeGame = useCallback((next: GameId) => {
    setVisited((current) => {
      if (current.has(next)) return current;
      const updated = new Set(current);
      updated.add(next);
      return updated;
    });
    setGame(next);
    localStorage.setItem("tactician-game", next);
  }, []);

  const changeLocale = useCallback((next: Locale) => {
    setLocale(next);
    localStorage.setItem("tactician-locale", next);
  }, []);

  useEffect(() => {
    const restorePreferences = window.setTimeout(() => {
      const storedGame = localStorage.getItem("tactician-game");
      const storedLocale = localStorage.getItem("tactician-locale");
      if (isGameId(storedGame)) changeGame(storedGame);
      if (isLocale(storedLocale)) setLocale(storedLocale);
    }, 0);

    if (
      "serviceWorker" in navigator &&
      (window.location.protocol === "https:" || window.location.hostname === "localhost")
    ) {
      navigator.serviceWorker.register("./sw.js").catch(() => undefined);
    }
    return () => window.clearTimeout(restorePreferences);
  }, [changeGame]);

  useEffect(() => {
    document.documentElement.lang = locale === "zh" ? "zh-CN" : "en";
    document.title = locale === "zh" ? "棋局参谋" : "Board Tactician";
  }, [locale]);

  useEffect(() => {
    const capture = (event: Event) => {
      event.preventDefault();
      setInstallPrompt(event as InstallPromptEvent);
    };
    const clear = () => setInstallPrompt(null);
    window.addEventListener("beforeinstallprompt", capture);
    window.addEventListener("appinstalled", clear);
    return () => {
      window.removeEventListener("beforeinstallprompt", capture);
      window.removeEventListener("appinstalled", clear);
    };
  }, []);

  const install = useCallback(async () => {
    if (!installPrompt) return;
    await installPrompt.prompt();
    await installPrompt.userChoice;
    setInstallPrompt(null);
  }, [installPrompt]);

  const navigation = {
    game,
    locale,
    installAvailable: installPrompt !== null,
    nativeAndroid,
    onGameChange: changeGame,
    onInstall: install,
    onLocaleChange: changeLocale,
  };

  return (
    <>
      {visited.has("fanorona") && (
        <div hidden={game !== "fanorona"}>
          <FanoronaAssistant
            {...navigation}
            active={game === "fanorona"}
            createWorker={workers.fanorona}
          />
        </div>
      )}
      {visited.has("draughts") && (
        <div hidden={game !== "draughts"}>
          <DraughtsAssistant
            {...navigation}
            active={game === "draughts"}
            createWorker={workers.draughts}
          />
        </div>
      )}
      {visited.has("morris") && (
        <div hidden={game !== "morris"}>
          <MorrisAssistant
            {...navigation}
            active={game === "morris"}
            createWorker={workers.morris}
          />
        </div>
      )}
    </>
  );
}
