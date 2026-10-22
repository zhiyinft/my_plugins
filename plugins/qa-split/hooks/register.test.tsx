import { test, expect, mock } from 'claude-code/testing'
import { emptyModel, fromTranscript, hiddenIds, ingestLive, promptText, readingTurn, rowKey, summarize } from './model'
import type { Sighting } from './model'

const SURFACES = ['terminal', 'desktop'] as const

const PROMPT = '11111111-1111-4111-8111-111111111111'
const NOTE = '22222222-2222-4222-8222-222222222222'
const CALL = '33333333-3333-4333-8333-333333333333'
const RESULT = '44444444-4444-4444-8444-444444444444'
const ANSWER = '55555555-5555-4555-8555-555555555555'

const turnRows = [
  { door: 'prompt', uuid: PROMPT, message: { type: 'user', role: 'user', content: [{ type: 'text', text: 'why does the band flicker?' }] } },
  { door: 'response', uuid: NOTE, message: { type: 'assistant', role: 'assistant', content: [{ type: 'text', text: 'Let me read the band code.' }] } },
  {
    door: 'response',
    uuid: CALL,
    message: {
      type: 'assistant',
      role: 'assistant',
      content: [{ type: 'tool_use', id: 'toolu_1', name: 'Read', input: { file_path: '/work/hooks/band.tsx' } }],
    },
  },
  {
    door: 'tool-result',
    uuid: RESULT,
    message: { type: 'user', role: 'user', content: [{ type: 'tool_result', tool_use_id: 'toolu_1', content: '1\texport const band = 1' }] },
  },
  { door: 'response', uuid: ANSWER, message: { type: 'assistant', role: 'assistant', content: [{ type: 'text', text: 'It redraws on every tick.' }] } },
] as const

const PROMPT2 = '88888888-8888-4888-8888-888888888888'
const CALL2 = '99999999-9999-4999-8999-999999999999'
const RESULT2 = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'
const ANSWER2 = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb'

const secondTurn = [
  { door: 'prompt', uuid: PROMPT2, message: { type: 'user', role: 'user', content: [{ type: 'text', text: 'now add a test' }] } },
  {
    door: 'response',
    uuid: CALL2,
    message: { type: 'assistant', role: 'assistant', content: [{ type: 'tool_use', id: 'toolu_2', name: 'Bash', input: { command: 'npm test' } }] },
  },
  {
    door: 'tool-result',
    uuid: RESULT2,
    message: { type: 'user', role: 'user', content: [{ type: 'tool_result', tool_use_id: 'toolu_2', content: 'all passed' }] },
  },
  { door: 'response', uuid: ANSWER2, message: { type: 'assistant', role: 'assistant', content: [{ type: 'text', text: 'Added band.test.tsx.' }] } },
] as const

test('a text block followed by a tool call becomes a note; the last one stays the answer', () => {
  const m = emptyModel('/work')
  for (const row of turnRows) ingestLive(m, row as any)
  expect(m.turns.map(t => t.text)).toEqual(['why does the band flicker?'])
  expect(hiddenIds(m)).toEqual([rowKey(NOTE)])
  const steps = m.steps.get(rowKey(PROMPT))!
  expect(steps.map(s => s.kind)).toEqual(['say', 'tool', 'say'])
  const tool = steps[1]!
  expect(tool.kind === 'tool' && tool.status).toBe('done')
  expect(tool.kind === 'tool' && tool.summary).toBe('hooks/band.tsx')
  const answer = steps[2]!
  expect(answer.kind === 'say' && answer.isAnswer).toBe(true)
})

