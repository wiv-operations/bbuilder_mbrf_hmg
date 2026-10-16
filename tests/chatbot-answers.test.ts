import { flowtest } from 'bbuilder/test'

// Each flowtest talks to the published bot as a fresh contact. Run them with
// `bbuilder test`, or `bbuilder test --publish` to publish the local flows first.
flowtest('answers a greeting', async ctx => {
    await ctx.user.send('hi')
    await ctx.user.text.received()
})
