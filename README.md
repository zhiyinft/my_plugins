# my_plugins

My customized Claude Code plugins and mods, published as one plugin marketplace, `my-plugins`. Installs follow `main`: commit and push a change, and every machine with the marketplace on auto-update picks it up.

## Plugins

| Plugin | Kind | What it does | Origin |
| :- | :- | :- | :- |
| [fanyi](plugins/fanyi) | mod | Write to Claude in your own language; every reply gets a streamed translation | Fork of [JrCx7scC/claude-code-fanyi](https://github.com/JrCx7scC/claude-code-fanyi) |
| [prompt-rail](plugins/prompt-rail) | mod | A rail of the session's prompts: hover to read one, click to jump to it | Fork of [oikon48/prompt-rail](https://github.com/oikon48/prompt-rail) (`plugins/prompt-rail`) |

**Plugins and mods:** a plugin is the package you install, a folder with a `.claude-plugin/plugin.json`. It can carry skills, slash commands, agents, MCP servers and hooks. A mod is a plugin with a JavaScript/TypeScript hooks module that runs inside Claude Code, so it can draw UI (panes, bars, toggles) and change prompts and replies as they pass. Every mod is a plugin; a plugin of only skills is not a mod.

## Install on a machine

```bash
claude plugin marketplace add zhiyinft/my_plugins
claude plugin install fanyi@my-plugins
claude plugin install prompt-rail@my-plugins
```

Then turn on auto-update for the marketplace: in `/plugin`, open **Marketplaces**, select `my-plugins` and choose **Enable auto-update**. Or set it in `~/.claude/settings.json`:

```json
"extraKnownMarketplaces": {
  "my-plugins": {
    "source": { "source": "github", "repo": "zhiyinft/my_plugins" },
    "autoUpdate": true
  }
}
```

Don't also install a plugin from its upstream marketplace: two copies of a mod both run, so for fanyi every reply would be translated twice.

## Changing a plugin

1. Edit it under `plugins/<name>/`. To try it for one session without installing, run `claude --plugin-dir plugins/<name>`; a mod reloads on save.
2. Commit and push to `main`.
3. In each session that starts after the push, Claude Code refreshes the marketplace within ten minutes of the first message and updates the installed plugins. The running session keeps the old code until `/reload-plugins` or the next launch. To update right away instead:

   ```bash
   claude plugin marketplace update my-plugins
   claude plugin update <name>@my-plugins
   ```

No plugin here sets `version` in its `plugin.json`. Without one, Claude Code versions a plugin by its git commit, so every push is an update. A pinned version would hold installs back until someone bumped it. `claude plugin validate` warns about the missing version; that's expected.

The [Validate](.github/workflows/validate.yml) workflow validates the marketplace and every plugin, and runs each mod's tests, on every push. It doesn't stop a push from reaching installs, so fix a red run promptly.

## Adding a plugin

**My own:** create `plugins/<name>/` with a `.claude-plugin/plugin.json` (no `version`), then add an entry to [.claude-plugin/marketplace.json](.claude-plugin/marketplace.json) and a row to the table above:

```json
{ "name": "<name>", "source": "./plugins/<name>", "description": "..." }
```

**A fork of someone else's:** import it with [scripts/vendor.mjs](scripts/vendor.mjs), which needs only git and Node:

```bash
node scripts/vendor.mjs add plugins/<name> <repo-url>
```

Options: `--branch <branch>` (default `main`); `--path <dir>` when the plugin is a folder of the upstream repo rather than its root; `--file <path>`, repeatable, to also bring an upstream file into the plugin's root, such as a `LICENSE` that lives at the upstream repo's root. The import leaves `version` out of `plugin.json` and records the upstream in [upstreams.json](upstreams.json). Then add the marketplace entry and the table row.

## Pulling upstream changes into forks

```bash
node scripts/vendor.mjs sync                       # every fork
node scripts/vendor.mjs sync plugins/<name>        # one fork
```

Each fork is merged with upstream's changes since its last import, so local edits stay. Conflicts are resolved like in any merge; finish with `git commit`.

## Layout

```
.claude-plugin/marketplace.json   the marketplace: one entry per plugin
plugins/<name>/                   one plugin each, with its own .claude-plugin/plugin.json
upstreams.json                    where each fork comes from
scripts/vendor.mjs                imports forks and merges their upstream changes
.github/workflows/validate.yml    validates and tests every plugin on push
```
