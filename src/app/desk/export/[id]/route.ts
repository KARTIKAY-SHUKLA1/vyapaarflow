import { db } from "@/db";
import { getViewer } from "@/lib/auth/dal";
import { getExportFile } from "@/server/tally";

/** CSV download. Desk-only (checked here, not just by the proxy); never cached. */
export async function GET(_req: Request, ctx: RouteContext<"/desk/export/[id]">) {
  const { id } = await ctx.params;
  const viewer = await getViewer();
  const file = await getExportFile(db, viewer, id);
  if (!file) return new Response("Not found", { status: 404, headers: { "Cache-Control": "no-store" } });
  return new Response(file.csv, {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="${file.fileName}"`,
      "Cache-Control": "no-store",
      "X-Content-Type-Options": "nosniff",
    },
  });
}
