"use client";

import { useActionState, useEffect, useRef, useState } from "react";
import { Button, Notice } from "@/components/ui";
import { fill, type Messages } from "@/lib/i18n/messages";
import { formatIndianMobile } from "@/lib/phone";
import { loginAction, type LoginState } from "./actions";

type Demo = { label: string; phone: string; detail: string };

export function LoginForm({ t, demoAccounts }: { t: Messages["login"]; demoAccounts: Demo[] | null }) {
  const [state, action, pending] = useActionState<LoginState, FormData>(loginAction, { step: "phone" });
  const [now, setNow] = useState(() => Date.now());
  const codeRef = useRef<HTMLInputElement>(null);

  // Resend countdown: the server sends an absolute deadline; we only tick a clock.
  useEffect(() => {
    if (!state.waitUntil) return;
    const timer = setInterval(() => {
      const t = Date.now();
      setNow(t);
      if (t >= state.waitUntil!) clearInterval(timer);
    }, 1000);
    return () => clearInterval(timer);
  }, [state.waitUntil]);
  const wait = state.waitUntil ? Math.max(0, Math.ceil((state.waitUntil - now) / 1000)) : 0;

  useEffect(() => {
    if (state.step === "otp") codeRef.current?.focus();
  }, [state.step, state.waitUntil]);

  const errorText = state.error
    ? state.error === "rateLimited"
      ? fill(t.errors.rateLimited, { s: state.retryAfterSec ?? 30 })
      : t.errors[state.error]
    : null;

  if (state.step === "otp" && state.phone) {
    return (
      <div className="space-y-5">
        <p className="text-[15px] text-ink-2">
          {t.otpSentTo} <span className="num font-semibold text-ink">{formatIndianMobile(state.phone)}</span>
        </p>

        {state.demoOtp && (
          <Notice tone="info">
            {t.demoOtp} <span className="num font-mono text-lg font-semibold tracking-widest">{state.demoOtp}</span>
          </Notice>
        )}

        <form action={action} className="space-y-4">
          <input type="hidden" name="phone" value={state.phone} />
          <label className="block">
            <span className="mb-1.5 block text-[15px] font-medium">{t.otpLabel}</span>
            <input
              ref={codeRef}
              name="code"
              inputMode="numeric"
              autoComplete="one-time-code"
              pattern="\d{6}"
              maxLength={6}
              required
              aria-invalid={!!errorText}
              aria-describedby={errorText ? "login-error" : undefined}
              className="num h-14 w-full rounded-md border border-line-strong bg-surface px-4 text-center text-2xl tracking-[0.5em] outline-none focus:border-accent"
            />
          </label>
          {errorText && (
            <p id="login-error" role="alert" className="text-[15px] text-danger">
              {errorText}
            </p>
          )}
          <Button type="submit" name="intent" value="verify" size="lg" disabled={pending}>
            {pending ? t.verifying : t.verify}
          </Button>
        </form>

        <div className="flex items-center justify-between gap-2">
          <form action={action}>
            <Button type="submit" name="intent" value="change" variant="ghost" disabled={pending}>
              {t.changeNumber}
            </Button>
          </form>
          <form action={action}>
            <input type="hidden" name="phone" value={state.phone} />
            <Button type="submit" name="intent" value="send" variant="ghost" disabled={pending || wait > 0}>
              {wait > 0 ? fill(t.resendIn, { s: wait }) : t.resend}
            </Button>
          </form>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <form action={action} className="space-y-4">
        <label className="block">
          <span className="mb-1.5 block text-[15px] font-medium">{t.phoneLabel}</span>
          <div className="flex h-14 items-center rounded-md border border-line-strong bg-surface focus-within:border-accent">
            <span className="num pl-4 pr-2 text-lg text-ink-3">+91</span>
            <input
              name="phone"
              type="tel"
              inputMode="numeric"
              autoComplete="tel-national"
              placeholder={t.phonePlaceholder}
              defaultValue={state.phone ? state.phone.slice(2) : ""}
              required
              aria-invalid={!!errorText}
              aria-describedby={errorText ? "login-error" : undefined}
              className="num h-full w-full min-w-0 rounded-r-md bg-transparent pr-4 text-lg outline-none"
            />
          </div>
        </label>
        {errorText && (
          <p id="login-error" role="alert" className="text-[15px] text-danger">
            {errorText}
          </p>
        )}
        <Button type="submit" name="intent" value="send" size="lg" disabled={pending}>
          {pending ? t.sending : t.sendOtp}
        </Button>
      </form>

      {demoAccounts && (
        <section aria-labelledby="demo-title" className="border-t border-line pt-5">
          <h2 id="demo-title" className="text-[15px] font-semibold">
            {t.demoTitle}
          </h2>
          <p className="mt-0.5 text-[13px] text-ink-2">{t.demoHint}</p>
          <ul className="mt-3 space-y-2">
            {demoAccounts.map((d) => (
              <li key={d.phone}>
                <form action={action}>
                  <input type="hidden" name="phone" value={d.phone} />
                  <button
                    type="submit"
                    name="intent"
                    value="send"
                    disabled={pending}
                    className="flex w-full items-center justify-between gap-3 rounded-md border border-line px-4 py-3 text-left hover:bg-sunken disabled:opacity-50"
                  >
                    <span className="min-w-0">
                      <span className="block text-[15px] font-medium">{d.label}</span>
                      <span className="block truncate text-[13px] text-ink-2">{d.detail}</span>
                    </span>
                    <span className="num shrink-0 text-[13px] text-ink-3">{formatIndianMobile(d.phone)}</span>
                  </button>
                </form>
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}
