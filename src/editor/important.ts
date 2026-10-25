import { Mark } from '@tiptap/core'

export const ImportantMark = Mark.create({
  name: 'important',
  inclusive: false,
  addAttributes() {
    return { importantId: {
      default: null,
      parseHTML: (element: HTMLElement) => element.getAttribute('data-important-id'),
      renderHTML: (attributes: { importantId?: string | null }) => attributes.importantId ? { 'data-important-id': attributes.importantId } : {},
    } }
  },
  parseHTML() { return [{ tag: 'mark[data-important-id]' }] },
  renderHTML({ HTMLAttributes }) { return ['mark', HTMLAttributes, 0] },
})
