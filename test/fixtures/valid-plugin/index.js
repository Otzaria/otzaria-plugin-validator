'use strict'

// A valid plugin: every API used has its declared permission.
async function init() {
  const info = await Otzaria.call('app.getInfo')
  const books = await Otzaria.call('library.findBooks', { query: 'בראשית' })
  console.log(info, books)
}

init()
