// Node.js API.
const assert = require('assert')

// A fast 32-bit hash with pretty good avalanche.
const fnv = require('hash.fnv')

// An `async`/`await` message queue.
const Avenue = require('avenue')

// Return the first non-null value.
const coalesce = require('extant')

const noop = require('nop')

// A Turnstile that will distribute work to a fixed pool of workers according to
// hashed value. The work ingress interface is the same as Turnstile as is the
// worker interface. You can use Fracture with a Turnstile Queue, Set or Check
// interface wrapper.
//
// `Fracture` depends on `Destructible` which I use in all my applications, so
// you should use it in yours, but if not, you'll create need to create a single
// `Destructible` instance as part of creating a `Fracture`.

//
class Fracture {
    //

    // `const fracture = new Fracture(destructible, options)`
    //
    // Create a `Fracture` that will terminate when the given `destructible`
    // terminates. The `options` are as follows.
    //
    // Entries in the queue for longer than the `timeout` value will be marked
    // as `timedout` and `canceled` when they are submitted to the worker
    // function. This is a load shedding strategy for the queue. If you use the
    // timeout function you worker function should process timed out entries
    // quickly, perhaps doing nothing at all in order to shed load.
    //
    // The timeout function does not cancel the worker function in any way. If
    // your worker function performs an action that could block and cause a
    // backlog, you should also use a timeout mechanism within the function.
    // For example, if you perform an HTTP request you should timeout the HTTP
    // request using the timeout property of the HTTP client.
    //
    //
    //  * `turnstiles` &mdash; the number of worker functions instances to
    //  start.
    //  * `timeout` &mdash; mark an entry in the queue as timed out and canceled
    //  if it has been waiting in the queue for longer than the timeout value.

    //
    constructor (destructible, options = {}) {
        // Whether or not we've been terminated.
        this.terminated = false
        // Timeout for queue.
        this.timeout = coalesce(options.timeout, Infinity)
        // We can provide a mock `Date` for timeout debugging.
        this._Date = coalesce(options.Date, Date)
        // Count of turnstiles, i.e. worker functions.
        const turnstiles = coalesce(options.turnstiles, 1)
        // Health interface identical to the one in `Turnstile`.
        this.health = { occupied: 0, waiting: 0, rejecting: 0, turnstiles }

        // A promise used to track train of work queues.
        this._drain = null
        this._drained = noop

        // Create our pool of workers.
        this._turnstiles = []
        for (let i = 0; i < turnstiles; i++) {
            const turnstile = { queue: new Avenue, shifter: null }
            turnstile.shifter = turnstile.queue.shifter()
            this._turnstiles.push(turnstile)
            destructible.durable([ 'turnstile', i ], this._turnstile(turnstile.shifter))
        }
        //

        // Create a queue of work that has timed out.
        this._rejected = new Avenue
        // Poll the rejectable queue for timed out work.
        destructible.durable('rejector', this._rejector(this._rejected.shifter()))

        // Hang onto the `Destructible` for the sake of `destroy()`.
        this._destructible = destructible
    }

    get size () {
        return this.health.occupied + this.health.rejecting + this.health.waiting
    }

    // Confused at the moment about how to wind up a streaming object that
    // depends on Destructible. Let's recall that we don't want to assume that
    // the user is done with us. Maybe they want to send a final message to all
    // the streams (which we don't do, but we could) and have it wind down that
    // way.

    //
    drain () {
        if (this._drain == null) {
            this._drain = new Promise(resolve => this._drained = resolve)
        }
        const drain = this._drain
        this._checkDrain()
        return drain
    }

    terminate () {
        this.terminated = true
        for (const turnstile of this._turnstiles) {
            turnstile.queue.push(null)
        }
        this._rejected.push(null)
        return this.drain()
    }

    _checkDrain () {
        if (this._drain != null && this.size == 0) {
            this._drain = null
            const drained = this._drained
            this._drained = noop
            drained.call()
        }
    }

    // `fracture._turnstile(shifter)` &mdash; a single instance of a worker
    // function. It runs for the lifetime of this `Fracture`, pulling work off
    // of a work queue and `await`ing work when there is none available.

