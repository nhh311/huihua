import { openDB } from 'idb'
import type { Session } from '../types'

const DB_NAME = 'huihua'
const DB_VERSION = 1

const dbPromise = openDB(DB_NAME, DB_VERSION, {
  upgrade(db) {
    if (!db.objectStoreNames.contains('sessions')) {
      db.createObjectStore('sessions', { keyPath: 'id' })
    }
    if (!db.objectStoreNames.contains('meta')) {
      db.createObjectStore('meta', { keyPath: 'key' })
    }
  },
})

export const loadSessions = async (): Promise<Session[]> => {
  const db = await dbPromise
  const list = await db.getAll('sessions')
  return (list || []).sort((a, b) => String(b.updatedAt).localeCompare(String(a.updatedAt)))
}

export const putSession = async (session: Session) => {
  const db = await dbPromise
  await db.put('sessions', session)
}

export const deleteSession = async (id: string) => {
  const db = await dbPromise
  await db.delete('sessions', id)
}

export const getMeta = async (key: string) => {
  const db = await dbPromise
  const row = await db.get('meta', key)
  return row?.value
}

export const setMeta = async (key: string, value: any) => {
  const db = await dbPromise
  await db.put('meta', { key, value })
}

const timers = new Map<string, ReturnType<typeof setTimeout>>()

export const scheduleSave = (session: Session, delay = 350) => {
  const existing = timers.get(session.id)
  if (existing) clearTimeout(existing)
  timers.set(
    session.id,
    setTimeout(() => {
      timers.delete(session.id)
      putSession(session).catch(() => {})
    }, delay)
  )
}

export const flushSave = (session: Session) => {
  const existing = timers.get(session.id)
  if (existing) clearTimeout(existing)
  timers.delete(session.id)
  return putSession(session)
}
