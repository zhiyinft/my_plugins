import { test, expect } from 'claude-code/testing'

const SURFACES = ['terminal', 'desktop'] as const

// Stands in for a mod that adds its section and its badge segment, as fanyi,
// prompt-rail and qa-split do: its own before what is beneath it.
const sectionMod = {
  name: 'section-mod',
  register(on: any) {
    on('ui.render', { component: 'Pane', requestId: 'mod-settings' }, async ($: any, e: any, next: any) => {
      const drawn = await next(e)
      const { Box, Text } = $.ui.resolve(e)
      return Box({ flexDirection: 'column', children: [Text({ children: 'Section of a mod' }), ...(drawn ? [drawn] : [])] })
    })
    on('ui.render', { component: 'SessionMode' }, async ($: any, e: any, next: any) => {
      const drawn = await next(e)
      const { Box, Text } = $.ui.resolve(e)
      return Box({ flexDirection: 'row', children: [Text({ children: '译' }), ...(drawn ? [drawn] : [])] })
    })
  },
}

// The engine's side: an empty site beneath, prismantis's /config row, a pane that opens.
const engine = (on: any, rows: { prismantis?: boolean } = { prismantis: true }) => {
  const writes: unknown[] = []
  on('ui.render', ($: any, e: any) => $.ui.resolve(e).Box({}))
  on('config.list', () => ({ value: rows.prismantis === undefined ? [] : [{ key: 'prismantis.enabled', label: 'Enabled', kind: 'boolean', value: rows.prismantis, provider: { kind: 'plugin', name: 'prismantis' }, isLocked: false }] }))
  on('config.set', ($: any, e: any) => {
    writes.push(e.value)
    rows.prismantis = e.value
    return { value: e.value }
  })
  const opened: string[] = []
  on('ui.open', ($: any, e: any) => {
    opened.push(e.id)
    return { value: { isPlaced: true } }
  })
  on('ui.close', () => ({}))
  on('ui.toast', () => ({ value: undefined }))
  return { writes, opened }
}

const texts = async (ui: any) => (await ui.findAll({ type: 'Text' })).map((t: any) => String(t.text))

test('the pane holds each mod\'s section, then prismantis\'s switch, then Close; the switch writes its /config row', { plugins: [sectionMod] }, async ($, on) => {
  const { writes } = engine(on)
  for (const surface of SURFACES) {
    const pane = await $.ui.mount({ plugin: 'mod-settings', surface, component: 'Pane', requestId: 'mod-settings', props: { title: 'Mods', isFocused: true } as any })
    const drawn = await texts(pane)
    expect(drawn.indexOf('Section of a mod')).toBeGreaterThanOrEqual(0)
    expect(drawn.indexOf('Section of a mod')).toBeLessThan(drawn.indexOf('Prismantis'))
    expect((await pane.find({ key: 'prismantis' }))?.props.value).toBe('on')
    const buttons = await pane.findAll({ type: 'Button' })
    expect(buttons.at(-1)?.props.key).toBe('close')
    await pane.unmount()
  }
  const pane = await $.ui.mount({ plugin: 'mod-settings', surface: 'terminal', component: 'Pane', requestId: 'mod-settings', props: { title: 'Mods', isFocused: true } as any })
  await pane.select({ key: 'prismantis', value: 'off' })
  expect(writes).toEqual([false])
  expect((await pane.find({ key: 'prismantis' }))?.props.value).toBe('off')
})

test('⚙ mods ends the badge, after the mods\' segments, and opens the pane', { plugins: [sectionMod] }, async ($, on) => {
  const { opened } = engine(on)
  for (const surface of SURFACES) {
    const badge = await $.ui.mount({ plugin: 'mod-settings', surface, component: 'SessionMode', props: { modes: [] } })
    const drawn = await badge.findAll({})
    const mark = drawn.findIndex((node: any) => node.type === 'Text' && node.text === '译')
    const gear = drawn.findIndex((node: any) => node.type === 'Text' && node.text === '⚙ mods')
    expect(mark).toBeGreaterThanOrEqual(0)
    expect(gear).toBeGreaterThan(mark)
    await badge.press({ key: 'open' })
    await badge.unmount()
  }
  expect(opened).toEqual(['mod-settings', 'mod-settings'])
})

test('/mods opens the pane; without prismantis the pane leaves its switch out', async ($, on) => {
  const { opened } = engine(on, {})
  const result: any = await $.command.run({ command: 'mods' } as any)
  expect(String(result.text)).toContain('opened')
  expect(opened).toEqual(['mod-settings'])
  const pane = await $.ui.mount({ plugin: 'mod-settings', surface: 'terminal', component: 'Pane', requestId: 'mod-settings', props: { title: 'Mods', isFocused: true } as any })
  expect(await pane.find({ key: 'prismantis' })).toBeUndefined()
})
