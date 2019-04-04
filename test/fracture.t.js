require('proof')(5, require('cadence')(prove))

function prove (async, okay) {
    var Fracture = require('..')
    var expect = [{
        envelope: {
            module: 'turnstile',
            method: 'enter',
            when: 0,
            waited: 0,
            timedout: false,
            body: { id: 0 },
            error: null
        },
        message: 'push'
    }, {
        envelope: {
            module: 'turnstile',
            method: 'enter',
            when: 0,
            waited: 0,
            timedout: false,
            body: { id: 0 },
            error: null
        },
        message: 'no hash'
    }, {
        envelope: {
            module: 'turnstile',
            method: 'enter',
            when: 0,
            waited: 0,
            timedout: false,
            body: { id: 31 },
            error: null
        },
        message: 'no hash sync'
    }, {
        envelope: {
            module: 'turnstile',
            method: 'enter',
            when: 31,
            waited: 0,
            timedout: false,
            body: { id: 0 },
            error: null
        },
        message: 'timed out'
    }, {
        envelope: {
            module: 'turnstile',
            method: 'enter',
            when: 31,
            waited: 0,
            timedout: false,
            body: { id: 0 },
            error: null
        },
        message: 'purge'
    }]
    var callbacks = []
    var object = {
        work: function (envelope, callback) {
            var expected = expect.shift()
            if (expected) okay(envelope, expected.envelope, expected.message)
            else console.log(envelope)
            time += envelope.body.id
            callbacks.push(callback)
        }
    }
    var time = 0, fracture
    fracture = new Fracture({
        Date: { now: function () { return time } },
        extractor: function (work) { return work.id },
        buckets: 3,
        fractured: {},
        funnel: {}
    })
    fracture.enter({
        method: object.work.bind(object.work),
        body:  { id: 0 }
    })
    callbacks.pop()()
    fracture = new Fracture({
        Date: { now: function () { return time } },
        extractor: function (work) { return work.id },
        fractured: { timeout: 1 },
        funnel: { turnstiles: 2 }
    })
    fracture.enter({
        method: object.work.bind(object.work),
        body:  { id: 0 }
    })
    fracture.enter({
        method: object.work.bind(object.work),
        body:  { id: 31 }
    })
    fracture.enter({
        method: object.work.bind(object.work),
        body:  { id: 0 }
    })
    fracture.enter({
        method: object.work.bind(object.work),
        body:  { id: 0 }
    })
    callbacks.pop()()
    callbacks.pop()()
    callbacks.pop()()
    callbacks.pop()()
}
