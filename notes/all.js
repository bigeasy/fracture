async function main () {
    const Future = require('perhaps')
    const future = new Future
    const thenable = [{
        then (resolve, reject) {
            console.log('thenable 1')
            setTimeout(() => {
                console.log('timeout')
                future.promise.then(resolve, reject)
            }, 1000)
        }
    }, {
        then (resolve, reject) {
            console.log('thenable 2')
            future.promise.then(resolve, reject)
        }
    }]
    future.resolve(1)
    await Promise.all(thenable.concat(thenable[0]))
    console.log('done')
}

main()
