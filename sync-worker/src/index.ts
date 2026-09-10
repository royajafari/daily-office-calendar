import { loadConfig } from "./config.js";
import { OrdsClient } from "./ordsClient.js";
import { createGoogleClient, type GoogleClient } from "./googleClient.js";
import { buildSyncPayload } from "./contract.js";

async function processOne(ords: OrdsClient, google: GoogleClient): Promise<boolean> {
  const item = await ords.claimNext();
  if (!item) return false;

  try {
    const snapshot = await ords.getEventSnapshot(item.eventId);
    const payload = buildSyncPayload(item, snapshot);

    if (payload.operation === "UPSERT") {
      await google.upsert(payload);
    } else {
      await google.remove(payload);
    }

    await ords.reportResult(item.queueId, "DONE");
    console.log(`sync-worker: queue item ${item.queueId} (${item.operation}) done`);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error(`sync-worker: queue item ${item.queueId} failed: ${message}`);
    await ords.reportResult(item.queueId, "FAILED", message.slice(0, 4000));
  }

  return true;
}

async function main(): Promise<void> {
  const config = loadConfig();
  const ords = new OrdsClient(config);
  const google = createGoogleClient(config);

  console.log(
    `sync-worker starting (dryRun=${config.dryRun}, pollIntervalMs=${config.pollIntervalMs}, ordsBaseUrl=${config.ordsBaseUrl})`
  );

  for (;;) {
    let processed = false;
    do {
      processed = await processOne(ords, google);
    } while (processed);
    await new Promise((resolve) => setTimeout(resolve, config.pollIntervalMs));
  }
}

main().catch((err) => {
  console.error("sync-worker crashed:", err);
  process.exit(1);
});
