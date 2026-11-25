/** Canonical delivery manifest and opaque alias publication. */
export function createDeliveryManifestService({
  sharedRoot, tasks, fs, path, crypto, mkdirp, writeJson, listDeliveryFiles, warn, maxFiles = 2000,
}) {
  const rootFor = taskId => path.join(sharedRoot, taskId ?? 'default', 'artifacts')

  const buildDeliveryManifest = (taskId) => {
    const task = tasks.project(taskId)
    if (task === undefined) throw new Error('unknown task')
    const root = rootFor(taskId)
    const listed = listDeliveryFiles(root)
    if (listed.truncated === true) throw new Error(`delivery has more than ${maxFiles} files; split the task`)
    const files = listed.sort((left, right) => left.path.localeCompare(right.path)).map(file => {
      const full = path.join(root, file.path)
      const before = fs.statSync(full)
      const content = fs.readFileSync(full)
      const after = fs.statSync(full)
      if (before.size !== after.size || before.mtimeMs !== after.mtimeMs) {
        throw new Error(`delivery file changed while hashing: ${file.path}`)
      }
      const hash = crypto.createHash('sha256').update(content).digest('hex')
      return {
        path: file.path.split(path.sep).join('/'),
        bytes: after.size,
        sha256: hash,
        mode: `0${(after.mode & 0o777).toString(8)}`,
      }
    })
    const manifest = {
      generatedAt: new Date().toISOString(),
      root,
      files,
    }
    const taskDir = path.join(sharedRoot, taskId)
    mkdirp(taskDir, 0o755)
    const manifestPath = path.join(taskDir, 'manifest.json')
    const temporary = `${manifestPath}.${crypto.randomBytes(4).toString('hex')}.tmp`
    writeJson(temporary, manifest, 0o644)
    fs.renameSync(temporary, manifestPath)
    return manifest
  }

  const publishDeliveryAlias = (taskId, deliveryId) => {
    const target = rootFor(taskId)
    const aliasRoot = path.join(sharedRoot, '.deliveries', deliveryId)
    const alias = path.join(aliasRoot, 'artifacts')
    mkdirp(aliasRoot, 0o755)
    try {
      const existing = fs.lstatSync(alias)
      if (existing.isSymbolicLink() && fs.realpathSync(alias) === fs.realpathSync(target)) return alias
      fs.rmSync(alias, { recursive: true, force: true })
    } catch { /* alias does not exist yet */ }
    try {
      fs.symlinkSync(target, alias, 'dir')
      return alias
    } catch (error) {
      warn(`delivery alias could not be published: ${String(error)}`)
      return target
    }
  }

  return { buildDeliveryManifest, publishDeliveryAlias }
}
