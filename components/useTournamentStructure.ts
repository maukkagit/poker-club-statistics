"use client";
import { useCallback, useMemo, useState } from "react";
import type { BlindLevel, BreakRow, StructureRow } from "@/lib/types";
import {
  DEFAULT_STARTING_STACK, DEFAULT_BREAK_MINUTES, DEFAULT_TEMPLATE_ID,
  STRUCTURE_TEMPLATES, defaultStructure, emptyLevelDraft, validateStructure,
} from "@/lib/tournament-structure";

export type StructureController = {
  structure: StructureRow[];
  startingStack: number;
  /** Validation message for the current structure, or null when valid. */
  error: string | null;
  /** The id of the applied template, or null after a manual edit. */
  selectedTemplateId: string | null;
  setStartingStack: (n: number) => void;
  applyTemplate: (id: string) => void;
  /** Set the duration (minutes) of every level row at once. */
  setAllLevelDurations: (n: number) => void;
  /** Set the duration (minutes) of every break row at once. */
  setAllBreakDurations: (n: number) => void;
  addLevel: () => void;
  addBreak: () => void;
  updateRow: (index: number, patch: Partial<BlindLevel> & Partial<BreakRow>) => void;
  removeRow: (index: number) => void;
  moveRow: (index: number, dir: -1 | 1) => void;
  reset: () => void;
  /** Replace the whole ladder + stack (e.g. to discard unsaved edits). */
  restore: (structure: StructureRow[], startingStack: number) => void;
};

/**
 * State + mutators for the wizard's Structure step. Holds the editable
 * blind/break ladder and the starting stack; the wizard reads `structure` /
 * `startingStack` at Confirm. Validation is delegated to the pure
 * `validateStructure`.
 */
export function useTournamentStructure(
  initial?: { structure?: StructureRow[] | null; startingStack?: number | null },
): StructureController {
  const seeded = !!(initial?.structure && initial.structure.length);
  const [structure, setStructure] = useState<StructureRow[]>(
    () => (seeded ? initial!.structure! : defaultStructure()),
  );
  const [startingStack, setStartingStackState] = useState<number>(
    initial?.startingStack ?? DEFAULT_STARTING_STACK,
  );
  // Seeded-from-existing structures don't match a named template until the user
  // applies one, so start "Customised".
  const [selectedTemplateId, setSelectedTemplateId] = useState<string | null>(
    seeded ? null : DEFAULT_TEMPLATE_ID,
  );

  // Any manual edit means the structure no longer matches a named template.
  const setStartingStack = useCallback((n: number) => {
    setStartingStackState(n);
  }, []);

  const applyTemplate = useCallback((id: string) => {
    const tpl = STRUCTURE_TEMPLATES.find(t => t.id === id);
    if (!tpl) return;
    setStructure(tpl.build());
    setStartingStackState(tpl.startingStack);
    setSelectedTemplateId(tpl.id);
  }, []);

  const setAllLevelDurations = useCallback((n: number) => {
    setSelectedTemplateId(null);
    setStructure(s => s.map(r => (r.kind === "level" ? { ...r, duration_min: n } : r)));
  }, []);

  const setAllBreakDurations = useCallback((n: number) => {
    setSelectedTemplateId(null);
    setStructure(s => s.map(r => (r.kind === "break" ? { ...r, duration_min: n } : r)));
  }, []);

  const addLevel = useCallback(() => {
    setSelectedTemplateId(null);
    setStructure(s => [...s, emptyLevelDraft()]);
  }, []);

  const addBreak = useCallback(() => {
    setSelectedTemplateId(null);
    setStructure(s => [...s, { kind: "break", duration_min: DEFAULT_BREAK_MINUTES }]);
  }, []);

  const updateRow = useCallback((index: number, patch: Partial<BlindLevel> & Partial<BreakRow>) => {
    setSelectedTemplateId(null);
    setStructure(s => s.map((row, i) => (i === index ? { ...row, ...patch } as StructureRow : row)));
  }, []);

  const removeRow = useCallback((index: number) => {
    setSelectedTemplateId(null);
    setStructure(s => s.filter((_, i) => i !== index));
  }, []);

  const moveRow = useCallback((index: number, dir: -1 | 1) => {
    setSelectedTemplateId(null);
    setStructure(s => {
      const j = index + dir;
      if (j < 0 || j >= s.length) return s;
      const next = [...s];
      [next[index], next[j]] = [next[j], next[index]];
      return next;
    });
  }, []);

  const reset = useCallback(() => {
    applyTemplate(DEFAULT_TEMPLATE_ID);
  }, [applyTemplate]);

  const restore = useCallback((s: StructureRow[], stack: number) => {
    setStructure(s);
    setStartingStackState(stack);
    setSelectedTemplateId(null);
  }, []);

  const error = useMemo(() => validateStructure(structure), [structure]);

  return {
    structure, startingStack, error, selectedTemplateId,
    setStartingStack, applyTemplate, setAllLevelDurations, setAllBreakDurations,
    addLevel, addBreak, updateRow, removeRow, moveRow, reset, restore,
  };
}
