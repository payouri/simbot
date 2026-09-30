import {
  defaultTopGearSelection,
  PAPERDOLL_LEFT,
  type PaperdollSlot,
  type Sim,
} from "@simbot/shared";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import clsx from "clsx";
import { useEffect, useMemo, useRef, useState } from "react";
import { Link, Navigate, useNavigate, useParams } from "react-router";
import { useImportItems } from "../items/api";
import { queueSim } from "../quick-sim/api";
import { useDraftQuery, useImportSetup } from "./api";
import { useDraftAutosave } from "./autosave";
import { Command } from "./Command";
import {
  candidatesInPlay,
  groupBySlot,
  includedCount,
  setCandidates,
  toggleItem,
  toggleLock,
} from "./model";
import { focusSlot, Sheet, type Side, SlotTile, useIsPhone } from "./Sheet";
import { Tray } from "./Tray";

/** The Top Gear setup of a Draft: the Paperdoll, its trays and the command column. */
export function SetupPage() {
  const id = Number(useParams().id);
  const draft = useDraftQuery(id);
  return (
    <main className="mx-auto max-w-[1440px] px-4 py-6 md:px-6">
      <nav className="mb-4 flex gap-4 text-[12.5px]">
        <Link to="/quick-sim" className="text-muted hover:text-fg">
          New Sim
        </Link>
        <Link to="/history" className="text-muted hover:text-fg">
          History
        </Link>
        <Link to="/queue" className="text-muted hover:text-fg">
          Queue
        </Link>
      </nav>
      {draft.isPending && <p className="text-[13px] text-muted">Loading the Draft…</p>}
      {draft.isError && <p className="text-[13px] text-loss">Could not load this Draft.</p>}
      {draft.data &&
        (draft.data.status === "draft" ? (
          <Setup sim={draft.data} />
        ) : (
          <Navigate to={`/sims/${id}`} replace />
        ))}
    </main>
  );
}

function Setup({ sim }: { sim: Sim }) {
  const phone = useIsPhone();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const items = useImportItems(sim.importId);
  const setup = useImportSetup(sim.importId);
  const { input, edit, flush, save, retry } = useDraftAutosave(sim.id, {
    settings: sim.settings,
    selection: sim.topGearSelection ?? defaultTopGearSelection(null),
  });
  const [open, setOpen] = useState<PaperdollSlot | null>(null);
  const groups = useMemo(() => groupBySlot(items.data?.items ?? []), [items.data]);

  const run = useMutation({
    mutationFn: async () => {
      await flush();
      return queueSim(sim.id);
    },
    onSuccess: (queued) => {
      queryClient.setQueryData(["sim", sim.id], queued);
      void queryClient.invalidateQueries({ queryKey: ["queue"] });
      navigate(`/sims/${sim.id}`);
    },
  });

  const canRun = candidatesInPlay(input.selection, groups) === 0;
  const runRef = useRef(() => {});
  runRef.current = () => {
    if (canRun && !run.isPending) run.mutate();
  };
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) {
        e.preventDefault();
        runRef.current();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  if (items.isPending) return <p className="text-[13px] text-muted">Reading items…</p>;
  if (items.isError) return <p className="text-[13px] text-loss">Could not load the gear.</p>;

  const select = (selection: typeof input.selection) => edit({ selection });
  const closeTray = () => {
    const slot = open;
    setOpen(null);
    if (slot) requestAnimationFrame(() => focusSlot(slot));
  };
  const openSide = open ? (PAPERDOLL_LEFT.includes(open) ? "left" : "right") : null;

  const tray = open ? (
    <Tray
      key={open}
      slot={open}
      group={groups[open]}
      included={input.selection.included}
      locked={input.selection.lockedSlots.includes(open)}
      phone={phone}
      onToggleItem={(index) => select(toggleItem(input.selection, index))}
      onSetAll={(on) => select(setCandidates(input.selection, groups[open].candidates, on))}
      onToggleLock={() => select(toggleLock(input.selection, open))}
      onClose={closeTray}
    />
  ) : undefined;

  const renderSlot = (slot: PaperdollSlot, side: Side) => {
    const group = groups[slot];
    const locked = input.selection.lockedSlots.includes(slot);
    const total = group.candidates.length;
    const chosen = includedCount(input.selection.included, group.candidates);
    return (
      <SlotTile
        slot={slot}
        side={side}
        equipped={group.equipped}
        open={open === slot}
        locked={locked}
        compact={phone}
        onClick={() => setOpen((o) => (o === slot ? null : slot))}
        meta={
          locked ? (
            <span className="text-faint">Locked</span>
          ) : total === 0 ? (
            <span className="text-faint">
              No candidates
              {group.placeholders.length > 0 && ` · ${group.placeholders.length} unknown`}
            </span>
          ) : (
            <span className={clsx("num", chosen > 0 && "text-action")}>
              {chosen} of {total} candidates
            </span>
          )
        }
      />
    );
  };

  return (
    <Sheet
      phone={phone}
      renderSlot={renderSlot}
      leftTray={openSide === "left" || (phone && open) ? tray : undefined}
      rightTray={openSide === "right" && !phone ? tray : undefined}
      center={
        <Command
          sim={sim}
          itemsView={items.data}
          setup={setup.data}
          settings={input.settings}
          selection={input.selection}
          groups={groups}
          save={save}
          runError={run.isError ? run.error.message : null}
          running={run.isPending}
          onSettings={(settings) => edit({ settings })}
          onSelection={select}
          onRun={() => runRef.current()}
          onRetry={() => void retry()}
        />
      }
    />
  );
}
