import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register } from 'claude-code'

// The pane every mod draws its section into: a mod hooks
// `{ component: 'Pane', requestId: 'mod-settings' }`, draws what is beneath it
// (`next(e)`) and adds its own section above it. The badge at the right of the
// footer is shared the same way: a mod hooks `SessionMode` and puts its
// segment before what is beneath it, so this mod's part always ends the row.
const PANE = 'mod-settings'
const changed = atom({ plugin: 'mod-settings', key: 'changed' } as const, 0)
// prismantis loads nothing while it is off, so it cannot draw a switch to come
// back on: its switch is here, its own /config row.
const PRISMANTIS = 'prismantis.enabled'

const openPane = ($: EngineInterface) =>
  $.ui.open({ id: PANE, title: 'Mods', focus: true, closeOnEscape: true, rows: 20, columns: 60 })

async function configValue($: EngineInterface, key: string) {
  try {
    return (await $.config.list()).find(row => row.key === key)?.value
  } catch {
    return undefined
  }
}

export const register: Register = on => {
  on('session.start', async ($, e, next) => {
    await $.command.register({
      name: 'mods',
      description: 'Open the mod settings: fanyi, prompt rail, qa-split and prismantis switches in one pane.',
      immediate: true,
    })
    return next(e)
  })

  on('command.run', { command: 'mods' }, async $ => {
    const placed = await openPane($)
    return { text: placed.isPlaced ? 'Mod settings opened.' : `The mod settings pane waits to be drawn: ${placed.reason}` }
  })

  // The badge, at the right end of the footer line (beside the engine's mode
  // labels): the mods' segments, then "⚙ mods". Each mod puts its segment
  // before what is beneath it, so this mod's part always ends the row.
  on('ui.render', { component: 'SessionMode' }, async ($, e, next) => {
    const drawn = await next(e)
    const { Box, Text, Button } = $.ui.resolve(e)
    const gear = (
      <Button key="open" label="Open the mod settings" plain dimColor onPress={() => void openPane($)}>
        <Text dimColor>⚙ mods</Text>
      </Button>
    )
    return (
      <Box flexDirection="row" gap={1}>
        {drawn}
        {gear}
      </Box>
    )
  })

  // The pane: the mods' sections beneath, then prismantis's switch.
  on('ui.render', { component: 'Pane', requestId: PANE }, async ($, e, next) => {
    const { Box, Text, Select, Button } = $.ui.resolve(e)
    await read($, changed)
    const sections = await next(e)
    const prismantis = await configValue($, PRISMANTIS)
    return (
      <Box flexDirection="column">
        {sections}
        {prismantis !== undefined && (
          <Box flexDirection="column" marginTop={1}>
            <Text bold>Prismantis</Text>
            <Select
              key="prismantis"
              label="Rendering"
              value={prismantis === false ? 'off' : 'on'}
              options={[
                { value: 'on', label: 'On: colorful replies' },
                { value: 'off', label: "Off: Claude Code's own" },
              ]}
              onSelect={async value => {
                const result = await $.config.set({ key: PRISMANTIS, value: value === 'on' })
                if (result.deny) $.ui.toast(`prismantis was not switched: ${result.deny}`)
                await update($, changed, n => n + 1)
              }}
            />
            <Text dimColor>Themes, colors and styles: /config, under prismantis.</Text>
          </Box>
        )}
        <Box marginTop={1}>
          <Button key="close" label="Close" onPress={() => void $.ui.close({ id: PANE })} />
        </Box>
      </Box>
    )
  })
}
