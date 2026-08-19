# Sikumi Observer for Grok Build

This plugin reports session, file, command, subagent, and worktree metadata to Sikumi-local.

It does not start, stop, or manage Grok Build. ACP is not used.

The plugin provides a Claude Code compatible `hooks/hooks.json` component. Sikumi never treats plugin or config files as ready. Ready is only after Sikumi receives a real event.
