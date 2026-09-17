"use client";

import { useEffect, useState } from "react";

interface RequestRow {
  id: number;
  requestedBy: string;
  eventType: string;
  title: string;
  note?: string;
  startsAt: string;
  endsAt: string;
  status: "PENDING" | "APPROVED" | "REJECTED";
  reviewedBy?: string;
  reviewedAt?: string;
}

const EVENT_TYPE_LABEL: Record<string, string> = {
  MEETING: "جلسه",
  MISSION: "مأموریت",
  APPOINTMENT: "قرار ملاقات",
  OTHER: "سایر",
};

const STATUS_LABEL: Record<string, string> = {
  PENDING: "در انتظار",
  APPROVED: "تأیید شد",
  REJECTED: "رد شد",
};

function formatDateTime(value: string): string {
  const fmt = new Intl.DateTimeFormat("fa-IR", { dateStyle: "medium", timeStyle: "short" });
  return fmt.format(new Date(value));
}

export default function SecretaryPage() {
  const [rows, setRows] = useState<RequestRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [notice, setNotice] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<number | null>(null);

  async function load() {
    setLoading(true);
    const res = await fetch("/api/requests", { cache: "no-store" });
    const body = await res.json().catch(() => ({ items: [] }) as { items: RequestRow[] });
    setRows((body.items as RequestRow[]) ?? []);
    setLoading(false);
  }

  useEffect(() => {
    void load();
  }, []);

  async function review(id: number, decision: "APPROVED" | "REJECTED") {
    setBusyId(id);
    setNotice(null);

    const res = await fetch(`/api/requests/${id}/review`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ decision, reviewedBy: "منشی (پیش‌نمایش)" }),
    });
    const body = await res.json().catch(() => ({}) as Record<string, unknown>);

    if (!res.ok) {
      setNotice((body.error as string) ?? "بررسی درخواست ناموفق بود.");
    }

    setBusyId(null);
    await load();
  }

  return (
    <main className="wide">
      <h1>بررسی درخواست‌ها (منشی)</h1>
      <p className="subtitle">
        این پیش‌نمایش موقت است — بدون احراز هویت واقعی، فقط برای نمایش جریان کار. نسخه‌ی
        نهایی و امن این صفحه در APEX (نقش OFFICE_HEAD) ساخته می‌شود.
      </p>

      {notice && <p className="error">{notice}</p>}

      {loading ? (
        <p>در حال بارگذاری...</p>
      ) : rows.length === 0 ? (
        <p>هنوز درخواستی ثبت نشده است.</p>
      ) : (
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>#</th>
                <th>درخواست‌کننده</th>
                <th>نوع</th>
                <th>عنوان</th>
                <th>بازه</th>
                <th>وضعیت</th>
                <th>اقدام</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => (
                <tr key={row.id}>
                  <td>{row.id}</td>
                  <td>{row.requestedBy}</td>
                  <td>{EVENT_TYPE_LABEL[row.eventType] ?? row.eventType}</td>
                  <td>{row.title}</td>
                  <td>
                    {formatDateTime(row.startsAt)} — {formatDateTime(row.endsAt)}
                  </td>
                  <td>
                    <span className={`badge status-${row.status.toLowerCase()}`}>
                      {STATUS_LABEL[row.status]}
                    </span>
                  </td>
                  <td>
                    {row.status === "PENDING" ? (
                      <div className="row-actions">
                        <button
                          type="button"
                          disabled={busyId === row.id}
                          onClick={() => review(row.id, "APPROVED")}
                        >
                          تأیید
                        </button>
                        <button
                          type="button"
                          className="secondary"
                          disabled={busyId === row.id}
                          onClick={() => review(row.id, "REJECTED")}
                        >
                          رد
                        </button>
                      </div>
                    ) : (
                      <span className="subtitle">
                        {row.reviewedAt ? formatDateTime(row.reviewedAt) : "—"}
                      </span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </main>
  );
}
