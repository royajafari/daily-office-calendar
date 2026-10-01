import { NextResponse } from "next/server";
import { validateAppointmentRequest } from "@/lib/validate";
import { submitRequestToOrds } from "@/lib/ordsClient";
import { addDemoRequest } from "@/lib/demo-data";
import { consumePass } from "@/lib/captcha";
import type { AppointmentRequestInput } from "@/lib/types";

export async function POST(request: Request) {
  const body = (await request.json().catch(() => null)) as
    | (Partial<AppointmentRequestInput> & { captchaToken?: unknown })
    | null;

  if (!body) {
    return NextResponse.json({ error: "بدنه‌ی درخواست نامعتبر است." }, { status: 400 });
  }

  const errors = validateAppointmentRequest(body);
  if (errors.length > 0) {
    return NextResponse.json({ errors }, { status: 422 });
  }

  // After field validation, so fixing a typo doesn't cost the user their tick.
  const captcha = consumePass(body.captchaToken);
  if (!captcha.ok) {
    return NextResponse.json({ error: captcha.error, captcha: true }, { status: 403 });
  }

  const { captchaToken: _captchaToken, ...fields } = body;
  const validInput = fields as AppointmentRequestInput;
  const ordsBaseUrl = process.env.ORACLE_API_BASE_URL;

  if (ordsBaseUrl) {
    try {
      const result = await submitRequestToOrds(ordsBaseUrl, validInput);
      return NextResponse.json(result, { status: 201 });
    } catch (err) {
      return NextResponse.json(
        {
          error: "ثبت درخواست روی سرور واقعی ناموفق بود.",
          detail: err instanceof Error ? err.message : String(err),
        },
        { status: 502 }
      );
    }
  }

  const demoRequest = addDemoRequest(validInput);
  return NextResponse.json(demoRequest, { status: 201 });
}
