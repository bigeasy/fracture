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
            worker: async ({ key, value }) => {
                if (key === 'a' && value.work) {
                    const pause = await fracture.pause('b')
                    const promise = fracture.pause('b')
                    pause.resume()
                    {
                        const pause = await promise
                        pause.resume()
                    }
                }
            }
        })

        fracture.enqueue('a').work = true
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
            worker: async ({ key, value }) => {
                throw new Error('thrown')
            }
        })

        fracture.enqueue('a').work = true
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

    {
        const destructible = new Destructible($ => $(), 5000, 'fracture')
        const turnstile = new Turnstile(destructible)

        const gathered = []
        const fracture = new Fracture(destructible.durable($ => $(), 'fracture'), {
            turnstile: turnstile,
            entry: () => ({ work: [] }),
            worker: async ({ key, value }) => gathered.push.apply(gathered, value.work)
        })

        fracture.enqueue('a').work.push('a')

        await fracture.drain()

        const pause = await fracture.pause('a')
        pause.resume()

        await destructible.destroy().promise
    }
})
