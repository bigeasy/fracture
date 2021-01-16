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

class Pause {
    constructor (fracture, key, entries) {
        this.fracture = fracture
        this.key = key
        this.entries = entries
    }

    resume () {
        this.fracture.deferrable.operational()
        const queue = this.fracture._get(this.key)
        if (queue.pauses.length != 0) {
            queue.pauses.shift().resolve()
        } else if (queue.entries.length != 0) {
            this.fracture._enqueue(this.key)
        } else {
            this.fracture._vivifyer.remove(Keyify.stringify(this.key))
            if (--this.fracture.count == 0) {
                this.fracture._drain.resolve()
            }
        }
    }
}

class Fracture {
    static Completion = class extends Future {}

    constructor (destructible, { turnstile, entry, worker }) {
        assert(destructible.isDestroyedIfDestroyed(turnstile.destructible))

        this.turnstile = turnstile
        this.turnstile.deferrable.increment()

        this.destructible = destructible

        this.deferrable = destructible.durable($ => $(), { countdown: 1 }, 'deferrable')

        this.destructible.destruct(() => {
            this.destructible.ephemeral($ => $(), 'shutdown', async () => {
                await this.destructible.copacetic('drain', null, async () => this.drain())
                this._drain.resolve()
                this.deferrable.decrement()
            })
        })
        this.destructible.panic(() => this._drain.resolve())

        this.deferrable.destruct(() => this.turnstile.deferrable.decrement())

        this._entry = entry
        this._worker = worker

        this._drain = Future.resolve()

        this._continuations = []

        this.count = 0
        this._vivifyer = new Vivifyer((_, key) => {
            this.count++
            return {
                state: CREATED,
                entry: Turnstile.NULL_ENTRY,
                completed: new Fracture.Completion,
                continuations: [],
                pauses: [],
                entries: []
            }
        })
    }

    _get (key) {
        return this._vivifyer.get(Keyify.stringify(key), key)
    }

    async pause (key) {
        this.deferrable.operational()
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
        return new Pause(this, key, queue.entries.slice(0).map(entry => entry.entry))
    }

    enqueue (key) {
        this.deferrable.operational()
        const queue = this._get(key)
        if (queue.state == CREATED && queue.continuations.length == 0) {
            this._enqueue(key)
        }
        if (queue.entries.length == 0) {
            queue.entries.push({ completed: new Future, entry: (this._entry)(key) })
        }
        return queue.entries[queue.entries.length - 1]
    }

    // We do not provide any sort of return from enqueue. If the user wants to
    // turn a value they can construct a `Promise` in their entry.

    //
    _enqueue (key) {
        const queue = this._get(key)
        queue.state = WAITING
        queue.entry = this.turnstile.enter({}, async entry => {
            queue.enqueued = false
            if (queue.state == WAITING) {
                queue.state = WORKING
                const value = queue.entries.shift()
                const promise = queue.continuations.length == 0 ? null : queue.continuations.shift().promise
                const continuation = await (this._worker)({ ...entry, key, entry: value.entry, promise })
                if (continuation != null && typeof continuation == 'function') {
                    const future = Future.capture(continuation(), future => {
                        queue.entries.unshift(value)
                        this._enqueue(key)
                    })
                    queue.continuations.push(future)
                } else if (queue.pauses.length != 0) {
                    queue.pauses.shift().resolve()
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
        if (this.count != 0) {
            return (async () => {
                while (! this.deferrable.destroyed && this.count != 0) {
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
