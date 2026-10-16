# my_plugins

My Claude Code plugins and mods, as the marketplace `my-plugins`. Installs auto-update from `main`.

| Plugin | Fork of |
| :- | :- |
| fanyi | [JrCx7scC/claude-code-fanyi](https://github.com/JrCx7scC/claude-code-fanyi) |
| prompt-rail | [oikon48/prompt-rail](https://github.com/oikon48/prompt-rail) |
| prismantis | [NahumLitvin/prismantis](https://github.com/NahumLitvin/prismantis) |

## Setup on a machine

```bash
claude plugin marketplace add zhiyinft/my_plugins
claude plugin install <plugin>@my-plugins
```

Then add `"autoUpdate": true` to the `my-plugins` entry under `extraKnownMarketplaces` in `~/.claude/settings.json`. Don't also install a plugin from its upstream marketplace.

## Workflow

- Try a change: `claude --plugin-dir plugins/<name>`
- Ship it: commit and push. Sessions pick it up within ~10 min of the first message (`/reload-plugins` in a running one). Right away: `claude plugin marketplace update my-plugins` then `claude plugin update <name>@my-plugins`.
- Plugins have no `version` in `plugin.json`, so each commit is a new version. Keep it that way.
- Fork a plugin: `node scripts/vendor.mjs add plugins/<name> <repo-url> [--path <dir>] [--file <path>] [--exclude <pathspec>]`, then add it to `.claude-plugin/marketplace.json`.
- Pull upstream changes into forks: `node scripts/vendor.mjs sync [plugins/<name>]`
