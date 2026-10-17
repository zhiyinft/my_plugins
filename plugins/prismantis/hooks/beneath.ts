import type { RenderElement, RenderNode } from 'claude-code'

// How prismantis shares a transcript row with the mods beneath it in the
// chain. It asks them first (next(e)) and then:
//   - a row one drew away, an empty Box, stays away: qa-split draws that for
//     the tool rows and notes it moves to its own pane, and prismantis draws
//     nothing there of its own;
//   - where Claude Code drew the row's own props, prismantis draws in its
//     place, keeping whatever a mod wrapped round it (a line under a prompt);
//   - where Claude Code drew props a mod beneath rewrote (fanyi asking for
//     the translation drawn as a reply, in the original's place or under it),
//     that drawing is left as drawn: prismantis would draw the original there;
//   - anything else is Claude Code's own drawing, or one standing in for it,
//     and prismantis draws the row as it always has.
// So the order the mods sit in does not change what each of them does.
//
// Which props each of Claude Code's drawings was asked with comes from the
// trace of prismantis's own next() call: the engine's link there lists what it
// received and the drawing ({ type: 'engine', ref }) it answered. A drawing the
// trace does not list (a mod beneath asked more than once) counts as the
// row's own when it is the only one, and as rewritten when there are several.

// One link of next.trace, as far as this file reads it.
type Link = { readonly tier: string; readonly received: unknown; readonly returned: unknown }

// An empty Box: the row drawn away by a mod beneath.
export const isDrawnAway = (node: RenderElement | undefined): node is RenderElement =>
  node !== undefined && node.type === 'Box' && (node.children ?? []).length === 0

// The props Claude Code drew each of its drawings with, by ref.
const drawnWith = (trace: readonly Link[]) => {
  const props = new Map<number, unknown>()
  for (const link of trace) {
    const node = link.returned as { type?: unknown; ref?: unknown } | undefined
    if (link.tier === 'core' && node?.type === 'engine' && typeof node.ref === 'number') {
      props.set(node.ref, (link.received as { props?: unknown } | undefined)?.props)
    }
  }
  return props
}

// Equal as data: the same keys holding equal values, in any order; a key
// holding undefined counts as absent.
const isSame = (a: unknown, b: unknown): boolean => {
  if (a === b) return true
  if (typeof a !== 'object' || typeof b !== 'object' || a === null || b === null) return false
  if (Array.isArray(a) !== Array.isArray(b)) return false
  const keys = (o: object) => Object.keys(o).filter(key => (o as Record<string, unknown>)[key] !== undefined)
  const [ka, kb] = [keys(a), keys(b)]
  return ka.length === kb.length && ka.every(key => isSame((a as Record<string, unknown>)[key], (b as Record<string, unknown>)[key]))
}

// How many of Claude Code's own drawings `node` holds.
const engineNodes = (node: RenderNode): number => {
  if (typeof node === 'string') return 0
  if (node.type === 'engine') return 1
  if (node.type !== 'Box' || !node.children) return 0
  return node.children.reduce((sum, child) => sum + engineNodes(child), 0)
}

// `node` with each of Claude Code's drawings of the row's own props replaced
// by `own`; undefined when it holds none.
const swapped = (node: RenderNode, own: RenderElement, isOwn: (ref: number) => boolean): RenderNode | undefined => {
  if (typeof node === 'string') return undefined
  if (node.type === 'engine') return isOwn(node.ref) ? own : undefined
  if (node.type !== 'Box' || !node.children) return undefined
  let isFound = false
  const children = node.children.map(child => {
    const swap = swapped(child, own, isOwn)
    if (swap === undefined) return child
    isFound = true
    return swap
  })
  return isFound ? { ...node, children } : undefined
}

// Prismantis's drawing of a row placed in what the mods beneath drew: in place
// of each of Claude Code's drawings of the row's own props (`isOwn`), whatever
// is wrapped round them kept; alone where nothing beneath drew the row.
export const inPlaceOfEngine = (beneath: RenderElement | undefined, own: RenderElement, isOwn: (ref: number) => boolean = () => true): RenderElement => {
  if (beneath === undefined || engineNodes(beneath) === 0) return own
  if (beneath.type === 'engine') return isOwn(beneath.ref) ? own : beneath
  return (swapped(beneath, own, isOwn) as RenderElement | undefined) ?? beneath
}

// For a row hook, right after its own next(e): places its drawing in what the
// mods beneath drew for the row with `props` (see inPlaceOfEngine), telling
// Claude Code's drawings of those props from others by the call's trace.
export const placeIn = (beneath: RenderElement | undefined, props: unknown, trace: readonly Link[]) => {
  const drawn = drawnWith(trace)
  const isOnly = beneath !== undefined && engineNodes(beneath) === 1
  const isOwn = (ref: number) => (drawn.has(ref) ? isSame(drawn.get(ref), props) : isOnly)
  return (own: RenderElement) => inPlaceOfEngine(beneath, own, isOwn)
}