test('a resumed transcript rebuilds the same turns, rewound rows left out', () => {
  const rows = [
    { type: 'user', uuid: PROMPT, parentUuid: null, message: { content: 'why does the band flicker?' } },
    { type: 'assistant', uuid: NOTE, parentUuid: PROMPT, message: { content: [{ type: 'text', text: 'Let me read the band code.' }] } },
    { type: 'assistant', uuid: CALL, parentUuid: NOTE, message: { content: [{ type: 'tool_use', id: 'toolu_1', name: 'Read', input: { file_path: '/work/a.ts' } }] } },
    { type: 'user', uuid: RESULT, parentUuid: CALL, message: { content: [{ type: 'tool_result', tool_use_id: 'toolu_1', content: 'ok', is_error: true }] } },
    // Rewound away: its parent is the prompt, but the last row does not continue it.
    { type: 'assistant', uuid: '66666666-6666-4666-8666-666666666666', parentUuid: PROMPT, message: { content: [{ type: 'text', text: 'dropped' }] } },
    { type: 'assistant', uuid: ANSWER, parentUuid: RESULT, message: { content: [{ type: 'text', text: 'It redraws.' }] } },
    { type: 'system', subtype: 'turn_duration', uuid: '77777777-7777-4777-8777-777777777777', parentUuid: ANSWER, durationMs: 64000 },
  ]
  const m = fromTranscript(rows.map(row => JSON.stringify(row)).join('\n'), '/work')
  expect(m.turns).toHaveLength(1)
  expect(m.turns[0]!.durationMs).toBe(64000)
  expect(m.turns[0]!.errors).toBe(1)
  expect(m.steps.get(rowKey(PROMPT))!.map(s => (s.kind === 'say' ? s.text : s.kind))).toEqual(['Let me read the band code.', 'tool', 'It redraws.'])
})

test('prompts read as typed, tool calls on one line', () => {
  expect(promptText('<command-name>/review</command-name>\n<command-args>42</command-args>')).toBe('/review 42')
  expect(promptText('<task-notification><summary>tests passed</summary></task-notification>')).toBe('Background task: tests passed')
  expect(summarize('Bash', { command: 'npm test', description: 'Run the tests' }, '/work')).toBe('Run the tests')
  expect(summarize('Grep', { pattern: 'AbovePrompt', path: 'C:\\work\\hooks' }, 'C:\\work')).toBe('AbovePrompt  in hooks')
})

const PANE_PROPS = {
  title: 'Details',
  isFocused: false,
  bodyColumns: 60,
  placement: 'dock' as const,
  scroll: { offset: 0, bodyRows: 30 },
  view: {},
}

const run = (args: string) => ({ command: 'qa-split', args, origin: { kind: 'composer' as const }, presentation: { isFullscreen: true, columns: 200 } })

const setUp = async ($: any, on: any, rows: readonly any[] = turnRows) => {
  on('ui.open', () => ({ value: { isPlaced: true } }))
  on('ui.close', () => ({ value: undefined }))
  // Stand in for the engine's own drawing of a prompt, a reply block and a tool row.
  on('ui.render', { component: 'UserMessage' }, ($: any, e: any) => {
    const { Text } = $.ui.resolve(e)
    return <Text>{`> ${e.props.text}`}</Text>
  })
  on('ui.render', { component: 'AssistantMessage' }, ($: any, e: any) => {
    const { Text } = $.ui.resolve(e)
    return <Text>{e.props.text}</Text>
  })
  on('ui.render', { component: 'ToolUse' }, ($: any, e: any) => {
    const { Text } = $.ui.resolve(e)
    return <Text>{`${e.props.tool} row`}</Text>
  })
  await $.command.run(run(''))
  for (const row of rows) await $.session.append({ ...row, origin: { kind: 'composer' } })
}

const prompt = (text: string, onScreen?: { first: number; last: number; of: number } | null) => ({
  text,
  origin: { kind: 'composer' as const },
  isExpanded: false,
  ...(onScreen === undefined ? {} : { onScreen }),
})

const sight = (turn: number, first: number, last: number, of: number, order: number): Sighting => ({ turn, first, last, of, order })

test('the turn read is the one at the viewport top, or the newest at the end; silent rows that left are dropped', () => {
  // Turn 0's answer cut at the top, turn 1's prompt cut at the bottom.
  expect(readingTurn(new Map([['a', sight(0, 5, 9, 10, 1)], ['b', sight(1, 0, 1, 3, 2)]]), 1).turn).toBe(0)
  // At the end: every row of the newest turn shows to its last.
  expect(readingTurn(new Map([['a', sight(0, 8, 9, 10, 1)], ['b', sight(1, 0, 2, 3, 2)]]), 1).turn).toBe(1)
  // Only the last two rows of turn 0 at the top: turn 1 below is the one read.
  expect(readingTurn(new Map([['a', sight(0, 8, 9, 10, 1)], ['b', sight(1, 0, 4, 9, 2)], ['c', sight(2, 0, 1, 3, 3)]]), 3).turn).toBe(1)
  // A row of turn 0 heard before the row cut at the top left without saying so.
  const scrolled = readingTurn(new Map([['old', sight(0, 0, 3, 4, 1)], ['top', sight(2, 4, 9, 12, 2)], ['next', sight(3, 0, 1, 5, 3)]]), 5)
  expect(scrolled).toEqual({ turn: 2, stale: ['old'] })
  // Likewise a row of a later turn heard before the row cut at the bottom.
  expect(readingTurn(new Map([['late', sight(4, 0, 2, 3, 1)], ['top', sight(1, 2, 6, 7, 2)], ['bottom', sight(2, 0, 3, 8, 3)]]), 4).stale).toEqual(['late'])
  expect(readingTurn(new Map(), 0).turn).toBeUndefined()
})

