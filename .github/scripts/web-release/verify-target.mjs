import { appendFile, readFile } from 'node:fs/promises'
import { createHash } from 'node:crypto'
import { setTimeout } from 'node:timers/promises'
import { pathToFileURL } from 'node:url'
import { api, verifySource } from './github.mjs'
import { verifyPackage } from './package.mjs'
import { validateManifest } from './policy.mjs'

export async function verifyHosted(manifest, { request = fetch, wait = setTimeout } = {}) {
  validateManifest(manifest)
  for (let attempt = 1; attempt <= 6; attempt++) {
    try {
      for (const file of manifest.files) {
        const url = new URL(file.path, 'https://tree-editor.github.io/')
        url.search = new URLSearchParams({
          release: `${manifest.sourceRunId}-${manifest.sourceRunAttempt}`,
          attempt: String(attempt),
        }).toString()
        const response = await request(url, {
          redirect: 'error',
          cache: 'no-store',
          signal: AbortSignal.timeout(15000),
        })
        if (!response.ok) throw new Error('Hosted file is unavailable')
        const chunks = []
        let size = 0
        for await (const chunk of response.body) {
          size += chunk.byteLength
          if (size > file.size) {
            throw new Error('Hosted file exceeds expected size')
          }
          chunks.push(chunk)
        }
        const bytes = Buffer.concat(chunks)
        if (size !== file.size || createHash('sha256').update(bytes).digest('hex') !== file.sha256) {
          throw new Error('Hosted file differs from release')
        }
      }
      return
    } catch {
      if (attempt === 6)
        throw new Error('Deployment switched, but hosted release verification failed; inspect Pages before retrying')
      await wait(10000)
    }
  }
}

export async function verifyTarget({ directory = 'site', manifestFile = 'provenance.json', sha, request = api } = {}) {
  if (!/^[a-f0-9]{40}$/.test(sha)) throw new Error('Invalid target candidate SHA')
  const head = await request('/repos/tree-editor/tree-editor.github.io/git/ref/heads/main')
  if (head.object?.sha !== sha) throw new Error('Target release is stale')
  const manifest = JSON.parse(await readFile(manifestFile, 'utf8'))
  await verifyPackage(directory, manifest, { allowRetainedAssets: true })
  await verifySource(manifest, { request })
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    if (process.argv[2] === 'hosted' && process.argv.length === 3) {
      await verifyHosted(JSON.parse(await readFile('provenance.json', 'utf8')))
    } else {
      if (process.argv.length !== 2 || !process.env.GITHUB_OUTPUT)
        throw new Error('Invalid target verification arguments')
      await verifyTarget({ sha: process.env.GITHUB_SHA })
      await appendFile(process.env.GITHUB_OUTPUT, 'proceed=true\n')
    }
  } catch (error) {
    console.error(error.message)
    process.exitCode = 1
  }
}
