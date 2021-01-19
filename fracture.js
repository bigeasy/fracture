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
    static CompletionInstance = 0

    // **TODO** Feels like a misnomer.
    static Completion = class extends Future {
        constructor () {
            super()
            this.id = Fracture.CompletionInstance++
        }
    }

    static CompletionSet = class {
        constructor () {
            this._map = new Map
            this._head = null
        }

        get size () {
            return this._map.size
        }

        add (completed) {
            if (! this._map.has(completed.id)) {
                const node = { next: this._head, completed }
                this._map.set(completed.id, node)
                this._head = node
            }
        }

        async clear () {
            while (this._head != null) {
                const { completed } = this._head
                this._head = this._head.next
                this._map.delete(completed.id)
                if (! completed.fulfilled) {
                    await completed.promise
                }
            }
        }
    }

    static NULL_COMPLETION_SET = new (class extends Fracture.CompletionSet {
        size = 0
        add () {}
        clear() {}
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

    constructor (destructible, { turnstile, value, worker }) {
        assert(destructible.isDestroyedIfDestroyed(turnstile.destructible))

        this.turnstile = turnstile
        this.turnstile.deferrable.increment()

        this.destructible = destructible

        this.deferrable = destructible.durable($ => $(), { countdown: 1 }, 'deferrable')

        this._drain = Future.resolve()

        this.destructible.destruct(() => this.deferrable.decrement())
        this.deferrable.panic(() => this._drain.resolve())
        this.deferrable.destruct(() => {
            this.deferrable.ephemeral($ => $(), 'shutdown', async () => {
                await this.destructible.copacetic2(async () => this.drain())
                this._destructible.decrement()
                this.turnstile.deferrable.decrement()
            })
        })
        this._destructible = this.deferrable.durable($ => $(), { countdown: 1 }, 'fracture')
        this._destructible.panic(() => {
            this._drain.resolve()
        })

        this._value = value
        this._worker = worker

        this._continuations = []

        this.count = 0
        this._vivifyer = new Vivifyer((_, key) => {
            this.count++
            return {
                state: CREATED,
                entry: Turnstile.NULL_ENTRY,
                continuations: [],
                blocks: [],
                pauses: [],
                entries: []
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
        if (queue.state == CREATED && queue.continuations.length == 0) {
            this._enqueue(key)
        }
        if (queue.entries.length == 0) {
            queue.entries.push({ completed: new Fracture.Completion, value: (this._value)(key) })
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

                if (queue.continuations.length != 0) {
                    const { capture, resume } = queue.continuations.shift()
                    resume.resolve(capture.promise)
                } else if (this._destructible.destroyed) {
                    queue.blocks.push(Future.resolve())
                    try {
                        this._destructible.operational()
                    } catch (error) {
                        const work = queue.entries.shift()
                        work.completed.reject(error)
                    }
                } else {
                    const work = queue.entries.shift()
                    const displace = promise => {
                        if (typeof promise == 'function') {
                            promise = promise()
                        }
                        const resume = new Future
                        const capture = Future.capture(promise, () => {
                            this._enqueue(key)
                        })
                        queue.continuations.push({ capture, resume })
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
                        return resume.promise
                    }
                    queue.blocks.push(new Future)
                    this._destructible.destructive($ => $(), 'worker', (this._worker)({
                        ...entry,
                        key: key,
                        value: work.value,
                        displace: displace,
                        pause: key => this._pause(key)
                    })).then((...vargs) => {
                        work.completed.resolve.apply(work.completed, vargs)
                        queue.blocks.shift().resolve()
                    }, error => {
                        try {
                            this._destructible.operational()
                        } catch (error) {
                            work.completed.reject(error)
                        }
                        // There can only be one block remaining.
                        queue.blocks[0].resolve()
                    })
                }

                // Await a block then shift it. An inversion of the scram array
                // in Destructible where the resolving side shifts.
                await queue.blocks[0].promise
                queue.blocks.shift()

                if (queue.continuations.length != 0) {
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
        if (this.count != 0) {
            return (async () => {
                while (! this._destructible.destroyed && this.count != 0) {
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
