"use client";

import { Suspense, useCallback, useEffect, useState, type FormEvent } from "react";
import { useSearchParams } from "next/navigation";
import Link from "next/link";

interface RequestStatusResult {
  id: number;
  eventType: string;
  title: string;
  status: string;
  startsAt: string;
  endsAt: string;
  reviewedAt: string | null;
  reviewNote: string | null;
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

const PERSIAN_DIGITS = "۰۱۲۳۴۵۶۷۸۹";
const ARABIC_DIGITS = "٠١٢٣٤٥٦٧٨٩";

// Accepts Persian/Arabic-Indic digits too (common on Persian keyboards),
// normalizes them to ASCII, and strips everything else non-numeric.
function toDigitsOnly(value: string): string {
  const normalized = value.replace(/[۰-۹٠-٩]/g, (ch) => {
    const persianIndex = PERSIAN_DIGITS.indexOf(ch);
    if (persianIndex !== -1) return String(persianIndex);
    return String(ARABIC_DIGITS.indexOf(ch));
  });
  return normalized.replace(/[^0-9]/g, "");
}

function StatusForm() {
  const searchParams = useSearchParams();
  const [requestId, setRequestId] = useState(searchParams.get("id") ?? "");
  const [state, setState] = useState<"idle" | "loading" | "found" | "error">("idle");
  const [result, setResult] = useState<RequestStatusResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [idHint, setIdHint] = useState<string | null>(null);

  function handleIdChange(raw: string) {
    const digitsOnly = toDigitsOnly(raw);
    setIdHint(digitsOnly.length < raw.length ? "شناسه‌ی درخواست فقط باید عدد باشد." : null);
    setRequestId(digitsOnly);
  }

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
      <Link className="back-link" href="/">
        ← بازگشت به صفحه اول
      </Link>
      <h1>بررسی وضعیت درخواست</h1>
      <p className="subtitle">
        شناسه‌ای که بعد از ثبت درخواست به شما نمایش داده شد را وارد کنید.
      </p>

      <form onSubmit={handleSubmit}>
        <label>
          شناسه‌ی درخواست
          <input
            inputMode="numeric"
            pattern="[0-9]*"
            value={requestId}
            onChange={(e) => handleIdChange(e.target.value)}
            placeholder="مثلاً 12"
          />
        </label>
        {idHint && <p className="error">{idHint}</p>}

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
          {result.reviewNote && (
            <div className="review-note">
              <strong>یادداشت منشی:</strong> {result.reviewNote}
            </div>
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
