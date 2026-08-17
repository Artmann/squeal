---
name: frog-init
description:
  Create the friction log, config, and issue form. Run `frog init --help` for
  usage details.
requires_bin: frog
command: frog init
---

# frog init

Create the friction log, config, and issue form.

## Environment Variables

| Name                    | Type     | Required | Default | Description                                                      |
| ----------------------- | -------- | -------- | ------- | ---------------------------------------------------------------- |
| `npm_config_user_agent` | `string` | no       |         | Package-manager user agent used to select the Frog command.      |
| `npm_execpath`          | `string` | no       |         | Package-manager executable path used to select the Frog command. |

## Options

| Flag        | Type      | Default | Description                                                                                  |
| ----------- | --------- | ------- | -------------------------------------------------------------------------------------------- |
| `--cwd`     | `string`  |         | Directory to run in. Defaults to the working directory.                                      |
| `--inbound` | `boolean` | `true`  | Accept friction reported by other repositories. Pass `--no-inbound` to disable during setup. |

## Output

| Field      | Type    | Required | Description       |
| ---------- | ------- | -------- | ----------------- |
| `created`  | `array` | yes      | Files written.    |
| `existing` | `array` | yes      | Files left alone. |

## Examples

```sh
# Set up Frog
frog init
```
