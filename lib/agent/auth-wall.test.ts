// @vitest-environment node
import { describe, expect, it } from "vitest";
import { looksAuthWalled } from "./auth-wall";

describe("looksAuthWalled", () => {
  it("flags known identity-provider hosts", () => {
    expect(looksAuthWalled("https://accounts.google.com/signin")).toBe(true);
    expect(looksAuthWalled("https://acme.okta.com/")).toBe(true);
    expect(looksAuthWalled("https://login.microsoftonline.com/common")).toBe(
      true,
    );
    expect(looksAuthWalled("https://appleid.apple.com/")).toBe(true);
  });

  it("flags sign-in subdomains", () => {
    expect(looksAuthWalled("https://login.example.com/")).toBe(true);
    expect(looksAuthWalled("https://signin.aws.amazon.com/")).toBe(true);
    expect(looksAuthWalled("https://sso.acme.io/")).toBe(true);
  });

  it("flags explicit sign-in paths", () => {
    expect(looksAuthWalled("https://github.com/login")).toBe(true);
    expect(looksAuthWalled("https://example.com/sign-in")).toBe(true);
    expect(looksAuthWalled("https://example.com/oauth2/authorize")).toBe(true);
    expect(looksAuthWalled("https://wordpress.site/wp-login.php")).toBe(true);
  });

  it("does NOT flag ordinary pages (high precision)", () => {
    expect(looksAuthWalled("https://example.com")).toBe(false);
    expect(looksAuthWalled("https://www.example.gov/apply")).toBe(false);
    expect(looksAuthWalled("https://en.wikipedia.org/wiki/Login")).toBe(false);
    // generic account/app/my surfaces preview fine — not flagged
    expect(looksAuthWalled("https://my.uscis.gov/account")).toBe(false);
    expect(looksAuthWalled("https://app.notion.so/workspace")).toBe(false);
    // word-boundary safety: not every "auth"/"account" substring is a login
    expect(looksAuthWalled("https://example.com/author/jane")).toBe(false);
    expect(looksAuthWalled("https://example.com/accountant")).toBe(false);
  });

  it("returns false for non-URLs", () => {
    expect(looksAuthWalled("not a url")).toBe(false);
    expect(looksAuthWalled("")).toBe(false);
  });
});
