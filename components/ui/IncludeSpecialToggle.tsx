"use client";
import { Toggle } from "./Toggle";

/**
 * The "Include special tournaments" switch shared by the dashboard,
 * face-off and player-detail headers. Wraps {@link Toggle} with the fixed
 * label plus the compact sizing those headers all use (≈10px label on
 * mobile, stepping up to `text-sm` from `sm:`), so the three call sites
 * stay byte-for-byte identical.
 *
 * `labelPosition` is forwarded for the player-detail header, which renders
 * the switch before its label; the dashboard and face-off keep the default
 * "left".
 */
export function IncludeSpecialToggle({
  checked,
  onChange,
  labelPosition,
}: {
  checked: boolean;
  onChange: (next: boolean) => void;
  labelPosition?: "left" | "right";
}) {
  return (
    <Toggle
      checked={checked}
      onChange={onChange}
      label="Include special tournaments"
      size="sm"
      labelPosition={labelPosition}
      className="text-[0.7rem] sm:text-sm"
    />
  );
}
