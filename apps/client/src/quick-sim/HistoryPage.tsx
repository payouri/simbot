import type { SimListItem, SimStatus } from "@simbot/shared";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { Link, useNavigate } from "react-router";
import { copySimToDraft, deleteSim, listSims } from "./api";

const STATUS_LABEL: Record<SimStatus, string> = {
  draft: "Draft",
  queued: "Queued",
  running: "Running",
  succeeded: "Succeeded",
  failed: "Failed",
  cancelled: "Stopped",
};

const STATUS_COLOR: Record<SimStatus, string> = {
  draft: "text-muted",
  queued: "text-warn",
  running: "text-info",
  succeeded: "text-win",
  failed: "text-loss",
  cancelled: "text-muted",
};

/** History of all Sims, filterable by Character and status. */
export function HistoryPage() {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [selectedStatus, setSelectedStatus] = useState<SimStatus | "all">("all");

  const filters = selectedStatus !== "all" ? { status: selectedStatus as SimStatus } : {};

  const sims = useQuery({
    queryKey: ["sims", filters],
    queryFn: () => listSims(filters),
  });

  const deleteSimMutation = useMutation({
    mutationFn: (id: number) => deleteSim(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["sims"] });
    },
  });

  const copyMutation = useMutation({
    mutationFn: (id: number) => copySimToDraft(id),
    onSuccess: (newSim) => {
      navigate(`/sims/${newSim.id}/setup`);
    },
  });

  const handleDelete = (id: number) => {
    if (confirm("Are you sure you want to delete this Sim?")) {
      deleteSimMutation.mutate(id);
    }
  };

  const handleCopyToDraft = (id: number) => {
    copyMutation.mutate(id);
  };

  const formatDate = (dateStr: string) => {
    const date = new Date(dateStr);
    return date.toLocaleString("en-US", {
      month: "short",
      day: "numeric",
      year: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
    });
  };

  return (
    <main className="mx-auto max-w-4xl px-4 py-10 md:px-6">
      <div className="mb-6 flex items-center justify-between">
        <h1 className="text-[24px] font-semibold tracking-tight">History</h1>
        <Link
          to="/quick-sim"
          className="rounded-[7px] bg-action px-4 py-2 text-[14px] font-semibold text-action-ink transition-colors duration-150 hover:bg-action-strong"
        >
          New Sim
        </Link>
      </div>

      <div className="mb-6 flex gap-2">
        <button
          type="button"
          onClick={() => setSelectedStatus("all")}
          className={`rounded-[5px] px-3 py-2 text-[12.5px] ${
            selectedStatus === "all"
              ? "bg-raised text-fg ring-1 ring-line-strong"
              : "text-muted hover:text-fg"
          }`}
        >
          All
        </button>
        {(["draft", "queued", "running", "succeeded", "failed", "cancelled"] as SimStatus[]).map(
          (status) => (
            <button
              type="button"
              key={status}
              onClick={() => setSelectedStatus(status)}
              className={`rounded-[5px] px-3 py-2 text-[12.5px] ${
                selectedStatus === status
                  ? "bg-raised text-fg ring-1 ring-line-strong"
                  : "text-muted hover:text-fg"
              }`}
            >
              {STATUS_LABEL[status]}
            </button>
          ),
        )}
      </div>

      {sims.isLoading && <p className="text-muted">Loading…</p>}
      {sims.isError && <p className="text-loss">Error loading sims</p>}

      {sims.data && sims.data.length === 0 && (
        <p className="text-center text-muted">No sims found</p>
      )}

      {sims.data && sims.data.length > 0 && (
        <div className="overflow-x-auto">
          <table className="w-full text-[12.5px]">
            <thead>
              <tr className="border-b border-line">
                <th className="px-3 py-3 text-left font-semibold">Character</th>
                <th className="px-3 py-3 text-left font-semibold">Status</th>
                <th className="px-3 py-3 text-left font-semibold">SimC Build</th>
                <th className="px-3 py-3 text-left font-semibold">Date</th>
                <th className="px-3 py-3 text-left font-semibold">Actions</th>
              </tr>
            </thead>
            <tbody>
              {sims.data.map((sim: SimListItem) => (
                <tr key={sim.id} className="border-b border-line/50 hover:bg-raised/30">
                  <td className="px-3 py-3">
                    <div className="font-semibold text-fg">{sim.character.name}</div>
                    <div className="text-[11.5px] text-muted">
                      {sim.character.class} {sim.character.spec ? `(${sim.character.spec})` : ""}
                    </div>
                  </td>
                  <td className={`px-3 py-3 font-semibold ${STATUS_COLOR[sim.status]}`}>
                    {STATUS_LABEL[sim.status]}
                  </td>
                  <td className="px-3 py-3 text-muted">{sim.simcTag || "—"}</td>
                  <td className="px-3 py-3 text-muted">
                    {formatDate(sim.finishedAt || sim.createdAt)}
                  </td>
                  <td className="px-3 py-3">
                    <div className="flex gap-2">
                      <button
                        type="button"
                        onClick={() => navigate(`/sims/${sim.id}`)}
                        className="text-action hover:text-action-strong"
                      >
                        View
                      </button>
                      {sim.status !== "draft" &&
                        sim.status !== "queued" &&
                        sim.status !== "running" && (
                          <>
                            <button
                              type="button"
                              onClick={() => handleCopyToDraft(sim.id)}
                              disabled={copyMutation.isPending}
                              className="text-action hover:text-action-strong disabled:text-muted"
                            >
                              Copy
                            </button>
                            <button
                              type="button"
                              onClick={() => handleDelete(sim.id)}
                              disabled={deleteSimMutation.isPending}
                              className="text-loss hover:text-loss-strong disabled:text-muted"
                            >
                              Delete
                            </button>
                          </>
                        )}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </main>
  );
}
