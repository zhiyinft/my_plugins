import { atom, read, update } from 'claude-code'
import type { EngineInterface, OnScreen, RenderElement, RenderInput, RenderSurface, Register } from 'claude-code'

import type { QaLine, QaStep, QaTurn } from '../types'
import {
  CONVERSATIONAL,
  answerIds,
  cellWidth,
  duration,
  emptyModel,
  fromTranscript,
  hiddenIds,
  ingestLive,
  markRunning,
  oneLine,
  readingTurn,
  restoreModel,
  rowKey,
  shownTurn,
} from './model'
import type { Model, Sighting } from './model'

// Two panels: the transcript on the left keeps the person's prompts and the
// answers to them; every tool call, the notes written between calls and the
// thinking move to a pane docked on the right, one turn at a time.

declare module 'claude-code' {
  interface EngineInterface {
    // prismantis's noun, there only where prismantis is installed: it draws
    // markdown in its own style for other mods. Called inside a try.
    prismantis: {
      markdown: (args: { surface: RenderSurface; text: string; columns: number }) => Promise<RenderElement | undefined>
    }
  }
}

const PANE = 'qa-split'
// The pane the mods share for their switches, opened by mod-settings (/mods).
const MODS_PANE = 'mod-settings'
const TITLE = 'Details'
// The share of the terminal the pane asks for when docked.
const SHARE = 0.45
// How long after the last onScreen report the turn in view is worked out, and
// at the latest after the first, so reports that never pause (a held scroll,
// a streaming reply) still move the pane. A remounted row replays where it
// was last seen and corrects itself within a frame or two.
const SETTLE_MS = 60
const SETTLE_MAX_MS = 200
// A turn picked by hand stays in the pane through the redraws its press
// causes; a scroll to another turn after this long goes back to following.
const PIN_HOLD_MS = 800
// Lines of a tool's result an expanded step shows.
const OUTPUT_LINES = 24

const turnsAtom = atom({ plugin: 'qa-split', key: 'turns' } as const, [])
const modeAtom = atom({ plugin: 'qa-split', key: 'mode' } as const, { isOff: false, isShown: false, agent: null })
const pinnedAtom = atom({ plugin: 'qa-split', key: 'pinned' } as const, null)
const inViewAtom = atom({ plugin: 'qa-split', key: 'inView' } as const, null)
const openAtom = atom({ plugin: 'qa-split', key: 'open' } as const, [])
const foldedAtom = atom({ plugin: 'qa-split', key: 'folded' } as const, [])
const STEPS = { plugin: 'qa-split', key: 'steps' } as const
const HIDDEN = { plugin: 'qa-split', key: 'hidden' } as const

const GLYPH: Record<string, { glyph: string; color?: string; dim?: boolean }> = {
  running: { glyph: '◐', color: 'claude' },
  done: { glyph: '✓', color: 'success' },
  error: { glyph: '✗', color: 'error' },
  stopped: { glyph: '■', dim: true },
}

const TONE: Record<string, string> = { add: 'diffAdded', del: 'diffRemoved' }

// The module's own view of the conversation; $.state holds the copy drawings
// read, which outlives a hot reload of this module.
let model: Model = emptyModel()
let isRestored = false
// The prompt and answer rows the transcript's viewport shows, by component and
// the id each is drawn under: the row's key, the part of it on screen, and
// when it said so (see readingTurn).
const onScreen = new Map<string, Omit<Sighting, 'turn'> & { key: string }>()
let reports = 0
let settleQuiet: { cancel: () => void } | undefined
let settleLatest: { cancel: () => void } | undefined
let lastInView: string | null = null
let pinnedAt = 0
let paneTurn: string | undefined
let sizedFor = 0
let lastSeat = ''

// What the drawn tool name says: an MCP tool by its server and name.
const toolName = (tool: string) => {
  const mcp = /^mcp__(.+?)__(.+)$/.exec(tool)
  return mcp ? `${mcp[1]!.replace(/^plugin_[^_]+_/, '')}·${mcp[2]}` : tool
}

// What a turn's work came to: "4m 12s · 23 tool calls · 1 failed".
const turnFacts = (turn: QaTurn) =>
  [
    turn.isRunning ? 'working…' : turn.durationMs !== undefined ? duration(turn.durationMs) : '',
    turn.tools > 0 ? `${turn.tools} tool call${turn.tools === 1 ? '' : 's'}` : '',
    turn.errors > 0 ? `${turn.errors} failed` : '',
  ].filter(Boolean)

