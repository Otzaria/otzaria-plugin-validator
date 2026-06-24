'use strict'

// Hardcoded snapshot of the official Otzaria plugin SDK surface.
// Mirrors the constants in the Otzaria app
// (lib/plugins/models/plugin_valid_permissions.dart,
//  lib/plugins/services/plugin_extended_validator.dart)
// and the website validator (src/lib/pluginValidation.js).
//
// These act as a FLOOR: the live API_REFERENCE.md fetched from GitHub only
// ever EXPANDS the known set, so a lagging doc can never make a currently
// valid plugin fail. Keep in sync when the official SDK changes.

const FALLBACK_PERMISSIONS = [
  'app.info.read',
  'app.user_email.read',
  'app.run_on_startup',
  'library.books.read',
  'library.content.read',
  'search.fulltext.read',
  'reader.open',
  'reader.context_menu',
  'reader.highlight',
  'navigation.write',
  'notes.read',
  'notes.write',
  'calendar.read',
  'settings.read',
  'ui.feedback',
  'ui.create_shortcut',
  'plugin.storage.read',
  'plugin.storage.write',
  'published_data.write',
  'network.access',
  'feedback.send_email',
  'history.read',
  'history.write',
  'database.read',
  'notifications.send',
  'notifications.system',
  'events.subscribe:navigation.changed',
  'events.subscribe:reader.current_book_changed',
  'events.subscribe:reader.current_ref_changed',
  'events.subscribe:reader.selection_changed',
  'events.subscribe:theme.changed',
  'events.subscribe:settings.changed',
  'events.subscribe:calendar.date_changed',
  'events.subscribe:workspace.changed',
  'events.subscribe:plugin.permissions_changed',
]

const FALLBACK_API_METHODS = [
  'app.getInfo', 'app.getTheme', 'app.getLocale', 'app.getUserEmail', 'app.getGrantedPermissions',
  'library.findBooks', 'library.getBookMetadata', 'library.listRecentBooks',
  'library.getBookContent', 'library.getBookToc',
  'search.fullText',
  'reader.openBook', 'reader.openBookAtRef', 'reader.getCurrentState', 'reader.getCurrentRef',
  'reader.getSelection', 'reader.addContextMenuItem', 'reader.removeContextMenuItem',
  'reader.setHighlight', 'reader.getHighlights', 'reader.clearHighlight', 'reader.clearAllHighlights',
  'navigation.goTo',
  'notes.list', 'notes.getBookNotesSummary', 'notes.add', 'notes.update', 'notes.delete',
  'ui.showMessage', 'ui.showSuccess', 'ui.showError', 'ui.showConfirm', 'ui.showWarning',
  'feedback.sendEmail',
  'history.list', 'history.listSearches', 'history.clear', 'history.remove',
  'notifications.showInApp', 'notifications.sendSystem', 'notifications.scheduleSystem',
  'notifications.cancel', 'notifications.cancelAll', 'notifications.checkPermissions',
  'notifications.requestPermissions',
  'storage.get', 'storage.set', 'storage.remove', 'storage.list',
  'settings.get', 'settings.getMany',
  'calendar.getSelectedDate', 'calendar.getDailyTimes', 'calendar.getHalachicTimes',
  'calendar.getJewishDate', 'calendar.getEvents',
  'publishedData.upsert', 'publishedData.remove', 'publishedData.listOwn',
  'database.listSources', 'database.describeSource', 'database.query', 'database.batchQuery',
  'library.getTree',
  'network.fetch', 'network.download',
  'ui.pickFolder',
  'fs.extractZip', 'fs.deleteFile',
  'fs.pickUserFile', 'fs.resolveFileUrl', 'fs.readTextFile', 'fs.revokeFile',
  'shortcut.create',
]

