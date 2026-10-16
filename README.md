# my_plugins

My customized Claude Code plugins, mods and skills, published as one plugin marketplace.

## Plugins

| Plugin | What it does | Origin |
| :- | :- | :- |
| [fanyi](plugins/fanyi) | Mod: write to Claude in your own language, get streamed translations of every reply | Fork of [JrCx7scC/claude-code-fanyi](https://github.com/JrCx7scC/claude-code-fanyi) `main` |

## Install

```bash
claude plugin marketplace add zhiyinft/my_plugins
claude plugin install <plugin>@my-plugins
```

From a local checkout instead: `claude plugin marketplace add D:/projects/my_plugins`.

## Layout

```
.claude-plugin/marketplace.json   the marketplace: one entry per plugin
plugins/<name>/                   one plugin each, with its own .claude-plugin/plugin.json
```

## Adding a plugin

**My own:** create `plugins/<name>/` with a `.claude-plugin/plugin.json`, then add an entry to `.claude-plugin/marketplace.json`:

```json
{ "name": "<name>", "source": "./plugins/<name>", "description": "..." }
```

**Forked from another repo:** vendor it with `git subtree` so it can be edited here and still take upstream changes:

```bash
git subtree add --prefix=plugins/<name> <upstream-git-url> <branch> --squash
```

Then add the marketplace entry and a row to the table above, with the upstream URL in the Origin column.

## Syncing forks with upstream

```bash
git subtree pull --prefix=plugins/<name> <upstream-git-url> <branch> --squash
```

Local edits are merged with upstream's; conflicts are resolved like any merge. Always pass `--squash` for a prefix that was added with it.

For fanyi:

```bash
git subtree pull --prefix=plugins/fanyi https://github.com/JrCx7scC/claude-code-fanyi.git main --squash
```

## Checking

```bash
claude plugin validate .claude-plugin/marketplace.json
claude plugin validate plugins/<name>/.claude-plugin/plugin.json
claude --plugin-dir plugins/<name>     # try one plugin for a session without installing
```
