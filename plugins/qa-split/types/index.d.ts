// One line of a tool call's expanded detail: `add` and `del` for an edit's
// new and old text, `dim` for an aside.
export type QaLine = { text: string; tone?: 'add' | 'del' | 'dim' }

// One thing that happened in a turn, in order. A `say` is a text block of the
// reply: `isAnswer` while it is part of the answer shown on the left, false
// once a tool call followed it (it is then an in-between note, shown here).
export type QaStep =
  | { kind: 'say'; id: string; text: string; isAnswer: boolean }
  | { kind: 'think'; id: string; text: string }
  | {
      kind: 'tool'
      id: string
      tool: string
      summary: string
      detail: QaLine[]
      output?: string
      status: 'running' | 'done' | 'error' | 'stopped'
    }

// One prompt and what answered it; `id` is the prompt row's key.
export type QaTurn = {
  id: string
  text: string
  isRunning: boolean
  durationMs?: number
  tools: number
  errors: number
}

// Whether rows are hidden on the left: only while the split is on, the pane
// has been drawn, and the main conversation (not a subagent's) is in view.
export type QaMode = { isOff: boolean; isShown: boolean; agent: string | null }

declare module 'claude-code' {
  interface PluginState {
    'qa-split': {
      turns: QaTurn[]
      steps: StateFamily<QaStep[]>
      hidden: StateFamily<boolean>
      mode: QaMode
      // The turn the pane is held on by ◄ ►; null follows the transcript.
      pinned: string | null
      // The turn the transcript shows most of, where the surface says.
      inView: string | null
      // The steps expanded in the pane, by id.
      open: string[]
    }
  }
}
