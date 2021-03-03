{
    // Want to use a special type in the function signature to indicate that we
    // are a fractured function so that if called from a fractured worker we
    // will put ourselves in the background. Additionally, here, we look at
    // using Too Much Magic and we would only defer the current thread when we
    // await on a Thenable. This is Too Much Magic.
    //
    // It is a cleaner implementation after a fashion and maybe I implement it
    // just to see how it ripples through the code, tagging everything, and if
    // the code looks nicer in general, I can move it back.
    //
    // Curious to consider how we then enqueue many items and wait on them too.
    const fracture = new Fracture(destructible.ephemeral('fracture'), {
        turnstile: turnstile,
        value: () => ({
            latch: latch(), value: null
        }),
        worker: async ({ key, value, stack }) => {
            switch (key) {
            case 'calculate': {
                    // Return a Magic Thenable.
                    return await fracture.enqueue(value.method, stack, delegate => delegate.value = value.value)
                }
                break
            case 'increment': {
                    return value.value + 1
                }
                break
            case 'decrement': {
                    return value.value - 1
                }
                break
            }
        }
    })
    // Our Turnstile is not in our stack to return a normal promise.
    const calculation = await fracture.enqueue('calculate', Fracture.stack(), value => {
        value.value = 1
        value.method = 'increment'
    })
    okay(calculation, 2, 'continuation')
    await fracture.destructible.destroy().promise
    console.log('done')
}

{
    // We could replace the Too Much Magic with something more explicit and that
    // would make it less likely that this would attract a GitHub Issues debate.
    //
    // Perhaps this would still return a magic Thenable in order to *assert*
    // that we didn't hang out code and that would be much nicer.
    const fracture = new Fracture(destructible.ephemeral('fracture'), {
        turnstile: turnstile,
        value: () => ({
            latch: latch(), value: null
        }),
        worker: async ({ key, value, stack }) => {
            switch (key) {
            case 'calculate': {
                    // Return a Magic Thenable *explicitly* and *asert* that we did wait
                    // on it.
                    return await fracture.enqueue(value.method, stack, delegate => delegate.value = value.value).displacable()
                }
                break
            case 'increment': {
                    return value.value + 1
                }
                break
            case 'decrement': {
                    return value.value - 1
                }
                break
            }
        }
    })
    // Our Turnstile is not in our stack to return a normal promise. We would
    // not call displacable here, but if we did, we could assert that we have a
    // stack of any depth and if not raise an exception.
    const calculation = await fracture.enqueue('calculate', Fracture.stack(), value => {
        value.value = 1
        value.method = 'increment'
    })
    okay(calculation, 2, 'continuation')
    await fracture.destructible.destroy().promise
    console.log('done')
}

{
    // Would this solve a problem arrising in amalgamate where by passing in our
    // set of awaits we're not able to, well, it gets goofy is all. We now have
    // a new problem, though, in that our Magic Thenable gets called over and
    // over agian, so we have to have some sort of displace me only the one one
    // time, but then how do we do this?
    //
    // We can simply say we are displaced until all the work be backlogged
    // clears and then we can undisplace because if we trigger a thenable and we
    // have a backlog, well we'll run backlog knowing that the displaced
    // function cannot enqueue more work. We ought to be able to track whether
    // or not it is already displaced, we can do our thing where we simply skip
    // it if it is already rsolved.
    async function worker ({ stack, value: inserts }) {
        while (const { index, key, parts } of inserts) {
            futures.add(cursor.insert(index, key, parts, Future.stack()))
        }
        // await Fracture.all(futures).displacable() // an alternative.
        for (const future of futures) {
            await future.displacable()
        }
    }
}
