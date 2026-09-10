export interface WorkerConfig {
  ordsBaseUrl: string;
  ordsUser?: string;
  ordsPassword?: string;
  pollIntervalMs: number;
  dryRun: boolean;
  google?: {
    clientEmail: string;
    privateKey: string;
    calendarId: string;
  };
}

/**
 * Google credentials (G4 in docs/architecture.md) are optional on purpose:
 * without them the worker runs in dry-run mode — it still polls ORDS,
 * validates the contract and logs what it would have sent to Google, but
 * never calls the real API. Never fabricate these values; they come only
 * from the operator's environment.
 */
export function loadConfig(env: NodeJS.ProcessEnv = process.env): WorkerConfig {
  const ordsBaseUrl = env.ORDS_BASE_URL;
  if (!ordsBaseUrl) {
    throw new Error(
      "ORDS_BASE_URL is required, e.g. http://localhost:8080/ords/daily_office/daily-office"
    );
  }

  const hasGoogleCreds = Boolean(
    env.GOOGLE_CLIENT_EMAIL && env.GOOGLE_PRIVATE_KEY && env.GOOGLE_CALENDAR_ID
  );

  return {
    ordsBaseUrl,
    ordsUser: env.ORDS_USER,
    ordsPassword: env.ORDS_PASSWORD,
    pollIntervalMs: Number(env.POLL_INTERVAL_MS ?? 5000),
    dryRun: env.SYNC_DRY_RUN === "true" || !hasGoogleCreds,
    google: hasGoogleCreds
      ? {
          clientEmail: env.GOOGLE_CLIENT_EMAIL as string,
          privateKey: (env.GOOGLE_PRIVATE_KEY as string).replace(/\\n/g, "\n"),
          calendarId: env.GOOGLE_CALENDAR_ID as string,
        }
      : undefined,
  };
}
