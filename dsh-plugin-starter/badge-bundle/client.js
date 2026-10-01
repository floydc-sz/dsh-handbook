/**
 * Client half: this exact shape is what the Web module loader evaluates.
 * `require('react')` is provided by the Harness client runtime; the plugin must
 * not import Harness Client packages (for example ui-primitives) itself.
 */
window.__ModuleLoader__.load({
  id: '@local/dsh-badge-bundle',
  factory(require) {
    const React = require('react')
    const h = React.createElement

    function Badge() {
      return h(
        'div',
        {
          'aria-hidden': true,
          style: {
            display: 'inline-flex',
            alignItems: 'center',
            gap: 6,
            padding: '2px 8px',
            borderRadius: 999,
            fontSize: 12,
            lineHeight: '18px',
            color: 'var(--dsh-text-secondary, #6b7280)',
            background: 'var(--dsh-fill-tertiary, rgba(127,127,127,0.12))',
            pointerEvents: 'none',
            userSelect: 'none',
          },
        },
        h('span', {
          style: {
            width: 8,
            height: 8,
            borderRadius: '50%',
            background: '#2ea043',
            display: 'inline-block',
          },
        }),
        'badge-bundle 已加载',
      )
    }

    return {
      inject: ['slots'],
      apply(ctx) {
        ctx.slots.inject('conversation.composer.dock', () =>
          ctx.slots.register(
            {
              name: 'conversation.composer.dock',
              id: 'dsh-badge-bundle',
              order: 5,
            },
            Badge,
          ),
        )
      },
    }
  },
})