// Minimum Otzaria version each API was added in. Mirrors _methodMinVersion in
// lib/plugins/services/plugin_extended_validator.dart and the version table in
// docs/plugin-sdk/API_REFERENCE.md. A plugin that calls an API newer than its
// declared minAppVersion is a blocking error. Keep in sync with the app + docs.
const FALLBACK_METHOD_MIN_VERSION = {
  // 0.9.89 — first plugin system (all base APIs)
  'app.getInfo': '0.9.89',
  'app.getTheme': '0.9.89',
  'app.getLocale': '0.9.89',
  'app.getUserEmail': '0.9.89',
  'app.getGrantedPermissions': '0.9.89',
  'library.findBooks': '0.9.89',
  'library.getBookMetadata': '0.9.89',
  'library.listRecentBooks': '0.9.89',
  'library.getBookContent': '0.9.89',
  'library.getBookToc': '0.9.89',
  'search.fullText': '0.9.89',
  'reader.openBook': '0.9.89',
  'reader.openBookAtRef': '0.9.89',
  'reader.getCurrentState': '0.9.89',
  'reader.getCurrentRef': '0.9.89',
  'reader.getSelection': '0.9.89',
  'reader.addContextMenuItem': '0.9.89',
  'reader.removeContextMenuItem': '0.9.89',
  'reader.setHighlight': '0.9.89',
  'reader.getHighlights': '0.9.89',
  'reader.clearHighlight': '0.9.89',
  'reader.clearAllHighlights': '0.9.89',
  'navigation.goTo': '0.9.89',
  'notes.list': '0.9.89',
  'notes.getBookNotesSummary': '0.9.89',
  'notes.add': '0.9.89',
  'notes.update': '0.9.89',
  'notes.delete': '0.9.89',
  'ui.showMessage': '0.9.89',
  'ui.showSuccess': '0.9.89',
  'ui.showError': '0.9.89',
  'ui.showConfirm': '0.9.89',
  'ui.showWarning': '0.9.89',
  'feedback.sendEmail': '0.9.89',
  'history.list': '0.9.89',
  'history.listSearches': '0.9.89',
  'history.clear': '0.9.89',
  'history.remove': '0.9.89',
  'notifications.showInApp': '0.9.89',
  'notifications.sendSystem': '0.9.89',
  'notifications.scheduleSystem': '0.9.89',
  'notifications.cancel': '0.9.89',
  'notifications.cancelAll': '0.9.89',
  'notifications.checkPermissions': '0.9.89',
  'notifications.requestPermissions': '0.9.89',
  'storage.get': '0.9.89',
  'storage.set': '0.9.89',
  'storage.remove': '0.9.89',
  'storage.list': '0.9.89',
  'settings.get': '0.9.89',
  'settings.getMany': '0.9.89',
  'calendar.getSelectedDate': '0.9.89',
  'calendar.getDailyTimes': '0.9.89',
  'calendar.getHalachicTimes': '0.9.89',
  'calendar.getJewishDate': '0.9.89',
  'calendar.getEvents': '0.9.89',
  'publishedData.upsert': '0.9.89',
  'publishedData.remove': '0.9.89',
  'publishedData.listOwn': '0.9.89',
  'database.listSources': '0.9.89',
  'database.describeSource': '0.9.89',
  'database.query': '0.9.89',
  'database.batchQuery': '0.9.89',
  // 0.9.93
  'library.getTree': '0.9.93',
  'network.fetch': '0.9.93',
  'network.download': '0.9.93',
  'fs.deleteFile': '0.9.93',
  'fs.extractZip': '0.9.93',
  'ui.pickFolder': '0.9.93',
  // 0.9.94
  'shortcut.create': '0.9.94',
  'fs.pickUserFile': '0.9.94',
  'fs.readTextFile': '0.9.94',
  'fs.resolveFileUrl': '0.9.94',
  'fs.revokeFile': '0.9.94',
}

const FALLBACK_EVENTS = [
  'plugin.boot', 'plugin.ready',
  'theme.changed',
  'navigation.changed',
  'reader.current_book_changed', 'reader.current_ref_changed',
  'reader.selection_changed', 'reader.context_menu_item_clicked',
  'calendar.date_changed', 'workspace.changed',
  'settings.changed', 'plugin.permissions_changed',
]

// APIs that exist in real plugins but are not documented publicly. Not warned on.
const KNOWN_UNDOCUMENTED_METHODS = [
  'network.fetch',
  'plugin.listInstalled',
  'plugin.requestInstall',
  'plugin.uninstall',
]

