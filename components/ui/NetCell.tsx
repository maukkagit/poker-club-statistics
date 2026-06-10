import { eurSigned } from "@/lib/format";

/**
 * Centered table cell rendering a signed-euro net value with the standard
 * pos/neg colouring used by the player-detail and face-off history tables.
 */
export function NetCell({ net }: { net: number }) {
  return <td className={`text-center ${net >= 0 ? "pos" : "neg"}`}>{eurSigned(net)}</td>;
}
