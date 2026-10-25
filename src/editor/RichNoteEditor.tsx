import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { EditorContent, useEditor, useEditorState } from '@tiptap/react'
import { CodeBlock } from '@tiptap/extension-code-block'
import { StarterKit } from '@tiptap/starter-kit'
import { Placeholder } from '@tiptap/extensions'
import { Bold, Code2, Italic, List, ListOrdered, Redo2, Strikethrough, Underline, Undo2, Outdent, Indent, Check, LoaderCircle, RotateCcw, Star, Trash2, CornerUpRight, Palette, Highlighter, PanelTop, Square, X, ArrowUp, ArrowDown, Minus, Table2, Rows3, Columns3, Combine, Split, Link2, ExternalLink, Copy } from 'lucide-react'
import { useNavigate } from 'react-router-dom'
import type { JSONContent } from '@tiptap/core'
import { TextStyle, Color } from '@tiptap/extension-text-style'
import { Highlight } from '@tiptap/extension-highlight'
import { toDocument } from './document'
import { StableBlockIds } from './blockIds'
import { ImportantMark } from './important'
import { applyBlockColor, BlockFormatting } from './blockFormatting'
import { BlockOperations, canMoveBlock, moveBlock } from './blockOperations'
import { TableKit } from '@tiptap/extension-table'
import { LinkDialog, type LinkItem, type LinkSubject, type LinkTarget } from './LinkDialog'
import { NoteLink, safeExternalUrl, type NoteLinkAttrs } from './links'

type Props = { noteId: string; content: JSONContent | string; focusOnMount?: boolean; subjects: LinkSubject[]; items: LinkItem[]; save: (id: string, doc: JSONContent) => boolean; onFlushReady?: (flush:()=>JSONContent)=>void }
type SaveState = 'saved' | 'saving' | 'failed'
type LinkDialogState = { from: number; to: number; text: string; attrs: Partial<NoteLinkAttrs> | null }
type LinkMenuState = Omit<LinkDialogState, 'attrs'> & { attrs: NoteLinkAttrs; x: number; y: number }
const jsonText = (node: JSONContent): string => node.text ?? (node.content ?? []).map(jsonText).join('')
const languages = ['plaintext', 'python', 'javascript', 'typescript', 'java', 'c', 'cpp', 'sql', 'bash', 'json', 'html', 'css']
type ImportantNote = { id: string; from: number; to: number; text: string; blockId: string | null }

function collectImportantNotes(editor: NonNullable<ReturnType<typeof useEditor>>): ImportantNote[] {
  const ranges = new Map<string, ImportantNote>()
  editor.state.doc.descendants((node, pos, parent) => {
    if (!node.isText) return
    const marker = node.marks.find(mark => mark.type.name === 'important' && typeof mark.attrs.importantId === 'string')
    if (!marker) return
    const id = marker.attrs.importantId as string
    const end = pos + node.nodeSize
    const existing = ranges.get(id)
    if (existing) {
      existing.from = Math.min(existing.from, pos)
      existing.to = Math.max(existing.to, end)
    } else ranges.set(id, { id, from: pos, to: end, text: '', blockId: (parent?.attrs.blockId as string | undefined) ?? null })
  })
  return [...ranges.values()].map(range => ({ ...range, text: editor.state.doc.textBetween(range.from, range.to, ' ', '\n').trim() })).filter(range => range.text).sort((a, b) => a.from - b.from)
}

function ToolbarButton({ label, active, disabled, children, onClick }: { label: string; active?: boolean; disabled?: boolean; children: React.ReactNode; onClick: () => void }) {
  return <button type="button" className={`editor-tool ${active ? 'is-active' : ''}`} aria-label={label} title={label} aria-pressed={active} disabled={disabled} onMouseDown={event => event.preventDefault()} onClick={onClick}>{children}</button>
}

function ColorPicker({ label, icon, value, onChange, onClear }: { label: string; icon: React.ReactNode; value: string; onChange: (value: string) => void; onClear: () => void }) {
  return <span className="editor-color-control"><label className="editor-color-picker" title={label}><span>{icon}<i style={{ backgroundColor: value }}/></span><input type="color" aria-label={label} value={value} onChange={event => onChange(event.currentTarget.value)}/></label><button type="button" className="editor-color-reset" aria-label={`Clear ${label.toLocaleLowerCase()}`} title={`Clear ${label.toLocaleLowerCase()}`} onMouseDown={event => event.preventDefault()} onClick={onClear}><X size={11}/></button></span>
}

