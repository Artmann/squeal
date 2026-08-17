---
name: frog-publish
description:
  Publish friction entries as GitHub issues. Run `frog publish --help` for usage
  details.
requires_bin: frog
command: frog publish
---

# frog publish

Publish friction entries as GitHub issues.

## Environment Variables

| Name             | Type     | Required | Default | Description                                               |
| ---------------- | -------- | -------- | ------- | --------------------------------------------------------- |
| `GH_TOKEN`       | `string` | no       |         | Fallback when GITHUB_TOKEN is unset.                      |
| `GITHUB_API_URL` | `string` | no       |         | API base URL. Set automatically inside Actions.           |
| `GITHUB_TOKEN`   | `string` | no       |         | Token used to file issues. Falls back to `gh auth token`. |

## Options

| Flag               | Type      | Default | Description                                                                     |
| ------------------ | --------- | ------- | ------------------------------------------------------------------------------- |
| `--commit`         | `boolean` |         | Commit the issue links. On by default; pass `--no-commit` to leave them staged. |
| `--cwd`            | `string`  |         | Directory to run in. Defaults to the working directory.                         |
| `--dryRun`         | `boolean` |         | Report what would be filed without filing it.                                   |
| `--expectedAuthor` | `string`  |         | Issue author trusted for automated matching and replay markers.                 |
| `--max`            | `number`  |         | Ceiling for this run. Defaults to the `maxPerRun` config value.                 |
| `--pr`             | `string`  |         | Pull request this is filed from, as `owner/name#number` or a bare number.       |
| `--token`          | `string`  |         | GitHub token. Overrides the environment.                                        |

## Output

| Field               | Type      | Required | Description                                                          |
| ------------------- | --------- | -------- | -------------------------------------------------------------------- |
| `commented`         | `array`   | yes      | Entries that landed on an issue that already covered them.           |
| `commented[].id`    | `string`  | yes      |                                                                      |
| `commented[].issue` | `string`  | yes      |                                                                      |
| `commented[].title` | `string`  | yes      |                                                                      |
| `committed`         | `boolean` | yes      | Whether the issue links were committed.                              |
| `created`           | `array`   | yes      |                                                                      |
| `created[].id`      | `string`  | yes      |                                                                      |
| `created[].issue`   | `string`  | yes      |                                                                      |
| `created[].title`   | `string`  | yes      |                                                                      |
| `deferred`          | `array`   | yes      | Entries left pending, and why.                                       |
| `deferred[].code`   | `string`  | yes      |                                                                      |
| `deferred[].id`     | `string`  | yes      |                                                                      |
| `deferred[].reason` | `string`  | yes      |                                                                      |
| `unlabelled`        | `array`   | yes      | Destinations that dropped the labels. This token cannot label there. |

## Examples

```sh
# File everything pending
frog publish

# See what would be filed
frog publish --dryRun true
```

> Needs a token: GITHUB_TOKEN, GH_TOKEN, --token, or an authenticated `gh`.
