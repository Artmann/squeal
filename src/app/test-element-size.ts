import { vi } from 'vitest'

/**
 * jsdom reports every element as 0×0, which makes a virtualized list decide it
 * has no visible window and render nothing. Giving elements a real size lets
 * `@tanstack/react-virtual` compute a window the way a browser would.
 *
 * Call from `beforeEach` in any test that renders virtualized content.
 */
export function stubElementSize({
  height = 600,
  width = 800
}: {
  height?: number
  width?: number
} = {}): void {
  vi.spyOn(Element.prototype, 'getBoundingClientRect').mockImplementation(
    function (this: Element): DOMRect {
      return {
        bottom: height,
        height,
        left: 0,
        right: width,
        toJSON: () => ({}),
        top: 0,
        width,
        x: 0,
        y: 0
      } as DOMRect
    }
  )

  for (const [property, value] of [
    ['clientHeight', height],
    ['clientWidth', width],
    ['offsetHeight', height],
    ['offsetWidth', width]
  ] as const) {
    Object.defineProperty(HTMLElement.prototype, property, {
      configurable: true,
      value
    })
  }
}
