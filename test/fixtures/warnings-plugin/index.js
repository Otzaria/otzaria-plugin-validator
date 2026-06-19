'use strict'

// Uses a known API without declaring its permission (-> warning),
// and a completely unknown API (-> warning).
async function init() {
  await Otzaria.call('library.findBooks', { query: 'x' }) // needs library.books.read
  await Otzaria.call('totally.unknown.method') // unknown API
  Otzaria.on('made.up.event', () => {}) // unknown event
}

init()
