require('proof')(2, require('cadence')(prove))

function prove (async, assert) {
    var Fracture = require('..')
    var expect = [{
        envelope: {
            module: 'turnstile',
            method: 'enter',
            when: 0,
            waited: 0,
            timedout: false,
            body: { id: 1 }
        },
        message: 'push'
    }, {
        envelope: {
            module: 'turnstile',
            method: 'enter',
            when: 0,
            waited: 0,
            timedout: false,
            body: { id: 1 }
        },
        message: 'enqueue'
    }]
    var object = {
        work: function (envelope, callback) {
            var expected = expect.shift()
            assert(envelope, expected.envelope, expected.message)
            callback()
        }
    }
    var fracture = new Fracture(object, 'work', {
        extractor: function (work) { return work.id },
        buckets: 3,
        turnstile: {
            Date: { now: function () { return 0 } }
        }
    })

    fracture.push({ id: 1 })
    fracture.enqueue({ id: 1 }, async())
}
