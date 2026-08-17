---
name: frog-resolve
description:
  Remove one resolved friction entry. Run `frog resolve --help` for usage
  details.
requires_bin: frog
command: frog resolve
---

# frog resolve

Remove one resolved friction entry.

## Arguments

| Name | Type     | Required | Description                      |
| ---- | -------- | -------- | -------------------------------- |
| `id` | `string` | yes      | Exact entry id from `frog list`. |

## Options

| Flag    | Type     | Default | Description                                             |
| ------- | -------- | ------- | ------------------------------------------------------- |
| `--cwd` | `string` |         | Directory to run in. Defaults to the working directory. |

## Output

| Field     | Type      | Required | Description |
| --------- | --------- | -------- | ----------- |
| `id`      | `string`  | yes      |             |
| `removed` | `boolean` | yes      |             |

## Examples

```sh
# Mark one entry resolved
frog resolve 20260803000000-example
```
