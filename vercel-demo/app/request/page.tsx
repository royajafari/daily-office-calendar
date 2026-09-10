"use client";

import { useState, type FormEvent } from "react";

const EVENT_TYPES: Array<{ value: string; label: string }> = [
  { value: "MEETING", label: "جلسه" },
  { value: "MISSION", label: "مأموریت" },
  { value: "APPOINTMENT", label: "قرار ملاقات" },
  { value: "OTHER", label: "سایر" },
];

interface FormState {
  requestedBy: string;
  eventType: string;
  title: string;
  note: string;
  startsAt: string;
  endsAt: string;
}

const INITIAL_STATE: FormState = {
  requestedBy: "",
  eventType: "MEETING",
  title: "",
  note: "",
  startsAt: "",
  endsAt: "",
};

export default function RequestPage() {
  const [form, setForm] = useState<FormState>(INITIAL_STATE);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [status, setStatus] = useState<"idle" | "submitting" | "done" | "error">("idle");
  const [serverError, setServerError] = useState<string | null>(null);

  function updateField<K extends keyof FormState>(field: K, value: FormState[K]) {
    setForm((prev) => ({ ...prev, [field]: value }));
  }

  async function handleSubmit(event: FormEvent) {
    event.preventDefault();
    setStatus("submitting");
    setErrors({});
    setServerError(null);

    const res = await fetch("/api/appointments", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(form),
    });

    if (res.status === 422) {
      const body = (await res.json()) as { errors: Array<{ field: string; message: string }> };
      const fieldErrors: Record<string, string> = {};
      for (const err of body.errors) {
        fieldErrors[err.field] = err.message;
      }
      setErrors(fieldErrors);
      setStatus("error");
      return;
    }

    if (!res.ok) {
      const body = await res.json().catch(() => ({}) as Record<string, unknown>);
      setServerError((body.error as string) ?? "ثبت درخواست ناموفق بود.");
      setStatus("error");
      return;
    }

    setStatus("done");
  }

  if (status === "done") {
    return (
      <main>
        <h1>درخواست ثبت شد</h1>
        <p>درخواست شما ثبت شد و در انتظار تأیید رئیس اداره است.</p>
      </main>
    );
  }

  return (
    <form onSubmit={handleSubmit}>
      <h1>ثبت درخواست وقت</h1>

      <label>
        نام شما
        <input
          value={form.requestedBy}
          onChange={(e) => updateField("requestedBy", e.target.value)}
        />
      </label>
      {errors.requestedBy && <p className="error">{errors.requestedBy}</p>}

      <label>
        نوع
        <select value={form.eventType} onChange={(e) => updateField("eventType", e.target.value)}>
          {EVENT_TYPES.map((t) => (
            <option key={t.value} value={t.value}>
              {t.label}
            </option>
          ))}
        </select>
      </label>
      {errors.eventType && <p className="error">{errors.eventType}</p>}

      <label>
        عنوان
        <input value={form.title} onChange={(e) => updateField("title", e.target.value)} />
      </label>
      {errors.title && <p className="error">{errors.title}</p>}

      <label>
        توضیحات (اختیاری)
        <textarea value={form.note} onChange={(e) => updateField("note", e.target.value)} />
      </label>

      <label>
        زمان شروع
        <input
          type="datetime-local"
          value={form.startsAt}
          onChange={(e) => updateField("startsAt", e.target.value)}
        />
      </label>
      {errors.startsAt && <p className="error">{errors.startsAt}</p>}

      <label>
        زمان پایان
        <input
          type="datetime-local"
          value={form.endsAt}
          onChange={(e) => updateField("endsAt", e.target.value)}
        />
      </label>
      {errors.endsAt && <p className="error">{errors.endsAt}</p>}

      {serverError && <p className="error">{serverError}</p>}

      <button type="submit" disabled={status === "submitting"}>
        ارسال درخواست
      </button>
    </form>
  );
}
