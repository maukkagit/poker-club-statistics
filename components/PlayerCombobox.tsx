"use client";
import { useEffect, useMemo, useRef, useState } from "react";
import type { Player } from "@/lib/types";

/**
 * Case- and diacritic-insensitive normalisation. Lets a user type "arsky"
 * to find "Ärsky" or "Mauno" to find "Mauno Malmivaara" without worrying
 * about Finnish accents.
 */
function normalize(s: string): string {
  return s.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase();
}

export default function PlayerCombobox({
  players,
  onSelect,
  placeholder = "Search players…",
  disabled = false,
}: {
  players: Player[];
  onSelect: (id: string) => void;
  placeholder?: string;
  disabled?: boolean;
}) {
  const [q, setQ] = useState("");
  const [open, setOpen] = useState(false);
  const [highlight, setHighlight] = useState(0);
  const rootRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);

  const filtered = useMemo(() => {
    const needle = normalize(q.trim());
    const matches = needle ? players.filter(p => normalize(p.name).includes(needle)) : players;
    // Present matches alphabetically so the list order is predictable
    // regardless of how players are stored/returned by the API.
    return [...matches].sort((a, b) => a.name.localeCompare(b.name));
  }, [q, players]);

  // Keep the highlighted row in bounds whenever the filtered list shrinks
  // (typing) or grows (deleting characters).
  useEffect(() => {
    if (highlight >= filtered.length) setHighlight(Math.max(0, filtered.length - 1));
  }, [filtered.length, highlight]);

  // Auto-scroll the highlighted row into view when navigating with the
  // keyboard.
  useEffect(() => {
    if (!open) return;
    const el = listRef.current?.children[highlight] as HTMLElement | undefined;
    el?.scrollIntoView({ block: "nearest" });
  }, [highlight, open]);

  // Click-outside closes the dropdown.
  useEffect(() => {
    if (!open) return;
    function onDoc(e: MouseEvent) {
      if (!rootRef.current?.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener("mousedown", onDoc);
    return () => document.removeEventListener("mousedown", onDoc);
  }, [open]);

  function select(p: Player) {
    onSelect(p.id);
    setQ("");
    setHighlight(0);
    setOpen(false);
    // Dismiss the dropdown after a pick: blur so the (now-empty) input isn't
    // focused — which would otherwise re-open the list via onFocus. The user
    // taps the field again to add the next player.
    inputRef.current?.blur();
  }

  return (
    <div ref={rootRef} className="relative">
      <input
        ref={inputRef}
        type="text"
        className="input"
        value={q}
        disabled={disabled}
        placeholder={placeholder}
        role="combobox"
        aria-expanded={open}
        aria-autocomplete="list"
        aria-controls="player-combobox-list"
        aria-activedescendant={open && filtered[highlight] ? `pc-opt-${filtered[highlight].id}` : undefined}
        onChange={e => { setQ(e.target.value); setOpen(true); setHighlight(0); }}
        onFocus={() => setOpen(true)}
        onKeyDown={e => {
          if (e.key === "ArrowDown") {
            e.preventDefault();
            setOpen(true);
            setHighlight(i => Math.min(filtered.length - 1, i + 1));
          } else if (e.key === "ArrowUp") {
            e.preventDefault();
            setHighlight(i => Math.max(0, i - 1));
          } else if (e.key === "Enter") {
            if (open && filtered[highlight]) {
              e.preventDefault();
              select(filtered[highlight]);
            }
          } else if (e.key === "Escape") {
            setOpen(false);
            setQ("");
          } else if (e.key === "Tab") {
            setOpen(false);
          }
        }}
      />

      {open && !disabled && (
        <div
          id="player-combobox-list"
          ref={listRef}
          role="listbox"
          className="absolute left-0 right-0 top-full mt-1 rounded-md shadow-2xl z-20 max-h-64 overflow-y-auto"
          style={{ background: "var(--card)", border: "1px solid var(--border)" }}
        >
          {filtered.length === 0 ? (
            <div className="px-3 py-2 muted text-sm">No matches</div>
          ) : (
            filtered.map((p, i) => {
              const isHighlight = i === highlight;
              return (
                <button
                  key={p.id}
                  id={`pc-opt-${p.id}`}
                  type="button"
                  role="option"
                  aria-selected={isHighlight}
                  // mousedown fires before the input's blur — without
                  // preventDefault, the blur would close the dropdown
                  // before the click handler ever runs.
                  onMouseDown={e => e.preventDefault()}
                  onClick={() => select(p)}
                  onMouseEnter={() => setHighlight(i)}
                  className="block w-full text-left px-3 py-2 text-sm"
                  style={isHighlight ? { background: "var(--bg)" } : undefined}
                >
                  {p.name}
                </button>
              );
            })
          )}
        </div>
      )}
    </div>
  );
}
