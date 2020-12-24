require('proof')(10, async okay => {
    const Fracture = require('..')
    //

    // **TODO** Define the strand concept in `Destructible`.

    // Our dependencies are as follows.

    // An `async`/`await` work queue. It is the foundation of Fracture.

    //
    const Turnstile = require('turnstile')
    //

    // Manage a tree of `async`/`await` code execution paths, with mechanism for
    // `Promise` cancellation.

    //
    const Destructible = require('destructible')
    //


    //
    {
        // When we create a Fracture we must create a `Turnstile`. To create a
        // Turnstile we must create a `Destructible`.

        //
        const destructible = new Destructible($ => $(), 'fracture')
        const turnstile = new Turnstile(destructible)
        //

        // Fracture allows a Turnstile to be shared across sub-systems. A user
        // can specify a number of concurrent strands to run in the application.
        // You create a Turnstile with the specified number of strands. You can
        // then use Fracture to share those strands across multiple sub-systems,
        // each sub-system doing whatever sort of work it needs to do inside the
        // strands.
        //
        // If you wanted to make a hard partition between sub-systems so that
        // the user can specify strands for each, you would divide those strands
        // between Turnstiles.

        // For example, if you had a wrote database server, you could have a set
        // of strands for network requests and a set of strands for file system
        // operations. The user could configure the number of strands for each.
        // You then use Fracture to create work queues, however many you need on
        // each set of strands.
        //
        // **TODO** Rename `turnstiles` to `strands` in `Turnstile`.
        //

        // Here is a worker class that we're going to automate with Fracture.

        //

        class Worker {
            constructor () {
                this.gathered = []
                this.called = 0
            }

            async work ({ key, value }) {
                const called = ++this.called
                for (const work of value) {
                    this.gathered.push({ called, key, work })
                }
            }
        }

        const worker = new Worker
        //

        // Our worker class expects an object with a key and value property. The
        // value is an array of values. For our example we'll just gather up the
        // values.

        //
        //
        // To create a Fracture you give it a Turnstile to use to queue its
        // work.
        //
        // Fracture will divide your work up by a key. For each key it will
        // create a queue entry. You will need to give Fracture a constructor
        // function to construct the value for each queue entry. The value is
        // whatever you want it to be. We are going to simply construct an empty
        // array.

        // You must also provide an asynchronous function that perform work on
        // the queue entry. You can optionally provide an object that will be
        // the `this` property of the function when it is called.

        //
        const fracture = new Fracture(destructible.durable($ => $(), 'fracture'), turnstile, () => [], worker.work, worker)
        //

        // Now we can queue some work. When we call enqueue we will get back an
        // instance of an object created using our constructor function.

        // Now this is important...

        // Whatever we do with this object, we must do it _synchronously_. You
        // cannot hold onto this object beyond an `async` call or a call that
        // will return you to the Node.js event loop.

        //
        const array = fracture.enqueue('a')
        array.push(1, 2, 3)
        //

        // Fracture needs you to be aware of how JavaScript works. You have a
        // synchronous window in which to add work to your user object. After
        // that window closes the object could be in in the user function
        // getting worked through, or it could be out of the queue entirely.

        // If you where to enqueue the same key immediately, you would get the
        // same user object.

        //
        okay(array === fracture.enqueue('a'), 'adding work to same user object')

        fracture.enqueue('a').push(4)

        okay(array, [ 1, 2, 3, 4 ], 'work piling up in the user object')

        //

        // You're not supposed to rely on this in your application, it's just to
        // illustrate that this object is going to gather up work from your
        // application until it enters your worker function.

        // When you use a different key, you will get a different user object.

        //
        fracture.enqueue('b').push(5)
        //

        // Now if we chill out for just a little bit, we'll probably see that
        // our work has been completed.

        //
        await new Promise(resolve => setTimeout(resolve, 50))

        okay(worker.gathered, [{
            called: 1, key: 'a', work: 1
        }, {
            called: 1, key: 'a', work: 2
        }, {
            called: 1, key: 'a', work: 3
        }, {
            called: 1, key: 'a', work: 4
        }, {
            called: 2, key: 'b', work: 5
        }], 'worker received all our queued work')
        //

        // You'll note that the first call to the worker function processed our
        // user object for the key `'a'` which was an array with four items.
        // Then a second call to the worker function processed the user object
        // for the key `'b'` which was an array with a single item.

        // We can now shutdown our Turnstile.

        // And wait for our Destructible to confirm that everything has been
        // shut down.

        //
        await destructible.destroy().rejected
    }

    {
        const destructible = new Destructible($ => $(), 'fracture')
        const turnstile = new Turnstile(destructible)

        const fracture = new Fracture(destructible.durable($ => $(), 'fracture'), turnstile, () => ({ work: [], entered: false }), async ({ value }) => {
            value.entered = true
            for (const timeout of value.work) {
                await new Promise(resolve => setTimeout(resolve, timeout))
            }
        })

        const first = fracture.enqueue('a')
        first.work.push(50)
        //

        // Let's go to the Node.js event loop for a moment so our work queue can
        // start.

        //
        await new Promise(resolve => setImmediate(resolve))
        //

        // Now when we enqueue we're going to get a new user object. Our current
        // object is in the work queue. We cannot add more work to it. We held
        // on to it just to show that a new user object has been created.

        //
        const second = fracture.enqueue('a')

        okay(second !== first, 'new user object created for future work')
        okay(first.entered, 'our first user object has entered the work queue (and could well have left it)')
        okay(!second.entered, 'our second user object has not entered the work queue')

        okay(second === fracture.enqueue('a'), 'we continue to get the same second object until we do something asynchronous')
        //

        // We need to wait for our Fracture to drain before we can terminate the
        // Turnstile.

        //
        await fracture.drain()
        //

        // Terminate the Turnstile.


        // Wait for our Destructible to confirm that everything has been shut
        // down.

        //
        await destructible.destroy().rejected
    }
    //

    // Pause is used to pull work out of the queue. It is how we avoid deadlock.
    // Sometimes work must be done across multiple keys. The keys allow us to
    // order our work for a given key. Sometimes work must be done across a
    // given key.
    //
    // In a database you might want to write to a database page. If you use the
    // page file name as a key, you can be assured that all your writes will be
    // in order. One write or set of writes after another.
    //
    // At some point you might need to merge two database pages. You can queue
    // an operation that will merge the pages, but that operation should wait
    // until any outstanding writes to those pages are written. If you only have
    // one strand and it enters your merge function, and then your merge
    // function waits on outstanding writes to the two merging pages to finish,
    // it will deadlock. There is only one strand so the queued writes to the
    // merging pages will not be able to make progress.
    //
    // This is where pause comes into play. The merge operation can pause the
    // writes to the two pages. When it does so it will pull their entries out
    // of the queue and it will process them itself, flushing the writes, then
    // merging the pages. Then when it resumes those entries will get processed
    // but the merge operation will have cleared the entries of writes that it
    // flushed.
    //
    // This allows us to have complicated concurrent operations that can run in
    // one or more strands. The underlying Turnstile has many stands and the
    // merge operation pauses the queue for a page that is currently in its
    // flush operation, the pause will block until the operation completes. We
    // know this cannot deadlock. Both the merge operation and the flush
    // operation have been assigned an available strand are both capable of
    // making progress even though one is waiting on the other.
    //
    // We can still get deadlock the old fashioned way. If the merge operation
    // pauses the flush operation and the flush operation pauses the merge
    // operation, that is going to deadlock eventually. Otherwise, you don't
    // have to concern yourself with a deadlock due to resource starvation,
    // i.e. there not enough strands to handle a fan-out of work.

    //
    {
        const destructible = new Destructible($ => $(), 10000, 'fracture')
        const turnstile = new Turnstile(destructible.durable('turnstile'))
        //

        // A very basic user object that just marks that the work entered the
        // work function.

        //
        const fracture = new Fracture(destructible.durable($ => $(), 'fracture'), turnstile, () => ({ entered: false, number: 0 }), async ({ value }) => {
            value.entered = true
        })
        //

        // Add some work, take note of the user object.

        //
        const willPause = fracture.enqueue('a')
        willPause.number = 7
        //

        // Pause immediately. We will get a pause object with an `entries`
        // property. The entries property will always have two user work
        // entries.

        //
        const pause = await fracture.pause('a')
        okay(pause.entries[0], { entered: false, number: 7 }, 'first pause entry')
        //

        //

        // Using a different key, we can add work to the queue and it will make
        // progress. We are not blocking the queue with our pause.

        //
        const unblocked = fracture.enqueue('b')
        await new Promise(resolve => setImmediate(resolve))
        okay(unblocked.entered, 'pausing does not block the queue')
        //

        // We now resume our paused entry.

        //
        pause.resume()
        //

        // If we wait for our Fracture to drain we will see that our paused work
        // was completed.

        //
        await fracture.drain()

        okay(willPause.entered, 'paused work was resumed')
        //

        // Proceed with an orderly shutdown.

        //
        await destructible.destroy().rejected
    }

    {
        function latch () {
            let capture
            return { promise: new Promise(resolve => capture = { resolve }), ...capture }
        }
        const destructible = new Destructible($ => $(), 'fracture')
        const turnstile = new Turnstile(destructible, { turnstiles: 2 })
        //

        // A very basic user object that just marks that the work entered the
        // work function.

        //
        let sum = 0

        const fracture = new Fracture(destructible.durable($ => $(), 'fracture'), turnstile, () => ({
            entered: latch(), block: null, work: 0
        }), async ({ key, value }) => {
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

        b.block.resolve()
        a.block.resolve()

        // Proceed with an orderly shutdown.

        //
        await fracture.drain()
        await destructible.destroy().rejected
    }
})
