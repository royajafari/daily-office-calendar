"use client";

import { useRef, useState, type FormEvent } from "react";
import Link from "next/link";
import Script from "next/script";
import DatePicker, { type DateObject } from "react-multi-date-picker";
import persian from "react-date-object/calendars/persian";
import persian_fa from "react-date-object/locales/persian_fa";
import TimePicker from "react-multi-date-picker/plugins/time_picker";
import type { NotRobotCaptchaElement } from "@/types/not-robot-captcha";

// persian_fa ships [fullName, shortName] pairs for weekdays and defaults to
// the short form ("شن", "یک", ...); use the full name in both slots so the
// calendar always shows "شنبه", "یکشنبه", etc.
const persianFaFullWeekdays = {
  ...persian_fa,
  weekDays: persian_fa.weekDays.map(([full]: string[]) => [full, full]),
};

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

function toIsoString(value: DateObject | DateObject[] | null): string {
  if (!value || Array.isArray(value)) return "";
  const jsDate = value.toDate();
  return Number.isNaN(jsDate.getTime()) ? "" : jsDate.toISOString();
}

export default function RequestPage() {
  const [form, setForm] = useState<FormState>(INITIAL_STATE);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [status, setStatus] = useState<"idle" | "submitting" | "done" | "error">("idle");
  const [serverError, setServerError] = useState<string | null>(null);
  const [submittedId, setSubmittedId] = useState<number | null>(null);
  const captchaRef = useRef<NotRobotCaptchaElement>(null);

  function updateField<K extends keyof FormState>(field: K, value: FormState[K]) {
    setForm((prev) => ({ ...prev, [field]: value }));
  }

  async function handleSubmit(event: FormEvent) {
    event.preventDefault();
    // The widget's own submit guard normally stops us before this runs; if
    // its script failed to load, the server still rejects the missing token.
    const captcha = captchaRef.current;
    if (captcha && typeof captcha.requireValid === "function" && !captcha.requireValid()) return;

    setStatus("submitting");
    setErrors({});
    setServerError(null);

    const res = await fetch("/api/appointments", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ...form, captchaToken: captcha?.token ?? "" }),
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
      // Past field validation the pass has been used up (or was rejected): tick again.
      captcha?.reset?.();
      setServerError((body.error as string) ?? "ثبت درخواست ناموفق بود.");
      setStatus("error");
      return;
    }

    const created = (await res.json()) as { id?: number };
    setSubmittedId(created.id ?? null);
    setStatus("done");
  }

  if (status === "done") {
    return (
      <main>
        <Link className="back-link" href="/">
          ← بازگشت به صفحه اول
        </Link>
        <h1>درخواست ثبت شد</h1>
        <p>درخواست شما ثبت شد و در انتظار تأیید رئیس اداره است.</p>
        {submittedId != null && (
          <>
            <p>
              شناسه‌ی درخواست شما: <strong>{submittedId}</strong> — این شماره را برای بررسی
              وضعیت بعداً نگه دارید.
            </p>
            <Link className="cta" href={`/status?id=${submittedId}`}>
              بررسی وضعیت درخواست
            </Link>
          </>
        )}
      </main>
    );
  }

  return (
    <form onSubmit={handleSubmit}>
      <Link className="back-link" href="/">
        ← بازگشت به صفحه اول
      </Link>
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
        <DatePicker
          calendar={persian}
          locale={persianFaFullWeekdays}
          calendarPosition="bottom-right"
          format="YYYY/MM/DD HH:mm"
          plugins={[<TimePicker key="time" hideSeconds />]}
          value={form.startsAt ? new Date(form.startsAt) : null}
          onChange={(value) => updateField("startsAt", toIsoString(value))}
          inputClass="jalali-input"
          className="big-jalali-picker"
          placeholder="روز/ماه/سال ساعت:دقیقه"
          minDate={new Date()}
        />
      </label>
      {errors.startsAt && <p className="error">{errors.startsAt}</p>}

      <label>
        زمان پایان
        <DatePicker
          calendar={persian}
          locale={persianFaFullWeekdays}
          calendarPosition="bottom-right"
          format="YYYY/MM/DD HH:mm"
          plugins={[<TimePicker key="time" hideSeconds />]}
          value={form.endsAt ? new Date(form.endsAt) : null}
          onChange={(value) => updateField("endsAt", toIsoString(value))}
          inputClass="jalali-input"
          className="big-jalali-picker"
          placeholder="روز/ماه/سال ساعت:دقیقه"
          minDate={form.startsAt ? new Date(form.startsAt) : new Date()}
        />
      </label>
      {errors.endsAt && <p className="error">{errors.endsAt}</p>}

      <Script src="/not-robot.js" />
      {/* name="": React owns this subtree, so no hidden <input> — the token goes in the JSON body. */}
      <not-robot-captcha ref={captchaRef} server="/api/captcha" name="" className="captcha" />

      {serverError && <p className="error">{serverError}</p>}

      <button type="submit" disabled={status === "submitting"}>
        ارسال درخواست
      </button>
    </form>
  );
}
