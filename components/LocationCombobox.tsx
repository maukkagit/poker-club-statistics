"use client";
import { useEffect, useMemo, useState } from "react";
import type { Location } from "@/lib/types";
import { useComboboxNav } from "@/components/useComboboxNav";

/**
 * Case- and diacritic-insensitive normalisation so "kasino", "Kasino " and
 * "Käsinö" all collide on a single match. Mirrors `PlayerCombobox`.
 */
function normalize(s: string): string {
  return s.trim().normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase();
}

/**
 * Controlled typeahead for a single Location reference.
 *
 * - `value` is the currently-selected location id (or `null` for "no location").
 * - Typing filters the existing list; pressing Enter or clicking selects.
 * - When the typed query doesn't match any existing location exactly, a
 *   "+ Create '<query>'" row appears at the top. Choosing it calls `onCreate`,
 *   which is expected to POST to /api/locations and then call `onChange` with
 *   the new id.
 * - The little × on the right clears the selection.
 *
 * UX detail: while the input is blurred we render the currently-selected
 * location name as a placeholder so the user can see what's set without
 * having to focus the field. Focusing clears the field and opens the
 * dropdown for fresh typing.
 */
export default function LocationCombobox({
  value,
  locations,
  onChange,
  onCreate,
  placeholder = "Search or add a location…",
  disabled = false,
}: {
  value: string | null;
  locations: Location[];
  onChange: (id: string | null) => void;
  onCreate: (name: string) => Promise<Location>;
  placeholder?: string;
  disabled?: boolean;
}) {
  const [q, setQ] = useState("");
  const [creating, setCreating] = useState(false);

  const selected = useMemo(
    () => (value ? locations.find(l => l.id === value) ?? null : null),
    [value, locations],
  );

  const filtered = useMemo(() => {
    const needle = normalize(q);
    if (!needle) return locations;
    return locations.filter(l => normalize(l.name).includes(needle));
  }, [q, locations]);

  // Exact-match check (after normalisation) — when true we hide the
  // "+ Create" row, because picking it would just duplicate an existing row.
  const exactMatch = useMemo(() => {
    const needle = normalize(q);
    if (!needle) return true;
    return locations.some(l => normalize(l.name) === needle);
  }, [q, locations]);

  const showCreate = q.trim().length > 0 && !exactMatch;
  // The "+ Create …" row is rendered as the first item in the dropdown when
  // visible; the existing-locations list is shifted down by one index so the
  // keyboard highlight can move through both seamlessly.
  const totalItems = filtered.length + (showCreate ? 1 : 0);

  // Shared open/highlight state, refs, bounds-clamping, scroll-into-view and
  // click-outside. Clicking outside also clears the query for this combobox.
  const { open, setOpen, highlight, setHighlight, rootRef, inputRef, listRef } =
    useComboboxNav(totalItems, () => setQ(""));

  // Reset the keyboard highlight whenever the dropdown contents shift —
  // typing, location list refresh, or toggling the create row. We default
  // to the first *existing* match (skipping the create row) so pressing
  // Enter after a prefix search like "Mauk" selects "Maukka's house"
  // instead of accidentally creating a brand-new "Mauk" location.
  useEffect(() => {
    setHighlight(showCreate && filtered.length > 0 ? 1 : 0);
  }, [q, filtered.length, showCreate]);

  function selectExisting(l: Location) {
    onChange(l.id);
    setQ("");
    setHighlight(0);
    setOpen(false);
    inputRef.current?.blur();
  }

  async function createAndSelect(name: string) {
    if (creating) return;
    setCreating(true);
    try {
      const created = await onCreate(name);
      onChange(created.id);
      setQ("");
      setHighlight(0);
      setOpen(false);
      inputRef.current?.blur();
    } finally {
      setCreating(false);
    }
  }

  function commitHighlight() {
    if (showCreate && highlight === 0) {
      void createAndSelect(q.trim());
      return;
    }
    const idx = showCreate ? highlight - 1 : highlight;
    const target = filtered[idx];
    if (target) selectExisting(target);
  }

  // What the user sees in the input box.
  // - While the dropdown is open, show their current query.
  // - While closed, show the selected location name (so they don't have to
  //   focus to see what's set). When nothing is selected, show empty so the
  //   placeholder is visible.
  const inputValue = open ? q : (selected?.name ?? "");

  return (
    <div ref={rootRef} className="relative">
      <div className="relative">
        <input
          ref={inputRef}
          type="text"
          className="input pr-8"
          value={inputValue}
          disabled={disabled}
          placeholder={selected ? selected.name : placeholder}
          role="combobox"
          aria-expanded={open}
          aria-autocomplete="list"
          aria-controls="location-combobox-list"
          onChange={e => { setQ(e.target.value); setOpen(true); setHighlight(0); }}
          onFocus={() => { setQ(""); setOpen(true); setHighlight(0); }}
          onKeyDown={e => {
            if (e.key === "ArrowDown") {
              e.preventDefault();
              setOpen(true);
              setHighlight(i => Math.min(totalItems - 1, i + 1));
            } else if (e.key === "ArrowUp") {
              e.preventDefault();
              setHighlight(i => Math.max(0, i - 1));
            } else if (e.key === "Enter") {
              if (open && totalItems > 0) {
                e.preventDefault();
                commitHighlight();
              }
            } else if (e.key === "Escape") {
              setOpen(false);
              setQ("");
              inputRef.current?.blur();
            } else if (e.key === "Tab") {
              setOpen(false);
            }
          }}
        />
        {/* Clear / no-location button. Hidden when nothing is selected. */}
        {selected && !disabled && (
          <button
            type="button"
            onClick={() => { onChange(null); setQ(""); setOpen(false); inputRef.current?.blur(); }}
            aria-label="Clear location"
            title="Clear location"
            className="absolute right-1 top-1/2 -translate-y-1/2 inline-flex items-center justify-center w-6 h-6 rounded text-[var(--muted)] hover:text-[var(--text)]"
            // Stop the input's blur from firing first and closing the dropdown
            // before this click is processed.
            onMouseDown={e => e.preventDefault()}
          >
            ×
          </button>
        )}
      </div>

      {open && !disabled && (
        <div
          id="location-combobox-list"
          ref={listRef}
          role="listbox"
          className="absolute left-0 right-0 top-full mt-1 rounded-md shadow-2xl z-20 max-h-64 overflow-y-auto"
          style={{ background: "var(--card)", border: "1px solid var(--border)" }}
        >
          {showCreate && (
            <button
              key="__create"
              type="button"
              role="option"
              aria-selected={highlight === 0}
              onMouseDown={e => e.preventDefault()}
              onClick={() => void createAndSelect(q.trim())}
              onMouseEnter={() => setHighlight(0)}
              className="block w-full text-left px-3 py-2 text-sm border-b border-[var(--border)]"
              style={highlight === 0 ? { background: "var(--bg)" } : undefined}
              disabled={creating}
            >
              <span className="text-[var(--accent)] font-semibold mr-1">+ Add</span>
              <span>“{q.trim()}”</span>
              {creating && <span className="muted ml-2">creating…</span>}
            </button>
          )}
          {filtered.length === 0 && !showCreate && (
            <div className="px-3 py-2 muted text-sm">No locations yet — start typing to add one</div>
          )}
          {filtered.map((l, i) => {
            const idx = showCreate ? i + 1 : i;
            const isHighlight = idx === highlight;
            const isSelected = l.id === value;
            return (
              <button
                key={l.id}
                type="button"
                role="option"
                aria-selected={isHighlight}
                onMouseDown={e => e.preventDefault()}
                onClick={() => selectExisting(l)}
                onMouseEnter={() => setHighlight(idx)}
                className="block w-full text-left px-3 py-2 text-sm"
                style={isHighlight ? { background: "var(--bg)" } : undefined}
              >
                {l.name}
                {isSelected && <span className="muted ml-2 text-xs">selected</span>}
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}
