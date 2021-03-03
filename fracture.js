// # Fracture

// Welcome back. Here's the stuff that will take some time to load into
// programmer memory.

//  * We use `Destructible.destructive` to wrap the worker function invocation
//  so that an error will wreck the Fracture destructible and not the Turnstile.
//  * Continuations are necessary if you call a Fracture-based function so that
//  a worker does not wait on a another worker behind it in the queue. Even with
//  multiple strands we can deadlock if all strands are waiting on something
//  behind them in the queue.
//
// And while you're here maybe think about this...
//
// Still don't know how to shut it down after error. Let's start by asserting
// that is the intention of the design that once a Fracture has a failure it is
// in a panic and no more work will be accepted, any queued work will be
// abandoned. This is what we want to see happen.
//
// Any work that is in process is allowed to complete.
//
// The only thing that remains a mystery are displacements. Does `displace`
// raise an exception in order to arrest forward motion of the worker or does it
// try to continue working?
//
// For starters, we can can run the displacements inside `destructive`, so we
// know that the error will get reported by Destructible. Well, that seems like
// it is starters and finishers. It kind of solves the problem of lost errors.
//
// Think about it, this is what we're doing for now.

//
const assert = require('assert')

const Keyify = require('keyify')
const Vivifyer = require('vivifyer')
const Destructible = require('destructible')
const Turnstile = require('turnstile')
const Future = require('perhaps')

const PAUSED = Symbol('PAUSED')
const CREATED = Symbol('CREATED')
const WORKING = Symbol('WORKING')
const WAITING = Symbol('WAITING')

class Fracture {
    // When you implement a function that uses fracture you should either return
    // the enqueue future or accept a future set and add enqueue futures to it.
    // These signatures will let the caller know that they should use `displace`
    // to invoke the function or resolve the future set if they are calling from
    // within a Fracture worker.
    static Future = class extends Future {}

    static FutureSet = class {
        constructor () {
            this._set = new Set
        }

        get size () {
            return this._set.size
        }

        add (future) {
            this._set.add(future)
        }

        prune () {
            for (const future of this._set) {
                if (future.fulfilled) {
                    this._set.delete(future)
                } else {
                    break
                }
            }
        }

        async join () {
            for (const future of this._set) {
                await future.promise
                this._set.delete(future)
            }
        }
    }
    //

    // To be used as a default argument for functions that accept a future set
    // when the caller doesn't intend to await the resolution of the futures in
    // the set.
    static NULL_FUTURE_SET = new (class extends Fracture.FutureSet {
        size = 0
        add () {}
        prune () {}
        join() {}
    })

    static Pause = class {
        constructor (fracture, key, queue) {
            this.fracture = fracture
            this.key = key
            this._queue = queue
        }

        get entries () {
            return this._queue.entries.map(entry => entry.value)
        }

        resume () {
            this.fracture._destructible.operational()
            if (this._queue.pauses.length != 0) {
                this._queue.pauses.shift().resolve()
            } else if (this._queue.entries.length != 0) {
                this.fracture._enqueue(this.key)
            } else {
                this.fracture._vivifyer.remove(Keyify.stringify(this.key))
                if (--this.fracture.count == 0) {
                    this.fracture._drain.resolve()
                }
            }
        }
    }

    constructor (destructible, { turnstile, value, worker, cancel = () => {} }) {
        this.turnstile = turnstile
        this.turnstile.deferrable.increment()

        this.destructible = destructible

        this.deferrable = destructible.durable($ => $(), { countdown: 1 }, 'deferrable')

        this._drain = Future.resolve()

        this.destructible.destruct(() => this.deferrable.decrement())
        this.deferrable.panic(() => this._drain.resolve())
        this.deferrable.destruct(() => {
            this.deferrable.ephemeral($ => $(), 'shutdown', async () => {
                await this.drain()
                this._destructible.decrement()
                this.turnstile.deferrable.decrement()
            })
        })
        this._destructible = this.deferrable.durable($ => $(), { countdown: 1 }, 'queue')
        // When we are errored all queued work will reject with a
        // `Destructible.Error.DESTORYED`. We run workers and displacements in
        // destructible so we don't have to worry about swallowing errors. Any
        // errors that occur will get reported through destructible.
        //
        // The user will have to come to grips with the fact that a return value
        // may be lost if their is an error in the Fracture even if the value a
        // valid resolution. I've got no problem with this since the database
        // work I'm doing based on Fracture always culminates in an atomic
        // operation that preserves the work that if missing means the work
        // failed and failed atomically.
        this._destructible.panic(() => {
            try {
                this._destructible.operational()
            } catch (error) {
                for (const key in this._vivifyer.map) {
                    const queue = this._vivifyer.map[key]
                    for (const entry of queue.working.concat(queue.displacements.concat(queue.entries))) {
                        entry.future.reject(error)
                    }
                    this.count--
                    this._vivifyer.remove(key)
                }
            }
            this._drain.resolve()
        })

        this._value = value
        this._cancel = cancel
        this._worker = worker

        this._displacements = []

        this.count = 0
        this._vivifyer = new Vivifyer((_, key) => {
            this.count++
            return {
                state: CREATED,
                entry: Turnstile.NULL_ENTRY,
                displacements: [],
                blocks: [],
                pauses: [],
                entries: [],
                working: []
            }
        })
    }

