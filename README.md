# my_plugins

My Claude Code plugins and mods, as the marketplace `my-plugins`. Installs auto-update from `main` when a plugin's version goes up.

| Plugin | Fork of |
| :- | :- |
| fanyi | [JrCx7scC/claude-code-fanyi](https://github.com/JrCx7scC/claude-code-fanyi) |
| prompt-rail | [oikon48/prompt-rail](https://github.com/oikon48/prompt-rail) |
| prismantis | [NahumLitvin/prismantis](https://github.com/NahumLitvin/prismantis) |
| qa-split | none: written here |
| mod-settings | none: written here |

## Setup on a machine

```bash
claude plugin marketplace add zhiyinft/my_plugins
claude plugin install <plugin>@my-plugins
```

Then add `"autoUpdate": true` to the `my-plugins` entry under `extraKnownMarketplaces` in `~/.claude/settings.json`. Don't also install a plugin from its upstream marketplace.

## Workflow

- Try a change: `claude --plugin-dir plugins/<name>`
- Ship it: bump the plugin's `version` in `plugins/<name>/.claude-plugin/plugin.json`, then commit and push. Sessions pick it up within ~10 min of the first message (`/reload-plugins` in a running one). Right away: `claude plugin marketplace update my-plugins` then `claude plugin update <name>@my-plugins`.
- Installs update only when the version goes up, so bump it with every change to a plugin: patch for a fix, minor for a feature, major for a change that breaks settings or habits. `node scripts/check-versions.mjs` checks this before you push, and CI checks each push.
- Fork a plugin: `node scripts/vendor.mjs add plugins/<name> <repo-url> [--path <dir>] [--file <path>] [--exclude <pathspec>]`, then add it to `.claude-plugin/marketplace.json`.
- Pull upstream changes into forks: `node scripts/vendor.mjs sync [plugins/<name>]`, then bump each synced plugin's version. Upstream's own version is left out.
