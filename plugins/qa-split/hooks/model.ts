import type { QaLine, QaStep, QaTurn } from '../types'

// The conversation as turns: each prompt, then everything that answered it in
// order. Built from the rows the session stores (live through session.append,
// or read back from the transcript file on resume), and mirrored into $.state
// by the module, which writes what each change marks dirty.

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

// The key rows are matched by. A row the engine draws in several parts is
// drawn under ids derived from its stored uuid, the first four groups kept and
// the last replaced, so a uuid is matched by those groups; any other id (a
// tool_use id) as it is.
export const rowKey = (id: string) => (UUID.test(id) ? id.slice(0, 24) : id)

// Tools whose rows are part of the conversation itself and stay on the left: a
// question put to the person, a plan for them to approve.
export const CONVERSATIONAL = new Set(['AskUserQuestion', 'ExitPlanMode'])

// Older turns drop out of the pane past this many.
const MAX_TURNS = 300
// What a step keeps of a tool's result, and of its input.
const MAX_OUTPUT = 2400
const MAX_DETAIL_LINES = 16
const MAX_LINE = 400

// The id of the turn that collects rows stored before any prompt.
const OPENING = 'opening'

export type Block = {
  type?: string
  text?: string
  thinking?: string
  id?: string
  name?: string
  input?: unknown
  tool_use_id?: string
  content?: unknown
  is_error?: boolean
}

export type Model = {
  cwd: string
  turns: QaTurn[]
  steps: Map<string, QaStep[]>
  // Row key, or tool_use id, -> the id of the turn it belongs to.
  owners: Map<string, string>
  dirtyTurns: boolean
  dirtySteps: Set<string>
  // Row keys newly hidden on the left, not yet written.
  hide: Set<string>
}

export const emptyModel = (cwd = ''): Model => ({
  cwd,
  turns: [],
  steps: new Map(),
  owners: new Map(),
  dirtyTurns: false,
  dirtySteps: new Set(),
  hide: new Set(),
})

// The model again from what $.state held (after a hot reload of the module).
export const restoreModel = (cwd: string, turns: QaTurn[], steps: Map<string, QaStep[]>): Model => {
  const m = emptyModel(cwd)
  m.turns = turns.map(turn => ({ ...turn }))
  for (const turn of m.turns) {
    const list = (steps.get(turn.id) ?? []).map(step => ({ ...step }))
    m.steps.set(turn.id, list)
    m.owners.set(turn.id, turn.id)
    for (const step of list) m.owners.set(step.id, turn.id)
  }
  return m
}

// ---- text helpers ----

// Terminal cells a character takes: two for East Asian wide and emoji ranges.
const cells = (char: string) => {
  const code = char.codePointAt(0) ?? 0
  if (code < 0x1100) return 1
  if (
    (code >= 0x1100 && code <= 0x115f) ||
    (code >= 0x2e80 && code <= 0xa4cf) ||
    (code >= 0xac00 && code <= 0xd7a3) ||
    (code >= 0xf900 && code <= 0xfaff) ||
    (code >= 0xfe30 && code <= 0xfe4f) ||
    (code >= 0xff00 && code <= 0xff60) ||
    (code >= 0xffe0 && code <= 0xffe6) ||
    (code >= 0x1f300 && code <= 0x1faff) ||
    (code >= 0x20000 && code <= 0x3fffd)
  ) {
    return 2
  }
  return 1
}

export const cellWidth = (text: string) => {
  let width = 0
  for (const char of text) width += cells(char)
  return width
}

// One line of at most `width` cells, an ellipsis where it was cut.
export const oneLine = (text: string, width: number) => {
  const flat = text.replace(/\s+/g, ' ').trim()
  if (width <= 0) return ''
  if (cellWidth(flat) <= width) return flat
  let out = ''
  let used = 0
  for (const char of flat) {
    const w = cells(char)
    if (used + w > width - 1) break
    out += char
    used += w
  }
  return `${out}…`
}

const cut = (text: string, max: number) => (text.length > max ? `${text.slice(0, max)}…` : text)