    //
    async _turnstile (shifter) {
        try {
            this.health.occupied++
            for (;;) {
                // Sync `shift` returns `null` for at tail and end of stream,
                // but async shift only returns null at end of stream. We'll
                // know which sort of `null` it is when we call async `shift`.
                let entry = shifter.sync.shift()
                if (entry == null) {
                    this.health.occupied--
                    this._checkDrain()
                    entry = await shifter.shift()
                    this.health.occupied++
                }
                if (entry == null) {
                    break
                }
                this.health.waiting--
                const now = this._Date.now()
                const timedout = entry.timesout < now
                const waited = now - entry.when
                const canceled = this.terminated || timedout
                await entry.method.call(entry.object, {
                    body: entry.body,
                    when: entry.when,
                    waited: now - entry.when,
                    timedout: timedout,
                    canceled: canceled,
                    vargs: entry.vargs
                })
            }
        } finally {
            this.health.occupied--
            this._checkDrain()
        }
    }

    // `fracture._rejector(shifter)` &mdash; invoke worker function with a timed
    // out state.
    //
    //  * `shifter` &mdash; shifter for rejected queue.
    //
    // **TODO**: Should have you have a rejector in fracture? You added a
    // rejector to Turnstile to prune the backlog of the worker function is
    // blocking, but with Fracture you intend to have each worker function
    // process a sub-queue hashed by a key in order. The rejector is its own
    // queue and items would be processed in some arbitrary order.
    //
    // **TODO**: What is the alternative though? If you push onto the queue and
    // it blocked, so you instead raise an exception? Or maybe return false and
    // let the client handle it?
    //
    // When we call this function, we've already asserted that the entry in
    // question has expired, so do not repeat the test.

    //
    async _rejector (shifter) {
        try {
            this.health.rejecting++
            for (;;) {
                let entry = shifter.sync.shift()
                if (entry == null) {
                    this.health.rejecting--
                    this._checkDrain()
                    entry = await shifter.shift()
                    this.health.rejecting++
                }
                if (entry == null) {
                    break
                }
                this.health.waiting--
                const now = this._Date.now()
                await entry.method.call(entry.object, {
                    body: entry.body,
                    when: entry.when,
                    waited: now - entry.when,
                    timedout: true ,
                    canceled: true,
                    vargs: entry.vargs
                })
            }
        } finally {
            // The only statement that throws above is the worker function call.
            this.health.rejecting--
            this._checkDrain()
        }
    }

    // `fracture.enter(entry, body[, object][, when])` &mdash; push a work entry
    // into the work queue.
    //
    //  * `method` &mdash; the work function to call.
    //  * `body` &mdash; argument to pass to the work function.
    //  * `object` &mdash; optional context object for the work function call.
    //  * `when` &mdash; optional submission time for the work.
    //
    // The `method` is invoked with the optional `object` as the `this`
    // property and with the given given `body` as the first argument to the
    // work method. The work method will receive a state argument as the final
    // argument to the function.

    //
    enter ({ method, body, when, object, vargs }) {
        assert(!this.terminated, 'enter when terminated')
        // Increment wiating count.
        this.health.waiting++
        // Pop and shift variadic arguments.
        const now = when || this._Date.now()
        const index = coalesce(vargs[0], 0)
        // TODO This is now dubious, we used it when Fracture was composed of
        // Turnstiles but now Fracture is it's own thing.
        // Hash out a turnstile.
        const turnstile = this._turnstiles[index]
        // Push the work into the turnstile.
        turnstile.queue.push({ method, object, when: now, body, timesout: now + this.timeout, vargs })
        // We check for rejections on entry assuming that if we've managed to
        // make a list a certain length, there is no harm in leaving it that
        // length for however long it takes for us to detect that it is
        // struggling.
        for (;;) {
            const peek = turnstile.shifter.sync.peek()
            if (peek == null || now < peek.timesout) {
                break
            }
            this._rejected.push(turnstile.shifter.sync.shift())
        }
    }
}

module.exports = Fracture
