---
title: "frog log writes Markdown that the repo's own prettier --check rejects"
severity: 'minor'
---

## Expected Behavior

`npx frog log` writes an entry that passes this repository's own CI.

## Current Behavior

`ci.yml` runs `npx prettier --check .`, which covers `.agents/friction-log/**`.
The Markdown `frog log` writes is not prettier-formatted — long prose lines are
left unwrapped and the YAML `title:` stays on one line — so logging friction
turns the Format job red on the next push. Prettier's own fix rewraps the body
at 80 columns and folds the title across lines, which `frog list` still parses.

The failure surfaces a full CI round trip after the entry is written, and the
job that fails is unrelated to whatever the commit was about.

## Possible Solution

Either have `frog log` write prettier-compatible Markdown, or add
`.agents/friction-log` to `.prettierignore` — the entries are generated files,
and the repo already ignores other generated output.

## Minimal Reproducible Example

    npx frog log "some friction" --body "$(cat body.md)"
    npx prettier --check .    # warns on the new friction.md, exit 1

## Context

Cost a CI round trip on a PR whose own changes were clean, having run prettier
locally on every file the change touched — but not on the entry `frog` had just
written.
