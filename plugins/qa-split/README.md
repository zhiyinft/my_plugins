# qa-split

Two panels for Claude Code. The transcript keeps the conversation: your prompts and Claude's answers. Everything behind an answer (each tool call, the notes Claude writes between calls, its thinking) moves to a **Details** pane docked beside it.

```
┌─ transcript ───────────────────────────┐┌─ Details ─────────────┐
│ > why does the band flicker?           ││ ◄ ►  1/2     follow ↓ │
│   ⎿  1m 4s · 6 tool calls  ▸ Details   ││ ❯ why does the band   │
│ ● It redraws on every tick...          ││   flicker?            │
│ > now add a test                       ││ ───────────────────── │
│   ⎿  working… · 3 tool calls           ││ │ Let me read the     │
│                                        ││ │ band code.          │
│                                        ││ ✓ Read hooks/band.tsx │
└────────────────────────────────────────┘└───────────────────────┘
```

## Use

- The pane shows the turn you are reading: the one at the top of the transcript, or the newest one when you are at the bottom.
- Under each prompt that had tool calls, a line sums up the work. Click it to show that turn in the pane; click again, or scroll to another turn, and the pane follows the transcript again.
- In the pane, click a tool call to see its input (edits as −/+ lines) and the start of its output. ◄ ► (`p` / `n` while the pane has focus) step through turns.
- A text block Claude writes before a tool call is a note and goes to the pane; the last text of a turn is the answer and stays in the transcript. Questions Claude asks you (`AskUserQuestion`) and plans to approve stay in the transcript too.
- `/qa-split off` puts everything back in the transcript; so does closing the pane. `/qa-split` turns it on again.

The pane docks beside the transcript in the fullscreen terminal. Opened at the start of a session it needs 144 columns; `/qa-split` opens it from 110. Narrower, or on the main screen, it sits above the prompt.

## With other mods

A row qa-split moves to the pane is drawn as an empty box in the transcript. prismantis and fanyi in this marketplace leave such a row alone: no styling, no translation. Rows that stay in the transcript are theirs as usual. Where prismantis is installed, the pane draws notes in its style.

## Install

```
/plugin install qa-split@my-plugins
```

## Privacy

qa-split reads this session's transcript file on your machine to list the turns from before it loaded, and sends nothing anywhere.
