import type { RenderElement, RenderNode } from 'claude-code'

// How prismantis shares a transcript row with the mods beneath it in the
// chain. It asks them first (next(e)) and then:
//   - a row one drew away, an empty Box, stays away: qa-split draws that for
//     the tool rows and notes it moves to its own pane, and prismantis draws
//     nothing there of its own;
//   - a row one wrapped (a line under a prompt, a frame round a reply) keeps
//     the wrapping, prismantis drawing in place of Claude Code's own drawing
//     inside it;
//   - anything else is Claude Code's own drawing, or one standing in for it,
//     and prismantis draws the row as it always has.
// So the order the mods sit in does not change what each of them does.

// An empty Box: the row drawn away by a mod beneath.
export const isDrawnAway = (node: RenderElement | undefined): node is RenderElement =>
  node !== undefined && node.type === 'Box' && (node.children ?? []).length === 0

// `node` with each of Claude Code's own drawings in it replaced by `own`;
// undefined when it holds none.
const swapped = (node: RenderNode, own: RenderElement): RenderNode | undefined => {
  if (typeof node === 'string') return undefined
  if (node.type === 'engine') return own
  if (node.type !== 'Box' || !node.children) return undefined
  let isFound = false
  const children = node.children.map(child => {
    const swap = swapped(child, own)
    if (swap === undefined) return child
    isFound = true
    return swap
  })
  return isFound ? { ...node, children } : undefined
}

// Prismantis's drawing of a row, inside whatever the mods beneath wrapped
// round Claude Code's own; its own drawing alone where they wrapped nothing.
export const inPlaceOfEngine = (beneath: RenderElement | undefined, own: RenderElement): RenderElement => {
  if (beneath === undefined || beneath.type === 'engine') return own
  return (swapped(beneath, own) as RenderElement | undefined) ?? own
}
