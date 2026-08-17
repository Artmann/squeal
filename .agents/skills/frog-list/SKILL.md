---
name: frog-list
description:
  List entries with their state. Run `frog list --help` for usage details.
requires_bin: frog
command: frog list
---

# frog list

List entries with their state.

## Options

| Flag      | Type     | Default | Description                                             |
| --------- | -------- | ------- | ------------------------------------------------------- |
| `--cwd`   | `string` |         | Directory to run in. Defaults to the working directory. |
| `--since` | `string` |         | Only entries added since this git ref.                  |
| `--state` | `string` |         | Filter by state.                                        |

## Output

| Field                   | Type     | Required | Description                                                       |
| ----------------------- | -------- | -------- | ----------------------------------------------------------------- |
| `entries`               | `array`  | yes      |                                                                   |
| `entries[].artifacts`   | `array`  | no       | Reproduction files, when the entry has any. Runnable as they are. |
| `entries[].id`          | `string` | yes      |                                                                   |
| `entries[].occurrences` | `number` | no       | Times observed, when tracked.                                     |
| `entries[].issue`       | `string` | no       | Linked issue, absent while pending.                               |
| `entries[].severity`    | `string` | yes      |                                                                   |
| `entries[].state`       | `string` | yes      |                                                                   |
| `entries[].target`      | `string` | no       | Absent means this repository.                                     |
| `entries[].title`       | `string` | yes      |                                                                   |
| `linked`                | `number` | yes      | Entries already filed as issues.                                  |
| `pending`               | `number` | yes      | Entries not filed yet.                                            |

## Examples

```sh
# Everything recorded
frog list

# Only what is not filed yet
frog list --state pending

# Only what this branch added
frog list --since main
```
