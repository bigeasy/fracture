// Not able to get all the edge cases in the `readme.t.js` and striving for them
// is making the `readme.t.js` less in instructive.
require('proof')(8, async okay => {
    const assert = require('assert')

    const rescue = require('rescue')

    const Future = require('perhaps')
    const Turnstile = require('turnstile')
    const Destructible = require('destructible')

    const Interrupt = require('interrupt')

    Interrupt.audit = () => {}

    const Fracture = require('..')

    // Minimal test.
    {
        const destructible = new Destructible($ => $(), 'fracture')
        const turnstile = new Turnstile(destructible.durable('turnstile'))

        const errors = []

        destructible.ephemeral('test', async () => {
            const fracture = new Fracture(destructible.durable($ => $(), 'fracture'), {
                turnstile: turnstile,
                value: () => [],
                worker: async ({ key, value, pause }) => {
                    return key
                }
            })

            okay(await fracture.enqueue(Fracture.stack(), 'a'), 'a', 'resolve')

            destructible.destroy()
        })

        await destructible.promise
    }

    // Error test.
    {
        const destructible = new Destructible($ => $(), 'fracture')
        const turnstile = new Turnstile(destructible.durable('turnstile'))

        const errors = []

        destructible.ephemeral('test', async () => {
            const fracture = new Fracture(destructible.durable($ => $(), 'fracture'), {
                turnstile: turnstile,
                value: () => [],
                worker: async ({ key, value, pause }) => {
                    throw new Error(key)
                }
            })

            try {
                await fracture.enqueue(Fracture.stack(), 'b')
            } catch (error) {
                errors.push(error.code)
            }

            destructible.destroy()
        })

        try {
            await destructible.promise
        } catch (error) {
            errors.push(error.code)
        }
        okay(errors, [ 'DESTROYED', 'ERRORED' ], 'reported')
    }

    // Displacable invocation.
    {
        const destructible = new Destructible($ => $(), 'fracture')
        const turnstile = new Turnstile(destructible.durable({ isolated: true }, 'turnstile'))

        const test = []
        destructible.ephemeral('test', async () => {
            const fracture = new Fracture(destructible.durable($ => $(), 'fracture'), {
                turnstile: turnstile,
                value: () => [],
                worker: async ({ key, value, stack }) => {
                    if (key == 'a') {
                        return await fracture.enqueue(stack, 'b', _value => _value.push(value[0]))
                    }
                    return value[0] + 1
                }
            })

            const result = await fracture.enqueue(Fracture.stack(), 'a', value => value.push(1))
            okay(result, 2, 'displaced')

            destructible.destroy()
        })

        await destructible.promise
    }

    // Pause test.
    {
        const destructible = new Destructible($ => $(), 'fracture')
        const turnstile = new Turnstile(destructible.durable({ isolated: true }, 'turnstile'))

        destructible.ephemeral('test', async () => {
            const blocks = { b: new Future, c: new Future }
            const expected = { b: [[ 1 ]], c: [] }
            const fracture = new Fracture(destructible.durable($ => $(), 'fracture'), {
                turnstile: turnstile,
                value: () => [],
                worker: async ({ key, value, pause }) => {
                    assert(key != 'a')
                    await blocks[key].promise
                    const paused = await pause('a')
                    okay(paused.values, expected[key], `expected values for ${key}`)
                    await new Promise(resolve => setTimeout(resolve, 50))
                    paused.resume()
                }
            })

            fracture.enqueue(Fracture.stack(), 'b')
            fracture.enqueue(Fracture.stack(), 'c')
            fracture.enqueue(Fracture.stack(), 'a', work => work.push(1))

            blocks.b.resolve(true)
            blocks.c.resolve(true)

            destructible.destroy()
        })

        await destructible.promise
    }

    // Pause race.
    {
        const destructible = new Destructible($ => $(), 'fracture')
        const turnstile = new Turnstile(destructible.durable({ isolated: true }, 'turnstile'), { strands: 2 })

        destructible.ephemeral('test', async () => {
            const fracture = new Fracture(destructible.durable($ => $(), 'fracture'), {
                turnstile: turnstile,
                value: () => [],
                worker: async ({ key, value, pause }) => {
                    const paused = await pause('c')
                    await new Promise(resolve => setTimeout(resolve, 50))
                    paused.resume()
                }
            })

            fracture.enqueue(Fracture.stack(), 'a')
            fracture.enqueue(Fracture.stack(), 'b')

            for (const promise of [ fracture.drain(), fracture.drain() ]) {
                await promise
            }

            destructible.destroy()
        })

        await destructible.promise
    }

    // Pause a working key.
    {
        const destructible = new Destructible($ => $(), 'fracture')
        const turnstile = new Turnstile(destructible.durable({ isolated: true }, 'turnstile'), { strands: 2 })

        destructible.ephemeral('test', async () => {
            const blocks = { a: new Future, b: new Future }
            const fracture = new Fracture(destructible.durable($ => $(), 'fracture'), {
                turnstile: turnstile,
                value: () => [],
                worker: async ({ key, value, pause }) => {
                    await blocks[key].promise
                    if (key == 'b') {
                        const paused = await pause('a')
                        await new Promise(resolve => setTimeout(resolve, 50))
                        paused.resume()
                    }
                }
            })

            fracture.enqueue(Fracture.stack(), 'a')
            fracture.enqueue(Fracture.stack(), 'b')

            await new Promise(resolve => setImmediate(resolve))

            blocks.b.resolve()
            blocks.a.resolve()

            destructible.destroy()
        })

        await destructible.promise
    }

    // Resume a paused key that has work.
    {
        const destructible = new Destructible($ => $(), 'fracture')
        const turnstile = new Turnstile(destructible.durable('turnstile'))

        const test = []
        destructible.ephemeral('test', async () => {
            const blocks = { a: new Future, b: Future.resolve() }
            const fracture = new Fracture(destructible.durable($ => $(), 'fracture'), {
                turnstile: turnstile,
                value: () => [],
                worker: async ({ key, value, pause }) => {
                    if (key == 'a') {
                        const paused = await pause('b')
                        await blocks[key].promise
                        await new Promise(resolve => setTimeout(resolve, 50))
                        paused.resume()
                    } else {
                        test.push(value)
                    }
                }
            })

            fracture.enqueue(Fracture.stack(), 'a')
            fracture.enqueue(Fracture.stack(), 'b')

            await new Promise(resolve => setImmediate(resolve))

            fracture.enqueue(Fracture.stack(), 'b', value => value.push(1))
            blocks.b.resolve()
            blocks.a.resolve()

            destructible.destroy()
        })

        await destructible.promise
        okay(test, [[ 1 ]], 'enqueue while paused')
    }

    // Enqueue onto existing entry.
    {
        const destructible = new Destructible($ => $(), 'fracture')
        const turnstile = new Turnstile(destructible.durable({ isolated: true }, 'turnstile'))

        const test = []
        destructible.ephemeral('test', async () => {
            const fracture = new Fracture(destructible.durable($ => $(), 'fracture'), {
                turnstile: turnstile,
                value: () => [],
                worker: async ({ key, value, pause }) => {
                    test.push(value)
                }
            })

            fracture.enqueue(Fracture.stack(), 'a', value => value.push(1))
            fracture.enqueue(Fracture.stack(), 'a', value => value.push(2))

            destructible.destroy()
        })

        await destructible.promise
        okay(test, [[ 1, 2 ]], 'enqueue into existing entry')
    }

    // Enqueue when there is a subsequent entry.
    {
        const destructible = new Destructible($ => $(), 'fracture')
        const turnstile = new Turnstile(destructible.durable({ isolated: true }, 'turnstile'))

        const test = []
        destructible.ephemeral('test', async () => {
            const block =new Future
            const fracture = new Fracture(destructible.durable($ => $(), 'fracture'), {
                turnstile: turnstile,
                value: () => [],
                worker: async ({ key, value, pause }) => {
                    await block.promise
                }
            })

            fracture.enqueue(Fracture.stack(), 'a')

            await new Promise(resolve => setImmediate(resolve))

            fracture.enqueue(Fracture.stack(), 'a')

            block.resolve()

            destructible.destroy()
        })

        await destructible.promise
    }

    // Error raised from within worker.
    {
        const destructible = new Destructible($ => $(), 'fracture')
        const turnstile = new Turnstile(destructible.durable({ isolated: true }, 'turnstile'))

        const test = []
        destructible.ephemeral('test', async () => {
            const fracture = new Fracture(destructible.durable($ => $(), 'fracture'), {
                turnstile: turnstile,
                value: () => [],
                worker: async ({ key, value, pause }) => {
                    throw new Error('errored')
                }
            })

            fracture.enqueue(Fracture.stack(), 'a')

            try {
                await fracture.enqueue(Fracture.stack(), 'b')
            } catch (error) {
                test.push(error.code)
            }

            destructible.destroy()
        })

        try {
            await destructible.promise
        } catch (error) {
            test.push(error.code)
        }
        okay(test, [ 'DESTROYED', 'ERRORED' ], 'error within worker function')
    }
})
