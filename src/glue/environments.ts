// Re-exported from the API contract so the renderer keeps one import path
// for environment shapes.
import type { EnvironmentDto } from './api/schemas'

export type { EnvironmentDto } from './api/schemas'

/**
 * The hues the settings screen offers. A fixed set rather than a free slider:
 * the badge composes one lightness and one chroma for every hue, and a slider
 * would let the user land somewhere those two do not flatter — a yellow at the
 * chroma that suits a blue reads washed out in light mode and muddy in dark.
 *
 * Roughly red, amber, green, cyan, blue, violet. The first three are the ones
 * the shipped environments use.
 */
export const environmentHues = [25, 70, 152, 195, 262, 310]

/**
 * The environment a connection is labelled with, or undefined.
 *
 * Undefined covers both "no environment" and "an environment that has since
 * been deleted": a connection keeps its `environmentId` until the delete's
 * transaction clears it, and a renderer holding a list from before that
 * would otherwise have to treat a miss as an error. It is not an error — it
 * is a connection with no badge.
 */
export function findEnvironment(
  environments: readonly EnvironmentDto[],
  environmentId: string | null
): EnvironmentDto | undefined {
  if (environmentId === null) {
    return undefined
  }

  return environments.find((environment) => environment.id === environmentId)
}