// A result's first lines, and how many more there were.
const lines = (text: string, max: number) => {
  const all = text.split(/\r?\n/)
  return all.length > max ? [...all.slice(0, max), `… ${all.length - max} more lines`] : all
}

// Write what the model marked dirty.
async function flush($: EngineInterface) {
  const writes: Promise<unknown>[] = []
  if (model.dirtyTurns) writes.push(update($, turnsAtom, () => model.turns.map(turn => ({ ...turn }))))
  for (const id of model.dirtySteps) {
    writes.push($.state.set({ ...STEPS, id }, (model.steps.get(id) ?? []).map(step => ({ ...step }))))
  }
  for (const key of model.hide) writes.push($.state.set({ ...HIDDEN, id: key }, true))
  model.dirtyTurns = false
  model.dirtySteps = new Set()
  model.hide = new Set()
  await Promise.all(writes)
}

// Everything again, from a model built whole (a resumed transcript, a /clear).
async function writeAll($: EngineInterface, next: Model) {
  model = next
  isRestored = true
  model.dirtyTurns = true
  for (const turn of model.turns) model.dirtySteps.add(turn.id)
  for (const key of hiddenIds(model)) model.hide.add(key)
  await flush($)
}

// The session's folder, which tool paths are shown relative to; '' where the
// host has none to give.
async function sessionCwd($: EngineInterface) {
  try {
    return await $.session.cwd()
  } catch {
    return ''
  }
}

// This session's transcript file, where Claude Code keeps it: the config
// folder's projects/<the folder's name, each other character a dash>/<id>.jsonl.
async function transcriptPath($: EngineInterface, cwd: string) {
  const config =
    (await $.env.get('CLAUDE_CONFIG_DIR')) ??
    `${(await $.env.get('USERPROFILE')) ?? (await $.env.get('HOME')) ?? ''}/.claude`
  return `${config.replace(/[\\/]+$/, '')}/projects/${cwd.replace(/[^a-zA-Z0-9]/g, '-')}/${await $.session.id()}.jsonl`
}

// The turns so far, from the transcript, when the mod loads into a session
// that already has some (it was installed or enabled mid-session).
async function backfill($: EngineInterface) {
  if (model.turns.length > 0) return
  try {
    const cwd = await sessionCwd($)
    const text = await $.fs.read(await transcriptPath($, cwd))
    if (typeof text === 'string' && model.turns.length === 0) await writeAll($, fromTranscript(text, cwd))
  } catch {
    // A new session has no file yet.
  }
}

// After a hot reload the module starts empty; $.state kept the turns.
async function restore($: EngineInterface) {
  if (isRestored) return
  isRestored = true
  const cwd = await sessionCwd($)
  if (model.turns.length > 0) {
    model.cwd = cwd
    return
  }
  const turns = (await read($, turnsAtom)) as QaTurn[]
  const steps = new Map<string, QaStep[]>()
  await Promise.all(
    turns.map(async turn => {
      const { value } = await $.state.get({ ...STEPS, id: turn.id })
      steps.set(turn.id, (value ?? []) as QaStep[])
    }),
  )
  model = restoreModel(cwd, turns, steps)
}

async function isSplit($: EngineInterface) {
  const mode = await read($, modeAtom)
  return !mode.isOff && mode.isShown && mode.agent === null
}

// The turn the person reads, from the rows' last reports (see readingTurn):
// written for the pane, which follows it unless a turn was picked by hand
// just now. With no row placing anyone, the last one stays.
async function settle($: EngineInterface) {
  settleQuiet?.cancel()
  settleLatest?.cancel()
  settleQuiet = undefined
  settleLatest = undefined
  const index = new Map(model.turns.map((turn, i) => [turn.id, i]))
  const newest = model.turns.length - 1
  const seen = new Map<string, Sighting>()
  for (const [name, row] of onScreen) {
    const owner = model.owners.get(row.key)
    // A reply block drawn before it is stored is the running turn's.
    const isStreaming = owner === undefined && name.startsWith('AssistantMessage') && model.turns[newest]?.isRunning === true
    const turn = owner !== undefined ? index.get(owner) : isStreaming ? newest : undefined
    if (turn !== undefined) seen.set(name, { turn, first: row.first, last: row.last, of: row.of, order: row.order })
  }
  const { turn, stale } = readingTurn(seen, newest)
  for (const name of stale) onScreen.delete(name)
  const best = turn === undefined ? undefined : model.turns[turn]?.id
  if (best === undefined || best === lastInView) return
  lastInView = best
  await update($, inViewAtom, () => best)
  if ((await $.clock.now()) - pinnedAt > PIN_HOLD_MS && (await read($, pinnedAtom)) !== null) await update($, pinnedAtom, () => null)
}

