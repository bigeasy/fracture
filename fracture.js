const Keyify = require('keyify')
const Vivifyer = require('vivifyer')
const assert = require('assert')
const Destructible = require('destructible')
const Turnstile = require('turnstile')

let _

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
        Destructible.Error.assert(!this.fracture.turnstile.terminated, 'DESTROYED')
        const queue = this.fracture._get(this.key)
        if (queue.pauses.length != 0) {
            queue.pauses.shift().resolve.call()
        } else {
            this.fracture._enqueue(this.key)
        }
    }
}

class Fracture {
    constructor (counter, constructor, consumer, object) {
        this.turnstile = counter.counted.turnstile

        this.counted = { fracture: this }
        this.countdown = counter.countdown
        this.destructible = counter.destructible.durable('counters')

        this._counter = counter
        this._counter.destructible.destruct(() => {
            this._counter.destructible.ephemeral($ => $(), 'shutdown', async () => {
                await this.drain()
                this._counter.decrement()
            })
        })

        this._constructor = constructor
        this._consumer = consumer
        this._object = object
        this._entries = 0
        this._destroyed = false
        this._vivifyer = new Vivifyer(() => {
            this._entries++
            return {
                state: CREATED,
                entry: Turnstile.NULL_ENTRY,
                pauses: [],
                entries: [ constructor() ]
            }
        })
    }

    _get (key) {
        return this._vivifyer.get(Keyify.stringify(key))
    }

    async pause (key) {
        Destructible.Error.assert(!this.turnstile.terminated, 'DESTROYED')
        const queue = this._get(key)
        switch (queue.state) {
        case WORKING:
        case PAUSED: {
                const pause = { promise: new Promise(resolve => _ = { resolve }), ..._ }
                queue.pauses.push(pause)
                await pause.promise
            }
        case CREATED:
        case WAITING: {
                queue.state = PAUSED
                this.turnstile.unqueue(queue.entry)
                if (queue.entries.length == 1) {
                    queue.entries.push(this._constructor.call())
                }
            }
            break
        }
        return new Pause(this, key, queue.entries.slice(0))
    }

    enqueue (key) {
        Destructible.Error.assert(!this.turnstile.terminated, 'DESTROYED')
        const queue = this._get(key)
        switch (queue.state) {
        case CREATED: {
                this._enqueue(key)
            }
            break
        case WORKING: {
                if (queue.entries.length == 1) {
                    queue.entries.push(this._constructor.call())
                }
            }
            break
        }
        return queue.entries[queue.entries.length - 1]
    }
    //

    _checkDrain () {
        if (this._drain != null) {
            this._drain.resolve()
            this._drain = null
        }
    }

    // We do not provide any sort of return from enqueue. If the user wants to
    // turn a value they can construct a `Promise` in their entry.

    //
    _enqueue (key) {
        const queue = this._get(key)
        queue.state = WAITING
        queue.entry = this.turnstile.enter({}, async () => {
            queue.enqueued = false
            if (queue.state == WAITING) {
                queue.state = WORKING
                const value = queue.entries[0]
                try {
                    await this._consumer.call(this._object, { key, value })
                } catch (error) {
                    this._destroyed = true
                    this._checkDrain()
                    throw error
                }
                queue.entries.shift()
                if (queue.pauses.length != 0) {
                    queue.pauses.shift().resolve.call()
                } else if (queue.entries.length != 0) {
                    this._enqueue(key)
                } else {
                    this._vivifyer.remove(key)
                    if (--this._entries == 0) {
                        this._checkDrain()
                    }
                }
            }
        })
    }

    async drain () {
        while (!this._destroyed && this._entries != 0) {
            if (this._drain == null) {
                this._drain = { promise: new Promise(resolve => _ = { resolve }), ..._ }
            }
            await this._drain.promise
        }
    }
}

module.exports = Fracture
