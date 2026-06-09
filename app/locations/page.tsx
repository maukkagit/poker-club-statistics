"use client";
import { useEffect, useRef, useState } from "react";
import useSWR from "swr";
import type { Location, Tournament } from "@/lib/types";
import { apiKeys, invalidateAfterLocationMutation } from "@/lib/api";
import ConfirmDialog from "@/components/ConfirmDialog";
import { useSortable, SortableTh } from "@/components/sortable";

type EnrichedLocation = Location & { tournament_count: number };

export default function LocationsPage() {
  const { data: locations, isLoading } = useSWR<Location[]>(apiKeys.locations);
  // We pull tournaments to compute the usage count next to each location so
  // the admin can tell at a glance which locations are referenced before
  // attempting a delete (the API will refuse a delete that would dangle FKs).
  const { data: tournaments } = useSWR<(Tournament & { location_id?: string | null })[]>(apiKeys.tournaments);

  const loading = isLoading && !locations;
  const usageById = new Map<string, number>();
  for (const t of tournaments ?? []) {
    if (t.location_id) usageById.set(t.location_id, (usageById.get(t.location_id) ?? 0) + 1);
  }
  const enriched: EnrichedLocation[] = (locations ?? []).map(l => ({
    ...l,
    tournament_count: usageById.get(l.id) ?? 0,
  }));

  // Sortable table; defaults to name ascending (matches the API's ordering).
  const { sorted: sortedLocations, sortKey, sortDir, onSort } = useSortable<EnrichedLocation>(
    enriched,
    (l, key) => {
      switch (key) {
        case "count": return l.tournament_count;
        case "added": return l.created_at || null;
        default: return l.name.toLowerCase();
      }
    },
    { initialKey: "name", defaultDirs: { name: "asc", count: "desc", added: "desc" } },
  );

  const [name, setName] = useState("");
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editingName, setEditingName] = useState("");
  const [savingId, setSavingId] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [confirmDelete, setConfirmDelete] = useState<EnrichedLocation | null>(null);
  // When the user tries to delete an in-use location we don't open the
  // destructive confirm — we open this info modal instead, telling them
  // exactly why the action is blocked. Same modal is reused if the server
  // happens to reject the delete with a 409 (race condition: a tournament
  // was just linked to the location between page-load and click).
  const [inUseInfo, setInUseInfo] = useState<{ location: EnrichedLocation; usage: number } | null>(null);
  const [deleting, setDeleting] = useState(false);
  const editInputRef = useRef<HTMLInputElement | null>(null);

  // Auto-focus + select the edit input when entering edit mode so the user
  // can immediately start typing.
  useEffect(() => {
    if (editingId && editInputRef.current) {
      editInputRef.current.focus();
      editInputRef.current.select();
    }
  }, [editingId]);

  async function add(e: React.FormEvent) {
    e.preventDefault();
    const trimmed = name.trim();
    if (!trimmed) return;
    setErr(null);
    const res = await fetch("/api/locations", { method: "POST", body: JSON.stringify({ name: trimmed }) });
    if (!res.ok) {
      const body = await res.json().catch(() => ({}));
      setErr(body.error ?? "Failed to add location");
      return;
    }
    setName("");
    await invalidateAfterLocationMutation();
  }

  function startEdit(l: EnrichedLocation) {
    setErr(null);
    setEditingId(l.id);
    setEditingName(l.name);
  }
  function cancelEdit() {
    setEditingId(null);
    setEditingName("");
  }
  async function saveEdit(original: EnrichedLocation) {
    if (!editingId) return;
    const trimmed = editingName.trim();
    if (!trimmed) { setErr("Name can't be empty"); return; }
    if (trimmed === original.name) { cancelEdit(); return; }
    setSavingId(editingId);
    setErr(null);
    try {
      const res = await fetch("/api/locations", {
        method: "PATCH",
        body: JSON.stringify({ id: editingId, name: trimmed }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.error ?? "Failed to save");
      }
      await invalidateAfterLocationMutation();
      cancelEdit();
    } catch (e: any) {
      setErr(e?.message ?? String(e));
    } finally {
      setSavingId(null);
    }
  }

  // Entry point for the Delete button. If the cached usage count says the
  // location is still referenced by tournaments, we don't even ask "are you
  // sure?" — we open the explanatory info dialog instead. Otherwise we open
  // the regular destructive-confirm dialog.
  function requestDelete(l: EnrichedLocation) {
    setErr(null);
    if (l.tournament_count > 0) {
      setInUseInfo({ location: l, usage: l.tournament_count });
    } else {
      setConfirmDelete(l);
    }
  }

  async function performDelete(l: EnrichedLocation) {
    setDeleting(true);
    setErr(null);
    try {
      const res = await fetch(`/api/locations/${l.id}`, { method: "DELETE" });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        // 409 means the server enforced the same FK guard the client cached
        // count is supposed to enforce — but the count was stale (e.g. a
        // tournament linked to this location in another tab). Switch to the
        // explanatory dialog so the user understands why this failed.
        if (res.status === 409) {
          setConfirmDelete(null);
          // Refresh in the background so the row's count updates after we
          // close the info dialog.
          await invalidateAfterLocationMutation();
          setInUseInfo({ location: l, usage: l.tournament_count });
          return;
        }
        throw new Error(body.error ?? "Failed to delete");
      }
      await invalidateAfterLocationMutation();
      setConfirmDelete(null);
    } catch (e: any) {
      setErr(e?.message ?? String(e));
      setConfirmDelete(null);
    } finally {
      setDeleting(false);
    }
  }

  return (
    <div className="space-y-4">
      <h1 className="text-2xl font-bold">Locations</h1>
      <form onSubmit={add} className="card flex gap-2 items-end">
        <div className="flex-1">
          <label className="label">Add location</label>
          <input className="input" value={name} onChange={e => setName(e.target.value)} placeholder="e.g. Maukka’s house" />
        </div>
        <button className="btn whitespace-nowrap shrink-0" disabled={!name.trim()}>Add</button>
      </form>
      {err && <div className="card neg">{err}</div>}
      <div className="card">
        {loading ? <div className="muted">Loading…</div> : enriched.length === 0 ? (
          <div className="muted">No locations yet. Add one above, or create one inline while adding a tournament.</div>
        ) : (
          <table className="table">
            <thead>
              <tr>
                <SortableTh k="name" label="Name" sortKey={sortKey} sortDir={sortDir} onSort={onSort} />
                <SortableTh k="count" label="Tournaments" align="right" sortKey={sortKey} sortDir={sortDir} onSort={onSort} />
                <SortableTh k="added" label="Added" className="hidden sm:table-cell" sortKey={sortKey} sortDir={sortDir} onSort={onSort} />
                <th></th>
              </tr>
            </thead>
            <tbody>
              {sortedLocations.map(l => {
                const isEditing = editingId === l.id;
                const isSaving = savingId === l.id;
                return (
                  <tr key={l.id}>
                    <td>
                      {isEditing ? (
                        <input
                          ref={editInputRef}
                          className="input"
                          value={editingName}
                          onChange={e => setEditingName(e.target.value)}
                          onKeyDown={e => {
                            if (e.key === "Enter") { e.preventDefault(); void saveEdit(l); }
                            else if (e.key === "Escape") { e.preventDefault(); cancelEdit(); }
                          }}
                          disabled={isSaving}
                        />
                      ) : (
                        l.name
                      )}
                    </td>
                    <td className="text-right tabular-nums">{l.tournament_count}</td>
                    <td className="muted whitespace-nowrap hidden sm:table-cell">
                      {l.created_at ? new Date(l.created_at).toLocaleDateString() : "—"}
                    </td>
                    <td>
                      {isEditing ? (
                        <div className="flex gap-1 justify-end">
                          <button
                            type="button"
                            onClick={() => saveEdit(l)}
                            disabled={isSaving || !editingName.trim() || editingName.trim() === l.name}
                            className="btn text-xs px-2 py-1"
                          >
                            {isSaving ? "Saving…" : "Save"}
                          </button>
                          <button
                            type="button"
                            onClick={cancelEdit}
                            disabled={isSaving}
                            className="btn-secondary text-xs px-2 py-1 rounded border border-[var(--border)]"
                          >
                            Cancel
                          </button>
                        </div>
                      ) : (
                        <div className="flex gap-1 justify-end">
                          <button
                            type="button"
                            onClick={() => startEdit(l)}
                            className="btn-secondary text-xs px-2 py-1 rounded border border-[var(--border)]"
                          >
                            Edit
                          </button>
                          <button
                            type="button"
                            onClick={() => requestDelete(l)}
                            title="Delete location"
                            className="btn-secondary text-xs px-2 py-1 rounded border border-[var(--border)]"
                          >
                            Delete
                          </button>
                        </div>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </div>

      <ConfirmDialog
        open={!!confirmDelete}
        title="Delete this location?"
        message={
          confirmDelete ? (
            <>
              Permanently remove <strong>{confirmDelete.name}</strong>. This is only
              allowed because no tournaments reference it. The action cannot be undone.
            </>
          ) : null
        }
        confirmLabel="Delete"
        cancelLabel="Keep it"
        destructive
        busy={deleting}
        onCancel={() => setConfirmDelete(null)}
        onConfirm={() => { if (confirmDelete) void performDelete(confirmDelete); }}
      />

      <ConfirmDialog
        open={!!inUseInfo}
        title="Can’t delete this location"
        message={
          inUseInfo ? (
            <>
              <strong>{inUseInfo.location.name}</strong> is currently used by{" "}
              <strong>{inUseInfo.usage}</strong>{" "}
              {inUseInfo.usage === 1 ? "tournament" : "tournaments"}. To delete
              this location, first open{" "}
              {inUseInfo.usage === 1 ? "the tournament that references" : "the tournaments that reference"}{" "}
              it and either change the location or clear it.
            </>
          ) : null
        }
        confirmLabel="Got it"
        hideCancel
        onCancel={() => setInUseInfo(null)}
        onConfirm={() => setInUseInfo(null)}
      />
    </div>
  );
}
