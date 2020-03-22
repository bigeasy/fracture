require('proof')(3, prove)

async function prove (okay) {
    const test = []
    const Destructible = require('destructible')
    const destructible = new Destructible('test/fracture.test.js')
    const Fracture = require('..')
    new Fracture(destructible.ephemeral('defaults')).terminate()
    const fracture = new Fracture(destructible.durable('fracture'), {
        turnstiles: 3,
        Date: { now: () => 0 },
        timeout: 1
    })
    destructible.durable('test', async function () {
        await fracture.drain()
        const futures = {}
        function addFuture(name) {
            futures[name] = {}
            futures[name].promise = new Promise(resolve => futures[name].resolve = resolve)
        }
        [ 'first', 'second', 'third' ].forEach(name => addFuture(name))
        fracture.enter({
            method: async (entry) => {
                test.push(entry)
                futures.first.resolve(entry.body)
                await futures.second.promise
            },
            body: 'a',
            vargs: [ 0 ]
        })
        await new Promise(resolve => setImmediate(resolve))
        // This will reject because it is going to push and then be timed out.
        fracture.enter({
            method: async function (entry) {
                test.push(entry)
            },
            body: 1,
            object: { property: 1 },
            when: -3,
            vargs: [ 0 ]
        })
        fracture.enter({
            method: async function (entry) {
                test.push(entry)
            },
            body: 1,
            object: { property: 1 },
            when: -3,
            vargs: [ 0 ]
        })
        fracture.enter({
            method: async function (entry) {
                test.push(entry)
                futures.third.resolve(this.property + entry.body)
            },
            body: 1,
            object: { property: 1 },
            when: 0,
            vargs: [ 0 ]
        })
        okay(await futures.first.promise, 'a', 'first work')
        futures.second.resolve()
        okay(await futures.third.promise, 2, 'second work')
        const drains = [ fracture.drain(), fracture.drain() ]
        for (const drain of drains) {
            await drain
        }
        okay(test, [{
            canceled: false,
            timedout: false,
            waited: 0,
            when: 0,
            vargs: [ 0 ],
            body: 'a'
        }, {
            body: 1,
            canceled: true,
            timedout: true,
            waited: 3,
            when: -3,
            vargs: [ 0 ]
        }, {
            body: 1,
            canceled: true,
            timedout: true,
            waited: 3,
            when: -3,
            vargs: [ 0 ]
        }, {
            body: 1,
            canceled: false,
            timedout: false,
            waited: 0,
            when: 0,
            vargs: [ 0 ]
        }], 'states')
        await fracture.terminate()
    }())

    await destructible.destructed
}
