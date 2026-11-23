import assert from 'node:assert/strict'
import path from 'node:path'
import test from 'node:test'

import { applyPatchTargets, shellWords, shellWriteTargets } from '../lib/write-scope.js'

const cwd = path.resolve('/tmp/collab-write-scope')

test('shell write extraction finds redirections and copy destinations', () => {
  assert.deepEqual(shellWriteTargets('echo ok > result.md', cwd), [path.join(cwd, 'result.md')])
  assert.deepEqual(shellWriteTargets('cp result.md /tmp/exfil', cwd), ['/tmp/exfil'])
  assert.deepEqual(shellWriteTargets('cd /tmp && echo pwn > x', cwd), ['/tmp', path.join(cwd, 'x')])
  assert.deepEqual(shellWriteTargets('cat source.md', cwd), [])
  assert.deepEqual(shellWords('cp "a b" c'), ['cp', 'a b', 'c'])
})

test('apply_patch targets include add/update/delete/move headers', () => {
  const patch = [
    '*** Begin Patch',
    '*** Add File: a.txt',
    '*** Update File: b.txt',
    '*** Move to: c.txt',
    '*** Delete File: d.txt',
    '*** End Patch',
  ].join('\n')
  assert.deepEqual(applyPatchTargets(patch, cwd), [
    path.join(cwd, 'a.txt'),
    path.join(cwd, 'b.txt'),
    path.join(cwd, 'c.txt'),
    path.join(cwd, 'd.txt'),
  ])
})
