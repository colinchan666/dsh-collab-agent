/**
 * Conservative write-target extraction for managed workers. This is a policy
 * helper, not an OS sandbox; callers must still treat shell execution as a
 * best-effort boundary.
 */
import path from 'node:path'

const shellWords = (value) => (String(value).match(/"[^"]*"|'[^']*'|[^\s;&|]+/gu) ?? [])
  .map(word => word.replace(/^["']|["']$/gu, ''))
  .filter(word => word.length > 0)

/** Conservative write-target extraction for managed workers. */
const shellWriteTargets = (command, cwd) => {
  const targets = []
  const add = (value) => {
    if (typeof value !== 'string' || value.length === 0 || value.startsWith('-')) return
    targets.push(path.resolve(cwd, value))
  }
  const text = String(command)
  for (const match of text.matchAll(/\b(?:cd|pushd)\s+("[^"]+"|'[^']+'|[^\s;&|]+)/gu)) {
    const target = match[1].replace(/^["']|["']$/gu, '')
    if (target === '-' || target.startsWith('-')) continue
    if (path.resolve(cwd, target) === path.resolve(cwd)) continue
    add(target)
  }
  for (const match of text.matchAll(/(?:^|[^>&])>{1,2}\s*("[^"]+"|'[^']+'|[^\s;&|]+)/gu)) {
    const target = match[1].replace(/^["']|["']$/gu, '')
    if (!target.startsWith('&')) add(target)
  }
  for (const match of text.matchAll(/\b(cp|mv|install|rsync|ln|tee|touch|mkdir|rm|rmdir|truncate|dd|chmod|chown)\b([^;&|]*)/giu)) {
    const verb = match[1].toLowerCase()
    const words = shellWords(match[2]).filter(word => !word.startsWith('-'))
    if (verb === 'dd') {
      const of = words.find(word => word.startsWith('of='))
      if (of !== undefined) add(of.slice(3))
      continue
    }
    if (verb === 'tee' || verb === 'touch' || verb === 'mkdir' || verb === 'rm' || verb === 'rmdir' || verb === 'truncate' || verb === 'chmod' || verb === 'chown') {
      for (const word of words) {
        if (verb === 'chmod' && /^[0-7]{3,4}$/u.test(word)) continue
        add(word)
      }
      continue
    }
    if (words.length > 0) add(words[words.length - 1])
  }
  for (const match of text.matchAll(/\bsed\b([^;&|]*)/giu)) {
    if (!/(?:^|\s)-i(?:\s|$)/u.test(match[1])) continue
    const words = shellWords(match[1]).filter(word => !word.startsWith('-') && !word.startsWith('s/') && !word.startsWith('s#'))
    for (const word of words) add(word)
  }
  return targets
}

const applyPatchTargets = (patch, cwd) => {
  const targets = []
  for (const match of String(patch).matchAll(/^\*\*\* (?:Add File|Update File|Delete File|Move to): (.+)$/gmu)) {
    const value = match[1].trim()
    if (value.length > 0) targets.push(path.resolve(cwd, value))
  }
  return targets
}


export { shellWords, shellWriteTargets, applyPatchTargets }
