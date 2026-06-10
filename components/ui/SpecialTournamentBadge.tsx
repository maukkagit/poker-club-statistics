/**
 * Amber "Special" pill shown next to a tournament name in the face-off and
 * player-detail history tables. The tournaments-list page deliberately uses
 * a bare ★ star instead (denser layout), so it does not use this badge.
 */
export function SpecialTournamentBadge() {
  return (
    <span
      className="text-[0.7rem] font-semibold uppercase tracking-wide px-1.5 py-0.5 rounded-full border whitespace-nowrap"
      style={{
        color: "rgb(251 191 36)",
        borderColor: "rgb(251 191 36 / 0.4)",
        background: "rgb(251 191 36 / 0.12)",
      }}
    >
      Special
    </span>
  );
}
