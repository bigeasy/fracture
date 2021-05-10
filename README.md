[![Actions Status](https://github.com/bigeasy/fracture/workflows/Node%20CI/badge.svg)](https://github.com/bigeasy/fracture/actions)
[![codecov](https://codecov.io/gh/bigeasy/fracture/branch/master/graph/badge.svg)](https://codecov.io/gh/bigeasy/fracture)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)

An `async`/`await` work queue that groups work by key.

| What          | Where                                         |
| --- | --- |
| Discussion    | https://github.com/bigeasy/fracture/issues/1  |
| Documentation | https://bigeasy.github.io/fracture            |
| Source        | https://github.com/bigeasy/fracture           |
| Issues        | https://github.com/bigeasy/fracture/issues    |
| CI            | https://travis-ci.org/bigeasy/fracture        |
| Coverage:     | https://codecov.io/gh/bigeasy/fracture        |
| License:      | MIT                                           |

```text
npm install fracture
```

This `README.md` is also a unit test using the Proof unit test framework. We'll
use the Proof `okay` function to assert out statements in the readme. A Proof
unit test generally looks like this.

```javascript
require('proof')(4, async okay => {
    The `'fracture'` module exports a single `Fracture` object.

    const Fracture = require('fracture')
    okay('always okay')
    okay(true, 'okay if true')
    okay(1, 1, 'okay if equal')
    okay({ value: 1 }, { value: 1 }, 'okay if deep strict equal')

    Fracture depends on [Turnstile](https://github.com/bigeasy/turnstile). Turnstile
    is a an `async`/`await` work queue that manages parallel asynchronous call
    stacks, or strands. You enter work into the work queue providing a worker
    function and an object of some sort. The queue is consumed by a fixed number of
    of one or more work loops which run in parallel. They pull work off the queue
    and call the worker functions.

    Fracture allows a Turnstile to be shared across sub-systems, hence the name
    "Fracture." It provides mechanisms to resolve the deadlock issues and race
    conditions you'll face when you use a queue as a concurrency construct.

    Turnstile depends on [Destructible](https://github.com/bigeasy/destructible)
    manages a tree of asynchronous code paths, or strands as they're called by
    Destructible. It provides for catching and reporting errors from multiple
    concurrent `Promise`s as well as `Promise` cancellation.

    To use Fracture you must provide a `Destructible` and `Turnstile`.

    You provide an entry constructor function. It will create a queue of your design
    entry specific to your application. You provide a worker function that will
    process the entry.

    Fracture divides work up by keys. When you enqueue work into Fracture it will
    return an entry constructed by your entry constructor. This is the pending
    entry, the one you add your work to. It is constructed when you call `enqueue`
    and there is no entry available for the key. Until the entry is consumed by the
    worker function `enqeue` will return the same entry. When the entry is consumed
    by the worker function `enqueue` will create a new entry.

    There can be no entries for a key, a single pending entry for a key, or a
    working entry and a pending entry. There will only ever be at most two entries
    for each key in Fracture.

    In order to implement a work queue that has more than two entries, you add an
    array to the application specific entry and you process each array in your
    worker function.

    // Import Destructible and Turnstile.
    const Destructible = require('destructible')
    const Turnstile = require('turnstile')

    // Create a Destructible and Turnstile.
    const destructible = new Destructible('fracture')
    const turnstile = new Turnstile(destructible.durable('turnstile'))

    // Create a Fracture with a Destructible, Turnstile, entry constructor and
    // worker function.
    const gathered = []
    const fracture = new Fracture(destructible.durable('fracture'), {
        turnstile: turnstile,
        value: () => {
            return { work: [] }
        },
        worker: async ({ key, value: { work } }) => {
            gathered.push({ key, work })
        }
    })

    // Push work into the queue for a particular key.
    fracture.enqueue('a', entry => entry.work.push(1))

    // Push more work into the queue for the same key.
    fracture.enqueue('a', entry => entry.work.push(2))

    // Push work into the queue for a different key.
    fracture.enqueue('b', entry => entry.work.push(3))

    // Destroy the destructible and wait for everything to wind down.
    await destructible.destroy().promise

    // We should have gathered all the work into the `gathered` array.
    okay(gathered, [{
        work: [ 1, 2 ], key: 'a'
    }, {
        work: [ 3 ], key: 'b'
    }], 'okay')

    In the example above, `work` is the application specific work queue. When we
    call `enqueue` a new application specific entry is created.

    Deadlock occurs when an entry in the queue depends on a result of an entry in
    the queue that precedes it and there are not enough strands available for the
    proceeding entry to consume the proceeding entry.

    Race conditions are more difficult to describe and are Node.js specific. More on
    those later.

    A user can specify a number of concurrent strands to run in the application. You
    create a Turnstile with the specified number of strands. You can then use
    Fracture to share those strands across multiple sub-systems, each sub-system
    doing whatever sort of work it needs to do inside the Turnstile.

    If you wanted to make a hard partition between sub-systems so that the user can
    specify a number of strands for each, you would divide those sub-systems between
    Turnstiles.

    For example, if you had a wrote database server, you could have a Turnstile for
    network requests and a Turnstile for file system operations. The user could
    configure the number of strands for each. You then use Fracture to create work
    queues, however many you need on each set of strands.

    Above we configured Fracture to last the lifetime of the Turnstile and the
    Destructible, but a Fracture can end during the life of the program.

    // Import Destructible and Turnstile.
    const Destructible = require('destructible')
    const Turnstile = require('turnstile')

    // Create a Destructible and Turnstile.
    const destructible = new Destructible('fracture')
    const turnstile = new Turnstile(destructible.durable('turnstile'))

    // Create a Fracture with a Destructible, Turnstile, entry constructor and
    // work function.
    const gathered = []
    const fracture = new Fracture(destructible.ephemeral('fracture'), {
        turnstile: turnstile,
        value: () => {
            return { work: [] }
        },
        worker: async ({ key, value: { work } }) => {
            gathered.push({ key, work })
        }
    })

    // Add work to `fracture`.
    fracture.enqueue('a', entry => entry.work.push(1))
    fracture.enqueue('a', entry => entry.work.push(2))
    fracture.enqueue('b', entry => entry.work.push(3))

    // Destroy the destructible and wait for everything to wind down.
    await fracture.destructible.destroy().promise

    // We should have gathered all the work into the `gathered` array.
    okay(gathered, [{
        work: [ 1, 2 ], key: 'a'
    }, {
        work: [ 3 ], key: 'b'
    }], 'okay')

    // The `destructible` given to `fracture` is destroyed.
    okay(fracture.destructible.destroyed, 'fracture destructible destroyed')

    // The root `destructible` is still operational.
    okay(! destructible.destroyed, 'root destructible operational')

    We'll now pretend we declared a `destructible` and `turnstile` in our examples
    and that we're reusing them.

    const fracture = new Fracture(destructible.ephemeral('fracture'), {
        turnstile: turnstile,
        value: () => ({ work: [], entered: false }),
        worker: async ({ value }) => {
            value.entered = true
            for (const timeout of value.work) {
                await new Promise(resolve => setTimeout(resolve, timeout))
            }
        }
    })

    // Add some "work", which is just a timeout duration.
    let first
    fracture.enqueue('a', entry => {
        entry.work.push(50)
        first = entry
    })

    // Let's go to the Node.js event loop for a moment so our work queue can
    // start.
    await new Promise(resolve => setImmediate(resolve))

    // Now when we enqueue we're going to get a new user object. Our current
    // object is in the work queue. We cannot add more work to it. We held
    // on to it just to show that a new user object has been created.
    let second
    fracture.enqueue('a', entry => second = entry)

    okay(second !== first, 'new user object created for future work')
    okay(first.entered, 'our first user object has entered the work queue (and could well have left it)')
    okay(!second.entered, 'our second user object has not entered the work queue')

    fracture.enqueue('a', entry => okay(entry == second, 'we continue to get the same second object until we do something asynchronous'))

    await fracture.destructible.destroy().promise

    Pause is used to pull work out of the queue. It is how we avoid deadlock.
    Sometimes work must be done across multiple keys. The keys allow us to order our
    work for a given key. Sometimes work must be done across a given key.

    In a database you might want to write to a database page. If you use the page
    file name as a key, you can be assured that all your writes will be in order.
    One write or set of writes after another.

    At some point you might need to merge two database pages. You can queue an
    operation that will merge the pages, but that operation should wait until any
    outstanding writes to those pages are written. If you only have one strand and
    it enters your merge function, and then your merge function waits on outstanding
    writes to the two merging pages to finish, it will deadlock. There is only one
    strand so the queued writes to the merging pages will not be able to make
    progress.

    This is where pause comes into play. The merge operation can pause the writes to
    the two pages. When it does so it will pull their entries out of the queue and
    it will process them itself, flushing the writes, then merging the pages. Then
    when it resumes those entries will get processed but the merge operation will
    have cleared the entries of writes that it flushed.

    This allows us to have complicated concurrent operations that can run in one or
    more strands. The underlying Turnstile has many stands and the merge operation
    pauses the queue for a page that is currently in its flush operation, the pause
    will block until the operation completes. We know this cannot deadlock. Both the
    merge operation and the flush operation have been assigned an available strand
    are both capable of making progress even though one is waiting on the other.

    We can still get deadlock the old fashioned way. If the merge operation pauses
    the flush operation and the flush operation pauses the merge operation, that is
    going to deadlock eventually. Otherwise, you don't have to concern yourself with
    a deadlock due to resource starvation, i.e. there not enough strands to handle a
    fan-out of work.

    // A very basic user object that just marks that the work entered the
    // work function.
    const fracture = new Fracture(destructible.ephemeral('fracture'), {
        turnstile: turnstile,
        work: () => ({ entered: false, number: 0 }),
        worker: async ({ key, value, pause }) => {
            /*
            switch (key) {
            case 'a': {
                    const b = await pause('b')
                    okay(b.entries, [], 'paused b')
                    b.resume()
                }
                break
            case 'b': {
                    await pause('a')
                    okay(a.entries, [], 'paused a')
                    // auto-resume
                }
                break
            }
            */
            value.entered = true
        }
    })
    //

    // Add some work, take note of the user object.

    //
    const willPause = fracture.enqueue('a')
    willPause.value.number = 7
    //

    // Pause immediately. We will get a pause object with an `entries`
    // property. The entries property will always have two user work
    // entries.

    //
    const pause = await fracture.pause('a')
    okay(pause.entries[0], { entered: false, number: 7 }, 'first pause work')
    //

    //

    // Using a different key, we can add work to the queue and it will make
    // progress. We are not blocking the queue with our pause.

    //
    const unblocked = fracture.enqueue('b').value
    await new Promise(resolve => setImmediate(resolve))
    okay(unblocked.entered, 'pausing does not block the queue')
    //

    // We now resume our paused work.

    //
    pause.resume()
    //

    // If we wait for our Fracture to drain we will see that our paused work
    // was completed.
    await fracture.destructible.destroy().promise

    okay(willPause.value.entered, 'paused work was resumed')

    function latch () {
        let capture
        return { promise: new Promise(resolve => capture = { resolve }), ...capture }
    }
    //

    // A very basic user object that just marks that the work entered the
    // work function.

    //
    let sum = 0

    const parallel = destructible.ephemeral('parallel')
    const turnstile = new Turnstile(parallel.durable('turnstile'), { strands: 2 })
    const fracture = new Fracture(parallel.durable('fracture'), {
        turnstile: turnstile,
        value: () => ({
            entered: latch(), block: null, work: 0
        }),
        worker: async ({ key, value }) => {
            value.entered.resolve()
            if (value.block != null) {
                await value.block.promise
            }
            value.entered = true
            if (key == 'a') {
                const pause = await fracture.pause('b')
                for (const entry in pause.entries) {
                    sum += entry.work
                    entry.work = 0
                }
                pause.resume()
            }
            sum += value.work
        }
    })

    const a = fracture.enqueue('a')
    const b = fracture.enqueue('b')

    a.work = 1
    a.block = latch()
    b.work = 2
    b.block = latch()

    await a.entered.promise
    await b.entered.promise

    fracture.enqueue('b').work = 3

    a.block.resolve()
    await 1
    b.block.resolve()

    // Proceed with an orderly shutdown.

    //
    await parallel.destroy().promise

    Deadlock can also be resolved by the caller pausing itself.

    const fracture = new Fracture(destructible.durable('fracture'), {
        turnstile: turnstile,
        entry: () => ({
            latch: latch(), value: null
        }),
        worker: async ({ key, value, promise }) => {
            switch (key) {
            case 'calculate': {
                    if (promise == null) {
                        const entry = fracture.enqueue(value.method)
                        entry.value = value.value
                        return () => entry.latch.promise
                    }
                    value.latch.resolve(await promise)
                }
                break
            case 'increment': {
                    value.latch.resolve(value.value + 1)
                }
                break
            case 'decrement': {
                    value.latch.resolve(value.value + 1)
                }
                break
            }
        }
    })
    const entry = fracture.enqueue('calculate')
    entry.value = 1
    entry.method = 'increment'
    okay(await entry.latch.promise, 2, 'continuation')
    await fracture.destructible.destroy().promise
})
```
