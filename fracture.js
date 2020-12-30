const assert = require('assert')

const Keyify = require('keyify')
const Vivifyer = require('vivifyer')
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
        } else if (queue.entries.length != 0) {
            this.fracture._enqueue(this.key)
        } else {
            this.fracture._vivifyer.remove(Keyify.stringify(this.key))
            console.log(this.fracture.count)
            if (--this.fracture.count == 0) {
                this.fracture._checkDrain()
            }
        }
    }
}

class Fracture {
    constructor (destructible, turnstile, constructor, consumer, object) {
        assert(destructible.isDestroyedIfDestroyed(turnstile.destructible))

        this.turnstile = turnstile
        this.turnstile.deferrable.increment()

        this.destructible = destructible
        this.deferrable = destructible.durable($ => $(), 'deferrable', 1)

        this.destructible.destruct(() => this.deferrable.decrement())

        this.deferrable.destruct(() => {
            this.deferrable.ephemeral($ => $(), 'shutdown', async () => {
                await this.drain()
                this.turnstile.deferrable.decrement()
            })
        })

        this._constructor = constructor
        this._consumer = consumer
        this._object = object
        this.count = 0
        this._vivifyer = new Vivifyer((_, key) => {
            this.count++
            return {
                state: CREATED,
                entry: Turnstile.NULL_ENTRY,
                pauses: [],
                entries: []
            }
        })
    }

    _get (key) {
        return this._vivifyer.get(Keyify.stringify(key), key)
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
            }
            break
        }
        return new Pause(this, key, queue.entries.slice(0))
    }

    enqueue (key) {
        Destructible.Error.assert(!this.turnstile.terminated, 'DESTROYED')
        const queue = this._get(key)
        if (queue.state == CREATED) {
            this._enqueue(key)
        }
        if (queue.entries.length == 0) {
            queue.entries.push(this._constructor.call(null, key))
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
        queue.entry = this.turnstile.enter({}, async entry => {
            queue.enqueued = false
            if (queue.state == WAITING) {
                queue.state = WORKING
                const value = queue.entries.shift()
                try {
                    await this._consumer.call(this._object, { ...entry, key, value })
                } finally {
                    queue.entries.shift()
                    if (queue.pauses.length != 0) {
                        queue.pauses.shift().resolve.call()
                    } else if (queue.entries.length != 0) {
                        this._enqueue(key)
                    } else {
                        this._vivifyer.remove(Keyify.stringify(key))
                        console.log(this.count, this._vivifyer.map)
                        if (--this.count == 0) {
                            this._checkDrain()
                        }
                    }
                }
            }
        })
    }

    async drain () {
        while (this.count != 0) {
            if (this._drain == null) {
                this._drain = { promise: new Promise(resolve => _ = { resolve }), ..._ }
            }
            await this._drain.promise
        }
    }
}

module.exports = Fracture