test('the left keeps the prompt and the answer; the note and the tool row draw nothing', async ($, on) => {
  await setUp($, on)
  for (const surface of SURFACES) {
    const note = await $.ui.mount({ plugin: 'qa-split', surface, component: 'AssistantMessage', requestId: NOTE, props: { text: 'Let me read the band code.', isFirstOfReply: true } })
    expect(await note.find({ type: 'Text' })).toBeUndefined()
    await note.unmount()

    const answer = await $.ui.mount({ plugin: 'qa-split', surface, component: 'AssistantMessage', requestId: ANSWER, props: { text: 'It redraws on every tick.', isFirstOfReply: false } })
    expect(await answer.find({ type: 'Text', text: 'It redraws on every tick.' })).toBeDefined()
    await answer.unmount()

    const row = await $.ui.mount({
      plugin: 'qa-split',
      surface,
      component: 'ToolUse',
      requestId: 'toolu_1',
      props: { tool_use_id: 'toolu_1', tool: 'Read', input: { file_path: '/work/hooks/band.tsx' }, isRunning: false, isErrored: false, isInterrupted: false },
    })
    expect(await row.find({ type: 'Text', text: 'Read row' })).toBeUndefined()
    await row.unmount()
  }
})

test('the pane lists the turn: its prompt, the note, the call; a press expands the call', async ($, on) => {
  await setUp($, on)
  for (const surface of SURFACES) {
    const pane = await $.ui.mount({ plugin: 'qa-split', surface, component: 'Pane', requestId: 'qa-split', props: PANE_PROPS })
    expect(await pane.find({ type: 'Text', text: 'why does the band flicker?' })).toBeDefined()
    expect(await pane.find({ type: 'Markdown', text: 'Let me read the band code.' })).toBeDefined()
    expect(await pane.find({ type: 'Markdown', text: 'It redraws on every tick.' })).toBeUndefined()
    expect(await pane.find({ key: 'step-toolu_1' })).toBeDefined()
    expect(await pane.find({ type: 'Text', text: /export const band/ })).toBeUndefined()
    await pane.press({ key: 'step-toolu_1' })
    expect(await pane.find({ type: 'Text', text: /export const band/ })).toBeDefined()
    // Collapse again for the next surface.
    await pane.press({ key: 'step-toolu_1' })
    await pane.unmount()
  }
})

test('hide folds the pane to one row on that surface alone; show unfolds it', async ($, on) => {
  await setUp($, on)
  const phone = await $.ui.mount({ plugin: 'qa-split', surface: 'mobile', component: 'Pane', requestId: 'qa-split', props: { ...PANE_PROPS, placement: 'inline' as const } })
  const terminal = await $.ui.mount({ plugin: 'qa-split', surface: 'terminal', component: 'Pane', requestId: 'qa-split', props: PANE_PROPS })
  await phone.press({ key: 'hide' })
  expect(await phone.find({ key: 'step-toolu_1' })).toBeUndefined()
  expect(await phone.find({ type: 'Text', text: 'why does the band flicker?' })).toBeUndefined()
  expect((await phone.find({ key: 'unfold' }))?.text).toMatch(/Details · 1\/1 · 1 tool call/)
  expect(await terminal.find({ key: 'step-toolu_1' })).toBeDefined()
  await phone.press({ key: 'show' })
  expect(await phone.find({ key: 'step-toolu_1' })).toBeDefined()
  expect(await phone.find({ key: 'unfold' })).toBeUndefined()
})

