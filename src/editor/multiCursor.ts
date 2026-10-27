import { Extension } from '@tiptap/core'
import { Decoration, DecorationSet, EditorView } from '@tiptap/pm/view'
import { Plugin, PluginKey, TextSelection, type EditorState, type Transaction } from '@tiptap/pm/state'
import { DOMSerializer, Fragment, Slice } from '@tiptap/pm/model'

type Range = { from: number; to: number }
type MultiState = { ranges: Range[]; decorations: DecorationSet }
const key = new PluginKey<MultiState>('notehubMultiCursor')

function decorations(doc: EditorState['doc'], ranges: Range[]) {
  const entries: Decoration[] = []
  for (const range of ranges) {
    if (range.from === range.to) {
      const at = Math.max(0, Math.min(range.from, doc.content.size))
      entries.push(Decoration.widget(at, () => {
        const caret = document.createElement('span')
        caret.className = 'multi-cursor-caret'
        caret.setAttribute('aria-hidden', 'true')
        return caret
      }, { key: `cursor-${range.from}` }))
    } else if (range.from < range.to) {
      entries.push(Decoration.inline(range.from, range.to, { class: 'multi-cursor-selection' }, { inclusiveStart: false, inclusiveEnd: false }))
    }
  }
  return DecorationSet.create(doc, entries)
}

function mappedRanges(ranges: Range[], tr: Transaction) {
  return ranges.map(range => ({ from: tr.mapping.map(range.from), to: tr.mapping.map(range.to) }))
}

function lineRange(state: EditorState, pos: number): Range {
  const $pos = state.doc.resolve(Math.max(0, Math.min(pos, state.doc.content.size)))
  if (!$pos.parent.isTextblock) return { from: pos, to: pos }
  return { from: $pos.start(), to: $pos.end() }
}

function uniqueRanges(ranges: Range[]) {
  const seen = new Set<string>()
  return ranges.filter(range => {
    const signature = `${range.from}:${range.to}`
    if (seen.has(signature)) return false
    seen.add(signature)
    return true
  })
}

function insertAtRanges(view: EditorView, ranges: Range[], text: string, primaryRange = { from: view.state.selection.from, to: view.state.selection.to }) {
  const { state } = view
  const ordered = uniqueRanges(ranges).sort((a, b) => b.from - a.from)
  if (!ordered.length) return false
  let tr = state.tr
  for (const range of ordered) tr = tr.insertText(text, range.from, range.to)
  const cursor = Math.max(0, Math.min(tr.mapping.map(primaryRange.to, 1), tr.doc.content.size))
  tr = tr.setSelection(TextSelection.near(tr.doc.resolve(cursor)))
  tr.setMeta(key, ordered.filter(range => range.from !== primaryRange.from || range.to !== primaryRange.to).map(range => {
    const pos = tr.mapping.map(range.to, 1)
    return { from: pos, to: pos }
  }))
  view.dispatch(tr.scrollIntoView())
  return true
}

function pasteAtRanges(view: EditorView, ranges: Range[], text: string) {
  const { state } = view
  const ordered = uniqueRanges(ranges).sort((a, b) => b.from - a.from)
  if (!ordered.length) return false
  const lines = text.replace(/\r\n?/g, '\n').split('\n')
  const content = lines.flatMap((line, index) => [
    ...(line ? [state.schema.text(line)] : []),
    ...(index < lines.length - 1 ? [state.schema.nodes.hardBreak.create()] : []),
  ])
  const slice = new Slice(Fragment.fromArray(content), 0, 0)
  let tr = state.tr
  const primary = { from: state.selection.from, to: state.selection.to }
  for (const range of ordered) tr = tr.replaceRange(range.from, range.to, slice)
  const primaryPos = tr.mapping.map(primary.to, 1)
  tr = tr.setSelection(TextSelection.near(tr.doc.resolve(primaryPos)))
  const extras = ordered
    .filter(range => range.from !== primary.from || range.to !== primary.to)
    .map(range => {
      const pos = tr.mapping.map(range.to, 1)
      return { from: pos, to: pos }
    })
  tr.setMeta(key, extras)
  view.dispatch(tr.scrollIntoView())
  return true
}

function activeRanges(state: EditorState, extra: Range[]) {
  return uniqueRanges([{ from: state.selection.from, to: state.selection.to }, ...extra])
}

function copyRanges(view: EditorView, ranges: Range[], event: ClipboardEvent) {
  if (!event.clipboardData || ranges.length < 2) return false
  const { state } = view
  const normalized = uniqueRanges(ranges).sort((a, b) => a.from - b.from)
  const slices = normalized.map(range => state.doc.slice(range.from, range.to))
  const text = normalized.map(range => state.doc.textBetween(range.from, range.to, '\n', '\n')).join('\n')
  const wrapper = document.createElement('div')
  for (const slice of slices) {
    const block = document.createElement('div')
    block.appendChild(DOMSerializer.fromSchema(state.schema).serializeFragment(slice.content))
    wrapper.appendChild(block)
  }
  event.clipboardData.setData('text/plain', text)
  event.clipboardData.setData('text/html', wrapper.innerHTML)
  event.preventDefault()
  return true
}

