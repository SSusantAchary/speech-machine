import { beforeEach, describe, expect, it } from "vitest";
import { clearToken, hasValidToken, setToken } from "@/lib/api";

const encodeBase64Url = (value: string) =>
  Buffer.from(value, "utf8")
    .toString("base64")
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/g, "");

const createToken = (expSecondsFromNow: number) => {
  const header = encodeBase64Url(JSON.stringify({ alg: "HS256", typ: "JWT" }));
  const payload = encodeBase64Url(
    JSON.stringify({ sub: "admin", exp: Math.floor(Date.now() / 1000) + expSecondsFromNow })
  );
  return `${header}.${payload}.signature`;
};

describe("auth token helpers", () => {
  beforeEach(() => {
    clearToken();
  });

  it("rejects expired tokens", () => {
    setToken(createToken(-3600));
    expect(hasValidToken()).toBe(false);
  });

  it("accepts future-dated tokens", () => {
    setToken(createToken(3600));
    expect(hasValidToken()).toBe(true);
  });
});
