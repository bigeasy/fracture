describe('fracture', () => {
    const assert = require('assert')
    it('can fracture', async () => {
        const test = []
        const Destructible = require('destructible')
        const destructible = new Destructible('test/fracture.test.js')
        const Fracture = require('..')
        let now = 0
        const fracture = new Fracture(destructible, {
            turnstiles: 3,
            extractor: body => body,
            Date: { now: () => now },
            timeout: 1
        })
        const futures = {}
        function addFuture(name) {
            futures[name] = {}
            futures[name].promise = new Promise(resolve => futures[name].resolve = resolve)
        }
        [ 'first', 'second', 'third' ].map(name => addFuture(name))
        fracture.enter(async (value, state) => {
            test.push(state)
            futures.first.resolve(value)
            await futures.second.promise
        }, 'a')
        await new Promise(resolve => setImmediate(resolve))
        // This will reject because it is going to push and then be timed out.
        fracture.enter(async function (value, state) {
            test.push(state)
        }, 1, { property: 1 }, -3)
        fracture.enter(async function (value, state) {
            test.push(state)
            futures.third.resolve(this.property + value)
        }, 1, { property: 1 }, 0)
        assert.equal(await futures.first.promise, 'a', 'first work')
        futures.second.resolve()
        assert.equal(await futures.third.promise, 2, 'second work')
        fracture.destroy()
        await destructible.promise
        assert.deepStrictEqual(test, [{
            canceled: false,
            timedout: false,
            waited: 0,
            when: 0
        }, {
            canceled: true,
            timedout: true,
            waited: 3,
            when: -3
        }, {
            canceled: false,
            timedout: false,
            waited: 0,
            when: 0
        }], 'states')
    })
})
