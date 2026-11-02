import { Badge } from "@/components/ui";
import type { OrderStatus } from "@/db/schema";
import type { Messages } from "@/lib/i18n/messages";
import { STATUS_TONE } from "../shop/labels";

/** Desk wording for statuses ("To approve" rather than the retailer's "Received"). */
export function DeskStatusBadge({ d, status }: { d: Messages["desk"]; status: OrderStatus }) {
  return <Badge tone={STATUS_TONE[status]}>{d.filters[status]}</Badge>;
}
