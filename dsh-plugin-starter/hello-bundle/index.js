/**
 * Host half of the hello bundle.
 *
 * A Harness plugin is a module exporting `apply`. Everything registered through
 * `ctx` (listeners, tools, timers) is disposed automatically on unload; use
 * `ctx.effect()` only for resources that need an explicit disposer.
 */
export const name = 'hello-bundle'

export function apply(ctx) {
  ctx.effect(() => {
    const profile = process.env.DSH_PROFILE ?? '(no profile)'
    console.log(`[hello-bundle] loaded in profile ${profile}`)
    return () => console.log('[hello-bundle] unloaded')
  })
}
