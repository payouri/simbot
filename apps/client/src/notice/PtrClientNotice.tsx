import { FlaskConical } from "lucide-react";

/**
 * Shown on an Import, and on the Sims built from it, when its Addon String looks exported from
 * the PTR client. A hint only: the Game Data of a Sim is never changed by it.
 * (Once PTR Sims can be picked, #60, it shows on Live Sims only.)
 */
export function PtrClientNotice({ sim }: { sim: { importPtrClient: boolean } }) {
  if (!sim.importPtrClient) return null;
  return (
    <p
      role="note"
      className="flex items-start gap-2 rounded-[8px] border border-line bg-noise-wash px-3 py-2 text-[12.5px] text-muted"
    >
      <FlaskConical size={15} className="mt-px shrink-0" aria-hidden />
      <span>
        This Addon String looks exported from the PTR client. Gear and talents may differ from Live,
        so read a Live answer with care.
      </span>
    </p>
  );
}
