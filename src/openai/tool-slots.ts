// Which tool call a streamed chat-completions delta belongs to. Providers disagree: most number calls
// with `index`, some leave it out, and some send every parallel call as index 0 with its own id — so a
// new id at a slot already holding a different call starts a new call instead of merging the two.

/** A function from each streamed tool_calls entry to a stable 0-based slot, one per real call. */
export function toolCallSlots() {
  const slotOf = new Map<number, number>(); // the provider's index → our slot (re-pointed when a new id reuses it)
  const idOf = new Map<number, string>();
  let last = 0;
  let next = 0;
  return (tc: { index?: number; id?: string }) => {
    const idx = typeof tc.index === 'number' ? tc.index : last;
    last = idx;
    let slot = slotOf.get(idx);
    const held = slot === undefined ? undefined : idOf.get(slot);
    if (slot === undefined || (tc.id && held && held !== tc.id)) {
      slot = next++;
      slotOf.set(idx, slot);
    }
    if (tc.id) idOf.set(slot, tc.id);
    return slot;
  };
}

/** A streamed name piece: appended when it's a fragment, ignored when the provider resends the whole name. */
export function mergeName(sofar: string, piece: string) {
  if (!sofar || piece.startsWith(sofar)) return piece;
  return sofar.endsWith(piece) ? sofar : sofar + piece;
}
