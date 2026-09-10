import Link from "next/link";
import { DEMO_BUSY_BLOCKS } from "@/lib/demo-data";
import { fetchAvailabilityFromOrds } from "@/lib/ordsClient";
import type { BusyBlock } from "@/lib/types";

export const dynamic = "force-dynamic";

function formatRange(startsAt: string, endsAt: string): string {
  const fmt = new Intl.DateTimeFormat("fa-IR", { dateStyle: "medium", timeStyle: "short" });
  return `${fmt.format(new Date(startsAt))} — ${fmt.format(new Date(endsAt))}`;
}

async function loadBusyBlocks(): Promise<{ blocks: BusyBlock[]; live: boolean }> {
  const ordsBaseUrl = process.env.ORACLE_API_BASE_URL;
  if (!ordsBaseUrl) {
    return { blocks: DEMO_BUSY_BLOCKS, live: false };
  }

  try {
    const from = new Date().toISOString();
    const to = new Date(Date.now() + 14 * 24 * 60 * 60 * 1000).toISOString();
    const blocks = await fetchAvailabilityFromOrds(ordsBaseUrl, from, to);
    return { blocks, live: true };
  } catch {
    // A public demo should never break on a backend hiccup — fall back to mock data.
    return { blocks: DEMO_BUSY_BLOCKS, live: false };
  }
}

export default async function HomePage() {
  const { blocks, live } = await loadBusyBlocks();

  return (
    <main>
      <h1>دفتر کار روزانه</h1>
      <p className="subtitle">زمان‌های در دسترس رئیس اداره — فقط بازه‌های مشغول نمایش داده می‌شود، بدون عنوان یا جزئیات.</p>
      <span className="data-source">{live ? "داده‌ی زنده از سرور Oracle" : "داده‌ی نمایشی (demo)"}</span>

      {blocks.length === 0 ? (
        <p>در این بازه هیچ زمان مشغولی ثبت نشده است.</p>
      ) : (
        <ul className="busy-list">
          {blocks.map((block, i) => (
            <li key={i}>
              <span className="badge busy">مشغول</span>
              {formatRange(block.startsAt, block.endsAt)}
            </li>
          ))}
        </ul>
      )}

      <Link className="cta" href="/request">
        ثبت درخواست وقت
      </Link>
    </main>
  );
}