export const MultiCursor = Extension.create({
  name: 'multiCursor',
  addProseMirrorPlugins() {
    return [new Plugin<MultiState>({
      key,
      state: {
        init: () => ({ ranges: [], decorations: DecorationSet.empty }),
        apply: (tr, previous) => {
          const explicit = tr.getMeta(key) as Range[] | undefined
          const ranges = explicit ? explicit.map(range => ({ ...range })) : mappedRanges(previous.ranges, tr).filter(range => range.from >= 0 && range.to <= tr.doc.content.size)
          return { ranges, decorations: decorations(tr.doc, ranges) }
        },
      },
      props: {
        decorations(state) { return key.getState(state)?.decorations ?? null },
        handleDOMEvents: {
          mousedown(view, event) {
            if (!(event instanceof MouseEvent) || event.button !== 0) return false
            if (!event.altKey) {
              if (!event.shiftKey && key.getState(view.state)?.ranges.length) view.dispatch(view.state.tr.setMeta(key, []))
              return false
            }
            const pos = view.posAtCoords({ left: event.clientX, top: event.clientY })?.pos
            if (pos == null) return false
            event.preventDefault()
            const current = key.getState(view.state)?.ranges ?? []
            const ranges = uniqueRanges([...current, { from: pos, to: pos }])
            view.dispatch(view.state.tr.setMeta(key, ranges))
            view.focus()
            return true
          },
          copy(view, event) {
            const extra = key.getState(view.state)?.ranges ?? []
            if (!extra.length) return false
            const ranges = activeRanges(view.state, extra).map(range => range.from === range.to ? lineRange(view.state, range.from) : range)
            return copyRanges(view, ranges, event as ClipboardEvent)
          },
        },
        handleTextInput(view, from, to, text) {
          const extra = key.getState(view.state)?.ranges ?? []
          if (!extra.length) return false
          return insertAtRanges(view, [{ from, to }, ...extra], text)
        },
        handleKeyDown(view, event) {
          const extra = key.getState(view.state)?.ranges ?? []
          if (!extra.length || (event.key !== 'Backspace' && event.key !== 'Delete') || event.ctrlKey || event.metaKey || event.altKey) return false
          const state = view.state
          const active = activeRanges(state, extra)
          const primaryIndex = active.findIndex(range => range.from === state.selection.from && range.to === state.selection.to)
          const ranges = active.map(range => {
            if (range.from !== range.to) return range
            const $pos = state.doc.resolve(range.from)
            if (!$pos.parent.isTextblock) return range
            const text = $pos.parent.textContent
            const offset = $pos.parentOffset
            if (event.key === 'Backspace' && offset > 0) {
              let length = 1
              const current = text.charCodeAt(offset - 1)
              if (current >= 0xdc00 && current <= 0xdfff && offset > 1) {
                const previous = text.charCodeAt(offset - 2)
                if (previous >= 0xd800 && previous <= 0xdbff) length = 2
              }
              return { from: range.from - length, to: range.to }
            }
            if (event.key === 'Delete' && offset < text.length) {
              let length = 1
              const current = text.charCodeAt(offset)
              if (current >= 0xd800 && current <= 0xdbff && offset + 1 < text.length) {
                const next = text.charCodeAt(offset + 1)
                if (next >= 0xdc00 && next <= 0xdfff) length = 2
              }
              return { from: range.from, to: range.to + length }
            }
            return range
          })
          const primary = ranges[primaryIndex]
          event.preventDefault()
          return insertAtRanges(view, ranges, '', primary)
        },
        handlePaste(view, event) {
          const extra = key.getState(view.state)?.ranges ?? []
          if (!extra.length) return false
          const text = event.clipboardData?.getData('text/plain')
          if (text == null) return false
          event.preventDefault()
          return pasteAtRanges(view, activeRanges(view.state, extra), text)
        },
      },
    })]
  },
  addKeyboardShortcuts() {
    return {
      Escape: () => {
        const current = key.getState(this.editor.state)?.ranges ?? []
        if (!current.length) return false
        this.editor.view.dispatch(this.editor.state.tr.setMeta(key, []))
        return true
      },
      'Mod-l': () => {
        const state = this.editor.state
        const extra = key.getState(state)?.ranges ?? []
        const currentLine = lineRange(state, state.selection.from)
        const ranges = uniqueRanges([...extra.map(range => lineRange(state, range.from)), currentLine])
        const primary = ranges.findIndex(range => range.from === currentLine.from && range.to === currentLine.to)
        const selected = ranges[primary]
        const tr = state.tr.setSelection(TextSelection.create(state.doc, selected.from, selected.to)).setMeta(key, ranges.filter((_, index) => index !== primary))
        this.editor.view.dispatch(tr)
        return true
      },
    }
  },
})

export function copyCurrentLine(editor: { state: EditorState; view: EditorView }) {
  const range = lineRange(editor.state, editor.state.selection.from)
  const text = editor.state.doc.textBetween(range.from, range.to, '\n', '\n')
  const slice = editor.state.doc.slice(range.from, range.to)
  const wrapper = document.createElement('div')
  wrapper.appendChild(DOMSerializer.fromSchema(editor.state.schema).serializeFragment(slice.content))
  void (async () => {
    try {
      if (navigator.clipboard?.write && typeof ClipboardItem !== 'undefined') {
        await navigator.clipboard.write([new ClipboardItem({ 'text/plain': new Blob([text], { type: 'text/plain' }), 'text/html': new Blob([wrapper.innerHTML], { type: 'text/html' }) })])
      } else await navigator.clipboard?.writeText(text)
    } catch {
      await navigator.clipboard?.writeText(text)
    }
  })()
  return text
}

export function clearMultiCursors(view: EditorView) {
  if (key.getState(view.state)?.ranges.length) view.dispatch(view.state.tr.setMeta(key, []))
}
