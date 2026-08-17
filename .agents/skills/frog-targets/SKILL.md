---
name: frog-targets
description:
  List dependencies that accept friction reports. Run `frog targets --help` for
  usage details.
requires_bin: frog
command: frog targets
---

# frog targets

List dependencies that accept friction reports.

## Environment Variables

| Name             | Type     | Required | Default | Description                                     |
| ---------------- | -------- | -------- | ------- | ----------------------------------------------- |
| `GH_TOKEN`       | `string` | no       |         | Fallback when GITHUB_TOKEN is unset.            |
| `GITHUB_API_URL` | `string` | no       |         | API base URL. Set automatically inside Actions. |
| `XDG_CACHE_HOME` | `string` | no       |         | Where consent lookups are cached.               |
| `GITHUB_TOKEN`   | `string` | no       |         | Token used to read each dependency config.      |

## Options

| Flag      | Type     | Default | Description                                             |
| --------- | -------- | ------- | ------------------------------------------------------- |
| `--cwd`   | `string` |         | Directory to run in. Defaults to the working directory. |
| `--token` | `string` |         | GitHub token. Overrides the environment.                |

## Output

| Field            | Type     | Required | Description                     |
| ---------------- | -------- | -------- | ------------------------------- |
| `targets`        | `array`  | yes      |                                 |
| `targets[].name` | `string` | yes      | Package name.                   |
| `targets[].repo` | `string` | yes      | Repository issues are filed on. |

## Examples

```sh
# Which dependencies accept reports
frog targets
```

> Report to one of these with `frog log --target <name>`.
