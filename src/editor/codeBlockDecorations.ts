import { Extension } from '@tiptap/core'
import { Plugin, PluginKey } from '@tiptap/pm/state'
import { Decoration, DecorationSet } from '@tiptap/pm/view'
import { highlightCode } from './syntax'

const key = new PluginKey<DecorationSet>('notehubCodeDecorations')

type Token = { text: string; classes: string[] }
function tokens(html: string): Token[] {
  const root = document.createElement('div')
  root.innerHTML = html
  const result: Token[] = []
  const visit = (node: Node, parentClasses: string[]) => {
    if (node.nodeType === Node.TEXT_NODE) {
      const text = node.textContent ?? ''
      if (text) result.push({ text, classes: parentClasses })
      return
    }
    if (node.nodeType !== Node.ELEMENT_NODE) return
    const element = node as HTMLElement
    const classes = [...parentClasses, ...Array.from(element.classList)]
    element.childNodes.forEach(child => visit(child, classes))
  }
  root.childNodes.forEach(child => visit(child, []))
  return result
}

function createDecorations(doc: Parameters<typeof DecorationSet.create>[0]) {
  const decorations: Decoration[] = []
  doc.descendants((node, position) => {
    if (node.type.name !== 'codeBlock') return
    const code = node.textContent
    const language = String(node.attrs.language ?? 'plaintext')
    const html = code ? highlightCode(code, language) : null
    if (html) {
      let offset = 0
      for (const token of tokens(html)) {
        const from = position + 1 + offset
        const to = from + token.text.length
        if (token.classes.length && to <= position + node.nodeSize - 1) {
          decorations.push(Decoration.inline(from, to, { class: `hljs ${token.classes.join(' ')}` }))
        }
        offset += token.text.length
      }
    }
    const lineStarts = [0]
    for (let i = 0; i < code.length; i++) if (code[i] === '\n') lineStarts.push(i + 1)
    lineStarts.forEach((offset, index) => {
      const at = position + 1 + offset
      if (at <= position + node.nodeSize - 1) decorations.push(Decoration.widget(at, () => {
        const number = document.createElement('span')
        number.className = 'editor-code-line-number'
        number.textContent = String(index + 1)
        number.setAttribute('contenteditable', 'false')
        number.setAttribute('aria-hidden', 'true')
        return number
      }, { side: -1, key: `code-line-${position}-${index}` }))
    })
  })
  return DecorationSet.create(doc, decorations)
}

export const CodeBlockDecorations = Extension.create({
  name: 'codeBlockDecorations',
  addProseMirrorPlugins() {
    return [new Plugin({
      key,
      state: {
        init: (_, state) => createDecorations(state.doc),
        apply: (transaction, previous) => transaction.docChanged
          ? createDecorations(transaction.doc)
          : previous.map(transaction.mapping, transaction.doc),
      },
      props: { decorations: state => key.getState(state) ?? null },
    })]
  },
})
