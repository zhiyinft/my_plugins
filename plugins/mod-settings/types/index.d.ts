declare module 'claude-code' {
  interface PluginState {
    // Bumped after a change to a setting the pane draws from /config, so the
    // pane draws again: /config rows are not $.state, so reading them
    // subscribes nothing.
    'mod-settings': { changed: number }
  }
}
