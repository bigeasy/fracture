var cadence = require('cadence')
var abend = require('abend')
var Turnstile = require('turnstile/redux')
var fnv = require('hash.fnv')
var Operation = require('operation/variadic')
var coalesce = require('extant')

// TODO Need to come back and convince myself that there is no way to blow the
// stack with turnstile calling turnstiles. I know that there isn't because of
// Cadence. A trampoline is a trampoline. I know it, but I'm not convinced.

//
function Fracture () {
    var vargs = Array.prototype.slice.call(arguments)
    this._operation = Operation(vargs)
    var options = vargs.shift()
    var turnstile = coalesce(options.turnstile, {})
    this._extractor = options.extractor
    this._buckets = []
    for (var i = 0, I = options.buckets; i < I; i++) {
        this._buckets.push(new Turnstile(this, '_operate', {
            setImmediate: false,
            Date: coalesce(turnstile.Date, Date)
        }))
    }
    this.turnstile = new Turnstile(this, '_fracture', options.turnstile)
    this.health = this.turnstile.health
}

// TODO Note that stringify is going to depend on objet properties being in the
// same order.

//
Fracture.prototype._fracture = cadence(function (async, envelope) {
    var buffer = new Buffer(JSON.stringify(this._extractor.call(null, envelope.body.work)))
    var index = fnv(0, buffer, 0, buffer.length) % this._buckets.length
    this._buckets[index].enqueue(envelope.body.work, envelope.body.completed)
})

Fracture.prototype._operate = function (envelope, callback) {
    this._operation.call(null, envelope, callback)
}

Fracture.prototype.enter = function (envelope) {
    this.turnstile.enter({
        started: envelope.started,
        body: {
            completed: coalesce(envelope.completed, abend),
            work: envelope.body
        }
    })
}

Fracture.prototype.enqueue = function (work, callback) {
    this.enter({ completed: callback, body: work })
}

Fracture.prototype.push = function (work) {
    this.enter({ body: work })
}

module.exports = Fracture
