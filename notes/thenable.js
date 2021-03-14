async function main () {
    setImmediate(() => {
        const promise = new Promise(resolve => resolve(1))
        promise.then(() => console.log('happend'))
    })
    const thenable = {
        then (resolve, reject) {
            console.log('called', new Error().stack)
        }
    }
    await thenable
}

main()