// A path under the session's folder, relative to it; any other as given.
export const shortPath = (path: string, cwd: string) => {
  const p = path.replace(/\\/g, '/')
  const base = cwd.replace(/\\/g, '/').replace(/\/+$/, '')
  if (base && p.toLowerCase().startsWith(`${base.toLowerCase()}/`)) return p.slice(base.length + 1)
  return p
}

// The prompt as the person typed it, without what the engine wraps around it.
export const promptText = (raw: string) => {
  const command = /<command-name>\/?([^<]*)<\/command-name>/.exec(raw)
  if (command) {
    const args = /<command-args>([\s\S]*?)<\/command-args>/.exec(raw)?.[1]?.trim()
    return `/${command[1]!.trim()}${args ? ` ${args}` : ''}`
  }
  if (/^\s*<task-notification>/.test(raw)) {
    const summary = /<summary>([\s\S]*?)<\/summary>/.exec(raw)?.[1]?.trim()
    return `Background task: ${summary ?? 'finished'}`
  }
  return raw
    .replace(/^\s*<artifact-view-context[\s\S]*?<\/artifact-view-context>/, '')
    .replace(/<system-reminder>[\s\S]*?<\/system-reminder>/g, '')
    .trim()
}

// User rows that are the engine's wrapping, not a prompt.
const isWrapper = (raw: string) => /^\s*(<local-command-|<system-reminder>|<bash-|<user-prompt-submit-hook>|\[Request interrupted)/.test(raw)

const textOf = (content: unknown): string => {
  if (typeof content === 'string') return content
  if (!Array.isArray(content)) return ''
  return content
    .map(block => (block && typeof block === 'object' && (block as Block).type === 'text' ? ((block as Block).text ?? '') : ''))
    .filter(Boolean)
    .join('\n')
}

const blocksOf = (content: unknown): Block[] => {
  if (typeof content === 'string') return [{ type: 'text', text: content }]
  return Array.isArray(content) ? (content.filter(block => block && typeof block === 'object') as Block[]) : []
}

// ---- what a tool call shows ----

const str = (value: unknown) => (typeof value === 'string' ? value : undefined)
const field = (input: unknown, key: string) => (input && typeof input === 'object' ? str((input as Record<string, unknown>)[key]) : undefined)

// The call on one line: its command, its file, its pattern.
export const summarize = (tool: string, input: unknown, cwd: string): string => {
  const path = field(input, 'file_path') ?? field(input, 'notebook_path') ?? field(input, 'path')
  switch (tool) {
    case 'Bash':
    case 'PowerShell':
      return field(input, 'description') ?? field(input, 'command') ?? ''
    case 'Read':
    case 'Write':
    case 'Edit':
    case 'NotebookEdit':
      return path ? shortPath(path, cwd) : ''
    case 'Grep': {
      const pattern = field(input, 'pattern') ?? ''
      const where = field(input, 'path') ?? field(input, 'glob')
      return where ? `${pattern}  in ${shortPath(where, cwd)}` : pattern
    }
    case 'Glob':
      return field(input, 'pattern') ?? ''
    case 'WebFetch':
      return field(input, 'url') ?? ''
    case 'WebSearch':
      return field(input, 'query') ?? ''
    case 'Agent':
    case 'Task':
      return field(input, 'description') ?? field(input, 'subagent_type') ?? ''
    case 'Skill':
      return field(input, 'skill') ?? ''
    case 'ToolSearch':
      return field(input, 'query') ?? ''
  }
  if (input && typeof input === 'object') {
    for (const value of Object.values(input as Record<string, unknown>)) if (typeof value === 'string' && value.trim()) return value
  }
  return ''
}

const linesOf = (text: string, tone?: QaLine['tone'], max = MAX_DETAIL_LINES): QaLine[] => {
  const all = text.split(/\r?\n/)
  const kept = all.slice(0, max).map(line => ({ text: cut(line, MAX_LINE), ...(tone ? { tone } : {}) }))
  if (all.length > max) kept.push({ text: `… ${all.length - max} more lines`, tone: 'dim' })
  return kept
}

// The call's input as the pane's expanded step draws it.
export const details = (tool: string, input: unknown, cwd: string): QaLine[] => {
  const path = field(input, 'file_path')
  switch (tool) {
    case 'Bash':
    case 'PowerShell': {
      const command = field(input, 'command') ?? ''
      return linesOf(command)
    }
    case 'Edit': {
      const before = field(input, 'old_string') ?? ''
      const after = field(input, 'new_string') ?? ''
      return [
        ...(path ? [{ text: shortPath(path, cwd), tone: 'dim' as const }] : []),
        ...linesOf(before, 'del', 8).map(line => (line.tone === 'dim' ? line : { ...line, text: `- ${line.text}` })),
        ...linesOf(after, 'add', 8).map(line => (line.tone === 'dim' ? line : { ...line, text: `+ ${line.text}` })),
      ]
    }
    case 'Write': {
      const content = field(input, 'content') ?? ''
      return [...(path ? [{ text: shortPath(path, cwd), tone: 'dim' as const }] : []), ...linesOf(content, 'add', 10)]
    }
    case 'Agent':
    case 'Task':
      return linesOf(field(input, 'prompt') ?? '', undefined, 10)
  }
  if (input === undefined) return []
  let json = ''
  try {
    json = JSON.stringify(input, null, 1) ?? ''
  } catch {
    json = ''
  }
  return linesOf(cut(json, 1600), 'dim')
}

// A tool_result's content as text, kept short.
export const resultText = (content: unknown): string => {
  const text = typeof content === 'string' ? content : Array.isArray(content) ? textOf(content) || (content.some(b => (b as Block)?.type === 'image') ? '[image]' : '') : ''
  return cut(text.replace(/\s+$/, ''), MAX_OUTPUT)
}

// ---- building the turns ----

const replaceTurn = (m: Model, id: string, change: (turn: QaTurn) => QaTurn) => {
  const i = m.turns.findIndex(turn => turn.id === id)
  if (i < 0) return
  m.turns[i] = change(m.turns[i]!)
  m.dirtyTurns = true
}

const lastTurn = (m: Model): QaTurn => {
  const last = m.turns[m.turns.length - 1]
  if (last) return last
  const opening: QaTurn = { id: OPENING, text: '(before the first prompt)', isRunning: false, tools: 0, errors: 0 }
  m.turns.push(opening)
  m.steps.set(OPENING, [])
  m.owners.set(OPENING, OPENING)
  m.dirtyTurns = true
  return opening
}

// A turn's running calls end when the turn does.
const stopRunning = (m: Model, id: string) => {
  const steps = m.steps.get(id)
  if (!steps?.some(step => step.kind === 'tool' && step.status === 'running')) return
  m.steps.set(
    id,
    steps.map(step => (step.kind === 'tool' && step.status === 'running' ? { ...step, status: 'stopped' as const } : step)),
  )
  m.dirtySteps.add(id)
}

export const startTurn = (m: Model, uuid: string, raw: string) => {
  const id = rowKey(uuid)
  const text = promptText(raw)
  if (!text || m.owners.has(id)) return
  for (const turn of m.turns) {
    if (turn.isRunning) {
      replaceTurn(m, turn.id, t => ({ ...t, isRunning: false }))
      stopRunning(m, turn.id)
    }
  }
  m.turns.push({ id, text, isRunning: false, tools: 0, errors: 0 })
  m.steps.set(id, [])
  m.owners.set(id, id)
  m.dirtyTurns = true
  m.dirtySteps.add(id)
  while (m.turns.length > MAX_TURNS) {
    const gone = m.turns.shift()!
    for (const step of m.steps.get(gone.id) ?? []) m.owners.delete(step.id)
    m.owners.delete(gone.id)
    m.steps.delete(gone.id)
  }
}

export const markRunning = (m: Model, isRunning: boolean, durationMs?: number) => {
  const turn = m.turns[m.turns.length - 1]
  if (!turn) return
  replaceTurn(m, turn.id, t => ({ ...t, isRunning, ...(durationMs !== undefined ? { durationMs } : {}) }))
  if (!isRunning) stopRunning(m, turn.id)
}

export const addResponse = (m: Model, uuid: string, content: unknown) => {
  const turn = lastTurn(m)
  const steps = m.steps.get(turn.id)!
  const key = rowKey(uuid)
  let tools = 0
  for (const [i, block] of blocksOf(content).entries()) {
    if (block.type === 'text' && block.text?.trim()) {
      if (steps.some(step => step.kind === 'say' && step.id === key)) continue
      steps.push({ kind: 'say', id: key, text: block.text, isAnswer: true })
      m.owners.set(key, turn.id)
    } else if (block.type === 'thinking' && block.thinking?.trim()) {
      const id = `${key}#${i}`
      if (steps.some(step => step.id === id)) continue
      steps.push({ kind: 'think', id, text: block.thinking })
    } else if (block.type === 'tool_use' && block.id) {
      if (m.owners.has(block.id)) continue
      // A call after a text block makes that text an in-between note.
      for (const [j, step] of steps.entries()) {
        if (step.kind === 'say' && step.isAnswer) {
          steps[j] = { ...step, isAnswer: false }
          m.hide.add(step.id)
        }
      }
      const tool = block.name ?? 'tool'
      steps.push({
        kind: 'tool',
        id: block.id,
        tool,
        summary: summarize(tool, block.input, m.cwd),
        detail: details(tool, block.input, m.cwd),
        status: 'running',
      })
      m.owners.set(block.id, turn.id)
      tools += 1
    } else {
      continue
    }
    m.dirtySteps.add(turn.id)
  }
  if (tools > 0) replaceTurn(m, turn.id, t => ({ ...t, tools: t.tools + tools }))
}

export const addResults = (m: Model, content: unknown) => {
  for (const block of blocksOf(content)) {
    if (block.type !== 'tool_result' || !block.tool_use_id) continue
    const turnId = m.owners.get(block.tool_use_id)
    const steps = turnId === undefined ? undefined : m.steps.get(turnId)
    const i = steps?.findIndex(step => step.kind === 'tool' && step.id === block.tool_use_id) ?? -1
    const step = steps?.[i]
    if (!steps || !step || step.kind !== 'tool') continue
    const isError = block.is_error === true
    steps[i] = { ...step, status: isError ? 'error' : 'done', output: resultText(block.content) }
    m.dirtySteps.add(turnId!)
    if (isError) replaceTurn(m, turnId!, t => ({ ...t, errors: t.errors + 1 }))
  }
}

// ---- the rows ----

// A row as session.append hands it.
export type LiveRow = {
  door: string
  uuid: string
  message: { type: string; isMeta?: true; content: unknown }
  origin?: { kind: string }
}

export const ingestLive = (m: Model, row: LiveRow) => {
  const { door, uuid, message } = row
  if (door === 'prompt' && message.type === 'user' && !message.isMeta) {
    const raw = textOf(message.content)
    if (row.origin?.kind === 'task-notification' || !isWrapper(raw)) startTurn(m, uuid, raw)
  } else if (door === 'command' && message.type === 'user') {
    const raw = textOf(message.content)
    if (raw.includes('<command-name>')) startTurn(m, uuid, raw)
  } else if (door === 'response' && message.type === 'assistant') {
    addResponse(m, uuid, message.content)
  } else if (door === 'tool-result') {
    addResults(m, message.content)
  }
}

type FileRow = {
  type?: string
  subtype?: string
  uuid?: string
  parentUuid?: string | null
  isSidechain?: boolean
  isMeta?: boolean
  durationMs?: number
  message?: { content?: unknown }
}

// The turns of a transcript file (one JSON row per line), on the branch its
// last row continues: rows rewound away are left out.
export const fromTranscript = (text: string, cwd: string): Model => {
  const rows: FileRow[] = []
  for (const line of text.split('\n')) {
    if (!line.trim()) continue
    try {
      const row = JSON.parse(line) as FileRow
      if (row && typeof row === 'object' && typeof row.uuid === 'string') rows.push(row)
    } catch {
      // A torn last line while the engine appends.
    }
  }
  const byId = new Map(rows.map(row => [row.uuid!, row]))
  const live = new Set<string>()
  let row: FileRow | undefined = rows[rows.length - 1]
  while (row && !live.has(row.uuid!)) {
    live.add(row.uuid!)
    row = row.parentUuid ? byId.get(row.parentUuid) : undefined
  }
  const m = emptyModel(cwd)
  for (const r of rows) {
    if (!live.has(r.uuid!) || r.isSidechain) continue
    const content = r.message?.content
    if (r.type === 'user') {
      const blocks = blocksOf(content)
      if (blocks.some(block => block.type === 'tool_result')) {
        addResults(m, content)
        continue
      }
      const raw = textOf(content)
      if (r.isMeta && !raw.includes('<command-name>')) continue
      if (raw.includes('<command-name>') || /^\s*<task-notification>/.test(raw) || !isWrapper(raw)) startTurn(m, r.uuid!, raw)
    } else if (r.type === 'assistant') {
      addResponse(m, r.uuid!, content)
    } else if (r.type === 'system' && r.subtype === 'turn_duration' && typeof r.durationMs === 'number') {
      markRunning(m, false, r.durationMs)
    }
  }
  for (const turn of m.turns) if (turn.isRunning) markRunning(m, false)
  return m
}

// The text blocks of a turn shown on the left, in order.
export const answerIds = (m: Model, turnId: string) =>
  (m.steps.get(turnId) ?? []).flatMap(step => (step.kind === 'say' && step.isAnswer ? [step.id] : []))

// Every row key hidden on the left: the in-between notes of every turn.
export const hiddenIds = (m: Model) =>
  m.turns.flatMap(turn => (m.steps.get(turn.id) ?? []).flatMap(step => (step.kind === 'say' && !step.isAnswer ? [step.id] : [])))

// The turn the pane shows: the one held, else the one in view, else the newest.
export const shownTurn = (turns: readonly QaTurn[], pinned: string | null, inView: string | null) =>
  turns.find(turn => turn.id === pinned) ?? turns.find(turn => turn.id === inView) ?? turns[turns.length - 1]

// ---- which turn the transcript shows ----

// A transcript row's last onScreen report: the turn it belongs to (an index
// into the turns), the part of it on screen, and when it said so.
export type Sighting = { turn: number; first: number; last: number; of: number; order: number }

// Fewer of a turn's rows than this at the viewport's top read as the tail of
// a turn scrolled past, so the turn below it is the one being read.
const TAIL_ROWS = 3

// The turn being read, and the rows whose reports are stale.
//
// A row reports where it is only when that changes, and one that leaves the
// viewport may never say so (it unmounts), so the reports alone overstate
// what shows. Two rows place the viewport: the one last said to be cut at its
// top is the top row, so a row of an earlier turn heard before it has left;
// the one last said to be cut at its bottom is the bottom row, so a row of a
// later turn heard before it has left. With those dropped: at the end (every
// row of the newest turn on screen to its last row) the newest turn is read;
// otherwise the one at the top, unless only its tail shows there.
export const readingTurn = (seen: ReadonlyMap<string, Sighting>, newest: number) => {
  const rows = [...seen.entries()]
  const latest = (cut: (row: Sighting) => boolean) =>
    rows.reduce<Sighting | undefined>((best, [, row]) => (cut(row) && (!best || row.order > best.order) ? row : best), undefined)
  const top = latest(row => row.first > 0)
  const bottom = latest(row => row.last < row.of - 1)
  const stale = rows.flatMap(([name, row]) =>
    (top && row.turn < top.turn && row.order < top.order) || (bottom && row.turn > bottom.turn && row.order < bottom.order) ? [name] : [],
  )
  const live = rows.filter(([name]) => !stale.includes(name)).map(([, row]) => row)
  if (live.length === 0) return { turn: undefined, stale }
  const tail = live.filter(row => row.turn === newest)
  if (tail.length > 0 && tail.every(row => row.last >= row.of - 1)) return { turn: newest, stale }
  const turns = [...new Set(live.map(row => row.turn))].sort((a, b) => a - b)
  const first = turns[0]!
  const rowsOfFirst = live.filter(row => row.turn === first)
  const isCut = rowsOfFirst.some(row => row.first > 0)
  const shown = rowsOfFirst.reduce((sum, row) => sum + row.last - row.first + 1, 0)
  const turn = isCut && shown < TAIL_ROWS && turns.length > 1 ? turns[1]! : first
  return { turn, stale }
}

// "1m 4s", "12s".
export const duration = (ms: number) => {
  const s = Math.round(ms / 1000)
  if (s < 60) return `${s}s`
  const m = Math.floor(s / 60)
  return m < 60 ? `${m}m ${s % 60}s` : `${Math.floor(m / 60)}h ${m % 60}m`
}
