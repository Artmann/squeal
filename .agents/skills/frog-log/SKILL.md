---
name: frog-log
description: Write a friction entry. Run `frog log --help` for usage details.
requires_bin: frog
command: frog log
---

# frog log

Write a friction entry.

## Arguments

| Name    | Type     | Required | Description                              |
| ------- | -------- | -------- | ---------------------------------------- |
| `title` | `string` | no       | One line, specific enough to search for. |

## Environment Variables

| Name             | Type     | Required | Default | Description                                            |
| ---------------- | -------- | -------- | ------- | ------------------------------------------------------ |
| `EDITOR`         | `string` | no       |         | Editor opened for the body when running interactively. |
| `GH_TOKEN`       | `string` | no       |         | Fallback when GITHUB_TOKEN is unset.                   |
| `GITHUB_API_URL` | `string` | no       |         | API base URL. Set automatically inside Actions.        |
| `GITHUB_TOKEN`   | `string` | no       |         | Token used by --publish.                               |
| `VISUAL`         | `string` | no       |         | Overrides EDITOR when both are set.                    |

## Options

| Flag         | Type      | Default | Description                                                                                                                                       |
| ------------ | --------- | ------- | ------------------------------------------------------------------------------------------------------------------------------------------------- |
| `--body`     | `string`  |         | Complete Markdown body. Must preserve this repository issue form when one exists. Also read from piped input, or from an editor when interactive. |
| `--cwd`      | `string`  |         | Directory to run in. Defaults to the working directory.                                                                                           |
| `--force`    | `boolean` |         | Log it even if a similar entry already exists.                                                                                                    |
| `--label`    | `array`   |         | Extra issue label. Repeatable.                                                                                                                    |
| `--open`     | `boolean` |         | Open $EDITOR on the entry after writing it.                                                                                                       |
| `--publish`  | `boolean` |         | File the issue immediately instead of leaving it for `publish`.                                                                                   |
| `--severity` | `string`  |         | Impact. Defaults to minor.                                                                                                                        |
| `--token`    | `string`  |         | GitHub token. Overrides the environment.                                                                                                          |
| `--target`   | `string`  |         | Upstream npm package or GitHub repository as `owner/repo`. Omit for this repository.                                                              |

## Output

| Field       | Type     | Required | Description                                                                 |
| ----------- | -------- | -------- | --------------------------------------------------------------------------- |
| `artifacts` | `string` | no       | Directory for reproduction files. Not created until something writes there. |
| `file`      | `string` | yes      | Store location of the entry.                                                |
| `id`        | `string` | yes      |                                                                             |
| `issue`     | `string` | no       | Linked issue, when --publish filed one.                                     |
| `title`     | `string` | yes      |                                                                             |
| `unfiled`   | `string` | no       | Why --publish did not file an issue. The entry is written either way.       |

## Examples

```sh
# Log friction in this repository
frog log `pnpm test -- <files>` ignores file filters

# Log friction in an upstream library
frog log `getBalance` rejects a checksummed address --severity major --target viem
```

> Run `frog list` first: this friction may already be recorded.
