import { readFile, mkdir, writeFile, rename } from 'node:fs/promises'
import { dirname, resolve } from 'node:path'
import { randomUUID } from 'node:crypto'
import { mergeCandidates, validateCandidates } from './auction-candidates.mjs'

export function createFileCandidateStore(file = resolve('.cache/auction-candidates.json')) {
  let pending = Promise.resolve()
  const read = async () => {
    try {
      const content = await readFile(file, 'utf8')
      if (content.length > 5 * 1024 * 1024) return []
      const data = JSON.parse(content)
      return Array.isArray(data) ? data.filter(value => validateCandidates(value)) : []
    } catch (error) {
      if (error.code === 'ENOENT' || error instanceof SyntaxError) return []
      throw error
    }
  }
  return {
    async load(sourceDate) {
      await pending
      return (await read()).find(value => value.sourceDate === sourceDate) ?? null
    },
    save(value) {
      const task = pending.then(async () => {
        const days = await read()
        const merged = mergeCandidates(days.find(day => day.sourceDate === value.sourceDate), value)
        const output = [...days.filter(day => day.sourceDate !== value.sourceDate), merged]
          .sort((a, b) => b.sourceDate.localeCompare(a.sourceDate)).slice(0, 30)
        await mkdir(dirname(file), { recursive: true })
        const temp = `${file}.${randomUUID()}.tmp`
        await writeFile(temp, JSON.stringify(output), 'utf8')
        await rename(temp, file)
      })
      pending = task.catch(() => {})
      return task
    },
  }
}
