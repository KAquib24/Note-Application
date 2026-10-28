export type AuthUser = {
  id: string
  email: string
  name: string
  createdAt: number
  passwordHash: string
}

const USERS_KEY = 'notehub:users'
const SESSION_KEY = 'notehub:session'

function normalizeEmail(value: string) {
  return value.trim().toLowerCase()
}

function hashPassword(value: string) {
  let hash = 0
  for (let index = 0; index < value.length; index += 1) {
    hash = ((hash << 5) - hash + value.charCodeAt(index)) | 0
  }
  return String(hash >>> 0)
}

function readUsers(): Record<string, AuthUser> {
  try {
    const raw = localStorage.getItem(USERS_KEY)
    return raw ? (JSON.parse(raw) as Record<string, AuthUser>) : {}
  } catch {
    return {}
  }
}

function writeUsers(users: Record<string, AuthUser>) {
  try {
    localStorage.setItem(USERS_KEY, JSON.stringify(users))
    return true
  } catch {
    return false
  }
}

export function getCurrentUser(): AuthUser | null {
  try {
    const raw = localStorage.getItem(SESSION_KEY)
    return raw ? (JSON.parse(raw) as AuthUser) : null
  } catch {
    return null
  }
}

export function setCurrentUser(user: AuthUser | null) {
  try {
    if (!user) {
      localStorage.removeItem(SESSION_KEY)
      return true
    }
    localStorage.setItem(SESSION_KEY, JSON.stringify(user))
    return true
  } catch {
    return false
  }
}

export type AuthResult =
  | { ok: true; user: AuthUser }
  | { ok: false; message: string }

export function signUp(email: string, password: string, name: string): AuthResult {
  const cleanedEmail = normalizeEmail(email)
  const trimmedName = name.trim()
  if (!cleanedEmail || !password || !trimmedName) return { ok: false, message: 'Please fill in the required account details.' }

  const users = readUsers()
  if (users[cleanedEmail]) return { ok: false, message: 'An account already exists for this email.' }

  const user: AuthUser = {
    id: crypto.randomUUID(),
    email: cleanedEmail,
    name: trimmedName,
    createdAt: Date.now(),
    passwordHash: hashPassword(password),
  }

  users[cleanedEmail] = user
  if (!writeUsers(users)) return { ok: false, message: 'Your browser storage is unavailable right now.' }
  setCurrentUser(user)
  return { ok: true, user }
}

export function login(email: string, password: string): AuthResult {
  const cleanedEmail = normalizeEmail(email)
  const users = readUsers()
  const user = users[cleanedEmail]
  if (!user) return { ok: false, message: 'No account was found for that email.' }
  if (user.passwordHash !== hashPassword(password)) return { ok: false, message: 'That password does not match this account.' }
  setCurrentUser(user)
  return { ok: true, user }
}

export function logout() {
  setCurrentUser(null)
}

export function getUserWorkspaceKey(user?: AuthUser | null) {
  return user ? `workspace-v1:${user.id}` : 'workspace-v1'
}

export function getCloudWorkspaceKey(user?: AuthUser | null) {
  return user ? `cloud-workspace-v1:${user.id}` : 'cloud-workspace-v1'
}
