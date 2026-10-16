import type { On, RenderElement, RenderNode } from 'claude-code'
import { expect, test } from 'claude-code/testing'

import { inPlaceOfEngine, isDrawnAway } from '../hooks/beneath'

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
