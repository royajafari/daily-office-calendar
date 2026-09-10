import { describe, expect, it } from "vitest";
import { loadConfig } from "../src/config.js";

const BASE_ENV = {
  ORDS_BASE_URL: "http://localhost:8080/ords/daily_office/daily-office",
} as NodeJS.ProcessEnv;

describe("loadConfig", () => {
  it("defaults to dry-run when Google credentials are absent", () => {
    const config = loadConfig(BASE_ENV);
    expect(config.dryRun).toBe(true);
    expect(config.google).toBeUndefined();
  });

  it("enables real mode once all three Google credentials are present", () => {
    const config = loadConfig({
      ...BASE_ENV,
      GOOGLE_CLIENT_EMAIL: "worker@example.iam.gserviceaccount.com",
      GOOGLE_PRIVATE_KEY: "-----BEGIN PRIVATE KEY-----\\nabc\\n-----END PRIVATE KEY-----\\n",
      GOOGLE_CALENDAR_ID: "primary",
    } as NodeJS.ProcessEnv);
    expect(config.dryRun).toBe(false);
    expect(config.google?.calendarId).toBe("primary");
    expect(config.google?.privateKey).toContain("\n");
  });

  it("stays in dry-run when SYNC_DRY_RUN=true even with credentials", () => {
    const config = loadConfig({
      ...BASE_ENV,
      SYNC_DRY_RUN: "true",
      GOOGLE_CLIENT_EMAIL: "worker@example.iam.gserviceaccount.com",
      GOOGLE_PRIVATE_KEY: "-----BEGIN PRIVATE KEY-----\\nabc\\n-----END PRIVATE KEY-----\\n",
      GOOGLE_CALENDAR_ID: "primary",
    } as NodeJS.ProcessEnv);
    expect(config.dryRun).toBe(true);
  });

  it("throws without ORDS_BASE_URL", () => {
    expect(() => loadConfig({} as NodeJS.ProcessEnv)).toThrow();
  });
});
