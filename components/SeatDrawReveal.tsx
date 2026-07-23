"use client";
import { useEffect, useRef, useState } from "react";
import PokerTable, { SEAT_REVEAL, type TableOccupant } from "@/components/PokerTable";
import { useReducedMotion } from "@/components/ui/useReducedMotion";

type TableEntry = [number, TableOccupant[]];

// How long the table takes to glide from its grid slot into the centred
// spotlight. The overlay's reveal (shuffle + deal) is delayed by the same
// amount so the dealing only begins once the table has arrived.
const SLIDE_IN_MS = 460;

/**
 * Renders the drawn tables in a grid and plays the seat-draw reveal. On every
 * screen size each table takes its turn: it pops up centred in a spotlight
 * overlay, gets dealt, then flies to its slot in the grid. While a table is
 * spotlighted its grid slot shows an empty placeholder (so the layout — and the
 * flight destination — exists without spoiling who sits where); once it lands
 * the slot fills with the real seating.
 *
 * Reduced-motion: the spotlight is skipped and the settled grid shows instantly.
 * While animating, a Skip control jumps straight to the settled seating.
 *
 * `drawSeq` bumps on every fresh draw; changing it restarts the sequence.
 */
export default function SeatDrawReveal({
  tables, seatsPerTable, drawSeq,
}: {
  tables: TableEntry[];
  seatsPerTable: number;
  drawSeq: number;
}) {
  const reduced = useReducedMotion();
  const spotlight = !reduced;

  // Spotlight sequence state.
  const [active, setActive] = useState(-1);          // index currently spotlighted (-1 = none)
  const [settled, setSettled] = useState<Set<number>>(new Set());
  const overlayRef = useRef<HTMLDivElement | null>(null);
  const slotRefs = useRef<Map<number, HTMLDivElement>>(new Map());
  const tablesRef = useRef<TableEntry[]>(tables);
  tablesRef.current = tables;
  // Abort the in-flight async sequence (timers + awaits) when Skip is pressed
  // or when a new draw replaces this one.
  const abortRef = useRef<(() => void) | null>(null);

  // Reset synchronously when a new draw arrives so the grid never flashes the
  // previous (or settled) state before the sequence takes over.
  const seqRef = useRef<number>(-1);
  if (seqRef.current !== drawSeq) {
    seqRef.current = drawSeq;
    setSettled(new Set());
    setActive(spotlight ? 0 : -1);
  }

  function skip() {
    abortRef.current?.();
    abortRef.current = null;
    const node = overlayRef.current;
    if (node) {
      node.style.transition = "none";
      node.style.transform = "";
      node.style.opacity = "";
    }
    setActive(-1);
    setSettled(new Set(tablesRef.current.map(([tno]) => tno)));
  }

  useEffect(() => {
    if (!spotlight) { setActive(-1); return; }
    const tbls = tablesRef.current;
    if (tbls.length === 0) return;

    let cancelled = false;
    const timers: ReturnType<typeof setTimeout>[] = [];
    const wait = (ms: number) => new Promise<void>(res => { timers.push(setTimeout(res, ms)); });
    const nextPaint = () => new Promise<void>(res => requestAnimationFrame(() => requestAnimationFrame(() => res())));
    abortRef.current = () => {
      cancelled = true;
      timers.forEach(clearTimeout);
    };

    const flyToSlot = (tableNo: number) => new Promise<void>(resolve => {
      const node = overlayRef.current;
      const dest = slotRefs.current.get(tableNo);
      if (!node || !dest) { resolve(); return; }
      // Bring the destination into view so the landing is visible even when the
      // table's slot is further down the stacked list.
      dest.scrollIntoView({ block: "center", behavior: "auto" });
      const from = node.getBoundingClientRect();
      const to = dest.getBoundingClientRect();
      const scale = from.width ? to.width / from.width : 1;
      const dx = to.left - from.left;
      const dy = to.top - from.top;
      let done = false;
      const finish = () => {
        if (done) return;
        done = true;
        node.removeEventListener("transitionend", onEnd);
        resolve();
      };
      const onEnd = (e: TransitionEvent) => { if (e.propertyName === "transform") finish(); };
      node.addEventListener("transitionend", onEnd);
      requestAnimationFrame(() => {
        node.style.transformOrigin = "top left";
        node.style.transition = "transform 560ms cubic-bezier(0.22, 1, 0.36, 1)";
        node.style.transform = `translate(${dx}px, ${dy}px) scale(${scale})`;
      });
      timers.push(setTimeout(finish, 720)); // fallback if transitionend is missed
    });

    // Entrance: the reverse of the flight. Start the overlay sized/placed over
    // the table's grid slot, then glide it to the centred spotlight position —
    // so the table appears to lift out of the grid instead of popping from
    // nowhere. The shuffle/deal is held back (revealDelayMs) until this lands.
    const flyFromSlot = (tableNo: number) => new Promise<void>(resolve => {
      const node = overlayRef.current;
      const src = slotRefs.current.get(tableNo);
      if (!node) { resolve(); return; }
      // Make sure the originating slot is on-screen so the lift-off is visible.
      if (src) src.scrollIntoView({ block: "center", behavior: "auto" });
      // Reset to the natural (centred) position so we can measure the
      // destination, then compute the transform that maps it onto the slot.
      node.style.transition = "none";
      node.style.transform = "";
      void node.offsetWidth; // commit the reset before measuring
      const to = node.getBoundingClientRect();
      if (!src) { node.style.opacity = "1"; resolve(); return; }
      const from = src.getBoundingClientRect();
      const scale = to.width ? from.width / to.width : 1;
      const dx = from.left - to.left;
      const dy = from.top - to.top;
      node.style.transformOrigin = "top left";
      node.style.transform = `translate(${dx}px, ${dy}px) scale(${scale})`;
      void node.offsetWidth; // commit the start frame so the transition runs
      // Now that it's parked on the slot, reveal it (it was pre-hidden to avoid
      // a flash at the previous table's landing spot during the remount).
      node.style.opacity = "1";
      let done = false;
      const finish = () => {
        if (done) return;
        done = true;
        node.removeEventListener("transitionend", onEnd);
        node.style.transition = "";
        resolve();
      };
      const onEnd = (e: TransitionEvent) => { if (e.propertyName === "transform") finish(); };
      node.addEventListener("transitionend", onEnd);
      node.style.transition = `transform ${SLIDE_IN_MS}ms cubic-bezier(0.22, 1, 0.36, 1)`;
      node.style.transform = "translate(0px, 0px) scale(1)";
      timers.push(setTimeout(finish, SLIDE_IN_MS + 160)); // fallback
    });

    (async () => {
      for (let idx = 0; idx < tbls.length && !cancelled; idx++) {
        setActive(idx);
        // Pre-hide the persistent overlay wrapper so the newly-selected table
        // doesn't flash at the previous table's landing spot while React
        // swaps in the new table's content.
        if (overlayRef.current) {
          overlayRef.current.style.transition = "none";
          overlayRef.current.style.opacity = "0";
        }
        await nextPaint();
        if (cancelled) return;
        // Slide the table in from its grid slot before it starts dealing.
        await flyFromSlot(tbls[idx][0]);
        if (cancelled) return;
        const occ = tbls[idx][1].length;
        const dealMs = SEAT_REVEAL.shuffleMs + occ * SEAT_REVEAL.dealStepMs + SEAT_REVEAL.flyMs;
        await wait(dealMs + 340); // let it finish dealing, then a short beat
        if (cancelled) return;
        await flyToSlot(tbls[idx][0]);
        if (cancelled) return;
        setSettled(prev => { const n = new Set(prev); n.add(tbls[idx][0]); return n; });
        await wait(80);
      }
      if (!cancelled) setActive(-1);
    })();

    return () => {
      cancelled = true;
      timers.forEach(clearTimeout);
      abortRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [drawSeq, spotlight]);

  const activeEntry = spotlight && active >= 0 ? tables[active] : null;

  return (
    <>
      <div className="grid grid-cols-2 gap-3 sm:gap-4">
        {tables.map(([tno, occ], i, arr) => {
          // Odd table out: span both columns and center it at one column's width.
          const centerLast = arr.length % 2 === 1 && i === arr.length - 1;
          // A slot only shows its players once the table has landed; until then
          // it's an empty placeholder (and the destination for the flight).
          const showOccupants = spotlight ? settled.has(tno) : true;
          return (
            <div
              key={tno}
              ref={el => { if (el) slotRefs.current.set(tno, el); else slotRefs.current.delete(tno); }}
              className={`card${centerLast ? " col-span-2 w-1/2 justify-self-center" : ""}`}
            >
              <PokerTable tableNo={tno} occupants={showOccupants ? occ : []} seats={seatsPerTable} />
            </div>
          );
        })}
      </div>

      {activeEntry && (
        <div className="fixed inset-0 z-[100] flex items-center justify-center p-4">
          <div className="spotlight-backdrop absolute inset-0 bg-black/45" />
          {/* Wrapper transform is reserved for the JS-driven flight; keep Skip
              outside this node so it doesn't ride the table's translate/scale. */}
          <div ref={overlayRef} className="relative w-[min(88vw,440px)] will-change-transform pointer-events-none">
            <div className="card shadow-2xl">
              <PokerTable
                key={`overlay-${drawSeq}-${active}`}
                tableNo={activeEntry[0]}
                occupants={activeEntry[1]}
                seats={seatsPerTable}
                revealActive
                revealDelayMs={SLIDE_IN_MS}
              />
            </div>
          </div>
          <button
            type="button"
            className="btn btn-secondary absolute bottom-6 right-6 z-[101] shadow-lg"
            style={{ background: "var(--card)", borderColor: "var(--border)" }}
            onClick={skip}
          >
            Skip animation
          </button>
        </div>
      )}
    </>
  );
}
