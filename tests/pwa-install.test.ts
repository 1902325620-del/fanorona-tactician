import assert from "node:assert/strict";
import test from "node:test";
import {
  getIosInstallGuide,
  type InstallEnvironment,
  isPwaServingContext,
} from "../app/lib/pwaInstall";

const iphoneSafari =
  "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) " +
  "AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1";

function environment(overrides: Partial<InstallEnvironment> = {}): InstallEnvironment {
  return {
    protocol: "https:",
    hostname: "1902325620-del.github.io",
    userAgent: iphoneSafari,
    platform: "iPhone",
    maxTouchPoints: 5,
    navigatorStandalone: false,
    displayModeStandalone: false,
    ...overrides,
  };
}

test("iPhone Safari receives the Add to Home Screen guide", () => {
  assert.equal(getIosInstallGuide(environment()), "safari");
});

test("iOS embedded and alternate browsers receive the Safari handoff guide", () => {
  assert.equal(
    getIosInstallGuide(environment({ userAgent: `${iphoneSafari} MicroMessenger/8.0.50` })),
    "wechat",
  );
  assert.equal(
    getIosInstallGuide(environment({
      userAgent: iphoneSafari.replace("Version/17.0", "CriOS/126.0.6478.153"),
    })),
    "other-browser",
  );
  assert.equal(
    getIosInstallGuide(environment({ userAgent: `${iphoneSafari} MQQBrowser/14.9` })),
    "other-browser",
  );
});

test("iPad desktop browsing mode is recognized as iOS", () => {
  assert.equal(
    getIosInstallGuide(environment({
      platform: "MacIntel",
      userAgent:
        "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15) AppleWebKit/605.1.15 " +
        "(KHTML, like Gecko) Version/17.0 Safari/605.1.15",
    })),
    "safari",
  );
});

test("installed, desktop, Android, and insecure pages do not show the iOS guide", () => {
  assert.equal(getIosInstallGuide(environment({ navigatorStandalone: true })), null);
  assert.equal(getIosInstallGuide(environment({ displayModeStandalone: true })), null);
  assert.equal(getIosInstallGuide(environment({
    platform: "MacIntel",
    maxTouchPoints: 0,
    userAgent:
      "Mozilla/5.0 (Macintosh; Intel Mac OS X 14_5) AppleWebKit/605.1.15 " +
      "(KHTML, like Gecko) Version/17.5 Safari/605.1.15",
  })), null);
  assert.equal(getIosInstallGuide(environment({
    platform: "Linux armv8l",
    userAgent: "Mozilla/5.0 (Linux; Android 15) AppleWebKit/537.36 Chrome/126 Mobile Safari/537.36",
  })), null);
  assert.equal(getIosInstallGuide(environment({ protocol: "file:", hostname: "" })), null);
  assert.equal(getIosInstallGuide(environment({ protocol: "http:", hostname: "example.com" })), null);
});

test("localhost remains available for iOS-oriented development testing", () => {
  assert.equal(
    getIosInstallGuide(environment({ protocol: "http:", hostname: "127.0.0.1" })),
    "safari",
  );
  assert.equal(isPwaServingContext("http:", "localhost"), true);
  assert.equal(isPwaServingContext("http:", "127.0.0.1"), true);
  assert.equal(isPwaServingContext("http:", "[::1]"), true);
  assert.equal(isPwaServingContext("http:", "example.com"), false);
});
