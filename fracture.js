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
const { Future } = require('perhaps')

const DESTROYED = Symbol('DESTROYED')
const PAUSED = Symbol('PAUSED')
const CREATED = Symbol('CREATED')
const WORKING = Symbol('WORKING')
const WAITING = Symbol('WAITING')
const ERRORED = Symbol('ERRORED')

class Fracture {
    //

    // All invocations of enqueue require this stack, so any function that uses
    // enqueue also requires an instance of this stack. This clearly identifies
    // Fracture enabled functions in the code.

    //
    static Stack = class {
        constructor (fracture = { turnstile: null }, queue = {}, key = null) {
            this._fracture = fracture
            this._queue = queue
            this._awaiting = false
            this._callers = []
            this._key = key
        }

        // TODO So it is going to be bad if we displace into our own fracture
        // using the same key, so we should assert that this is not the case.
        // Would need a `canDisplace` function, would need to check that it is
        // not the same key and fracture.
        //
        // Probably... If displaced we do not have to descend.
        _displace (displacedBy = this) {
            if (
                displacedBy !== this &&
                displacedBy._fracture.turnstile === this._fracture.turnstile &&
                this._awaiting &&
                ! this._queue.displaced &&
                this._queue.state !== DESTROYED
            ) {
                displacedBy._queue.displacements.push(this)
                this._queue.displaced = true
                this._queue.blocks.push(new Future)
                Fracture._blockAdvance(this._queue)
            }
            for (const caller of this._callers) {
                caller._displace(displacedBy)
            }
        }
    }
    //

    // Stack constructor function is slightly less verbose than calling the
    // Stack constructor.

    //
    static stack () {
        return new Fracture.Stack
    }

    //
    static Pause = class {
        constructor (fracture, key, queue) {
            this.fracture = fracture
            this.key = key
            this._queue = queue
            this.values = this._queue.entries.map(entry => entry.value)
        }

        resume () {
            this.fracture._destructible.operational()
            assert(! this._queue.displaced)
            if (this._queue.pauses.length != 0) {
                this._queue.pauses.shift().resolve()
            } else if (this._queue.entries.length != 0) {
                this.fracture._enqueue(this.key)
            } else {
                this.fracture._vivifyer.remove(Keyify.stringify(this.key))
                this.fracture._maybeDrain()
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
                    for (const entry of queue.working) {
                        entry.future.reject(error)
                    }
                    this.count--
                    if (queue.entries.length == 0) {
                        this._vivifyer.remove(key)
                    }
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
                displaced: false,
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

    // TODO We could create the thenable once, that way in something like split,
    // instead of creating an array with an entry for each write, we could use
    // `Set` and we'd only wait for the batched write to await. This might be
    // enough of a performance improvement that we don't need to expose the
    // `fulfilled` property, but if we do, why not make `then` a function of
    // `Future` and override it in a subclass? This Thenable shoulud be a
    // separate class.

    static instance = 0
    //
    enqueue (stack, key, setter = () => {}) {
        assert(stack instanceof Fracture.Stack)
        this.deferrable.operational()
        const queue = this._get(key)
        // TODO Throw error here to prevent shutdown ..... throw Error
        if (queue.state == CREATED) {
            this._enqueue(key)
        }
        if (queue.entries.length == 0) {
            const entry = {
                future: new Future,
                value: (this._value)(key),
                stack: new Fracture.Stack(this, queue, key),
                thenables: new Map
            }
            queue.entries.push(entry)
        }
        const entry = queue.entries[queue.entries.length - 1]
        entry.stack._callers.push(stack)
        setter(entry.value)
        // Considering a case where we invoke a enqueue with a stack, but awiat
        // only at the very end. A nested call invoked enqueue with a stack, but
        // it does not await at all. If so, shouldn't it simply submit a fresh
        // stack? Yes, because it is not going block on the completion.

        // What happens if the turnstiles don't match up. A awaits B but B has a
        // different turnstile. B awaits C and C has the same turnstile as A. C
        // needs to displace A. This would be covered by this call.
        entry.stack._displace()
        // Continuing. A awaits B but B has a different turnstile. B calls C
        // many times and then awaits many thenables separately. Now we have to
        // think about the queues. C would have many values to process, but only
        // one queue entry, that queue entry could have multiple value entries,
        // but we resume after the first value entry is processed. To resume is
        // to place it back in the queue, possibly after A and that would create
        // deadlock, so we probably need a set of values, or else we only resume
        // when the queue is empty.

        // Modify that. B calls C many times and awaits many thenables, so A is
        // displaced until all the values are consumed. Then it is enqueued. B
        // calls C many times and awaits many thenables again, but now our
        // boolean switch has been flipped, is it enough to flip it back so that
        // we can trigger it again?

        // If this be the case, then we can do this per value set.

        // What happens if we add values to C from a separate stack path? Those
        // values would need to be processed, but they would not trigger any
        // displacement for A.

        // Isn't the `_awaiting` flag just a duplicate of
        // `entry.future.fulfilled`? Consider the race conditions.
        const thenable = entry.thenables.get(stack)
        if (thenable == null) {
            const thenable = {
                then: (resolve, reject) => {
                    if (! entry.future.fulfilled && ! stack._awaiting) {
                        stack._awaiting = true
                        entry.stack._displace()
                    }
                    entry.future.promise.then(resolve, reject)
                }
            }
            entry.thenables.set(stack, thenable)
            return thenable
        }
        return thenable
    }

    // It works. You have to flip any one switch and the get flipped in the
    // order of the array so go find one and flip it.
    static _blockAdvance (queue) {
        for (const future of queue.blocks) {
            if (! future.fulfilled) {
                future.resolve()
                break
            }
        }
    }

    _enqueue (key) {
        const queue = this._get(key)
        queue.state = WAITING
        queue.entry = this.turnstile.enter({}, async entry => {
            assert(queue.state == WAITING)
            queue.state = WORKING
            queue.enqueued = false
            if (queue.blocks.length != 0) {
                // We are a resumed displacement.
            } else if (this._destructible.destroyed) {
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
                // throw new Error // try it
                queue.blocks.push(new Future)
                queue.working.push(work)
                this._destructible.ephemeral('worker', (this._worker)({
                    ...entry,
                    key: key,
                    value: work.value,
                    stack: work.stack,
                    pause: key => this._pause(key)
                })).promise.then(result => {
                    queue.working.shift()
                    work.future.resolve(result)
                    Fracture._blockAdvance(queue)
                }, error => {
                    queue.working.shift()
                    work.future.reject(error)
                    Fracture._blockAdvance(queue)
                })
            }

            // Await a block then shift it. An inversion of the scram array in
            // Destructible where the resolving side shifts.
            await queue.blocks[0].promise
            queue.blocks.shift()

            if (! queue.displaced) {
                for (const stack of queue.displacements.splice(0)) {
                    stack._awaiting = false
                    stack._queue.displaced = false
                    stack._fracture._enqueue(stack._key)
                }
                if (queue.pauses.length != 0) {
                    // When we resolve the pause the promise will resolve in the worker
                    // function that is within the Turnstile. Even if the Turnstile is
                    // destoryed it will finish running a function in an surving strand
                    // so we do not have to check for operational.
                    queue.pauses.shift().resolve()
                } else if (queue.entries.length != 0) {
                    this._enqueue(key)
                } else {
                    queue.state = DESTROYED
                    this._vivifyer.remove(Keyify.stringify(key))
                    this._maybeDrain()
                }
            }
        })
    }

    _maybeDrain () {
        if (--this.count == 0) {
            this._drain.resolve()
        }
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
