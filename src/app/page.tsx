import { redirect } from "next/navigation";
import { getViewer } from "@/lib/auth/dal";
import { homeFor } from "@/lib/auth/policy";

export default async function Home() {
  const viewer = await getViewer();
  redirect(viewer ? homeFor(viewer.role) : "/login");
}
