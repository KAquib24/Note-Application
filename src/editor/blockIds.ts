import { Extension } from '@tiptap/core'
import { Plugin } from '@tiptap/pm/state'

const blockTypes = ['paragraph', 'heading', 'bulletList', 'orderedList', 'listItem', 'codeBlock', 'blockquote', 'table']

/** Gives headings and blocks stable IDs for links and navigation. */
export const StableBlockIds = Extension.create({
  name: 'stableBlockIds',
  addGlobalAttributes() {
    return [{ types: blockTypes, attributes: { blockId: {
      default: null,
      parseHTML: (element: HTMLElement) => element.getAttribute('data-block-id'),
      renderHTML: (attributes: { blockId?: string | null }) => attributes.blockId ? { 'data-block-id': attributes.blockId } : {},
    } } }]
  },
  addProseMirrorPlugins() {
    return [new Plugin({ appendTransaction: (_transactions, _oldState, newState) => {
      const seen = new Set<string>()
      const updates: Array<{ pos: number; attrs: Record<string, unknown> }> = []
      newState.doc.descendants((node, pos) => {
        if (!blockTypes.includes(node.type.name)) return
        let id = node.attrs.blockId as string | null
        if (!id || seen.has(id)) id = crypto.randomUUID()
        seen.add(id)
        if (node.attrs.blockId !== id) updates.push({ pos, attrs: { ...node.attrs, blockId: id } })
      })
      if (!updates.length) return null
      const transaction = newState.tr
      for (const update of updates) transaction.setNodeMarkup(update.pos, undefined, update.attrs)
      return transaction
    } })]
  },
})
