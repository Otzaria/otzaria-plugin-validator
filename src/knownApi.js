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
  'network.fetch', 'network.download',
  'shortcut.create',
]

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

const TOOL_TAB_ICON_NAME_RE = /^[a-z0-9_]+_24_(regular|filled)$/

module.exports = {
  FALLBACK_PERMISSIONS,
  FALLBACK_API_METHODS,
  FALLBACK_EVENTS,
  KNOWN_UNDOCUMENTED_METHODS,
  METHOD_REQUIRED_PERMISSION,
  RESERVED_HOLDER_FIELDS,
  SKIP_DIRS,
  TOOL_TAB_ICON_NAME_RE,
}
