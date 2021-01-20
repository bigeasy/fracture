// Not able to get all the edge cases in the `readme.t.js` and striving for them
// is making the `readme.t.js` less in instructive.
require('proof')(5, async okay => {
    const rescue = require('rescue')

    const Future = require('perhaps')
    const Turnstile = require('turnstile')
    const Destructible = require('destructible')

    const Fracture = require('..')

    function latch () {
        let capture
        return { promise: new Promise(resolve => capture = { resolve }), ...capture }
    }

    {
        const destructible = new Destructible($ => $(), 'fracture')
        const turnstile = new Turnstile(destructible.durable({ isolated: true }, 'turnstile'))

        destructible.ephemeral('test', async () => {
            const fracture = new Fracture(destructible.durable($ => $(), 'fracture'), {
                turnstile: turnstile,
                value: () => ({
                    work: false
                }),
                worker: async ({ key, value, pause }) => {
                    if (key === 'a' && value.work) {
                        const _pause = await pause('b')
                        const promise = pause('b')
                        _pause.resume()
                        {
                            const _pause = await promise
                            _pause.resume()
                        }
                    }
                }
            })

            fracture.enqueue('a').value.work = true
            fracture.enqueue('b')
            okay('yes')

            for (const promise of [ fracture.drain(), fracture.drain() ]) {
                console.log('draining')
                await promise
            }
        })

        await destructible.destroy().promise
    }

    {
        const destructible = new Destructible($ => $(), 'fracture')
        const turnstile = new Turnstile(destructible.durable($ => $(), { isolated: true }, 'turnstile'))

        const test = []

        destructible.ephemeral($ => $(), 'test', async () => {
            const fracture = new Fracture(destructible.durable($ => $(), 'fracture'), {
                turnstile: turnstile,
                value: () => ({ work: false }),
                worker: async ({ key, value }) => {
                    throw new Error('thrown')
                }
            })
            fracture.enqueue('a')
            try {
                await fracture.enqueue('b').future.promise
            } catch (error) {
                rescue(error, [{ symbol: Destructible.Error.DESTROYED }])
                test.push('destroyed')
            }
            await fracture.drain()
        })

        try {
            await destructible.destroy().promise
        } catch (error) {
            rescue(error, [ 'thrown' ])
            test.push('thrown')
        }

        okay(test, [ 'destroyed', 'thrown' ], 'error and destroyed')
    }
    //

    // Pulled Fracture concepts out of Strata. Didn't pull them out correctly.
    // Pause is supposed to be your synchronous time spent with the queue
    // contents for a given key. Pause was constructed with a copy of the
    // content and then returned from an `async` function. That is a race
    // because the contents of the queue can change before the `Promise`
    // returned from the function resolves.

    //
    {
        const destructible = new Destructible($ => $(), 'fracture')

        destructible.ephemeral($ => $(), 'test', async () => {
            const gathered = []

            const turnstile = new Turnstile(destructible.durable($ => $(), 'turnstile'))
            const fracture = new Fracture(destructible.durable($ => $(), 'fracture'), {
                turnstile: turnstile,
                value: () => ({ value: 0 }),
                worker: async ({ key, value, pause }) => {
                    if (key == 'two') {
                        const one = await pause('one')
                        for (const value of one.entries) {
                            gathered.push(value.value)
                            value.value = 2
                        }
                        one.resume()
                    } else {
                        gathered.push(value.value)
                    }
                }
            })

            fracture.enqueue('two')
            await 1

            fracture.enqueue('one').value.value = 1

            await fracture.drain()

            okay(gathered, [ 1, 2 ], 'pause has sync state of one')

            destructible.destroy()
        })

        await destructible.promise
    }

    {
        const destructible = new Destructible($ => $(), 5000, 'fracture')
        const turnstile = new Turnstile(destructible)

        const completions = new Fracture.FutureSet

        const gathered = []

        let work = 0

        const fracture = new Fracture(destructible.durable($ => $(), 'fracture'), {
            turnstile: turnstile,
            value: () => ({
                work: work++,
                latch: latch()
            }),
            worker: async ({ key, value, pause }) => {
                if (key == 'b') {
                    await value.latch.promise
                }
                gathered.push(value.work)
            }
        })

        completions.add(fracture.enqueue('a').future)
        completions.add(fracture.enqueue('a').future)
        completions.add(fracture.enqueue('b').future)

        const b = fracture.enqueue('b')

        okay(completions.size, 2, 'completion set size')

        await fracture.enqueue('a').future.promise
        completions.prune()

        b.value.latch.resolve()

        await completions.join()

        okay(gathered, [ 0, 1 ], 'completion set')

        await destructible.destroy().promise
    }

    {
        const completions = Fracture.NULL_FUTURE_SET
        completions.add()
        completions.prune()
        completions.join()
    }
})