    _get (key) {
        return this._vivifyer.get(Keyify.stringify(key), key)
    }

    async _pause (key) {
        this._destructible.operational()
        const queue = this._get(key)
        switch (queue.state) {
        case WORKING:
        case PAUSED: {
                const pause = new Future
                queue.pauses.push(pause)
                await pause.promise
            }
        case CREATED:
        case WAITING: {
                queue.state = PAUSED
                this.turnstile.unqueue(queue.entry)
            }
            break
        }
        return new Fracture.Pause(this, key, queue)
    }

    enqueue (key) {
        this.deferrable.operational()
        const queue = this._get(key)
        if (queue.state == CREATED && queue.displacements.length == 0) {
            this._enqueue(key)
        }
        if (queue.entries.length == 0) {
            queue.entries.push({ future: new Fracture.Future, value: (this._value)(key) })
        }
        return queue.entries[queue.entries.length - 1]
    }

    _enqueue (key) {
        const queue = this._get(key)
        queue.state = WAITING
        queue.entry = this.turnstile.enter({}, async entry => {
            queue.enqueued = false
            if (queue.state == WAITING) {
                queue.state = WORKING

                if (queue.displacements.length != 0) {
                    const { capture, future } = queue.displacements.shift()
                    future.resolve(capture.promise)
                } else if (this._destructible.destroyed) {
                    console.log('am I destroyed?', key)
                    queue.blocks.push(Future.resolve())
                    try {
                        this._destructible.operational()
                    } catch (error) {
                        const entry = queue.entries.shift()
                        ; (this._cancel)({ key, value: entry.value })
                        entry.future.reject(error)
                    }
                } else {
                    const work = queue.entries.shift()
                    queue.working.push(work)
                    const displace = promise => {
                        const future = new Future
                        const capture = Future.capture(this._destructible.destructive($ => $(), 'displace', async () => {
                            if (typeof promise == 'function') {
                                return promise()
                            }
                            return promise
                        }), () => {
                            this._enqueue(key)
                        })
                        queue.displacements.push({ capture, future })
                        // `displace` might be called a couple times before we come back
                        // around in the queue where blocks are shifted so we scan for the
                        // first unfulfilled block and resolve that one.
                        queue.blocks.push(new Future)
                        for (const block of queue.blocks) {
                            if (! block.fulfilled) {
                                block.resolve()
                                break
                            }
                        }
                        return future.promise
                    }
                    queue.blocks.push(new Future)
                    this._destructible.destructive($ => $(), 'worker', (this._worker)({
                        ...entry,
                        key: key,
                        value: work.value,
                        displace: displace,
                        pause: key => this._pause(key)
                    })).then((...vargs) => {
                        queue.working.shift()
                        work.future.resolve.apply(work.future, vargs)
                        queue.blocks.shift().resolve()
                    }, error => {
                        queue.working.shift()
                        try {
                            this._destructible.operational()
                        } catch (error) {
                            work.future.reject(error)
                        }
                        // There can only be one block remaining.
                        queue.blocks[0].resolve()
                    })
                }

                // Await a block then shift it. An inversion of the scram array
                // in Destructible where the resolving side shifts.
                await queue.blocks[0].promise
                queue.blocks.shift()

                if (queue.displacements.length != 0) {
                } else if (queue.pauses.length != 0) {
                    try {
                        this._destructible.operational()
                        queue.pauses.shift().resolve()
                    } catch (error) {
                        queue.pauses.shift().reject(error)
                    }
                } else if (queue.entries.length != 0) {
                    this._enqueue(key)
                } else {
                    this._vivifyer.remove(Keyify.stringify(key))
                    if (--this.count == 0) {
                        this._drain.resolve()
                    }
                }
            }
        })
    }

    drain () {
        if (! this.deferrable.errored && this.count != 0) {
            return (async () => {
                while (! this.deferrable.errored && this.count != 0) {
                    if (this._drain.fulfilled) {
                        this._drain = new Future
                    }
                    await this._drain.promise
                }
            }) ()
        }
        return null
    }
}

module.exports = Fracture
