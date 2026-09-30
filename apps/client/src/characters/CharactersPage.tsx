import type { Character, CharacterListItem } from "@simbot/shared";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { Link } from "react-router";
import {
  CharacterConflictError,
  listCharacters,
  mergeCharacter,
  updateCharacter,
} from "../quick-sim/api";

const label = (c: Character) => `${c.name} (${c.class}, ${c.region}-${c.realm})`;

/** Characters made by Import: edit their identity, or merge one into another on a collision. */
export function CharactersPage() {
  const queryClient = useQueryClient();
  const characters = useQuery({ queryKey: ["characters"], queryFn: listCharacters });
  const refresh = () => {
    queryClient.invalidateQueries({ queryKey: ["characters"] });
    queryClient.invalidateQueries({ queryKey: ["sims"] });
  };
  return (
    <main className="mx-auto max-w-3xl px-4 py-6 md:px-6">
      <div className="mb-4 flex items-baseline justify-between">
        <h1 className="text-[16px] font-semibold">Characters</h1>
        <Link to="/history" className="text-[12.5px] text-muted hover:text-fg">
          History
        </Link>
      </div>
      {characters.isPending && <p className="text-muted">Loading…</p>}
      {characters.isError && <p className="text-loss">Could not load Characters.</p>}
      <ul className="divide-y divide-line border-y border-line">
        {characters.data?.map((c) => (
          <CharacterRow key={c.id} character={c} onChanged={refresh} />
        ))}
      </ul>
    </main>
  );
}

function CharacterRow({
  character,
  onChanged,
}: {
  character: CharacterListItem;
  onChanged: () => void;
}) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState({
    region: character.region,
    realm: character.realm,
    name: character.name,
    class: character.class,
  });
  const [conflict, setConflict] = useState<Character | null>(null);

  const edit = useMutation({
    mutationFn: () => updateCharacter(character.id, draft),
    onSuccess: () => {
      setEditing(false);
      setConflict(null);
      onChanged();
    },
    onError: (err) => {
      if (err instanceof CharacterConflictError) setConflict(err.conflicting);
    },
  });
  const merge = useMutation({
    mutationFn: (targetId: number) => mergeCharacter(character.id, targetId),
    onSuccess: () => {
      setConflict(null);
      onChanged();
    },
  });

  return (
    <li className="py-3">
      <div className="flex items-center justify-between gap-3">
        <div>
          <div className="text-[14px]">{label(character)}</div>
          <div className="num text-[12px] text-muted">
            {character.importCount} Imports, {character.simCount} Sims
          </div>
        </div>
        <button
          type="button"
          className="text-[12.5px] text-muted hover:text-fg"
          onClick={() => setEditing(!editing)}
        >
          {editing ? "Cancel" : "Edit"}
        </button>
      </div>
      {editing && (
        <form
          className="mt-3 grid grid-cols-2 gap-2 md:grid-cols-4"
          onSubmit={(e) => {
            e.preventDefault();
            setConflict(null);
            edit.mutate();
          }}
        >
          {(["region", "realm", "name", "class"] as const).map((field) => (
            <label key={field} className="flex flex-col gap-1 text-[12px] text-muted">
              {field}
              <input
                className="border border-line bg-bg px-2 py-1 text-[13px] text-fg"
                value={draft[field]}
                onChange={(e) => setDraft({ ...draft, [field]: e.target.value })}
              />
            </label>
          ))}
          <button
            type="submit"
            className="col-span-2 text-[13px] md:col-span-4"
            disabled={edit.isPending}
          >
            Save
          </button>
        </form>
      )}
      {edit.isError && !conflict && <p className="mt-2 text-loss">{edit.error.message}</p>}
      {conflict && (
        <div className="mt-3 border border-warn p-3 text-[13px]">
          <p>
            {label(conflict)} already exists. Merge {label(character)} into it? Its Imports and Sims
            move across and this Character is deleted.
          </p>
          <div className="mt-2 flex gap-3">
            <button
              type="button"
              onClick={() => merge.mutate(conflict.id)}
              disabled={merge.isPending}
            >
              Merge
            </button>
            <button type="button" className="text-muted" onClick={() => setConflict(null)}>
              Keep separate
            </button>
          </div>
          {merge.isError && <p className="mt-2 text-loss">{merge.error.message}</p>}
        </div>
      )}
    </li>
  );
}