// Record one onScreen report (null once the row left), then work out the
// turn being read once the reports settle.
function noteOnScreen($: EngineInterface, component: string, requestId: string, place: OnScreen | null | undefined) {
  if (place === undefined) return
  const name = `${component}\u0000${requestId}`
  const had = onScreen.get(name)
  // A redraw that says the same is no news: the row keeps when it said so.
  if (place === null ? had === undefined : had?.first === place.first && had.last === place.last && had.of === place.of) return
  if (place === null) onScreen.delete(name)
  else onScreen.set(name, { key: rowKey(requestId), first: place.first, last: place.last, of: place.of, order: ++reports })
  settleQuiet?.cancel()
  settleQuiet = $.clock.after(SETTLE_MS, () => void settle($))
  settleLatest ??= $.clock.after(SETTLE_MAX_MS, () => void settle($))
}

// Hold the pane on a turn picked by hand, or (null) let it follow again.
async function holdTurn($: EngineInterface, id: string | null) {
  pinnedAt = await $.clock.now()
  await update($, pinnedAtom, () => id)
}

// Fold the pane to one row on this surface (a phone, where it sits above the
// prompt), or unfold it. The other surfaces keep theirs.
async function setFolded($: EngineInterface, surface: string, isFolded: boolean) {
  await update($, foldedAtom, list => [...list.filter(s => s !== surface), ...(isFolded ? [surface] : [])])
}

// Off: the details go back into the transcript.
async function turnOff($: EngineInterface) {
  await update($, modeAtom, mode => ({ ...mode, isOff: true, isShown: false }))
  await $.ui.close({ id: PANE })
}

async function turnOn($: EngineInterface) {
  await update($, modeAtom, mode => ({ ...mode, isOff: false }))
  return openPane($)
}

async function openPane($: EngineInterface) {
  const placed = await $.ui.open({ id: PANE, title: TITLE })
  if (placed.isPlaced) await update($, modeAtom, mode => ({ ...mode, isShown: true }))
  return placed
}

// A row that is not the conversation draws nothing on the left: an empty Box,
// which prismantis and fanyi above it take as a row drawn away and leave be.
function nothing($: EngineInterface, e: RenderInput) {
  const { Box } = $.ui.resolve(e)
  return <Box />
}

// What the pane's seat says, written just after the drawing that saw it.
function noteSeat($: EngineInterface, e: RenderInput<'Pane'>, mode: { isShown: boolean; agent: string | null }) {
  const agent = e.props.view.agentId ?? null
  lastSeat = `${e.props.placement}, ${e.props.bodyColumns} of ${e.viewport?.columns ?? '?'} columns`
  if (!mode.isShown || mode.agent !== agent) {
    $.clock.after(0, () => void update($, modeAtom, m => ({ ...m, isShown: true, agent })))
  }
  const columns = e.viewport?.columns ?? 0
  if (e.props.placement === 'dock' && columns > 0 && sizedFor !== columns) {
    sizedFor = columns
    const wanted = Math.max(40, Math.round(columns * SHARE))
    if (Math.abs(wanted - e.props.bodyColumns) > 4) {
      $.clock.after(0, () => void $.ui.open({ id: PANE, title: TITLE, columns: wanted }))
    }
  }
}

// A note drawn as prismantis draws replies, where prismantis is installed and
// on ($.prismantis.markdown, its offer to other mods); undefined otherwise (no
// such noun on $ without it), and the pane draws Claude Code's own markdown.
async function styledNote($: EngineInterface, surface: RenderSurface, text: string, columns: number) {
  try {
    return (await $.prismantis.markdown({ surface, text, columns })) ?? undefined
  } catch {
    return undefined
  }
}

