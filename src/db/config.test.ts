import { describe, expect, it } from "vitest";
import { assertWipeAllowed, databaseConfig, isRemoteDatabaseUrl, LOCAL_DEFAULT_URL } from "./config";

const TURSO = "libsql://vyapaarflow-demo.turso.io";
const PROD = { NODE_ENV: "production" };

describe("databaseConfig", () => {
  it("keeps the local SQLite default for development and tests", () => {
    expect(databaseConfig({})).toEqual({ url: LOCAL_DEFAULT_URL, authToken: undefined });
    expect(databaseConfig({ NODE_ENV: "development", DATABASE_URL: "file:./data/x.db" }).url).toBe("file:./data/x.db");
    expect(databaseConfig({ NODE_ENV: "test", DATABASE_URL: ":memory:" }).url).toBe(":memory:");
  });

  it("accepts a remote Turso URL with a token in production", () => {
    expect(databaseConfig({ ...PROD, DATABASE_URL: TURSO, DATABASE_AUTH_TOKEN: "t" })).toEqual({ url: TURSO, authToken: "t" });
    expect(databaseConfig({ ...PROD, DATABASE_URL: "https://db.example.com", DATABASE_AUTH_TOKEN: "t" }).url).toBe("https://db.example.com");
  });

  it("fails fast in production without DATABASE_URL", () => {
    expect(() => databaseConfig({ ...PROD, DATABASE_AUTH_TOKEN: "t" })).toThrow(/DATABASE_URL is not set/);
    expect(() => databaseConfig({ ...PROD, DATABASE_URL: "  ", DATABASE_AUTH_TOKEN: "t" })).toThrow(/DATABASE_URL is not set/);
  });

  it.each(["file:./data/local.db", ":memory:", "http://db.example.com", "libsql://", "not a url"])("fails fast in production for a non-remote URL: %s", (url) => {
    expect(() => databaseConfig({ ...PROD, DATABASE_URL: url, DATABASE_AUTH_TOKEN: "t" })).toThrow(/must be a remote libSQL\/Turso URL/);
  });

  it("fails fast in production without DATABASE_AUTH_TOKEN", () => {
    expect(() => databaseConfig({ ...PROD, DATABASE_URL: TURSO })).toThrow(/DATABASE_AUTH_TOKEN is not set/);
    expect(() => databaseConfig({ ...PROD, DATABASE_URL: TURSO, DATABASE_AUTH_TOKEN: "" })).toThrow(/DATABASE_AUTH_TOKEN is not set/);
  });

  it("never puts the URL value in the error", () => {
    expect(() => databaseConfig({ ...PROD, DATABASE_URL: "file:/secret/path.db?token=abc", DATABASE_AUTH_TOKEN: "t" })).toThrow(
      expect.objectContaining({ message: expect.not.stringMatching(/secret|abc/) }),
    );
  });

  it("does not check during next build, so the app builds without production credentials", () => {
    expect(databaseConfig({ ...PROD, NEXT_PHASE: "phase-production-build" }).url).toBe(LOCAL_DEFAULT_URL);
  });

  it("allows a local file in production only with ALLOW_LOCAL_DATABASE=true", () => {
    expect(databaseConfig({ ...PROD, ALLOW_LOCAL_DATABASE: "true", DATABASE_URL: "file:./data/e2e.db" }).url).toBe("file:./data/e2e.db");
    expect(() => databaseConfig({ ...PROD, ALLOW_LOCAL_DATABASE: "1", DATABASE_URL: "file:./data/e2e.db" })).toThrow();
  });
});

describe("isRemoteDatabaseUrl", () => {
  it("recognises remote libSQL URLs", () => {
    expect([TURSO, "https://x.turso.io", "wss://x.turso.io"].map(isRemoteDatabaseUrl)).toEqual([true, true, true]);
    expect(["file:a.db", ":memory:", "http://x", ""].map(isRemoteDatabaseUrl)).toEqual([false, false, false, false]);
  });
});

describe("assertWipeAllowed (db:seed / db:reset)", () => {
  it("lets local files and :memory: be wiped without an opt-in", () => {
    for (const url of ["file:./data/local.db", "file:./data/e2e.db", ":memory:"]) expect(() => assertWipeAllowed(url, { argv: [], env: {} })).not.toThrow();
  });

  it.each([TURSO, "https://x.turso.io", "wss://x.turso.io"])("refuses to wipe a remote database without an opt-in: %s", (url) => {
    expect(() => assertWipeAllowed(url, { argv: ["node", "scripts/reset.ts"], env: {} })).toThrow(/Refusing to wipe/);
  });

  it("accepts --allow-remote-wipe or ALLOW_REMOTE_WIPE=true", () => {
    expect(() => assertWipeAllowed(TURSO, { argv: ["node", "scripts/reset.ts", "--allow-remote-wipe"], env: {} })).not.toThrow();
    expect(() => assertWipeAllowed(TURSO, { argv: [], env: { ALLOW_REMOTE_WIPE: "true" } })).not.toThrow();
  });

  it("does not treat look-alike values as an opt-in", () => {
    expect(() => assertWipeAllowed(TURSO, { argv: ["--allow-remote-wipe=no", "--allow-remote"], env: { ALLOW_REMOTE_WIPE: "yes" } })).toThrow(/Refusing to wipe/);
  });

  it("names only the host in the refusal", () => {
    expect(() => assertWipeAllowed(`${TURSO}?authToken=supersecret`, { argv: [], env: {} })).toThrow(
      expect.objectContaining({ message: expect.stringContaining("vyapaarflow-demo.turso.io") }),
    );
    expect(() => assertWipeAllowed(`${TURSO}?authToken=supersecret`, { argv: [], env: {} })).toThrow(
      expect.objectContaining({ message: expect.not.stringContaining("supersecret") }),
    );
  });
});
