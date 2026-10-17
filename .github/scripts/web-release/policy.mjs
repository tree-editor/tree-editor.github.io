export const SOURCE_REPOSITORY = 'abtv/tree'
export const MAX_FILES = 128
export const MAX_FILE_BYTES = 10 * 1024 * 1024
export const MAX_PACKAGE_BYTES = 25 * 1024 * 1024

export function allowedPath(path) {
  return (
    path === 'index.html' ||
    path === '.nojekyll' ||
    (typeof path === 'string' && /^assets\/[A-Za-z0-9_.-]+$/.test(path) && path !== 'assets/.' && path !== 'assets/..')
  )
}

export function validateManifest(manifest) {
  if (
    manifest?.schema !== 1 ||
    manifest.sourceRepository !== SOURCE_REPOSITORY ||
    typeof manifest.sourceSha !== 'string' ||
    !/^[a-f0-9]{40}$/.test(manifest.sourceSha) ||
    typeof manifest.sourceRunId !== 'string' ||
    !/^[1-9][0-9]*$/.test(manifest.sourceRunId) ||
    !Number.isSafeInteger(manifest.sourceRunAttempt) ||
    manifest.sourceRunAttempt < 1 ||
    !Array.isArray(manifest.files) ||
    manifest.files.length > MAX_FILES
  )
    throw new Error('Invalid release manifest identity or bounds')
  const paths = new Set()
  let total = 0
  for (const file of manifest.files) {
    if (
      !allowedPath(file.path) ||
      paths.has(file.path) ||
      !/^[a-f0-9]{64}$/.test(file.sha256) ||
      !Number.isSafeInteger(file.size) ||
      file.size < 0 ||
      file.size > MAX_FILE_BYTES
    ) {
      throw new Error('Invalid release file')
    }
    paths.add(file.path)
    total += file.size
  }
  if (
    total > MAX_PACKAGE_BYTES ||
    !paths.has('index.html') ||
    !paths.has('.nojekyll') ||
    ![...paths].some((path) => /^assets\/.+\.js$/.test(path)) ||
    ![...paths].some((path) => /^assets\/.+\.css$/.test(path)) ||
    ![...paths].some((path) => /^assets\/.+\.(?:woff2?|ttf|otf)$/.test(path))
  ) {
    throw new Error('Incomplete or oversized release package')
  }
  return manifest
}

export function validateGate(results, { memoryRequired, demoRequired }) {
  for (const key of ['changes', 'check', 'electron', 'audit', 'chrome']) {
    if (results[key]?.result !== 'success') throw new Error(`Release check ${key} did not succeed`)
  }
  for (const [key, required] of [
    ['memory', memoryRequired],
    ['demo', demoRequired],
  ]) {
    if (typeof required !== 'boolean') throw new Error(`Missing release selector for ${key}`)
    const result = results[key]?.result
    if (result !== 'success' && !(result === 'skipped' && !required)) {
      throw new Error(`Release check ${key} did not succeed`)
    }
  }
}

// Keep these selectors aligned with demo.yml and e2e-memory.yml.
export function selectChecks(paths) {
  const shared = /^(?:package(?:-lock)?\.json|\.nvmrc)$/
  return {
    demo: paths.some(
      (path) =>
        shared.test(path) ||
        /^src\//.test(path) ||
        [
          'scripts/record-demo.mjs',
          'scripts/readme-screenshots.mjs',
          'docs/images/demo-document.json',
          'e2e/electron-entry.cjs',
          'e2e/hidden-windows.cjs',
          'e2e/shortcut-stub.cjs',
          'electron.vite.config.ts',
          '.github/workflows/demo.yml',
        ].includes(path),
    ),
    memory: paths.some(
      (path) =>
        shared.test(path) ||
        /^e2e\/(?:shared-application[^/]*\.spec\.ts|[^/]+\.cjs)$/.test(path) ||
        /^playwright[^/]*\.config\.ts$/.test(path) ||
        /^\.github\/workflows\/e2e[^/]*\.yml$/.test(path) ||
        [
          'e2e/fixtures.ts',
          'e2e/global-setup.ts',
          'e2e/electron-process.ts',
          'e2e/clipboard-lock.ts',
          'tsconfig.e2e.json',
          'scripts/e2e-diagnose.mjs',
        ].includes(path),
    ),
  }
}