// The turn's notes, each drawn by prismantis where it can, by step id.
async function styledNotes($: EngineInterface, e: RenderInput<'Pane'>, steps: QaStep[]) {
  const columns = Math.max(16, e.props.bodyColumns) - 2
  const drawn = await Promise.all(
    steps.map(async step => (step.kind === 'say' && !step.isAnswer ? ([step.id, await styledNote($, e.surface, step.text, columns)] as const) : undefined)),
  )
  const styled = new Map<string, RenderElement>()
  for (const entry of drawn) if (entry?.[1] !== undefined) styled.set(entry[0], entry[1])
  return styled
}

function drawPane(
  $: EngineInterface,
  e: RenderInput<'Pane'>,
  turns: QaTurn[],
  turn: QaTurn,
  steps: QaStep[],
  pinned: string | null,
  open: string[],
  styled: ReadonlyMap<string, RenderElement>,
) {
  const { Box, Text, Button, Markdown } = $.ui.resolve(e)
  const width = Math.max(16, e.props.bodyColumns)
  const index = turns.findIndex(t => t.id === turn.id)
  const goTo = (to: number) => {
    const target = turns[Math.min(turns.length - 1, Math.max(0, to))]
    if (target) void holdTurn($, target.id)
  }
  const toggle = (id: string) => update($, openAtom, list => (list.includes(id) ? list.filter(x => x !== id) : [...list, id].slice(-200)))

  const facts = turnFacts(turn)
  const notes = steps.filter(step => step.kind !== 'say' || !step.isAnswer)

  const toolRow = (step: Extract<QaStep, { kind: 'tool' }>) => {
    const look = GLYPH[step.status] ?? GLYPH.done!
    const name = toolName(step.tool)
    const room = Math.max(4, width - cellWidth(name) - 4)
    const isOpen = open.includes(step.id)
    return (
      <Box key={`row-${step.id}`} flexDirection="column">
        <Button key={`step-${step.id}`} plain onPress={() => toggle(step.id)}>
          <Text color={look.color} dimColor={look.dim}>
            {look.glyph}
          </Text>
          {' '}
          <Text bold>{name}</Text>
          {' '}
          <Text dimColor>{oneLine(step.summary, room)}</Text>
        </Button>
        {isOpen && (
          <Box flexDirection="column" paddingLeft={2} marginBottom={1}>
            {step.detail.map((line: QaLine, i: number) => (
              <Text
                key={`d-${i}`}
                color={line.tone && line.tone !== 'dim' ? TONE[line.tone] : undefined}
                dimColor={line.tone === 'dim'}
                wrap="truncate-end"
              >
                {line.text || ' '}
              </Text>
            ))}
            {step.output !== undefined && step.output !== '' && (
              <Box flexDirection="column" marginTop={step.detail.length > 0 ? 1 : 0}>
                {lines(step.output, OUTPUT_LINES).map((line, i) => (
                  <Text
                    key={`o-${i}`}
                    color={step.status === 'error' ? 'error' : undefined}
                    dimColor={step.status !== 'error'}
                    wrap="truncate-end"
                  >
                    {line || ' '}
                  </Text>
                ))}
              </Box>
            )}
            {step.status === 'running' && <Text dimColor>running…</Text>}
          </Box>
        )}
      </Box>
    )
  }

  return (
    <Box flexDirection="column">
      <Box flexDirection="row" justifyContent="space-between">
        <Box flexDirection="row">
          <Button key="prev" plain hotkey="p" dimColor={index <= 0} label="◄" onPress={() => goTo(index - 1)} />
          <Text> </Text>
          <Button key="next" plain hotkey="n" dimColor={index >= turns.length - 1} label="►" onPress={() => goTo(index + 1)} />
          <Text dimColor>{`  ${index + 1}/${turns.length}`}</Text>
        </Box>
        <Box flexDirection="row">
          {pinned !== null ? (
            <Button key="follow" plain hotkey="f" label="follow ↓" onPress={() => void holdTurn($, null)} />
          ) : (
            <Text dimColor>following</Text>
          )}
          <Text>{'  '}</Text>
          <Button key="hide" plain hotkey="h" dimColor label="▾ hide" onPress={() => void setFolded($, e.surface, true)} />
        </Box>
      </Box>
      <Box marginTop={1} flexDirection="row">
        <Text color="claude">{'❯ '}</Text>
        <Box flexGrow={1} flexShrink={1}>
          <Text bold wrap="wrap">
            {turn.text.length > 600 ? `${turn.text.slice(0, 600)}…` : turn.text}
          </Text>
        </Box>
      </Box>
      {facts.length > 0 && <Text dimColor>{`  ${facts.join(' · ')}`}</Text>}
      <Text dimColor>{'─'.repeat(width)}</Text>
      {notes.length === 0 && (
        <Text dimColor>{turn.isRunning ? 'Working…' : 'Nothing behind this answer: no tool calls, notes or thinking.'}</Text>
      )}
      {notes.map(step => {
        if (step.kind === 'tool') return toolRow(step)
        if (step.kind === 'think') {
          const isOpen = open.includes(step.id)
          return (
            <Box key={`row-${step.id}`} flexDirection="column">
              <Button key={`step-${step.id}`} plain dimColor onPress={() => toggle(step.id)}>
                {`∴ Thinking${isOpen ? '' : ` · ${oneLine(step.text, Math.max(4, width - 14))}`}`}
              </Button>
              {isOpen && (
                <Box paddingLeft={2} marginBottom={1}>
                  <Markdown text={step.text} dimColor />
                </Box>
              )}
            </Box>
          )
        }
        return (
          <Box key={`row-${step.id}`} flexDirection="row" marginY={1}>
            <Box width={2} flexShrink={0}>
              <Text dimColor>│</Text>
            </Box>
            <Box flexGrow={1} flexShrink={1}>
              {styled.get(step.id) ?? <Markdown text={step.text} />}
            </Box>
          </Box>
        )
      })}
      {!turn.isRunning && notes.length > 0 && steps.some(step => step.kind === 'say' && step.isAnswer) && (
        <Text dimColor>└ answered on the left</Text>
      )}
    </Box>
  )
}

