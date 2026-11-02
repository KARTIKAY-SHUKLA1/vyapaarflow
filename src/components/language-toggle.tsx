import { setLanguageAction } from "@/app/actions";
import type { Lang, Messages } from "@/lib/i18n/messages";

export function LanguageToggle({ lang, t }: { lang: Lang; t: Messages["app"] }) {
  return (
    <form action={setLanguageAction}>
      <input type="hidden" name="lang" value={lang === "hi" ? "en" : "hi"} />
      <button
        type="submit"
        aria-label={t.languageLabel}
        className="h-11 rounded-md px-3 text-[15px] font-medium text-ink-2 hover:bg-sunken hover:text-ink"
      >
        {t.language}
      </button>
    </form>
  );
}
