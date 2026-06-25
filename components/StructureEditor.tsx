"use client";
import { useEffect, useState } from "react";
import NumberInput from "@/components/NumberInput";
import type { StructureController } from "@/components/useTournamentStructure";
import type { StructureRow } from "@/lib/types";
import { STRUCTURE_TEMPLATES } from "@/lib/tournament-structure";

/**
 * Editable blind/break ladder for the wizard's Structure step. Renders one row
 * per level/break with inline editing, reordering and removal, plus the
 * starting stack. Pure presentation over {@link StructureController}.
 */
/** The common duration of every `kind` row, or null when there are none or they differ. */
function sharedDuration(structure: StructureRow[], kind: "level" | "break"): number | null {
  const mins = structure.filter(r => r.kind === kind).map(r => r.duration_min);
  if (mins.length === 0) return null;
  return mins.every(m => m === mins[0]) ? mins[0] : null;
}

export default function StructureEditor({ ctrl }: { ctrl: StructureController }) {
  const { structure } = ctrl;
  const allLevelDur = sharedDuration(structure, "level");
  const allBreakDur = sharedDuration(structure, "break");
  const hasBreaks = structure.some(r => r.kind === "break");

  // Pending bulk-duration entries — staged locally and only written into the
  // table when "Apply" is clicked. Re-seeded whenever the table's shared
  // duration actually changes (template applied, manual row edit, or our own
  // apply), but never while the user is typing (typing doesn't change the table).
  const [bulkLevel, setBulkLevel] = useState<number | null>(allLevelDur);
  const [bulkBreak, setBulkBreak] = useState<number | null>(allBreakDur);
  useEffect(() => { setBulkLevel(allLevelDur); }, [allLevelDur]);
  useEffect(() => { setBulkBreak(allBreakDur); }, [allBreakDur]);

  const canApply = bulkLevel != null || (hasBreaks && bulkBreak != null);
  const applyBulk = () => {
    if (bulkLevel != null) ctrl.setAllLevelDurations(bulkLevel);
    if (hasBreaks && bulkBreak != null) ctrl.setAllBreakDurations(bulkBreak);
  };

  // Running blind-level number (breaks don't increment it).
  let levelNo = 0;

  return (
    <div className="space-y-4">
      <div className="card">
        <label className="label">Template</label>
        <div className="flex flex-wrap gap-2">
          {STRUCTURE_TEMPLATES.map(tpl => {
            const active = ctrl.selectedTemplateId === tpl.id;
            return (
              <button
                key={tpl.id}
                type="button"
                className={active ? "btn text-sm" : "btn btn-secondary text-sm"}
                aria-pressed={active}
                onClick={() => ctrl.applyTemplate(tpl.id)}
              >
                {tpl.name}
              </button>
            );
          })}
        </div>
        <p className="muted text-xs mt-2 leading-snug">
          Pick a starting template, then fine-tune the levels below.
          {ctrl.selectedTemplateId == null && " (Customised)"}
        </p>
      </div>

      <div className="card space-y-4">
        {/* Starting stack — a single tournament-wide value, written straight
            through as you type (no Apply step). */}
        <div className="max-w-[200px]">
          <label className="label">Starting stack (chips)</label>
          <NumberInput
            className="input"
            value={ctrl.startingStack}
            onChange={n => ctrl.setStartingStack(n ?? 0)}
          />
        </div>

        {/* Bulk durations — these only rewrite the Minutes column of every
            level/break row, and only when "Apply to all" is clicked. Kept in
            their own bordered group so it's clear the button's scope is just
            these two fields (not the starting stack or the blinds). */}
        <div className="border-t pt-4" style={{ borderColor: "var(--border)" }}>
          <span className="label">Set every level / break to the same length</span>
          <div className="flex flex-wrap items-end gap-3 mt-1">
            <div className="min-w-[120px]">
              <label className="label muted text-xs">Level duration (mins)</label>
              <NumberInput
                className="input"
                value={bulkLevel}
                placeholder="Mixed"
                emptyBlurBehavior="null"
                onChange={setBulkLevel}
              />
            </div>
            <div className="min-w-[120px]">
              <label className="label muted text-xs">Break duration (mins)</label>
              <NumberInput
                className="input"
                value={bulkBreak}
                placeholder={hasBreaks ? "Mixed" : "No breaks"}
                emptyBlurBehavior="null"
                disabled={!hasBreaks}
                onChange={setBulkBreak}
              />
            </div>
            <button type="button" className="btn btn-secondary" disabled={!canApply} onClick={applyBulk}>
              Apply to all
            </button>
          </div>
          <p className="muted text-xs mt-2 leading-snug">Overwrites the Minutes column for all level (and break) rows below. Edit a single row in the table to give it a different length.</p>
        </div>
      </div>

      <div className="card">
        <div className="flex items-center justify-between mb-3">
          <h2 className="text-lg font-semibold">Blind structure</h2>
          <div className="flex gap-2">
            <button type="button" className="btn-secondary text-xs px-2 py-1 rounded border border-[var(--border)]" onClick={ctrl.addLevel}>+ Level</button>
            <button type="button" className="btn-secondary text-xs px-2 py-1 rounded border border-[var(--border)]" onClick={ctrl.addBreak}>+ Break</button>
            <button type="button" className="btn-secondary text-xs px-2 py-1 rounded border border-[var(--border)]" onClick={ctrl.reset}>Reset</button>
          </div>
        </div>

        <div className="overflow-x-auto">
          <table className="table">
            <thead>
              <tr>
                <th className="w-10">#</th>
                <th>Type</th>
                <th className="text-right">Small blind</th>
                <th className="text-right">Big blind</th>
                <th className="text-right">Ante</th>
                <th className="text-right">Minutes</th>
                <th className="w-28"></th>
              </tr>
            </thead>
            <tbody>
              {structure.map((row, i) => {
                const isLevel = row.kind === "level";
                if (isLevel) levelNo++;
                const thisLevelNo = levelNo;
                return (
                  <tr key={i} style={isLevel ? undefined : { background: "rgb(56 189 248 / 0.10)" }}>
                    <td className="muted tabular-nums">{isLevel ? thisLevelNo : "—"}</td>
                    <td>
                      {isLevel
                        ? <span className="font-medium">Level</span>
                        : <span className="font-semibold" style={{ color: "rgb(56 189 248)" }}>Break</span>}
                    </td>
                    <td className="text-right">
                      {isLevel ? (
                        <NumberInput className="input w-24 text-right ml-auto" blankZero value={row.sb} onChange={n => ctrl.updateRow(i, { sb: n ?? 0 })} />
                      ) : <span className="muted">—</span>}
                    </td>
                    <td className="text-right">
                      {isLevel ? (
                        <NumberInput className="input w-24 text-right ml-auto" blankZero value={row.bb} onChange={n => ctrl.updateRow(i, { bb: n ?? 0 })} />
                      ) : <span className="muted">—</span>}
                    </td>
                    <td className="text-right">
                      {isLevel ? (
                        <NumberInput className="input w-24 text-right ml-auto" blankZero value={row.ante} onChange={n => ctrl.updateRow(i, { ante: n ?? 0 })} />
                      ) : <span className="muted">—</span>}
                    </td>
                    <td className="text-right">
                      <NumberInput className="input w-20 text-right ml-auto" blankZero value={row.duration_min} onChange={n => ctrl.updateRow(i, { duration_min: n ?? 0 })} />
                    </td>
                    <td>
                      <div className="flex items-center gap-1 justify-end">
                        <button type="button" aria-label="Move up" title="Move up" className="btn-secondary text-xs px-1.5 py-0.5 rounded border border-[var(--border)] disabled:opacity-40" disabled={i === 0} onClick={() => ctrl.moveRow(i, -1)}>↑</button>
                        <button type="button" aria-label="Move down" title="Move down" className="btn-secondary text-xs px-1.5 py-0.5 rounded border border-[var(--border)] disabled:opacity-40" disabled={i === structure.length - 1} onClick={() => ctrl.moveRow(i, 1)}>↓</button>
                        <button type="button" aria-label="Remove" title="Remove" className="btn-secondary text-xs px-1.5 py-0.5 rounded border border-[var(--border)] hover:text-[var(--neg)]" onClick={() => ctrl.removeRow(i)}>×</button>
                      </div>
                    </td>
                  </tr>
                );
              })}
              {structure.length === 0 && (
                <tr><td colSpan={7} className="muted text-center py-4">No rows — add a level to get started.</td></tr>
              )}
            </tbody>
          </table>
        </div>

        {ctrl.error && (
          <div className="mt-3 text-sm neg">{ctrl.error}</div>
        )}
      </div>
    </div>
  );
}