// Folded: one row naming the turn the pane holds and what its work came to;
// a press anywhere on it unfolds the pane.
function drawFolded($: EngineInterface, e: RenderInput<'Pane'>, turns: QaTurn[], turn: QaTurn | undefined) {
  const { Box, Text, Button } = $.ui.resolve(e)
  const unfold = () => void setFolded($, e.surface, false)
  const facts = turn ? [`${turns.findIndex(t => t.id === turn.id) + 1}/${turns.length}`, ...turnFacts(turn)] : []
  return (
    <Box flexDirection="row" justifyContent="space-between">
      <Button key="unfold" plain onPress={unfold}>
        <Text color="claude">{'▸ '}</Text>
        <Text>{TITLE}</Text>
        {facts.length > 0 && <Text dimColor>{` · ${oneLine(facts.join(' · '), Math.max(4, e.props.bodyColumns - 20))}`}</Text>}
      </Button>
      <Button key="show" plain hotkey="h" label="show" onPress={unfold} />
    </Box>
  )
}

export const register: Register = on => {
  on('session.start', async ($, e, next) => {
    await $.command.register({
      name: 'qa-split',
      description: 'Conversation on the left, the work behind each answer in a pane on the right. on (default) or off.',
      argumentHint: '[on|off]',
      immediate: true,
    })
    await restore($)
    await backfill($)
    const mode = await read($, modeAtom)
    if (e.isInteractive && !mode.isOff) await openPane($)
    return next(e)
  })

  on('classic.SessionStart', async ($, e, next) => {
    const cwd = await sessionCwd($)
    if (e.source === 'clear') {
      onScreen.clear()
      lastInView = null
      await writeAll($, emptyModel(cwd))
      await update($, pinnedAtom, () => null)
      await update($, inViewAtom, () => null)
      await update($, openAtom, () => [])
    } else if (e.source === 'resume' && e.transcript_path) {
      try {
        const text = await $.fs.read(e.transcript_path)
        if (typeof text === 'string') await writeAll($, fromTranscript(text, cwd))
      } catch {
        // No file to read: the turns build up from here.
      }
    }
    return next(e)
  })

  // Every row the main conversation stores, as stored.
  on('session.append', async ($, e, next) => {
    const stored = await next(e)
    if (e.agentId === undefined && stored.deny === undefined) {
      try {
        await restore($)
        ingestLive(model, { door: e.door, uuid: stored.uuid, message: stored.message, origin: e.origin })
        await flush($)
      } catch {
        // The transcript is the engine's; a row this mod cannot read is left out.
      }
    }
    return stored
  })

  on('turn.start', async ($, e, next) => {
    await restore($)
    markRunning(model, true)
    await flush($)
    // A new turn: the pane follows it.
    await update($, pinnedAtom, () => null)
    return next(e)
  })

  on('turn.complete', async ($, e, next) => {
    const result = await next(e)
    if (e.agentId === undefined) {
      markRunning(model, false, e.durationMs)
      await flush($)
    }
    return result
  })

  // ---- the left ----

  on('ui.render', { component: 'ToolUse' }, async ($, e, next) => {
    if (CONVERSATIONAL.has(e.props.tool) || !(await isSplit($))) return next(e)
    return nothing($, e)
  })

  on('ui.render', { component: 'ToolResult' }, async ($, e, next) => {
    if (CONVERSATIONAL.has(e.props.tool) || !(await isSplit($))) return next(e)
    return nothing($, e)
  })

  on('ui.render', { component: 'ToolGroup' }, async ($, e, next) => {
    if (e.props.calls.some(call => CONVERSATIONAL.has(call.tool)) || !(await isSplit($))) return next(e)
    return nothing($, e)
  })

  // The run-in-background pill would stand alone under a hidden call.
  on('ui.render', { component: 'ToolProgress' }, async ($, e, next) => {
    if (!(await isSplit($))) return next(e)
    return next({ ...e, props: { ...e.props, hint: '' } })
  })

  on('ui.render', { component: 'AssistantMessage' }, async ($, e, next) => {
    if (!(await isSplit($))) {
      noteOnScreen($, e.component, e.requestId, e.props.onScreen)
      return next(e)
    }
    const key = rowKey(e.requestId)
    const { value: isHidden } = await $.state.get({ ...HIDDEN, id: key })
    if (e.props.isSummary || isHidden === true) {
      // A hidden row places no one.
      noteOnScreen($, e.component, e.requestId, null)
      return nothing($, e)
    }
    noteOnScreen($, e.component, e.requestId, e.props.onScreen)
    // The answer's first block opens the reply, the notes above it hidden.
    const turn = model.owners.get(key)
    if (turn !== undefined && !e.props.isFirstOfReply && e.requestId.length === 36 && answerIds(model, turn)[0] === key) {
      return next({ ...e, props: { ...e.props, isFirstOfReply: true } })
    }
    return next(e)
  })

  // Each prompt that had work behind it gets a line under it: what the work
  // came to, lit while the pane shows it; a click shows it there, and a
  // second click lets the pane follow the transcript again.
  on('ui.render', { component: 'UserMessage' }, async ($, e, next) => {
    noteOnScreen($, e.component, e.requestId, e.props.onScreen)
    if (!(await isSplit($))) return next(e)
    const turns = await read($, turnsAtom)
    const turn = turns.find(t => t.id === rowKey(e.requestId))
    if (!turn || (turn.tools === 0 && !turn.isRunning)) return next(e)
    const [pinned, inView] = await Promise.all([read($, pinnedAtom), read($, inViewAtom)])
    const isShown = shownTurn(turns, pinned, inView)?.id === turn.id
    const drawn = await next(e)
    const { Box, Button, Text } = $.ui.resolve(e)
    return (
      <Box flexDirection="column">
        {drawn}
        <Box paddingLeft={2}>
          <Button key={`turn-${turn.id}`} plain onPress={() => void holdTurn($, isShown && pinned === turn.id ? null : turn.id)}>
            <Text color={isShown ? 'claude' : undefined} dimColor={!isShown}>
              {`⎿  ${turnFacts(turn).join(' · ')}`}
            </Text>
            <Text color="claude">{isShown ? (pinned === turn.id ? '  ▸ Details (held)' : '  ▸ Details') : ''}</Text>
          </Button>
        </Box>
      </Box>
    )
  })

  // ---- the right ----

  on('ui.close', { id: PANE }, async ($, e, next) => {
    const closed = await next(e)
    // Closed by hand: the details go back into the transcript.
    await update($, modeAtom, mode => ({ ...mode, isShown: false, isOff: mode.isOff || e.origin.kind === 'person' }))
    return closed
  })

  on('ui.render', { component: 'Pane', requestId: PANE }, async ($, e) => {
    const { Text } = $.ui.resolve(e)
    const [turns, pinned, inView, open, mode, folded] = await Promise.all([
      read($, turnsAtom),
      read($, pinnedAtom),
      read($, inViewAtom),
      read($, openAtom),
      read($, modeAtom),
      read($, foldedAtom),
    ])
    noteSeat($, e, mode)
    const turn = shownTurn(turns, pinned, inView)
    if (folded.includes(e.surface)) return drawFolded($, e, turns, turn)
    if (!turn) {
      return <Text dimColor>The work behind each answer shows here: tool calls, the notes between them, thinking.</Text>
    }
    // Another turn: start at its top.
    if (paneTurn !== turn.id) {
      if (paneTurn !== undefined) $.clock.after(0, () => void $.ui.scroll({ to: 'start', in: PANE }).catch(() => undefined))
      paneTurn = turn.id
    }
    const { value } = await $.state.get({ ...STEPS, id: turn.id })
    const steps = value ?? []
    return drawPane($, e, turns, turn, steps, pinned, open, await styledNotes($, e, steps))
  })

  // Its section of the mod settings pane (/mods). Before what is beneath, so
  // mod-settings's Close stays last.
  on('ui.render', { component: 'Pane', requestId: MODS_PANE }, async ($, e, next) => {
    const drawn = await next(e)
    const mode = await read($, modeAtom)
    const { Box, Text, Button } = $.ui.resolve(e)
    const value = mode.isOff ? 'off' : 'on'
    const options = [
      { value: 'on', label: 'On: tool calls beside the transcript' },
      { value: 'off', label: 'Off: everything in the transcript' },
    ]
    const choose = async (chosen: string) => {
      if (chosen === 'off') await turnOff($)
      else await turnOn($)
    }
    // The mobile app draws no Select (its table hands out one that draws
    // nothing): there, and on any surface not known to, each choice is a
    // button, the one in force marked.
    let control
    if (e.surface === 'terminal' || e.surface === 'desktop' || e.surface === 'vscode') {
      const { Select } = $.ui.resolve(e)
      control = <Select key="mods-split" label="Details pane" value={value} options={options} onSelect={choose} />
    } else {
      control = (
        <Box flexDirection="column">
          <Text>Details pane</Text>
          {options.map(option => (
            <Button key={`mods-split-${option.value}`} plain dimColor={option.value !== value} onPress={() => void choose(option.value)}>
              <Text color={option.value === value ? 'claude' : undefined}>{option.value === value ? '● ' : '○ '}</Text>
              {option.label}
            </Button>
          ))}
        </Box>
      )
    }
    const section = (
      <Box flexDirection="column" marginBottom={1}>
        <Text bold>QA split</Text>
        {control}
      </Box>
    )
    return drawn ? (
      <Box flexDirection="column">
        {section}
        {drawn}
      </Box>
    ) : (
      section
    )
  })

  on('command.run', { command: 'qa-split' }, async ($, e) => {
    const arg = e.args.trim().toLowerCase()
    if (arg === 'off') {
      await turnOff($)
      return { text: 'qa-split is off: tool calls and notes show in the transcript again. /qa-split turns it back on.' }
    }
    if (arg === 'debug') {
      const mode = await read($, modeAtom)
      return {
        text: [
          `mode: ${JSON.stringify(mode)}`,
          `turns: ${model.turns.length}, hidden notes: ${hiddenIds(model).length}, rows on screen: ${onScreen.size}, in view: ${lastInView ?? 'none'}`,
          `pane: ${lastSeat || 'not drawn yet'}`,
        ].join('\n'),
      }
    }
    if (arg !== '' && arg !== 'on') return { text: 'Usage: /qa-split [on|off]' }
    const placed = await turnOn($)
    return {
      text: placed.isPlaced
        ? 'qa-split is on: the conversation stays here, the work behind each answer is in the Details pane.'
        : `The Details pane waits to be drawn: ${placed.reason}`,
    }
  })
}