// method -> required permission. Used both for "missing permission" warnings
// and as a hint when an invalid permission is declared in the manifest.
const METHOD_REQUIRED_PERMISSION = {
  'app.getInfo': 'app.info.read',
  'app.getTheme': 'app.info.read',
  'app.getLocale': 'app.info.read',
  'app.getGrantedPermissions': 'app.info.read',
  'app.getUserEmail': 'app.user_email.read',
  'library.findBooks': 'library.books.read',
  'library.getBookMetadata': 'library.books.read',
  'library.listRecentBooks': 'library.books.read',
  'library.getTree': 'library.books.read',
  'library.getBookContent': 'library.content.read',
  'library.getBookToc': 'library.content.read',
  'search.fullText': 'search.fulltext.read',
  'reader.openBook': 'reader.open',
  'reader.openBookAtRef': 'reader.open',
  'reader.getCurrentState': 'reader.open',
  'reader.getCurrentRef': 'reader.open',
  'reader.getSelection': 'reader.open',
  'reader.addContextMenuItem': 'reader.context_menu',
  'reader.removeContextMenuItem': 'reader.context_menu',
  'reader.setHighlight': 'reader.highlight',
  'reader.getHighlights': 'reader.highlight',
  'reader.clearHighlight': 'reader.highlight',
  'reader.clearAllHighlights': 'reader.highlight',
  'navigation.goTo': 'navigation.write',
  'notes.list': 'notes.read',
  'notes.getBookNotesSummary': 'notes.read',
  'notes.add': 'notes.write',
  'notes.update': 'notes.write',
  'notes.delete': 'notes.write',
  'ui.showMessage': 'ui.feedback',
  'ui.showSuccess': 'ui.feedback',
  'ui.showError': 'ui.feedback',
  'ui.showConfirm': 'ui.feedback',
  'ui.showWarning': 'ui.feedback',
  'feedback.sendEmail': 'feedback.send_email',
  'history.list': 'history.read',
  'history.listSearches': 'history.read',
  'history.clear': 'history.write',
  'history.remove': 'history.write',
  'notifications.showInApp': 'notifications.send',
  'notifications.sendSystem': 'notifications.system',
  'notifications.scheduleSystem': 'notifications.system',
  'notifications.cancel': 'notifications.system',
  'notifications.cancelAll': 'notifications.system',
  'notifications.checkPermissions': 'notifications.system',
  'notifications.requestPermissions': 'notifications.system',
  'storage.get': 'plugin.storage.read',
  'storage.set': 'plugin.storage.write',
  'storage.remove': 'plugin.storage.write',
  'storage.list': 'plugin.storage.read',
  'settings.get': 'settings.read',
  'settings.getMany': 'settings.read',
  'calendar.getSelectedDate': 'calendar.read',
  'calendar.getDailyTimes': 'calendar.read',
  'calendar.getHalachicTimes': 'calendar.read',
  'calendar.getJewishDate': 'calendar.read',
  'calendar.getEvents': 'calendar.read',
  'publishedData.upsert': 'published_data.write',
  'publishedData.remove': 'published_data.write',
  'publishedData.listOwn': 'published_data.write',
  'database.listSources': 'database.read',
  'database.describeSource': 'database.read',
  'database.query': 'database.read',
  'database.batchQuery': 'database.read',
  'network.fetch': 'network.access',
  'network.download': 'network.access',
  'shortcut.create': 'ui.create_shortcut',
}

// Fields on the Otzaria holder object that are not API methods (shorthand scanner).
const RESERVED_HOLDER_FIELDS = new Set([
  'call', 'on', 'off', 'emit', 'once', 'use', 'init', 'setup', 'ready',
])

// Directories never packed into a .otzplugin; an entrypoint inside one breaks silently.
const SKIP_DIRS = new Set([
  '.git', '.svn', '.hg', '.idea', '.vscode',
  'node_modules', '__pycache__', '.claude',
])

// Repo-metadata directories that are never part of a plugin (CI config, store
// screenshots). Skipped when packaging, on top of SKIP_DIRS.
const METADATA_DIRS = new Set(['.github', 'screenshots'])

// True for directories that are never plugin assets: the explicit metadata set
// plus any hidden directory (tool artifacts like .gstack, .github, .vscode...).
function isMetadataDir(name) {
  if (name === '.' || name === '..') return false
  return METADATA_DIRS.has(name) || name.startsWith('.')
}

// True for repo-metadata files that are never plugin assets (docs, licenses,
// dotfiles, lockfiles). Skipped when packaging so the .otzplugin stays lean.
function isMetadataFile(relName) {
  const base = relName.split('/').pop()
  if (base.startsWith('.')) return true // .gitignore, .editorconfig, .DS_Store, .eslintrc...
  const lower = base.toLowerCase()
  if (/\.md$/.test(lower)) return true
  if (lower.startsWith('license') || lower.startsWith('licence')) return true
  if (lower === 'package-lock.json' || lower === 'yarn.lock' || lower === 'pnpm-lock.yaml') return true
  return false
}

const TOOL_TAB_ICON_NAME_RE = /^[a-z0-9_]+_24_(regular|filled)$/

module.exports = {
  FALLBACK_PERMISSIONS,
  FALLBACK_API_METHODS,
  FALLBACK_METHOD_MIN_VERSION,
  FALLBACK_EVENTS,
  KNOWN_UNDOCUMENTED_METHODS,
  METHOD_REQUIRED_PERMISSION,
  RESERVED_HOLDER_FIELDS,
  SKIP_DIRS,
  METADATA_DIRS,
  isMetadataDir,
  isMetadataFile,
  TOOL_TAB_ICON_NAME_RE,
}
