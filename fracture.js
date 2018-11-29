var cadence = require('cadence')
var abend = require('abend')
var Turnstile = require('turnstile/redux')
var fnv = require('hash.fnv')
var coalesce = require('extant')
var Cache = require('magazine')
var noop = require('nop')

// TODO Need to come back and convince myself that there is no way to blow the
// stack with turnstile calling turnstiles. I know that there isn't because of
// Cadence. A trampoline is a trampoline. I know it, but I'm not convinced.

//
function Fracture (options) {
    this._Date = coalesce(options.Date, Date)
    this._buckets = new Cache({ Date: this._Date }).createMagazine()
    var fractured = JSON.parse(JSON.stringify(coalesce(options.fractured, {})))
    var funnel = JSON.parse(JSON.stringify(coalesce(options.funnel, {})))
    funnel.Date = fractured.Date = this._Date
    this.turnstile = new Turnstile(funnel)
    this._fractured = fractured
    this.health = this.turnstile.health
    if (options.buckets) {
        var extractor = options.extractor
        this._extractor = function (work) {
            var buffer = new Buffer(String(extractor(work)))
            return fnv(0, buffer, 0, buffer.length)
        }
    } else {
        this._extractor = options.extractor
    }
}

// Get a bucket or create one if it doesn't exist. Take this opportunity to
// deallocate any buckets that are not in use.

//
Fracture.prototype._getBucket = function (envelope) {
    // Purge unused buckets.
    var before = this._Date.now() - coalesce(this._fractured.timeout, Infinity) * 10
    var purge = this._buckets.purge()
    while (purge.cartridge && purge.cartridge.when < before) {
        if (purge.cartridge.value.turnstile.health.occupied == 0) {
            purge.cartridge.remove()
        }
        purge.next()
    }
    purge.release()
    // Get the bucket for the key generated from the work to do, or else create
    // the bucket if it does not exist.
    var key = String(this._extractor.call(null, envelope.body.body))
    var bucket = this._buckets.get(key, { turnstile: null })
    if (bucket.turnstile == null) {
        bucket.turnstile = new Turnstile(this._fractured)
    }
    return bucket
}

// TODO Note that stringify is going to depend on object properties being in the
// same order.

//
Fracture.prototype._fracture = cadence(function (async, envelope) {
    async(function () {
        this._getBucket(envelope).turnstile.enter({
            when: envelope.when,
            method: envelope.body.method,
            error: coalesce(envelope.body.error),
            object: coalesce(envelope.body.object),
            body: coalesce(envelope.body.body),
            started: coalesce(envelope.body.started),
            completed: async()
        })
    }, [], function (vargs) {
        envelope.body.completed.apply(null, vargs)
    })
})

Fracture.prototype.enter = function (envelope) {
    this.turnstile.enter({
        object: this,
        method: this._fracture,
        when: coalesce(envelope.when, this._Date.now()),
        body: {
            method: envelope.method,
            error: coalesce(envelope.error),
            object: coalesce(envelope.object),
            body: coalesce(envelope.body),
            started: coalesce(envelope.started, noop),
            completed: coalesce(envelope.completed, noop),
        }
    })
}

module.exports = Fracture