test('a line under each prompt shows its turn in the pane; a second click follows again', async ($, on) => {
  mock.clock(on)
  await setUp($, on, [...turnRows, ...secondTurn])
  for (const surface of SURFACES) {
    const pane = await $.ui.mount({ plugin: 'qa-split', surface, component: 'Pane', requestId: 'qa-split', props: PANE_PROPS })
    expect(await pane.find({ type: 'Text', text: 'now add a test' })).toBeDefined()
    const first = await $.ui.mount({ plugin: 'qa-split', surface, component: 'UserMessage', requestId: PROMPT, props: prompt('why does the band flicker?') })
    expect(await first.find({ type: 'Text', text: '> why does the band flicker?' })).toBeDefined()
    const line = `turn-${rowKey(PROMPT)}`
    expect((await first.find({ key: line }))?.text).toMatch(/1 tool call/)
    await first.press({ key: line })
    expect(await pane.find({ type: 'Text', text: 'why does the band flicker?' })).toBeDefined()
    expect((await first.find({ key: line }))?.text).toMatch(/Details \(held\)/)
    await first.press({ key: line })
    expect(await pane.find({ type: 'Text', text: 'now add a test' })).toBeDefined()
    await first.unmount()
    await pane.unmount()
  }
})

test('the pane follows the transcript as it scrolls', async ($, on) => {
  const clock = mock.clock(on)
  await setUp($, on, [...turnRows, ...secondTurn])
  const pane = await $.ui.mount({ plugin: 'qa-split', surface: 'terminal', component: 'Pane', requestId: 'qa-split', props: PANE_PROPS })
  // Scrolled up: turn 1's answer cut at the top, turn 2's prompt cut at the bottom.
  const answer = await $.ui.mount({
    plugin: 'qa-split',
    surface: 'terminal',
    component: 'AssistantMessage',
    requestId: ANSWER,
    props: { text: 'It redraws on every tick.', isFirstOfReply: true, onScreen: { first: 4, last: 9, of: 10 } },
  })
  const second = await $.ui.mount({ plugin: 'qa-split', surface: 'terminal', component: 'UserMessage', requestId: PROMPT2, props: prompt('now add a test', { first: 0, last: 1, of: 3 }) })
  await clock.advance(300)
  expect(await pane.find({ type: 'Text', text: 'why does the band flicker?' })).toBeDefined()
  // Down to the end: turn 2's rows show whole.
  await answer.redraw({ text: 'It redraws on every tick.', isFirstOfReply: true, onScreen: { first: 8, last: 9, of: 10 } })
  await second.redraw(prompt('now add a test', { first: 0, last: 2, of: 3 }))
  await $.ui.mount({
    plugin: 'qa-split',
    surface: 'terminal',
    component: 'AssistantMessage',
    requestId: ANSWER2,
    props: { text: 'Added band.test.tsx.', isFirstOfReply: true, onScreen: { first: 0, last: 2, of: 3 } },
  })
  await clock.advance(300)
  expect(await pane.find({ type: 'Text', text: 'now add a test' })).toBeDefined()
})

test('/qa-split off puts every row back on the left', async ($, on) => {
  await setUp($, on)
  await $.command.run(run('off'))
  const note = await $.ui.mount({ plugin: 'qa-split', surface: 'terminal', component: 'AssistantMessage', requestId: NOTE, props: { text: 'Let me read the band code.', isFirstOfReply: true } })
  expect(await note.find({ type: 'Text', text: 'Let me read the band code.' })).toBeDefined()
})

test('the mods pane turns the split off and on', async ($, on) => {
  on('ui.render', { component: 'Pane', requestId: 'mod-settings' }, ($: any, e: any) => $.ui.resolve(e).Box({}))
  await setUp($, on)
  const mods = await $.ui.mount({ plugin: 'qa-split', surface: 'terminal', component: 'Pane', requestId: 'mod-settings', props: { title: 'Mods', isFocused: true } as any })
  expect((await mods.find({ key: 'mods-split' }))?.props.value).toBe('on')
  await mods.select({ key: 'mods-split', value: 'off' })
  expect((await mods.find({ key: 'mods-split' }))?.props.value).toBe('off')
  const note = await $.ui.mount({ plugin: 'qa-split', surface: 'terminal', component: 'AssistantMessage', requestId: NOTE, props: { text: 'Let me read the band code.', isFirstOfReply: true } })
  expect(await note.find({ type: 'Text', text: 'Let me read the band code.' })).toBeDefined()
  await mods.select({ key: 'mods-split', value: 'on' })
  expect((await mods.find({ key: 'mods-split' }))?.props.value).toBe('on')
})
