# mod-settings

One settings entry for the mods in this marketplace, so none of them needs a line of its own above the prompt.

- **The badge**, at the right of the prompt footer: each installed mod's state in a glyph or two, then `⚙ mods`. fanyi shows `译`, in color while on and dim while off, a click switching translation; with its translation-only layout a `原` beside it switches the originals. prompt-rail shows the number of prompts (`┃12`, dim while the rail is off). `⚙ mods` opens the pane.
- **The pane** (`⚙`, or `/mods`): each mod's everyday switches. fanyi: translation, layout, originals, and **More fanyi settings…**. Prompt rail: above the prompt, beside the transcript, or off. QA split: the Details pane on or off. Prismantis: on or off; its themes and styles stay in `/config`.

## How a mod joins

A mod adds its section by hooking `ui.render` on `{ component: 'Pane', requestId: 'mod-settings' }`, and its badge segment on `{ component: 'SessionMode' }`. In both it draws its own part first, then what `next(e)` returned beneath it, so this mod's rows and `Close` (and `⚙ mods`) stay last whatever order the mods load in. Each part's handlers are the mod's own, so it writes only its own settings. A mod that is not installed simply has no section.

prismantis loads nothing while it is off, so its switch is drawn here, as its `prismantis.enabled` row of `/config`.