function activeLinkAt(editor: NonNullable<ReturnType<typeof useEditor>>, position: number) {
  const doc = editor.state.doc
  const candidates: Array<{ from: number; to: number; attrs: NoteLinkAttrs; distance: number }> = []
  doc.descendants((node, pos) => {
    if (!node.isText) return
    const mark = node.marks.find(value => value.type.name === 'link')
    if (!mark) return
    const start = pos
    const end = pos + node.nodeSize
    const distance = position < start ? start - position : position > end ? position - end : 0
    candidates.push({ from: start, to: end, attrs: mark.attrs as NoteLinkAttrs, distance })
  })
  if (!candidates.length) return null
  const nearest = candidates.reduce((best, candidate) => candidate.distance < best.distance ? candidate : best)
  if (nearest.distance > 0) return null
  const signature = JSON.stringify(nearest.attrs)
  let from = nearest.from, to = nearest.to
  for (const candidate of candidates) if (JSON.stringify(candidate.attrs) === signature && Math.abs(candidate.from - to) <= 1) to = Math.max(to, candidate.to)
  return { from, to, attrs: nearest.attrs, text: doc.textBetween(from, to, '', '') }
}

export function RichNoteEditor({ noteId, content, focusOnMount, subjects, items, save, onFlushReady }: Props) {
  const navigate = useNavigate()
  const [saveState, setSaveState] = useState<SaveState>('saved')
  const [linkDialog, setLinkDialog] = useState<LinkDialogState | null>(null)
  const [linkMenu, setLinkMenu] = useState<LinkMenuState | null>(null)
  const [linkMessage, setLinkMessage] = useState('')
  const [textColor, setTextColor] = useState('#e2e8f0')
  const [highlightColor, setHighlightColor] = useState('#ffe58f')
  const [blockTextColor, setBlockTextColor] = useState('#e2e8f0')
  const [blockBackground, setBlockBackground] = useState('#24364a')
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const latest = useRef<JSONContent>(toDocument(content))
  const saveRef = useRef(save)
  saveRef.current = save
  const extensions = useMemo(() => [
    StarterKit.configure({ codeBlock: false, link: false }),
    TextStyle,
    Color.configure({ types: ['textStyle'] }),
    Highlight.configure({ multicolor: true }),
    CodeBlock.configure({ enableTabIndentation: true, tabSize: 4, defaultLanguage: 'plaintext' }),
    Placeholder.configure({ placeholder: 'Start writing...' }),
    StableBlockIds,
    ImportantMark,
    BlockFormatting,
    BlockOperations,
    NoteLink,
    TableKit.configure({ table: { resizable: true, cellMinWidth: 72, lastColumnResizable: true } }),
  ], [])
  const editor = useEditor({ extensions, content: toDocument(content), immediatelyRender: false, onUpdate: ({ editor: current }) => {
    latest.current = current.getJSON()
    setSaveState('saving')
    if (timer.current) clearTimeout(timer.current)
    timer.current = setTimeout(() => {
      timer.current = null
      setSaveState(saveRef.current(noteId, latest.current) ? 'saved' : 'failed')
    }, 650)
  } }, [noteId])

  useEffect(() => {
    if (!editor) return
    const next = toDocument(content)
    if (JSON.stringify(editor.getJSON()) !== JSON.stringify(next)) editor.commands.setContent(next, { emitUpdate: false })
    latest.current = editor.getJSON()
  }, [editor, noteId, content])

  useEffect(() => {
    if (editor && focusOnMount) editor.commands.focus('start')
  }, [editor, focusOnMount])

  const retry = useCallback(() => {
    setSaveState(saveRef.current(noteId, latest.current) ? 'saved' : 'failed')
  }, [noteId])
  useEffect(() => () => {
    if (timer.current) {
      clearTimeout(timer.current)
      saveRef.current(noteId, latest.current)
    }
  }, [noteId])
  useEffect(() => {
    if (!editor || !onFlushReady) return
    const flush = () => {
      if (timer.current) clearTimeout(timer.current)
      timer.current = null
      const doc = editor.getJSON()
      latest.current = doc
      const saved = saveRef.current(noteId, doc)
      setSaveState(saved ? 'saved' : 'failed')
      if (!saved) throw new Error('Unable to save the latest note before exporting.')
      return doc
    }
    onFlushReady(flush)
    return () => onFlushReady(() => latest.current)
  }, [editor, noteId, onFlushReady])

  const state = useEditorState({ editor, selector: context => {
    const active = (name: string, attrs?: Record<string, unknown>) => context.editor?.isActive(name, attrs) ?? false
    const current = context.editor
    let blockStyle: { color?: string | null; backgroundColor?: string | null } | null = null
    if (current) for (let depth = current.state.selection.$from.depth; depth > 0; depth--) {
      const node = current.state.selection.$from.node(depth)
      if (node.attrs.blockStyle) { blockStyle = node.attrs.blockStyle; break }
    }
    return { bold: active('bold'), italic: active('italic'), underline: active('underline'), strike: active('strike'), code: active('code'), codeBlock: active('codeBlock'), bullet: active('bulletList'), ordered: active('orderedList'), heading1: active('heading', { level: 1 }), heading2: active('heading', { level: 2 }), heading3: active('heading', { level: 3 }), canMoveUp: current ? canMoveBlock(current, -1) : false, canMoveDown: current ? canMoveBlock(current, 1) : false, inTable: active('table'), canMergeCells: current?.can().mergeCells() ?? false, canSplitCell: current?.can().splitCell() ?? false, important: active('important'), selectionEmpty: current?.state.selection.empty ?? true, document: current?.state.doc, textColor: (current?.getAttributes('textStyle').color as string | null) ?? null, highlightColor: (current?.getAttributes('highlight').color as string | null) ?? null, blockTextColor: blockStyle?.color ?? null, blockBackground: blockStyle?.backgroundColor ?? null, canUndo: current?.can().undo() ?? false, canRedo: current?.can().redo() ?? false, language: (current?.getAttributes('codeBlock').language as string | null) ?? 'plaintext' }
  } })
  const linkItems = useMemo(() => editor ? items.map(item => item.id === noteId ? { ...item, content: editor.getJSON() } : item) : items, [editor, items, noteId, state?.document])

  const openLinkDialog = useCallback((current: NonNullable<typeof editor>) => {
    const selection = current.state.selection
    const linked = activeLinkAt(current, selection.from)
    const editingLink = Boolean(linked && (selection.empty || selection.from >= linked.from && selection.to <= linked.to))
    const from = editingLink && linked ? linked.from : selection.from
    const to = editingLink && linked ? linked.to : selection.to
    const currentText = editingLink && linked ? linked.text : current.state.doc.textBetween(from, to, '', '')
    const attrs = editingLink && linked ? linked.attrs : null
    setLinkDialog({ from, to, text: currentText, attrs })
    setLinkMenu(null)
    setLinkMessage('')
  }, [])

  useEffect(() => {
    if (!editor) return
    const listener = () => openLinkDialog(editor)
    editor.view.dom.addEventListener('notehub:open-link', listener)
    return () => editor.view.dom.removeEventListener('notehub:open-link', listener)
  }, [editor, openLinkDialog])

  const navigateLink = useCallback((attrs: NoteLinkAttrs) => {
    if (attrs.linkType === 'external') {
      const href = attrs.href ? safeExternalUrl(attrs.href) : null
      if (href) window.open(href, '_blank', 'noopener,noreferrer')
      else setLinkMessage('This external link is invalid or unsafe.')
      return
    }
    if (attrs.linkType === 'heading') {
      const target = linkItems.find(item => item.id === attrs.targetNoteId)
      const headingExists = Boolean(target && attrs.headingId && (() => {
        let found = false
        const visit = (node: JSONContent) => { if (node.type === 'heading' && node.attrs?.blockId === attrs.headingId) found = true; node.content?.forEach(visit) }
        visit(target.content)
        return found
      })())
      if (!target) { setLinkMessage('This heading link is broken because its note no longer exists.'); return }
      if (!headingExists) { setLinkMessage('This heading no longer exists. You can edit or remove this link.'); return }
      if (target.id === noteId) {
        const heading = editor?.view.dom.querySelector<HTMLElement>(`[data-block-id="${CSS.escape(attrs.headingId ?? '')}"]`)
        if (heading) { heading.scrollIntoView({ behavior: 'smooth', block: 'start' }); heading.classList.add('link-target-flash'); window.setTimeout(() => heading.classList.remove('link-target-flash'), 1500) }
      } else navigate(`/note/${target.id}`, { state: { jumpToHeadingId: attrs.headingId } })
      return
    }
    const target = linkItems.find(item => item.id === attrs.targetId && item.type === (attrs.linkType === 'section' ? 'section' : 'note'))
    if (!target) { setLinkMessage(`This ${attrs.linkType} link is broken because its target no longer exists.`); return }
    navigate(`/note/${target.id}`)
  }, [editor, linkItems, navigate, noteId])

  useEffect(() => {
    if (!editor) return
    const anchors = editor.view.dom.querySelectorAll<HTMLAnchorElement>('a[data-link-type]')
    for (const anchor of anchors) {
      const type = anchor.dataset.linkType
      const targetExists = type === 'external' ? Boolean(safeExternalUrl(anchor.getAttribute('href') ?? '')) : type === 'heading'
        ? linkItems.some(item => item.id === anchor.dataset.targetNoteId && (() => { let found = false; const visit = (node: JSONContent) => { if (node.type === 'heading' && node.attrs?.blockId === anchor.dataset.headingId) found = true; node.content?.forEach(visit) }; visit(item.content); return found })())
        : linkItems.some(item => item.id === anchor.dataset.targetId && item.type === (type === 'section' ? 'section' : 'note'))
      anchor.classList.toggle('broken-link', !targetExists)
      if (!targetExists) anchor.title = 'Broken link — target no longer exists'
      else if (type === 'external') anchor.title = anchor.href
      else if (type === 'heading') {
        const target = linkItems.find(item => item.id === anchor.dataset.targetNoteId)
        let notePath = target?.title ?? '', parentId = target?.parentId
        while (parentId) { const parent = linkItems.find(item => item.id === parentId); if (!parent) break; notePath = `${parent.title} / ${notePath}`; parentId = parent.parentId }
        const subject = target && subjects.find(entry => entry.id === target.subjectId)
        let title = ''
        if (target) { const visit = (node: JSONContent) => { if (node.type === 'heading' && node.attrs?.blockId === anchor.dataset.headingId) title = node.content?.map(jsonText).join('') ?? ''; node.content?.forEach(visit) }; visit(target.content) }
        anchor.title = `Heading: ${title} · ${subject ? `${subject.title} / ` : ''}${notePath}`
      } else {
        const target = linkItems.find(item => item.id === anchor.dataset.targetId)
        if (target) {
          let notePath = target.title, parentId = target.parentId
          while (parentId) { const parent = linkItems.find(item => item.id === parentId); if (!parent) break; notePath = `${parent.title} / ${notePath}`; parentId = parent.parentId }
          const subject = subjects.find(entry => entry.id === target.subjectId)
          anchor.title = `${type === 'section' ? 'Section' : 'Note'} · ${subject ? `${subject.title} / ` : ''}${notePath}`
        }
      }
    }
  }, [editor, linkItems, subjects, state?.document])

  if (!editor || !state) return <div className="rich-editor-loading" aria-label="Loading editor" />
  const activeEditor = editor
  const run = (command: (chain: ReturnType<typeof activeEditor.chain>) => ReturnType<typeof activeEditor.chain>) => command(activeEditor.chain().focus()).run()
  const language = languages.includes(state.language) ? state.language : 'plaintext'
  const importantNotes = collectImportantNotes(activeEditor)
  const jumpToSource = (note: ImportantNote) => activeEditor.chain().setTextSelection({ from: note.from, to: note.to }).scrollIntoView().focus().run()
  const removeImportant = (note: ImportantNote) => activeEditor.chain().setTextSelection({ from: note.from, to: note.to }).unsetMark('important').run()
  const applyTextColor = (value: string) => { setTextColor(value); activeEditor.chain().focus().setColor(value).run() }
  const applyHighlight = (value: string) => { setHighlightColor(value); activeEditor.chain().focus().setHighlight({ color: value }).run() }
  const applyBlockTextColor = (value: string) => { setBlockTextColor(value); applyBlockColor(activeEditor, 'color', value) }
  const applyBlockBackground = (value: string) => { setBlockBackground(value); applyBlockColor(activeEditor, 'backgroundColor', value) }
  const clearTextColor = () => { setTextColor('#e2e8f0'); activeEditor.chain().focus().unsetColor().run() }
  const clearHighlight = () => { setHighlightColor('#ffe58f'); activeEditor.chain().focus().unsetHighlight().run() }
  const clearBlockTextColor = () => { setBlockTextColor('#e2e8f0'); applyBlockColor(activeEditor, 'color', null) }
  const clearBlockBackground = () => { setBlockBackground('#24364a'); applyBlockColor(activeEditor, 'backgroundColor', null) }
  const saveLink = (text: string, target: LinkTarget) => {
    const { from, to } = linkDialog!
    const attrs = target as NoteLinkAttrs
    const { schema } = editor
    const existingText = editor.state.doc.textBetween(from, to, '', '')
    if (from !== to && existingText === text) editor.chain().focus().setTextSelection({ from, to }).setMark('link', attrs).run()
    else {
      const marks = [...(editor.state.storedMarks ?? editor.state.doc.resolve(from).marks())].filter(mark => mark.type.name !== 'link').map(mark => mark.toJSON())
      marks.push(schema.marks.link.create(attrs).toJSON())
      editor.chain().focus().insertContentAt({ from, to }, { type: 'text', text, marks }).run()
    }
    setLinkDialog(null)
  }
  const removeLinkRange = (range: LinkDialogState) => { editor.chain().focus().setTextSelection({ from: range.from, to: range.to }).unsetMark('link').run(); setLinkDialog(null); setLinkMenu(null) }
  const onEditorClick = (event: React.MouseEvent) => {
    setLinkMenu(null)
    const anchor = (event.target as HTMLElement).closest<HTMLAnchorElement>('a[data-link-type]')
    if (!anchor || anchor.dataset.linkType === 'external') return
    event.preventDefault()
    navigateLink({ linkType: anchor.dataset.linkType as NoteLinkAttrs['linkType'], href: anchor.getAttribute('href'), targetId: anchor.dataset.targetId ?? null, targetNoteId: anchor.dataset.targetNoteId ?? null, headingId: anchor.dataset.headingId ?? null })
  }
  const onEditorContextMenu = (event: React.MouseEvent) => {
    const anchor = (event.target as HTMLElement).closest<HTMLAnchorElement>('a[data-link-type]')
    if (!anchor) { setLinkMenu(null); return }
    event.preventDefault()
    const pos = editor.view.posAtCoords({ left: event.clientX, top: event.clientY })?.pos ?? editor.state.selection.from
    const found = activeLinkAt(editor, pos)
    if (!found) return
    setLinkMenu({ ...found, x: Math.min(event.clientX, window.innerWidth - 190), y: Math.min(event.clientY, window.innerHeight - 150) })
  }
  return <section className="rich-editor" aria-label="Note editor">
    <div className="editor-toolbar" role="toolbar" aria-label="Text formatting">
      <ToolbarButton label="Bold (Ctrl+B)" active={state.bold} onClick={() => run(chain => chain.toggleBold())}><Bold size={16}/></ToolbarButton>
      <ToolbarButton label="Italic (Ctrl+I)" active={state.italic} onClick={() => run(chain => chain.toggleItalic())}><Italic size={16}/></ToolbarButton>
      <ToolbarButton label="Underline (Ctrl+U)" active={state.underline} onClick={() => run(chain => chain.toggleUnderline())}><Underline size={16}/></ToolbarButton>
      <ToolbarButton label="Strikethrough" active={state.strike} onClick={() => run(chain => chain.toggleStrike())}><Strikethrough size={16}/></ToolbarButton>
      <ToolbarButton label="Heading 1" active={state.heading1} onClick={() => run(chain => chain.toggleHeading({ level: 1 }))}>H1</ToolbarButton>
      <ToolbarButton label="Heading 2" active={state.heading2} onClick={() => run(chain => chain.toggleHeading({ level: 2 }))}>H2</ToolbarButton>
      <ToolbarButton label="Heading 3" active={state.heading3} onClick={() => run(chain => chain.toggleHeading({ level: 3 }))}>H3</ToolbarButton>
      <span className="editor-tool-separator"/>
      <ToolbarButton label="Inline code" active={state.code} onClick={() => run(chain => chain.toggleCode())}><Code2 size={16}/></ToolbarButton>
      <ToolbarButton label="Insert or edit link (Ctrl+K)" onClick={() => openLinkDialog(editor)}><Link2 size={16}/></ToolbarButton>
      <ToolbarButton label="Mark selection important" active={state.important} disabled={state.selectionEmpty} onClick={() => state.important ? run(chain => chain.unsetMark('important')) : editor.chain().focus().setMark('important', { importantId: crypto.randomUUID() }).run()}><Star size={16}/></ToolbarButton>
      <span className="editor-tool-separator"/>
      <ColorPicker label="Text color" icon={<Palette size={15}/>} value={state.textColor ?? textColor} onChange={applyTextColor} onClear={clearTextColor}/>
      <ColorPicker label="Background highlight" icon={<Highlighter size={15}/>} value={state.highlightColor ?? highlightColor} onChange={applyHighlight} onClear={clearHighlight}/>
      <span className="editor-tool-separator"/>
      <ColorPicker label="Block text color" icon={<PanelTop size={15}/>} value={state.blockTextColor ?? blockTextColor} onChange={applyBlockTextColor} onClear={clearBlockTextColor}/>
      <ColorPicker label="Block background" icon={<Square size={15}/>} value={state.blockBackground ?? blockBackground} onChange={applyBlockBackground} onClear={clearBlockBackground}/>
      <ToolbarButton label="Code block" active={state.codeBlock} onClick={() => run(chain => chain.toggleCodeBlock({ language: 'plaintext' }))}><span className="code-tool-label">{`</>`}</span></ToolbarButton>
      {state.codeBlock && <select className="code-language" aria-label="Code language" value={language} onChange={event => editor.chain().focus().updateAttributes('codeBlock', { language: event.target.value }).run()}>{languages.map(value => <option key={value} value={value}>{value === 'plaintext' ? 'Plain text' : value.toUpperCase()}</option>)}</select>}
      <span className="editor-tool-separator"/>
      <ToolbarButton label="Bullet list" active={state.bullet} onClick={() => run(chain => chain.toggleBulletList())}><List size={16}/></ToolbarButton>
      <ToolbarButton label="Ordered list" active={state.ordered} onClick={() => run(chain => chain.toggleOrderedList())}><ListOrdered size={16}/></ToolbarButton>
      <ToolbarButton label="Outdent list item" disabled={!editor.can().liftListItem('listItem')} onClick={() => editor.chain().focus().liftListItem('listItem').run()}><Outdent size={16}/></ToolbarButton>
      <ToolbarButton label="Indent list item" disabled={!editor.can().sinkListItem('listItem')} onClick={() => editor.chain().focus().sinkListItem('listItem').run()}><Indent size={16}/></ToolbarButton>
      <span className="editor-tool-separator"/>
      <ToolbarButton label="Insert separator" onClick={() => editor.chain().focus().setHorizontalRule().run()}><Minus size={16}/></ToolbarButton>
      <ToolbarButton label="Move block up (Alt+↑)" disabled={!state.canMoveUp} onClick={() => moveBlock(editor, -1)}><ArrowUp size={16}/></ToolbarButton>
      <ToolbarButton label="Move block down (Alt+↓)" disabled={!state.canMoveDown} onClick={() => moveBlock(editor, 1)}><ArrowDown size={16}/></ToolbarButton>
      <span className="editor-tool-separator"/>
      <ToolbarButton label="Insert 3 by 3 table" onClick={() => editor.chain().focus().insertTable({ rows: 3, cols: 3, withHeaderRow: true }).run()}><Table2 size={16}/></ToolbarButton>
      {state.inTable && <>
        <span className="editor-tool-separator"/>
        <ToolbarButton label="Add row below" onClick={() => editor.chain().focus().addRowAfter().run()}><Rows3 size={16}/><span className="table-tool-caption">+ row</span></ToolbarButton>
        <ToolbarButton label="Delete current row" onClick={() => editor.chain().focus().deleteRow().run()}><Rows3 size={16}/><span className="table-tool-caption">− row</span></ToolbarButton>
        <ToolbarButton label="Add column after" onClick={() => editor.chain().focus().addColumnAfter().run()}><Columns3 size={16}/><span className="table-tool-caption">+ col</span></ToolbarButton>
        <ToolbarButton label="Delete current column" onClick={() => editor.chain().focus().deleteColumn().run()}><Columns3 size={16}/><span className="table-tool-caption">− col</span></ToolbarButton>
        <ToolbarButton label="Merge selected cells to create row or column span" disabled={!state.canMergeCells} onClick={() => editor.chain().focus().mergeCells().run()}><Combine size={16}/></ToolbarButton>
        <ToolbarButton label="Split merged cell and clear its row or column span" disabled={!state.canSplitCell} onClick={() => editor.chain().focus().splitCell().run()}><Split size={16}/></ToolbarButton>
      </>}
      <span className="editor-tool-separator"/>
      <ToolbarButton label="Undo (Ctrl+Z)" disabled={!state.canUndo} onClick={() => editor.chain().focus().undo().run()}><Undo2 size={16}/></ToolbarButton>
      <ToolbarButton label="Redo (Ctrl+Shift+Z)" disabled={!state.canRedo} onClick={() => editor.chain().focus().redo().run()}><Redo2 size={16}/></ToolbarButton>
    </div>
    <section className="important-notes" aria-label="Important Notes">
      <div className="important-notes-heading"><h2><Star size={15}/>Important Notes</h2><span>{importantNotes.length}</span></div>
      {importantNotes.length ? <ol>{importantNotes.map((note, index) => <li key={note.id}>
        <button className="important-source-link" type="button" aria-label={`Jump to important note ${index + 1}`} onClick={() => jumpToSource(note)}><span className="important-number">{index + 1}.</span><span>{note.text}</span><CornerUpRight size={14}/></button>
        <button className="important-remove" type="button" aria-label={`Remove important marker ${index + 1}`} title="Remove marker" onClick={() => removeImportant(note)}><Trash2 size={14}/></button>
      </li>)}</ol> : <p>Select text and use <Star size={12}/> to collect it here.</p>}
    </section>
    <EditorContent editor={editor} className="editor-content" onClick={onEditorClick} onContextMenu={onEditorContextMenu} />
    {linkMessage&&<div className="link-message" role="status"><span>{linkMessage}</span><button type="button" onClick={()=>setLinkMessage('')} aria-label="Dismiss message"><X size={13}/></button></div>}
    <div className="editor-status" aria-live="polite">{saveState === 'saved' ? <><Check size={13}/>Saved</> : saveState === 'saving' ? <><LoaderCircle className="spin" size={13}/>Saving…</> : <><span>Unable to save changes</span><button type="button" onClick={retry}><RotateCcw size={13}/>Retry</button></>}</div>
    {linkDialog&&<LinkDialog text={linkDialog.text} attrs={linkDialog.attrs} subjects={subjects} items={linkItems} onClose={()=>setLinkDialog(null)} onSave={saveLink} onRemove={()=>removeLinkRange(linkDialog)}/>}
    {linkMenu&&<div className="link-context-menu" role="menu" style={{left:linkMenu.x,top:linkMenu.y}} onMouseDown={event=>event.preventDefault()}>
      <button type="button" role="menuitem" onClick={()=>{navigateLink(linkMenu.attrs);setLinkMenu(null)}}><ExternalLink size={14}/>Open link</button>
      <button type="button" role="menuitem" onClick={()=>{setLinkMenu(null);setLinkDialog({from:linkMenu.from,to:linkMenu.to,text:linkMenu.text,attrs:linkMenu.attrs})}}><Link2 size={14}/>Edit link</button>
      <button type="button" role="menuitem" onClick={()=>{const target=linkMenu.attrs.href??(linkMenu.attrs.linkType==='heading'?`/note/${linkMenu.attrs.targetNoteId}#${linkMenu.attrs.headingId}`:`/note/${linkMenu.attrs.targetId}`);void navigator.clipboard?.writeText(target).then(()=>setLinkMessage('Link copied to clipboard.')).catch(()=>setLinkMessage('Could not access the clipboard.'));setLinkMenu(null)}}><Copy size={14}/>Copy link</button>
      <button type="button" role="menuitem" onClick={()=>removeLinkRange(linkMenu)}><X size={14}/>Remove link</button>
    </div>}
  </section>
}
