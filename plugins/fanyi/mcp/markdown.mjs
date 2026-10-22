// Splits Markdown into the plain-text pieces a machine translator should see, and puts the
// translated pieces back. Code blocks, inline code, links' targets, URLs, list markers,
// headings, quotes and table pipes never reach the translator, so it can't mangle them.
// Also finds the diagrams a reply draws as pictures, so they can be kept out of translation.

const FENCE = /^\s*(```|~~~)/
// Leading list markers, task boxes, heading hashes and quote marks, repeated (a quoted list)
const PREFIX = /^(?:\s*(?:[-*+]\s+\[[ xX]\]\s+|[-*+]\s+|\d+[.)]\s+|#{1,6}\s+|>\s?))*/
// Inline code, a link's target, a bare URL
const PROTECTED = /`[^`\n]+`|\]\([^)\s]+\)|https?:\/\/[^\s)>\]]+/g
const HAS_LETTER = /\p{L}/u
// Placeholders survive Apple Translation unchanged in every form tried; ⟦ ⟧ never occur in prose
const placeholder = (i) => `⟦${i}⟧`
const PLACEHOLDER = /⟦\s*(\d+)\s*⟧/g

/**
 * @param {string} text Markdown
 * @returns {{ segments: string[], rebuild: (translated: string[]) => string }}
 */
export function splitMarkdown(text) {
  const segments = []
  // Each output line is a list of literal strings and segment references
  const lines = []
  let inFence = false

  // Adds a piece of prose as a segment, its protected spans swapped for placeholders
  const prose = (s) => {
    const kept = []
    const masked = s.replace(PROTECTED, (m) => {
      kept.push(m)
      return placeholder(kept.length - 1)
    })
    if (!HAS_LETTER.test(masked.replace(PLACEHOLDER, ''))) return { literal: s }
    // Keep the surrounding spaces outside the segment; translators trim them
    const [, lead, body, trail] = masked.match(/^(\s*)([\s\S]*?)(\s*)$/)
    segments.push(body)
    return { segment: segments.length - 1, lead, trail, kept }
  }

  for (const line of text.split('\n')) {
    if (FENCE.test(line)) {
      inFence = !inFence
      lines.push([{ literal: line }])
      continue
    }
    if (inFence) {
      lines.push([{ literal: line }])
      continue
    }
    // A table row: each cell is translated on its own, the pipes kept
    if (/^\s*\|.*\|\s*$/.test(line)) {
      const cells = line.split('|')
      lines.push(cells.flatMap((cell, i) => (i ? [{ literal: '|' }, prose(cell)] : [prose(cell)])))
      continue
    }
    const prefix = line.match(PREFIX)[0]
    lines.push([{ literal: prefix }, prose(line.slice(prefix.length))])
  }

  const rebuild = (translated) =>
    lines
      .map((parts) =>
        parts
          .map((p) => {
            if ('literal' in p) return p.literal
            const out = (translated[p.segment] ?? segments[p.segment]).replace(PLACEHOLDER, (m, i) => p.kept[Number(i)] ?? m)
            return p.lead + out.trim() + p.trail
          })
          .join(''),
      )
      .join('\n')

  return { segments, rebuild }
}

// A fence's opening line: its run of backticks or tildes, then its language, read as prismantis
// reads it
const FENCE_OPEN = /^\s*(`{3,}|~{3,})\s*([\w+-]*)/
// The fenced blocks a renderer such as prismantis draws as pictures: Mermaid diagrams and text
// figures
const DIAGRAM = /^(?:mermaid|figure)$/i

// Whether a line closes the fence opened by `run`: the same character, at least as many times
const closes = (line, run) => {
  const t = line.trim()
  return t.length >= run.length && [...t].every((c) => c === run[0])
}

/**
 * The diagrams of a Markdown text, as offsets: each runs from its opening fence's line through its
 * closing one, or to the end when it isn't closed. A fence inside another block is that block's
 * code, not a diagram.
 * @param {string} text Markdown
 * @returns {{ start: number, end: number }[]}
 */
export function diagramsOf(text) {
  const spans = []
  let open = null
  let at = 0
  for (const line of text.split('\n')) {
    if (open) {
      if (closes(line, open.run)) {
        if (open.isDiagram) spans.push({ start: open.start, end: at + line.length })
        open = null
      }
    } else {
      const m = line.match(FENCE_OPEN)
      if (m) open = { run: m[1], start: at, isDiagram: DIAGRAM.test(m[2]) }
    }
    at += line.length + 1
  }
  if (open && open.isDiagram) spans.push({ start: open.start, end: text.length })
  return spans
}

/**
 * A Markdown text with its diagrams held out of translation, each swapped for a placeholder, and
 * `restore` putting them back into the translation. Once the translation is done, a diagram whose
 * placeholder it lost is added at its end; while it streams, a placeholder cut short is held back.
 * @param {string} text Markdown
 * @returns {{ text: string, restore: (translated: string, isDone?: boolean) => string } | null} null when it has no diagram
 */
export function holdDiagrams(text) {
  const spans = diagramsOf(text)
  if (!spans.length) return null
  const diagrams = spans.map(({ start, end }) => text.slice(start, end))
  let masked = ''
  let at = 0
  spans.forEach(({ start, end }, i) => {
    masked += text.slice(at, start) + placeholder(i)
    at = end
  })
  masked += text.slice(at)
  const restore = (translated, isDone = true) => {
    const put = new Set()
    // Each diagram on lines of its own, wherever the translation moved its placeholder
    const out = translated.replace(/[ \t]*⟦\s*(\d+)\s*⟧[ \t]*/g, (m, i, offset, s) => {
      const diagram = diagrams[Number(i)]
      if (diagram === undefined) return m
      put.add(Number(i))
      const before = offset > 0 && s[offset - 1] !== '\n' ? '\n' : ''
      const after = offset + m.length < s.length && s[offset + m.length] !== '\n' ? '\n' : ''
      return before + diagram + after
    })
    if (!isDone) return out.replace(/⟦\s*\d*\s*$/, '')
    const lost = diagrams.filter((_, i) => !put.has(i))
    return lost.length ? [out.trimEnd(), ...lost].join('\n\n') : out
  }
  return { text: masked, restore }
}

/**
 * The prose of a Markdown text: code blocks, inline code, link targets and URLs removed. What
 * language checks should look at, so identifiers and commands don't count as English.
 * @param {string} text Markdown
 * @returns {string}
 */
export function proseOf(text) {
  let inFence = false
  return text
    .split('\n')
    .filter((line) => {
      if (FENCE.test(line)) {
        inFence = !inFence
        return false
      }
      return !inFence
    })
    .join('\n')
    .replace(PROTECTED, ' ')
}
