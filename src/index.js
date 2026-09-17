'use strict'

// The public API of the `otzaria-plugin-validator` package.
//
// This file is pure re-exports and has NO side effects — requiring it never
// runs the GitHub Action (that entry point is src/action.js, and it is what
// action.yml points at). Anything exported here is consumed both by the Action
// and by the Otzaria store (Otzaria_Website), which is the point: one
// implementation of the SDK-conformance rules, not two.
//
// Authority: the DATA lives in src/spec.json, generated in Otzaria/otzaria from
// the app's own constants. The LOGIC lives here. Store POLICY (screenshots,
// minAppVersion floor, blocking on warnings) stays in the website.

const apiSpec = require('./apiSpec')
const manifestValidator = require('./manifestValidator')
const extendedValidator = require('./extendedValidator')
const whenValidator = require('./whenValidator')
const headlessValidator = require('./headlessValidator')
const knownApi = require('./knownApi')
const reachability = require('./reachability')
const validatePlugin = require('./validatePlugin')
const zip = require('./zip')
const ignore = require('./ignore')

module.exports = {
  // --- SDK spec (data) ---
  SPEC: knownApi.SPEC,
  DEFAULT_SPEC_URL: apiSpec.DEFAULT_SPEC_URL,
  SUPPORTED_SPEC_SCHEMA: apiSpec.SUPPORTED_SPEC_SCHEMA,
  getApiSpec: apiSpec.getApiSpec,
  parseSpecJson: apiSpec.parseSpecJson,
  buildFallbackSpec: apiSpec.buildFallbackSpec,
  mergeWithFallback: apiSpec.mergeWithFallback,

  // --- Manifest ---
  parseManifestJson: manifestValidator.parseManifestJson,
  buildManifest: manifestValidator.buildManifest,
  validateManifestFields: manifestValidator.validateManifestFields,
  MANIFEST_RULES: manifestValidator.MANIFEST_RULES,
  ALL_MANIFEST_RULES: manifestValidator.ALL_MANIFEST_RULES,
  compareCoreVersions: manifestValidator.compareCoreVersions,

  // --- contributes.startup `when` ---
  validateWhenConditions: whenValidator.validateWhenConditions,
  validateStartupWhenConditions: whenValidator.validateStartupWhenConditions,

  // --- Headless plugins ---
  validateHeadless: headlessValidator.validateHeadless,
  hasBackgroundActivationTrigger: headlessValidator.hasBackgroundActivationTrigger,

  // --- Code scan, cross-checks, design ---
  analyzeApiUsage: extendedValidator.analyzeApiUsage,
  runExtendedValidation: extendedValidator.runExtendedValidation,
  checkDesignCompliance: extendedValidator.checkDesignCompliance,
  scanCodeForApiUsage: extendedValidator.scanCodeForApiUsage,
  stripCommentsForScan: extendedValidator.stripCommentsForScan,
  isCodeLikeFile: extendedValidator.isCodeLikeFile,
  isStyleLikeFile: extendedValidator.isStyleLikeFile,

  // --- Packaging-shape helpers ---
  analyzeReachability: reachability.analyzeReachability,
  validateSource: validatePlugin.validateSource,
  extractZipFiles: zip.extractZipFiles,
  loadIgnore: ignore.loadIgnore,
  buildIgnoreMatcher: ignore.buildMatcher,

  // --- Constants from the spec (settings policy, baselines, packaging) ---
  BASELINE_PERMISSIONS: knownApi.BASELINE_PERMISSIONS,
  LEGACY_PERMISSION_ALIASES: knownApi.LEGACY_PERMISSION_ALIASES,
  PERMISSION_MIN_VERSION: knownApi.PERMISSION_MIN_VERSION,
  METHOD_REQUIRED_PERMISSION: knownApi.METHOD_REQUIRED_PERMISSION,
  KNOWN_UNDOCUMENTED_METHODS: knownApi.KNOWN_UNDOCUMENTED_METHODS,
  WHEN_CONDITION_MIN_VERSION: knownApi.WHEN_CONDITION_MIN_VERSION,
  isBlockedSettingKey: knownApi.isBlockedSettingKey,
  SKIP_DIRS: knownApi.SKIP_DIRS,
  isMetadataDir: knownApi.isMetadataDir,
  isMetadataFile: knownApi.isMetadataFile,
  TOOL_TAB_ICON_NAME_RE: knownApi.TOOL_TAB_ICON_NAME_RE,
  LOOPBACK_HOSTS: knownApi.LOOPBACK_HOSTS,
  VALID_STABILITY_VALUES: knownApi.VALID_STABILITY_VALUES,
}
