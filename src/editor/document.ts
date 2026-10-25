import type { JSONContent } from '@tiptap/core'

export const EMPTY_DOCUMENT: JSONContent = { type: 'doc', content: [{ type: 'paragraph' }] }

export function toDocument(value: unknown): JSONContent {
  if (typeof value === 'string') {
    const text = value.trim()
    return text ? { type: 'doc', content: text.split(/\n{2,}/).map(content => ({ type: 'paragraph', content: [{ type: 'text', text: content.replace(/\n/g, ' ') }] })) } : EMPTY_DOCUMENT
  }
  if (value && typeof value === 'object' && (value as JSONContent).type === 'doc') return value as JSONContent
  return EMPTY_DOCUMENT
}

