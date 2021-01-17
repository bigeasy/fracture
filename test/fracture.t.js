// Not able to get all the edge cases in the `readme.t.js` and striving for them
// is making the `readme.t.js` less in instructive.
require('proof')(3, async okay => {
    const Fracture = require('..')
    const Turnstile = require('turnstile')
    const Destructible = require('destructible')

    const rescue = require('rescue')

    function latch () {
        let capture
        return { promise: new Promise(resolve => capture = { resolve }), ...capture }
    }

    {
        const destructible = new Destructible($ => $(), 5000, 'fracture')
        const turnstile = new Turnstile(destructible)

        const fracture = new Fracture(destructible.durable($ => $(), 'fracture'), {
            turnstile: turnstile,
            entry: () => ({
                work: false
            }),
            worker: async ({ key, entry, pause }) => {
                if (key === 'a' && entry.work) {
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

        fracture.enqueue('a').entry.work = true
        fracture.enqueue('b')
        okay('yes')

        for (const promise of [ fracture.drain(), fracture.drain() ]) {
            await promise
        }

        await destructible.destroy().promise
    }

    {
        const destructible = new Destructible($ => $(), 'fracture')
        const turnstile = new Turnstile(destructible.durable($ => $(), 'turnstile'))

        const fracture = new Fracture(destructible.durable($ => $(), 'fracture'), {
            turnstile: turnstile,
            entry: () => ({ work: false }),
            worker: async ({ key, entry }) => {
                throw new Error('thrown')
            }
        })

        fracture.enqueue('a').entry.work = true
        fracture.enqueue('b')
        okay('yes')

        for (const promise of [ fracture.drain(), fracture.drain() ]) {
            await promise
        }

        try {
            await destructible.destroy().promise
        } catch (error) {
            const errors = rescue(error, [ [ 0 ], 'thrown' ]).errors
            okay(errors.length, 1, 'caught an error for each bit of work')
        }
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
                entry: () => ({ value: 0 }),
                worker: async ({ key, entry, pause }) => {
                    if (key == 'two') {
                        const one = await pause('one')
                        for (const entry of one.entries) {
                            gathered.push(entry.value)
                            entry.value = 2
                        }
                        one.resume()
                    } else {
                        gathered.push(entry.value)
                    }
                }
            })

            fracture.enqueue('two')
            await 1

            fracture.enqueue('one').entry.value = 1

            await fracture.drain()

            okay(gathered, [ 1, 2 ], 'pause has sync state of one')

            destructible.destroy()
        })

        await destructible.promise
    }
})
