export type IosInstallGuide = "safari" | "wechat" | "other-browser";

export interface InstallEnvironment {
  protocol: string;
  hostname: string;
  userAgent: string;
  platform: string;
  maxTouchPoints: number;
  navigatorStandalone: boolean;
  displayModeStandalone: boolean;
}

export function isPwaServingContext(protocol: string, hostname: string) {
  const localDevelopment =
    protocol === "http:" && /^(localhost|127(?:\.\d{1,3}){3}|\[::1\])$/.test(hostname);
  return protocol === "https:" || localDevelopment;
}

export function getIosInstallGuide({
  protocol,
  hostname,
  userAgent,
  platform,
  maxTouchPoints,
  navigatorStandalone,
  displayModeStandalone,
}: InstallEnvironment): IosInstallGuide | null {
  if (
    !isPwaServingContext(protocol, hostname) ||
    navigatorStandalone ||
    displayModeStandalone
  ) {
    return null;
  }

  const iosDevice = /iPad|iPhone|iPod/i.test(userAgent);
  const desktopModeIpad = platform === "MacIntel" && maxTouchPoints > 1;
  if (!iosDevice && !desktopModeIpad) return null;

  if (/MicroMessenger/i.test(userAgent)) return "wechat";

  const alternateBrowser = [
    /CriOS|FxiOS|EdgiOS|OPiOS|GSA|DuckDuckGo|YaBrowser|FBAN|FBAV|Instagram|Line\//i,
    /MQQBrowser|QQ\/|UCBrowser|Weibo|baiduboxapp|Quark|QHBrowser|DingTalk|aweme/i,
  ].some((pattern) => pattern.test(userAgent));
  const safari =
    /Version\/[\d.]+/i.test(userAgent) &&
    /Safari\//i.test(userAgent) &&
    !alternateBrowser;

  return safari ? "safari" : "other-browser";
}

export function detectIosInstallGuide(): IosInstallGuide | null {
  if (typeof window === "undefined" || typeof navigator === "undefined") return null;

  const iosNavigator = navigator as Navigator & { standalone?: boolean };
  return getIosInstallGuide({
    protocol: window.location.protocol,
    hostname: window.location.hostname,
    userAgent: navigator.userAgent,
    platform: navigator.platform,
    maxTouchPoints: navigator.maxTouchPoints,
    navigatorStandalone: iosNavigator.standalone === true,
    displayModeStandalone: window.matchMedia("(display-mode: standalone)").matches,
  });
}
