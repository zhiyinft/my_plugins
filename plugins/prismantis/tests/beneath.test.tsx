import type { On, RenderElement, RenderNode } from 'claude-code'
import { expect, test } from 'claude-code/testing'

import { inPlaceOfEngine, isDrawnAway, placeIn } from '../hooks/beneath'

// Stands in for a mod beneath prismantis that takes rows off the transcript,
// as qa-split does for the tool rows and notes it moves to its pane.
const drawsAway = (on: On) =>
  on('ui.render', ($, e) => {
    const { Box } = $.ui.resolve(e)
    return <Box />
  })

const call = (tool: string, input: unknown, id: string) => ({ tool_use_id: id, tool, input, isRunning: false, isErrored: false, isInterrupted: false })

test('a row a mod beneath drew away stays away: prismantis draws nothing of its own there', async ($, on) => {
  drawsAway(on)
  for (const surface of ['terminal', 'desktop'] as const) {
    const rows = [
      { component: 'ToolUse' as const, props: call('Read', { file_path: '/tmp/x' }, `r-${surface}`) },
      { component: 'ToolResult' as const, props: { tool_use_id: `r-${surface}`, tool: 'Bash', output: { stdout: 'ok', stderr: '', interrupted: false }, isErrored: false } },
      { component: 'ToolGroup' as const, props: { calls: [call('Read', { file_path: '/tmp/x' }, 'g1'), call('Grep', { pattern: 'x' }, 'g2')], isActive: false, isExpanded: false } },
      { component: 'AssistantMessage' as const, props: { text: 'Let me read the **band** code.', isFirstOfReply: true } },
      { component: 'UserMessage' as const, props: { text: 'why does it flicker?', origin: { kind: 'composer' as const }, isExpanded: false } },
    ]
    for (const row of rows) {
      const ui = await $.ui.mount({ plugin: 'prismantis', surface, ...row } as never)
      expect(await ui.find({ type: 'Text' })).toBeUndefined()
      await ui.unmount()
    }
  }
})

const engineNode = { type: 'engine', ref: 0 } as unknown as RenderElement
const box = (children: RenderNode[]) => ({ type: 'Box', props: { flexDirection: 'column' }, children }) as RenderElement
const text = (value: string) => ({ type: 'Text', children: [value] }) as RenderElement
const own = text('prismantis')

test('prismantis draws in place of Claude Code\'s own drawing, keeping what a mod beneath wrapped round it', () => {
  // Claude Code's own drawing alone, or nothing beneath: prismantis's alone.
  expect(inPlaceOfEngine(engineNode, own)).toBe(own)
  expect(inPlaceOfEngine(undefined, own)).toBe(own)
  // A line a mod added under the row stays under prismantis's drawing.
  expect(inPlaceOfEngine(box([engineNode, text('under')]), own)).toEqual(box([own, text('under')]))
  // Deeper too: a frame round the row and its translation.
  expect(inPlaceOfEngine(box([box([engineNode]), text('translation')]), own)).toEqual(box([box([own]), text('translation')]))
  // A stand-in for the engine that holds no drawing of its own: prismantis's alone.
  expect(inPlaceOfEngine(text('engine'), own)).toBe(own)
  // Only an empty Box is a row drawn away.
  expect(isDrawnAway(box([]))).toBe(true)
  expect(isDrawnAway(box([text('x')]))).toBe(false)
  expect(isDrawnAway(engineNode)).toBe(false)
  expect(isDrawnAway(undefined)).toBe(false)
})

// Claude Code's drawing number `ref`, and the engine's link of a trace that drew it with `props`.
const drawing = (ref: number) => ({ type: 'engine', ref }) as unknown as RenderElement
const core = (ref: number, props: unknown) => ({ tier: 'core', received: { component: 'AssistantMessage', props }, returned: drawing(ref) })
const row = { text: 'It redraws on every tick.', isFirstOfReply: true }
const translated = { text: '每次计时都会重绘。', isFirstOfReply: false }

test('a drawing of props a mod beneath rewrote is left as drawn: fanyi\'s translation is not replaced by the original', () => {
  // Bilingual: the original drawn with the row's props, the translation with rewritten ones.
  const bilingual = box([drawing(1), box([drawing(2), text('译')])])
  expect(placeIn(bilingual, row, [core(1, row), core(2, translated)])(own)).toEqual(box([own, box([drawing(2), text('译')])]))
  // Translation only: the one drawing is of the translation.
  expect(placeIn(drawing(3), row, [core(3, translated)])(own)).toEqual(drawing(3))
  // The row's own props, whatever order their keys come in and with a key holding undefined.
  expect(placeIn(drawing(4), { isFirstOfReply: true, text: row.text, isSummary: undefined }, [core(4, row)])(own)).toBe(own)
  // A drawing the trace does not list: the row's own when it is the only one, of several none.
  expect(placeIn(box([drawing(5), text('under')]), row, [])(own)).toEqual(box([own, text('under')]))
  const twice = box([box([drawing(6)]), box([drawing(7)])])
  expect(placeIn(twice, row, [])(own)).toBe(twice)
  // Nothing beneath (a test with no stand-in for the engine): prismantis's alone.
  expect(placeIn(undefined, row, [])(own)).toBe(own)
})
