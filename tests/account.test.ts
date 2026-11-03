import { describe, expect, it } from "vitest";
import { deviceLabel, parseUserAgent } from "@/lib/device";
import { PASSWORD_MAX, PASSWORD_MIN, passwordProblem } from "@/lib/password-rules";
import { authErrorMessage } from "@/lib/auth-errors";

const en = (_ar: string, e: string) => e;
const ar = (a: string) => a;

const UA = {
  chromeWin: "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
  edgeWin: "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36 Edg/120.0.0.0",
  safariIphone: "Mozilla/5.0 (iPhone; CPU iPhone OS 17_1 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.1 Mobile/15E148 Safari/604.1",
  chromeIos: "Mozilla/5.0 (iPhone; CPU iPhone OS 17_1 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) CriOS/120.0.6099.119 Mobile/15E148 Safari/604.1",
  firefoxLinux: "Mozilla/5.0 (X11; Linux x86_64; rv:121.0) Gecko/20100101 Firefox/121.0",
  chromeAndroid: "Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Mobile Safari/537.36",
  safariMac: "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.1 Safari/605.1.15",
  headless: "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) HeadlessChrome/119.0.6045.9 Safari/537.36",
};

describe("device label", () => {
  it("tells the browser and the system apart, Edge and Chrome iOS included", () => {
    expect(deviceLabel(UA.chromeWin, en)).toBe("Chrome on Windows");
    expect(deviceLabel(UA.edgeWin, en)).toBe("Edge on Windows");
    expect(deviceLabel(UA.safariIphone, en)).toBe("Safari on iOS");
    expect(deviceLabel(UA.chromeIos, en)).toBe("Chrome on iOS");
    expect(deviceLabel(UA.firefoxLinux, en)).toBe("Firefox on Linux");
    expect(deviceLabel(UA.chromeAndroid, en)).toBe("Chrome on Android");
    expect(deviceLabel(UA.safariMac, en)).toBe("Safari on macOS");
    expect(deviceLabel(UA.headless, en)).toBe("Chrome on Linux");
  });
  it("marks phones as mobile", () => {
    expect(parseUserAgent(UA.safariIphone).mobile).toBe(true);
    expect(parseUserAgent(UA.chromeAndroid).mobile).toBe(true);
    expect(parseUserAgent(UA.chromeWin).mobile).toBe(false);
  });
  it("is Arabic when asked and never throws on junk", () => {
    expect(deviceLabel(UA.chromeWin, (a) => a)).toBe("Chrome على Windows");
    for (const junk of [null, undefined, "", "node", "x".repeat(5000)]) expect(deviceLabel(junk, en)).toBe("Unknown device");
    expect(deviceLabel(null, (a) => a)).toBe("جهاز غير معروف");
    expect(deviceLabel("Mozilla/5.0 (Windows NT 10.0)", en)).toBe("Windows");
  });
});

describe("password policy", () => {
  it("asks for 10 to 72 characters", () => {
    expect(passwordProblem("abcdefghijklmnop".slice(0, PASSWORD_MIN - 1), en)).toMatch(/at least 10/);
    expect(passwordProblem("abcdefghi", en)).toMatch(/at least 10/);
    expect(passwordProblem("correct-horse-battery", en)).toBeNull();
    const alphabet = "abcdefghijklmnopqrstuvwxyz0123456789";
    const of = (n: number) => alphabet.repeat(3).slice(0, n);
    expect(passwordProblem(of(PASSWORD_MAX + 1), en)).toMatch(/at most 72/);
    expect(passwordProblem(of(PASSWORD_MAX), en)).toBeNull();
  });
  it("measures the maximum in bytes like bcrypt, and the minimum in characters", () => {
    expect(passwordProblem("ع".repeat(40), en)).toMatch(/at most 72/);        // 80 bytes
    expect(passwordProblem("ع".repeat(10), en)).toMatch(/too simple/);          // 10 characters, one repeated
    expect(passwordProblem("مرحبابكمجميعا", en)).toBeNull();
  });
  it("refuses edge spaces and one repeated character", () => {
    expect(passwordProblem(" correct-horse", en)).toMatch(/space/);
    expect(passwordProblem("correct-horse ", en)).toMatch(/space/);
    expect(passwordProblem("aaaaaaaaaaaa", en)).toMatch(/too simple/);
    expect(passwordProblem("short", ar)).toContain("10");
  });
});

describe("auth error messages", () => {
  it("explains rate limiting for sign-in, sign-up and mail", () => {
    expect(authErrorMessage({ status: 429, code: "over_request_rate_limit" }, en, "login")).toMatch(/Too many attempts/);
    expect(authErrorMessage({ status: 429 }, en, "login")).toMatch(/Too many attempts/);
    expect(authErrorMessage({ status: 429, code: "over_email_send_rate_limit" }, en, "signup")).toMatch(/confirmation-email limit/);
  });
  it("keeps wrong credentials generic and names an unconfirmed email", () => {
    expect(authErrorMessage({ status: 400, code: "invalid_credentials" }, en, "login")).toBe("Incorrect email or password.");
    expect(authErrorMessage({ status: 400, code: "email_not_confirmed" }, en, "login")).toMatch(/not confirmed/);
    expect(authErrorMessage({ status: 400, code: "something_new" }, en, "login")).toBe("Incorrect email or password.");
  });
  it("tells what is wrong with a refused password", () => {
    expect(authErrorMessage({ code: "weak_password", weak_password: { reasons: ["pwned"] } }, en, "signup")).toMatch(/data leaks/);
    expect(authErrorMessage({ code: "weak_password", weak_password: { reasons: ["characters"] } }, en, "password")).toMatch(/uppercase/);
    expect(authErrorMessage({ code: "weak_password" }, en, "signup")).toMatch(/too weak/);
    expect(authErrorMessage({ code: "same_password" }, en, "password")).toMatch(/different/);
  });
  it("reports an outage as such and falls back per form", () => {
    expect(authErrorMessage({ name: "AuthRetryableFetchError", status: 0 }, en, "login")).toMatch(/temporarily unavailable/);
    expect(authErrorMessage({ status: 503 }, en, "signup")).toMatch(/temporarily unavailable/);
    expect(authErrorMessage({ status: 422 }, en, "signup")).toMatch(/Could not create/);
    expect(authErrorMessage({ status: 422 }, en, "password")).toMatch(/Could not update/);
    expect(authErrorMessage(null, en, "reset")).toMatch(/could not be completed/);
  });
});
