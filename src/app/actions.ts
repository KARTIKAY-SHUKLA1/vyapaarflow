"use server";

import { eq } from "drizzle-orm";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { db } from "@/db";
import { users } from "@/db/schema";
import { endSession, getViewer } from "@/lib/auth/dal";
import { LANG_COOKIE } from "@/lib/i18n/server";
import { revalidatePath } from "next/cache";

export async function setLanguageAction(formData: FormData) {
  const lang = formData.get("lang") === "hi" ? "hi" : "en";
  (await cookies()).set(LANG_COOKIE, lang, { path: "/", maxAge: 365 * 24 * 3600, sameSite: "lax" });
  const viewer = await getViewer();
  if (viewer) await db.update(users).set({ language: lang }).where(eq(users.id, viewer.id));
  revalidatePath("/", "layout");
}

export async function signOutAction() {
  await endSession();
  redirect("/login");
}
