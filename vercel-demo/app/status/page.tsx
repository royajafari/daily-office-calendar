"use client";

import { Suspense, useCallback, useEffect, useState, type FormEvent } from "react";
import { useSearchParams } from "next/navigation";

interface RequestStatusResult {
  id: number;
  eventType: string;
  title: string;
  status: string;
  startsAt: string;
  endsAt: string;
  reviewedAt: string | null;
}

const STATUS_LABEL: Record<string, string> = {
  PENDING: "در انتظار بررسی",
  APPROVED: "تأیید شد",
  REJECTED: "رد شد",
};

const STATUS_CLASS: Record<string, string> = {
  PENDING: "status-pending",
  APPROVED: "status-approved",
  REJECTED: "status-rejected",
};

function formatDateTime(value: string): string {
  const fmt = new Intl.DateTimeFormat("fa-IR", { dateStyle: "medium", timeStyle: "short" });
  return fmt.format(new Date(value));
}

function StatusForm() {
  const searchParams = useSearchParams();
  const [requestId, setRequestId] = useState(searchParams.get("id") ?? "");
  const [state, setState] = useState<"idle" | "loading" | "found" | "error">("idle");
  const [result, setResult] = useState<RequestStatusResult | null>(null);
  const [error, setError] = useState<string | null>(null);

  const checkStatus = useCallback(async (id: string) => {
    setState("loading");
    setError(null);
    setResult(null);

    const res = await fetch(`/api/requests/${encodeURIComponent(id)}`);
    const body = await res.json().catch(() => ({}) as Record<string, unknown>);

    if (!res.ok) {
      setError((body.error as string) ?? "بررسی وضعیت ناموفق بود.");
      setState("error");
      return;
    }

    setResult(body as RequestStatusResult);
    setState("found");
  }, []);

  useEffect(() => {
    const idFromUrl = searchParams.get("id");
    if (idFromUrl) {
      void checkStatus(idFromUrl);
    }
    // Only run once on mount for the initial deep link.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function handleSubmit(event: FormEvent) {
    event.preventDefault();
    void checkStatus(requestId);
  }

  return (
    <main>
      <h1>بررسی وضعیت درخواست</h1>
      <p className="subtitle">
        شناسه‌ای که بعد از ثبت درخواست به شما نمایش داده شد را وارد کنید.
      </p>

      <form onSubmit={handleSubmit}>
        <label>
          شناسه‌ی درخواست
          <input
            inputMode="numeric"
            value={requestId}
            onChange={(e) => setRequestId(e.target.value)}
            placeholder="مثلاً 12"
          />
        </label>

        <button type="submit" disabled={state === "loading" || !requestId}>
          بررسی وضعیت
        </button>
      </form>

      {error && <p className="error">{error}</p>}

      {result && (
        <div className="status-card">
          <span className={`badge ${STATUS_CLASS[result.status] ?? ""}`}>
            {STATUS_LABEL[result.status] ?? result.status}
          </span>
          <h2>{result.title}</h2>
          <p>
            {formatDateTime(result.startsAt)} — {formatDateTime(result.endsAt)}
          </p>
          {result.reviewedAt && (
            <p className="subtitle">زمان بررسی: {formatDateTime(result.reviewedAt)}</p>
          )}
        </div>
      )}
    </main>
  );
}

export default function StatusPage() {
  return (
    <Suspense fallback={null}>
      <StatusForm />
    </Suspense>
  );
}
