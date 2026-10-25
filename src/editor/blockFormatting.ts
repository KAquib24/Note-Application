import { Extension, type Editor } from '@tiptap/core'

const blockTypes = ['paragraph', 'heading', 'codeBlock', 'blockquote']

export const BlockFormatting = Extension.create({
  name: 'blockFormatting',
  addGlobalAttributes() {
    return [{ types: blockTypes, attributes: { blockStyle: {
      default: null,
      parseHTML: (element: HTMLElement) => ({ color: element.style.color || null, backgroundColor: element.style.backgroundColor || null }),
      renderHTML: (attributes: { blockStyle?: { color?: string | null; backgroundColor?: string | null } | null }) => {
        const style = attributes.blockStyle
        if (!style) return {}
        return { style: [style.color ? `color: ${style.color}` : '', style.backgroundColor ? `background-color: ${style.backgroundColor}` : ''].filter(Boolean).join('; ') }
      },
    } } }]
  },
})

export function applyBlockColor(editor: Editor, property: 'color' | 'backgroundColor', value: string | null) {
  const { state } = editor
  const candidates = new Map<number, typeof state.doc>()
  const { selection } = state
  if (selection.empty) {
    for (let depth = selection.$from.depth; depth > 0; depth--) {
      const node = selection.$from.node(depth)
      if (blockTypes.includes(node.type.name)) {
        candidates.set(selection.$from.before(depth), node)
        break
      }
    }
  } else {
    state.doc.nodesBetween(selection.from, selection.to, (node, pos) => {
      if (blockTypes.includes(node.type.name)) candidates.set(pos, node)
    })
  }
  if (candidates.size === 0) return
  let transaction = state.tr
  for (const [pos, node] of candidates) {
    const current = (node.attrs.blockStyle as { color?: string | null; backgroundColor?: string | null } | null) ?? {}
    const next = { ...current }
    if (value) next[property] = value
    else delete next[property]
    transaction = transaction.setNodeMarkup(pos, undefined, { ...node.attrs, blockStyle: Object.keys(next).length ? next : null })
  }
  editor.view.dispatch(transaction)
  editor.view.focus()
}
