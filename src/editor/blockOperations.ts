import { Extension, type Editor } from '@tiptap/core'
import { Selection, TextSelection } from '@tiptap/pm/state'

type Direction = -1 | 1

function topLevelBlocks(editor: Editor) {
  const blocks = editor.state.doc.content.content
  const positions: number[] = []
  let position = 0
  for (const block of blocks) {
    positions.push(position)
    position += block.nodeSize
  }
  return { blocks, positions }
}

function selectedTopLevelIndex(editor: Editor, positions: number[]) {
  const topPosition = editor.state.selection.$from.depth ? editor.state.selection.$from.before(1) : -1
  return positions.indexOf(topPosition)
}

function sectionEnd(blocks: readonly { type: { name: string }; attrs: Record<string, unknown> }[], start: number) {
  const block = blocks[start]
  if (block.type.name !== 'heading') return start + 1
  const level = Number(block.attrs.level ?? 1)
  let end = start + 1
  while (end < blocks.length) {
    const next = blocks[end]
    if (next.type.name === 'heading' && Number(next.attrs.level ?? 1) <= level) break
    end++
  }
  return end
}

function moveRange(editor: Editor, direction: Direction): boolean {
  const { state } = editor
  const { blocks, positions } = topLevelBlocks(editor)
  const selectedIndex = selectedTopLevelIndex(editor, positions)
  if (selectedIndex < 0 || blocks.length < 2) return false

  const selectedBlock = blocks[selectedIndex]
  const sourceStart = selectedIndex
  const sourceEnd = sectionEnd(blocks, sourceStart)
  const isHeading = selectedBlock.type.name === 'heading'
  let targetStart: number
  let targetEnd: number

  if (direction < 0) {
    if (sourceStart === 0) return false
    if (!isHeading) {
      targetStart = sourceStart - 1
      if (blocks[targetStart].type.name === 'heading') return false
      targetEnd = sourceStart
    } else {
      targetStart = sourceStart - 1
      while (targetStart > 0 && blocks[targetStart].type.name !== 'heading') targetStart--
      if (blocks[targetStart].type.name !== 'heading') targetStart = 0
      targetEnd = sourceStart
    }
  } else {
    if (sourceEnd >= blocks.length) return false
    targetStart = sourceEnd
    if (!isHeading) {
      if (blocks[targetStart].type.name === 'heading') return false
      targetEnd = targetStart + 1
    } else targetEnd = sectionEnd(blocks, targetStart)
  }

  const source = blocks.slice(sourceStart, sourceEnd)
  const target = blocks.slice(targetStart, targetEnd)
  const reordered = direction < 0
    ? [...blocks.slice(0, targetStart), ...source, ...target, ...blocks.slice(sourceEnd)]
    : [...blocks.slice(0, sourceStart), ...target, ...source, ...blocks.slice(targetEnd)]

  const selectedNodeIndex = positions.findIndex(pos => pos === state.selection.$from.before(1))
  const selectedNode = blocks[selectedNodeIndex]
  const oldNodeStart = positions[selectedNodeIndex]
  const offset = Math.max(1, state.selection.from - oldNodeStart)
  const oldToOffset = Math.max(offset, state.selection.to - oldNodeStart)
  const newNodeIndex = reordered.indexOf(selectedNode)
  const newNodeStart = reordered.slice(0, newNodeIndex).reduce((sum, node) => sum + node.nodeSize, 0)
  const newNode = reordered[newNodeIndex]
  const maxOffset = Math.max(1, newNode.nodeSize - 1)
  const from = newNodeStart + Math.min(offset, maxOffset)
  const sameBlockSelection = state.selection.$from.before(1) === state.selection.$to.before(1)
  const to = sameBlockSelection ? newNodeStart + Math.min(oldToOffset, maxOffset) : from

  let transaction = state.tr.replaceWith(0, state.doc.content.size, reordered)
  const resolvedFrom = Math.min(from, transaction.doc.content.size)
  const resolvedTo = Math.min(Math.max(from, to), transaction.doc.content.size)
  const selection = state.selection instanceof TextSelection && newNode.isTextblock
    ? TextSelection.create(transaction.doc, resolvedFrom, Math.max(resolvedFrom, resolvedTo))
    : Selection.near(transaction.doc.resolve(resolvedFrom))
  transaction = transaction.setSelection(selection).scrollIntoView()
  editor.view.dispatch(transaction)
  editor.view.focus()
  return true
}

export function canMoveBlock(editor: Editor, direction: Direction) {
  const { blocks, positions } = topLevelBlocks(editor)
  const selectedIndex = selectedTopLevelIndex(editor, positions)
  if (selectedIndex < 0 || blocks.length < 2) return false
  const sourceEnd = sectionEnd(blocks, selectedIndex)
  const isHeading = blocks[selectedIndex].type.name === 'heading'
  if (direction < 0) return selectedIndex > 0 && (isHeading || blocks[selectedIndex - 1].type.name !== 'heading')
  return sourceEnd < blocks.length && (isHeading || blocks[sourceEnd].type.name !== 'heading')
}

export const BlockOperations = Extension.create({
  name: 'blockOperations',
  addKeyboardShortcuts() {
    return {
      'Alt-ArrowUp': () => moveRange(this.editor, -1),
      'Alt-ArrowDown': () => moveRange(this.editor, 1),
    }
  },
})

export function moveBlock(editor: Editor, direction: Direction) {
  return moveRange(editor, direction)
}
