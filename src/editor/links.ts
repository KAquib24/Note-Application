import { Mark } from '@tiptap/core'
import { safeExternalUrl } from './safeExternalUrl'
export { safeExternalUrl } from './safeExternalUrl'

export type LinkType = 'external' | 'note' | 'section' | 'heading'
export type NoteLinkAttrs = { href: string | null; linkType: LinkType; targetId: string | null; targetNoteId: string | null; headingId: string | null }

export const NoteLink = Mark.create({
  name: 'link',
  inclusive: false,
  addAttributes() {
    return {
      href: { default: null, parseHTML: element => element.getAttribute('data-link-type') === 'external' ? element.getAttribute('href') : null, renderHTML: attrs => attrs.linkType === 'external' && attrs.href ? { href: attrs.href } : {} },
      linkType: { default: 'external', parseHTML: element => element.getAttribute('data-link-type') ?? 'external', renderHTML: attrs => ({ 'data-link-type': attrs.linkType }) },
      targetId: { default: null, parseHTML: element => element.getAttribute('data-target-id'), renderHTML: attrs => attrs.targetId ? { 'data-target-id': attrs.targetId } : {} },
      targetNoteId: { default: null, parseHTML: element => element.getAttribute('data-target-note-id'), renderHTML: attrs => attrs.targetNoteId ? { 'data-target-note-id': attrs.targetNoteId } : {} },
      headingId: { default: null, parseHTML: element => element.getAttribute('data-heading-id'), renderHTML: attrs => attrs.headingId ? { 'data-heading-id': attrs.headingId } : {} },
    }
  },
  parseHTML() { return [{ tag: 'a[href]' }, { tag: 'a[data-link-type]' }] },
  renderHTML({ HTMLAttributes }) {
    const attrs = { ...HTMLAttributes }
    const type = String(attrs['data-link-type'] ?? 'external')
    if (type === 'external') {
      const safe = safeExternalUrl(String(attrs.href ?? ''))
      if (!safe) { delete attrs.href; delete attrs.target; delete attrs.rel }
      else { attrs.href = safe; attrs.target = '_blank'; attrs.rel = 'noopener noreferrer nofollow' }
    } else {
      const id = type === 'heading' ? attrs['data-target-note-id'] : attrs['data-target-id']
      attrs.href = id ? `/note/${encodeURIComponent(String(id))}` : '#'
      attrs.title = type === 'heading' ? 'Open heading' : type === 'section' ? 'Open section' : 'Open note'
    }
    return ['a', attrs, 0]
  },
  addKeyboardShortcuts() {
    return {
      'Mod-k': () => { this.editor.view.dom.dispatchEvent(new CustomEvent('notehub:open-link', { bubbles: true })); return true },
    }
  },
})
