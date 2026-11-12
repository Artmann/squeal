---
title: 'npx frog list and npx frog log both fail, so friction has to be logged by hand'
severity: 'minor'
---

### Expected Behavior

`npx frog list` lists the entries and `npx frog log` writes one, as `CLAUDE.md`
says to do.

### Current Behavior

- `npx frog list` stops with `MALFORMED_ENTRY`: "Entry
  `20260830125059-the-logger-mock` has no valid YAML frontmatter block", although
  that entry opens with a `---` frontmatter block. Its title is a folded
  multi-line string, which may be what the parser rejects.
- `npx frog log <title> --body <body>` stops with `STORE_ROOT_MISMATCH`: "The
  injected file store must use the same root as `--cwd`." Passing `--cwd` with
  the Windows path of the worktree gives the same error. Seen in a `git worktree`
  on Windows.

### Possible Solution

Put the logger-mock entry's title on one line. Check whether `frog` resolves its
store root from the main worktree rather than the current one.
