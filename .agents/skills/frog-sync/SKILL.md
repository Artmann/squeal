---
name: frog-sync
description:
  Reconcile entries against issue state. Run `frog sync --help` for usage
  details.
requires_bin: frog
command: frog sync
---

# frog sync

Reconcile entries against issue state.

## Environment Variables

| Name             | Type     | Required | Default | Description                                               |
| ---------------- | -------- | -------- | ------- | --------------------------------------------------------- |
| `GH_TOKEN`       | `string` | no       |         | Fallback when GITHUB_TOKEN is unset.                      |
| `GITHUB_API_URL` | `string` | no       |         | API base URL. Set automatically inside Actions.           |
| `GITHUB_TOKEN`   | `string` | no       |         | Token used to read issues. Falls back to `gh auth token`. |

## Options

| Flag               | Type      | Default | Description                                                                 |
| ------------------ | --------- | ------- | --------------------------------------------------------------------------- |
| `--commit`         | `boolean` |         | Commit the changes. On by default; pass `--no-commit` to leave them staged. |
| `--cwd`            | `string`  |         | Directory to run in. Defaults to the working directory.                     |
| `--dryRun`         | `boolean` |         | Report what would change without changing it.                               |
| `--expectedAuthor` | `string`  |         | Issue author trusted by automated reconciliation.                           |
| `--state`          | `string`  |         | Content-free reconciliation state from the Frog GitHub App.                 |
| `--token`          | `string`  |         | GitHub token. Overrides the environment.                                    |

## Output

| Field               | Type      | Required | Description                                                                     |
| ------------------- | --------- | -------- | ------------------------------------------------------------------------------- |
| `cleared`           | `array`   | yes      | Entries whose issue is gone. Their link was removed and they are pending again. |
| `cleared[].id`      | `string`  | yes      |                                                                                 |
| `cleared[].title`   | `string`  | yes      |                                                                                 |
| `committed`         | `boolean` | yes      |                                                                                 |
| `deferred`          | `array`   | yes      | Entries left unreconciled, and why.                                             |
| `deferred[].code`   | `string`  | yes      |                                                                                 |
| `deferred[].id`     | `string`  | yes      |                                                                                 |
| `deferred[].reason` | `string`  | yes      |                                                                                 |
| `reopened`          | `array`   | yes      | Entries rebuilt after their issues reopened.                                    |
| `reopened[].id`     | `string`  | yes      |                                                                                 |
| `reopened[].title`  | `string`  | yes      |                                                                                 |
| `removed`           | `array`   | yes      | Entries whose issue closed. The friction is resolved.                           |
| `removed[].id`      | `string`  | yes      |                                                                                 |
| `removed[].title`   | `string`  | yes      |                                                                                 |
| `updated`           | `array`   | yes      | Entries rewritten from their issue, or rebuilt.                                 |
| `updated[].id`      | `string`  | yes      |                                                                                 |
| `updated[].title`   | `string`  | yes      |                                                                                 |

## Examples

```sh
# Reconcile against issue state
frog sync

# See what would change
frog sync --dryRun true
```

> Safe to run repeatedly. Issue state takes precedence.
