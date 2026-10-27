import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { EditorContent, NodeViewContent, NodeViewWrapper, ReactNodeViewRenderer, useEditor, useEditorState, type NodeViewProps } from '@tiptap/react'
import { CodeBlock } from '@tiptap/extension-code-block'
import { Code } from '@tiptap/extension-code'
import { StarterKit } from '@tiptap/starter-kit'
import { Placeholder } from '@tiptap/extensions'
import { Bold, Code2, Italic, List, ListOrdered, Redo2, Strikethrough, Underline, Undo2, Outdent, Indent, Check, LoaderCircle, RotateCcw, Star, Trash2, CornerUpRight, Palette, Highlighter, PanelTop, Square, X, ArrowUp, ArrowDown, Minus, Table2, Rows3, Columns3, Combine, Split, Link2, ExternalLink, Copy, ChevronDown, ChevronRight, Pencil, Menu } from 'lucide-react'
import { useNavigate } from 'react-router-dom'
import type { JSONContent } from '@tiptap/core'
import { TextStyle, Color } from '@tiptap/extension-text-style'
import { Highlight } from '@tiptap/extension-highlight'
import { toDocument } from './document'
import { StableBlockIds } from './blockIds'
import { ImportantMark } from './important'
import { applyBlockColor, BlockFormatting } from './blockFormatting'
import { BlockOperations, canMoveBlock, moveBlock } from './blockOperations'
import { copyCurrentLine, MultiCursor } from './multiCursor'
import { TableKit } from '@tiptap/extension-table'
import { LinkDialog, type LinkItem, type LinkSubject, type LinkTarget } from './LinkDialog'
import { NoteLink, safeExternalUrl, type NoteLinkAttrs } from './links'
import { storage } from '../storage'
import { CodeBlockDecorations } from './codeBlockDecorations'

type Props = { noteId: string; content: JSONContent | string; focusOnMount?: boolean; subjects: LinkSubject[]; items: LinkItem[]; save: (id: string, doc: JSONContent) => boolean; onFlushReady?: (flush:()=>JSONContent)=>void }
type SaveState = 'saved' | 'saving' | 'failed'
type LinkDialogState = { from: number; to: number; text: string; attrs: Partial<NoteLinkAttrs> | null }
type LinkMenuState = Omit<LinkDialogState, 'attrs'> & { attrs: NoteLinkAttrs; x: number; y: number }
const jsonText = (node: JSONContent): string => node.text ?? (node.content ?? []).map(jsonText).join('')
const languages = ['plaintext', 'javascript', 'typescript', 'python', 'java', 'c', 'cpp', 'html', 'css', 'json', 'sql', 'bash', 'markdown', 'yaml', 'xml', 'jsx']
const ComposableCode = Code.extend({ excludes: '' })
type ImportantNote = { id: string; from: number; to: number; text: string; blockId: string | null }
type OutlineEntry = { id: string; title: string; level?: number; kind: 'section' | 'heading' | 'nested-note'; children: OutlineEntry[] }
type SavedColor={id:string;name:string;color:string}

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

function ColorPicker({ label, icon, value, recent, saved, onChange, onClear, onSaveColor, onRenameColor, onDeleteColor, onMoveColor }: { label: string; icon: React.ReactNode; value: string; recent: string[]; saved?:SavedColor[]; onChange: (value: string) => void; onClear: () => void; onSaveColor?:()=>void; onRenameColor?:(id:string)=>void; onDeleteColor?:(id:string)=>void; onMoveColor?:(id:string,delta:number)=>void }) {
  return <span className="editor-color-control"><label className="editor-color-picker" title={label}><span>{icon}<i style={{ backgroundColor: value }}/></span><input type="color" aria-label={label} value={value} onChange={event => onChange(event.currentTarget.value)}/></label>{recent.length>0&&<span className="recent-color-swatches" aria-label="Recent colors">{recent.map(color=><button key={color} type="button" aria-label={`Apply recent color ${color}`} title={color} style={{backgroundColor:color}} onMouseDown={event=>event.preventDefault()} onClick={()=>onChange(color)}/>)}</span>}{onSaveColor&&<details className="saved-colors-menu"><summary aria-label="Saved colors">Palette</summary><div className="saved-colors-panel"><button type="button" className="save-color-action" onClick={onSaveColor}>+ Save current color</button>{saved?.map((entry,index)=><div className="saved-color-row" key={entry.id}><button type="button" className="saved-color-swatch" aria-label={`Apply ${entry.name}`} title={`${entry.name} · ${entry.color}`} style={{backgroundColor:entry.color}} onMouseDown={event=>event.preventDefault()} onClick={()=>onChange(entry.color)}/><span>{entry.name}</span><button type="button" aria-label={`Move ${entry.name} up`} disabled={index===0} onClick={()=>onMoveColor?.(entry.id,-1)}><ArrowUp size={12}/></button><button type="button" aria-label={`Move ${entry.name} down`} disabled={index===(saved?.length??0)-1} onClick={()=>onMoveColor?.(entry.id,1)}><ArrowDown size={12}/></button><button type="button" aria-label={`Rename ${entry.name}`} onClick={()=>onRenameColor?.(entry.id)}><Pencil size={12}/></button><button type="button" aria-label={`Delete ${entry.name}`} onClick={()=>onDeleteColor?.(entry.id)}><Trash2 size={12}/></button></div>)}</div></details>}<button type="button" className="editor-color-reset" aria-label={`Clear ${label.toLocaleLowerCase()}`} title={`Clear ${label.toLocaleLowerCase()}`} onMouseDown={event => event.preventDefault()} onClick={onClear}><X size={11}/></button></span>
}

function CodeBlockView({node}:NodeViewProps){
  const [copied,setCopied]=useState(false)
  const language=String(node.attrs.language??'plaintext')
  const copy=async()=>{try{await navigator.clipboard.writeText(node.textContent);setCopied(true);window.setTimeout(()=>setCopied(false),1300)}catch{setCopied(false)}}
  return <NodeViewWrapper className="editor-code-block"><div className="editor-code-head" contentEditable={false}><span>{language==='plaintext'?'Plain text':language.toUpperCase()}</span><button type="button" onMouseDown={event=>event.preventDefault()} onClick={()=>void copy()}>{copied?<Check size={14}/>:<Copy size={14}/>}<span>{copied?'Copied':'Copy'}</span></button></div><pre><NodeViewContent<'code'> as="code" className="editor-code-content"/></pre></NodeViewWrapper>
}
const RichCodeBlock=CodeBlock.extend({addNodeView(){return ReactNodeViewRenderer(CodeBlockView)}})

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

function sectionOwnerId(items: LinkItem[], item: LinkItem): string | null {
  let parentId = item.parentId
  const seen = new Set<string>()
  while (parentId && !seen.has(parentId)) {
    seen.add(parentId)
    const parent = items.find(entry => entry.id === parentId)
    if (!parent) return null
    if (parent.type === 'note') return parent.id
    parentId = parent.parentId
  }
  return null
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
  const [recentColors, setRecentColors] = useState<string[]>(() => storage.get<string[]>('recent-colors', []))
  const [savedColors,setSavedColors]=useState<SavedColor[]>(()=>storage.get<SavedColor[]>('saved-colors',[]))
  const [closedHeadings,setClosedHeadings]=useState<Set<string>>(()=>new Set(storage.get<string[]>(`outline-collapsed-${noteId}`,[])))
  const [importantFeedback,setImportantFeedback]=useState('')
  const [copyFeedback,setCopyFeedback]=useState('')
  const [selectionMenu,setSelectionMenu]=useState<{x:number;y:number}|null>(null)
  const [activeHeadingId,setActiveHeadingId]=useState<string|null>(null)
  const [navigationOpen,setNavigationOpen]=useState(false)
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const savedSelection = useRef<{from:number;to:number}|null>(null)
  const latest = useRef<JSONContent>(toDocument(content))
  const saveRef = useRef(save)
  saveRef.current = save
  const extensions = useMemo(() => [
    StarterKit.configure({ codeBlock: false, link: false, heading: { levels: [1, 2, 3, 4, 5, 6] }, code: false }),
    ComposableCode,
    TextStyle,
    Color.configure({ types: ['textStyle'] }),
    Highlight.configure({ multicolor: true }),
    RichCodeBlock.configure({ enableTabIndentation: true, tabSize: 4, defaultLanguage: 'plaintext' }),
    CodeBlockDecorations,
    Placeholder.configure({ placeholder: 'Start writing...' }),
    StableBlockIds,
    ImportantMark,
    BlockFormatting,
    BlockOperations,
    MultiCursor,
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

  const toggleImportantSelection = useCallback(() => {
    if (!editor || editor.state.selection.empty) { setImportantFeedback('Select some text to mark it important.'); window.setTimeout(()=>setImportantFeedback(''),2000); return false }
    const {from,to}=editor.state.selection
    const mark=editor.schema.marks.important
    const isMarked=editor.state.doc.rangeHasMark(from,to,mark)
    const chain=editor.chain().focus().setTextSelection({from,to})
    const changed=isMarked?chain.unsetMark('important').run():chain.setMark('important',{importantId:crypto.randomUUID()}).run()
    if(changed){setImportantFeedback(isMarked?'Important note removed.':'Important note added.');window.setTimeout(()=>setImportantFeedback(''),2200)}
    return changed
  },[editor])

  useEffect(()=>{
    if(!editor)return
    const onKeyDown=(event:KeyboardEvent)=>{if((event.ctrlKey||event.metaKey)&&event.shiftKey&&event.key.toLowerCase()==='i'){event.preventDefault();event.stopPropagation();toggleImportantSelection()}}
    const dom=editor.view.dom;dom.addEventListener('keydown',onKeyDown,true);return()=>dom.removeEventListener('keydown',onKeyDown,true)
  },[editor,toggleImportantSelection])

  useEffect(()=>{
    if(!editor)return
    const remember=()=>{savedSelection.current={from:editor.state.selection.from,to:editor.state.selection.to}}
    editor.on('selectionUpdate',remember)
    remember()
    return()=>{editor.off('selectionUpdate',remember)}
  },[editor])

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
    return { bold: active('bold'), italic: active('italic'), underline: active('underline'), strike: active('strike'), code: active('code'), codeBlock: active('codeBlock'), bullet: active('bulletList'), ordered: active('orderedList'), heading1: active('heading', { level: 1 }), heading2: active('heading', { level: 2 }), heading3: active('heading', { level: 3 }), heading4: active('heading', { level: 4 }), heading5: active('heading', { level: 5 }), heading6: active('heading', { level: 6 }), canMoveUp: current ? canMoveBlock(current, -1) : false, canMoveDown: current ? canMoveBlock(current, 1) : false, inTable: active('table'), canMergeCells: current?.can().mergeCells() ?? false, canSplitCell: current?.can().splitCell() ?? false, important: active('important'), selectionEmpty: current?.state.selection.empty ?? true, document: current?.state.doc, textColor: (current?.getAttributes('textStyle').color as string | null) ?? null, highlightColor: (current?.getAttributes('highlight').color as string | null) ?? null, blockTextColor: blockStyle?.color ?? null, blockBackground: blockStyle?.backgroundColor ?? null, canUndo: current?.can().undo() ?? false, canRedo: current?.can().redo() ?? false, language: (current?.getAttributes('codeBlock').language as string | null) ?? 'plaintext' }
  } })
  useEffect(() => {
    if (!editor || typeof IntersectionObserver === 'undefined') return
    const headings = [...editor.view.dom.querySelectorAll<HTMLElement>('h1[data-block-id],h2[data-block-id],h3[data-block-id],h4[data-block-id],h5[data-block-id],h6[data-block-id]')]
    if (!headings.length) { setActiveHeadingId(null); return }
    const observer = new IntersectionObserver(entries => {
      const visible = entries.filter(entry => entry.isIntersecting).sort((a,b)=>a.boundingClientRect.top-b.boundingClientRect.top)
      const id = visible[0]?.target.getAttribute('data-block-id')
      if (id) setActiveHeadingId(current => current === id ? current : id)
    }, { root: null, rootMargin: '-128px 0px -68% 0px', threshold: 0 })
    headings.forEach(heading => observer.observe(heading))
    return () => observer.disconnect()
  }, [editor, state?.document])
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
    if(attrs.linkType==='section'){
      const ownerId=sectionOwnerId(linkItems,target)
      if(!ownerId){setLinkMessage('This section is not connected to a note.');return}
      if(ownerId===noteId){const heading=editor?.view.dom.querySelector<HTMLElement>(`[data-block-id="${CSS.escape(target.id)}"]`);if(heading){heading.scrollIntoView({behavior:'smooth',block:'start'});heading.classList.add('link-target-flash');window.setTimeout(()=>heading.classList.remove('link-target-flash'),1500)}}
      else navigate(`/note/${ownerId}`,{state:{jumpToSectionId:target.id}})
      return
    }
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
  const sectionItems=items.filter(item=>item.type==='section'&&sectionOwnerId(items,item)===noteId)
  const sectionByAnchor=new Map(sectionItems.map(item=>[item.id,item]))
  const outline:OutlineEntry[]=[]
  const sectionEntries=new Map<string,OutlineEntry>()
  let currentSection:OutlineEntry|null=null
  let headingStack:OutlineEntry[]=[]
  state.document?.descendants(node=>{
    if(node.type.name!=='heading')return
    const id=String(node.attrs.blockId??'')
    const section=sectionByAnchor.get(id)
    if(section){
      currentSection={id:section.id,title:section.title,kind:'section',children:[]}
      sectionEntries.set(section.id,currentSection)
      const parentSection=section.parentId?sectionEntries.get(section.parentId):undefined
      if(parentSection)parentSection.children.push(currentSection);else outline.push(currentSection)
      headingStack=[];return
    }
    const entry:OutlineEntry={id,title:node.textContent||'Untitled heading',level:Number(node.attrs.level)||1,kind:'heading',children:[]}
    while(headingStack.length&&(headingStack[headingStack.length-1].level??1)>=entry.level!)headingStack.pop()
    if(headingStack.length)headingStack[headingStack.length-1].children.push(entry)
    else (currentSection?.children??outline).push(entry)
    headingStack.push(entry)
  })
  for(const section of sectionItems){
    const sectionEntry=sectionEntries.get(section.id)
    if(!sectionEntry)continue
    for(const child of items.filter(item=>item.type==='note'&&item.parentId===section.id))sectionEntry.children.push({id:child.id,title:child.title,kind:'nested-note',children:[]})
  }
  for(const child of items.filter(item=>item.type==='note'&&item.parentId===noteId))outline.push({id:child.id,title:child.title,kind:'nested-note',children:[]})
  const toggleOutline=(id:string)=>setClosedHeadings(current=>{const next=new Set(current);next.has(id)?next.delete(id):next.add(id);storage.set(`outline-collapsed-${noteId}`,[...next]);return next})
  const outlineCount=(entries:OutlineEntry[]):number=>entries.reduce((sum,entry)=>sum+1+outlineCount(entry.children),0)
  const renderOutline=(entries:OutlineEntry[],parentNumber:string[]=[]):React.ReactNode=>entries.map((entry,index)=>{
    const parts=[...parentNumber,parentNumber.length===0?String(index+1).padStart(2,'0'):String(index+1)],number=parts.join('.')
    const expandable=entry.children.length>0,collapsed=closedHeadings.has(entry.id)
    const activate=()=>{setNavigationOpen(false);if(entry.kind==='nested-note'){navigate(`/note/${entry.id}`);return}const target=activeEditor.view.dom.querySelector<HTMLElement>(`[data-block-id="${CSS.escape(entry.id)}"]`);if(target){target.scrollIntoView({behavior:'smooth',block:'start'});target.classList.add('link-target-flash');window.setTimeout(()=>target.classList.remove('link-target-flash'),1500)}activeEditor.chain().focus().run()}
    const isActive=activeHeadingId===entry.id
    return <div className={`editor-outline-node outline-${entry.kind}${isActive?' is-active':''}`} key={entry.id}><div className="editor-outline-row" style={{'--outline-depth':parentNumber.length} as React.CSSProperties}>{expandable?<button type="button" className="outline-expander" aria-label={`${collapsed?'Expand':'Collapse'} ${entry.title}`} onClick={()=>toggleOutline(entry.id)}>{collapsed?<ChevronRight size={13}/>:<ChevronDown size={13}/>}</button>:<span className="outline-expander-spacer"/>}<button type="button" className="outline-target" aria-current={isActive?'location':undefined} onClick={activate}><span className="outline-number">{number}</span>{entry.kind==='section'?<span className="outline-badge section-badge">SECTION</span>:entry.kind==='heading'?<span className={`outline-badge heading-badge h${entry.level}`}>H{entry.level}</span>:<span className="outline-badge note-badge">NOTE</span>}<span className="outline-title">{entry.title}</span></button></div>{expandable&&!collapsed&&<div className="editor-outline-children">{renderOutline(entry.children,parts)}</div>}</div>
  })
  const copyPage=async()=>{try{const html=activeEditor.getHTML(),plain=activeEditor.getText({blockSeparator:'\n\n'});if(navigator.clipboard?.write&&typeof ClipboardItem!=='undefined')await navigator.clipboard.write([new ClipboardItem({'text/html':new Blob([html],{type:'text/html'}),'text/plain':new Blob([plain],{type:'text/plain'})})]);else await navigator.clipboard.writeText(plain);setCopyFeedback('Page copied.');window.setTimeout(()=>setCopyFeedback(''),1800)}catch{setCopyFeedback('Could not access the clipboard.');window.setTimeout(()=>setCopyFeedback(''),2200)}}
  const jumpToSource = (note: ImportantNote) => {setNavigationOpen(false);activeEditor.chain().setTextSelection({ from: note.from, to: note.to }).scrollIntoView().focus().run();const target=activeEditor.view.dom.querySelector<HTMLElement>(`[data-important-id="${CSS.escape(note.id)}"]`);if(target){target.classList.add('important-source-flash');window.setTimeout(()=>target.classList.remove('important-source-flash'),1500)}}
  const removeImportant = (note: ImportantNote) => activeEditor.chain().setTextSelection({ from: note.from, to: note.to }).unsetMark('important').run()
  const rememberColor = (value:string) => { const next=[value,...recentColors.filter(color=>color.toLocaleLowerCase()!==value.toLocaleLowerCase())].slice(0,8);setRecentColors(next);storage.set('recent-colors',next) }
  const saveColor=()=>{const name=window.prompt('Name this color');if(!name?.trim())return;const next=[...savedColors,{id:crypto.randomUUID(),name:name.trim(),color:state.textColor??textColor}];setSavedColors(next);storage.set('saved-colors',next)}
  const renameColor=(id:string)=>{const item=savedColors.find(entry=>entry.id===id);if(!item)return;const name=window.prompt('Rename saved color',item.name);if(!name?.trim())return;const next=savedColors.map(entry=>entry.id===id?{...entry,name:name.trim()}:entry);setSavedColors(next);storage.set('saved-colors',next)}
  const deleteColor=(id:string)=>{const next=savedColors.filter(entry=>entry.id!==id);setSavedColors(next);storage.set('saved-colors',next)}
  const moveColor=(id:string,delta:number)=>{const at=savedColors.findIndex(entry=>entry.id===id),to=at+delta;if(at<0||to<0||to>=savedColors.length)return;const next=[...savedColors];[next[at],next[to]]=[next[to],next[at]];setSavedColors(next);storage.set('saved-colors',next)}
  const applyTextColor = (value: string) => { setTextColor(value);rememberColor(value);const chain=activeEditor.chain().focus();if(savedSelection.current&&savedSelection.current.from<savedSelection.current.to)chain.setTextSelection(savedSelection.current).setColor(value).run();else chain.setColor(value).run() }
  const applyHighlight = (value: string) => { setHighlightColor(value);rememberColor(value);const chain=activeEditor.chain().focus();if(savedSelection.current&&savedSelection.current.from<savedSelection.current.to)chain.setTextSelection(savedSelection.current).setHighlight({ color: value }).run();else chain.setHighlight({ color: value }).run() }
  const applyBlockTextColor = (value: string) => { setBlockTextColor(value);rememberColor(value); applyBlockColor(activeEditor, 'color', value) }
  const applyBlockBackground = (value: string) => { setBlockBackground(value);rememberColor(value); applyBlockColor(activeEditor, 'backgroundColor', value) }
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
    setSelectionMenu(null)
    const anchor = (event.target as HTMLElement).closest<HTMLAnchorElement>('a[data-link-type]')
    if (!anchor || anchor.dataset.linkType === 'external') return
    event.preventDefault()
    navigateLink({ linkType: anchor.dataset.linkType as NoteLinkAttrs['linkType'], href: anchor.getAttribute('href'), targetId: anchor.dataset.targetId ?? null, targetNoteId: anchor.dataset.targetNoteId ?? null, headingId: anchor.dataset.headingId ?? null })
  }
  const onEditorContextMenu = (event: React.MouseEvent) => {
    const anchor = (event.target as HTMLElement).closest<HTMLAnchorElement>('a[data-link-type]')
    if (!anchor) {
      setLinkMenu(null)
      if(!editor.state.selection.empty){event.preventDefault();setSelectionMenu({x:Math.min(event.clientX,window.innerWidth-190),y:Math.min(event.clientY,window.innerHeight-90)})}
      else setSelectionMenu(null)
      return
    }
    setSelectionMenu(null)
    event.preventDefault()
    const pos = editor.view.posAtCoords({ left: event.clientX, top: event.clientY })?.pos ?? editor.state.selection.from
    const found = activeLinkAt(editor, pos)
    if (!found) return
    setLinkMenu({ ...found, x: Math.min(event.clientX, window.innerWidth - 190), y: Math.min(event.clientY, window.innerHeight - 150) })
  }
  return <section className="rich-editor" aria-label="Note editor">
    <div className="editor-toolbar" role="toolbar" aria-label="Text formatting">
      <ToolbarButton label="Open note navigation" onClick={()=>setNavigationOpen(true)}><Menu size={16}/><span className="navigation-tool-label">Navigation</span></ToolbarButton>
      <ToolbarButton label="Bold (Ctrl+B)" active={state.bold} onClick={() => run(chain => chain.toggleBold())}><Bold size={16}/></ToolbarButton>
      <ToolbarButton label="Italic (Ctrl+I)" active={state.italic} onClick={() => run(chain => chain.toggleItalic())}><Italic size={16}/></ToolbarButton>
      <ToolbarButton label="Underline (Ctrl+U)" active={state.underline} onClick={() => run(chain => chain.toggleUnderline())}><Underline size={16}/></ToolbarButton>
      <ToolbarButton label="Strikethrough" active={state.strike} onClick={() => run(chain => chain.toggleStrike())}><Strikethrough size={16}/></ToolbarButton>
      <ToolbarButton label="Heading 1" active={state.heading1} onClick={() => run(chain => chain.toggleHeading({ level: 1 }))}>H1</ToolbarButton>
      <ToolbarButton label="Heading 2" active={state.heading2} onClick={() => run(chain => chain.toggleHeading({ level: 2 }))}>H2</ToolbarButton>
      <ToolbarButton label="Heading 3" active={state.heading3} onClick={() => run(chain => chain.toggleHeading({ level: 3 }))}>H3</ToolbarButton>
      <ToolbarButton label="Heading 4" active={state.heading4} onClick={() => run(chain => chain.toggleHeading({ level: 4 }))}>H4</ToolbarButton>
      <ToolbarButton label="Heading 5" active={state.heading5} onClick={() => run(chain => chain.toggleHeading({ level: 5 }))}>H5</ToolbarButton>
      <ToolbarButton label="Heading 6" active={state.heading6} onClick={() => run(chain => chain.toggleHeading({ level: 6 }))}>H6</ToolbarButton>
      <span className="editor-tool-separator"/>
      <ToolbarButton label="Inline code" active={state.code} onClick={() => run(chain => chain.toggleCode())}><Code2 size={16}/></ToolbarButton>
      <ToolbarButton label="Insert or edit link (Ctrl+K)" onClick={() => openLinkDialog(editor)}><Link2 size={16}/></ToolbarButton>
      <ToolbarButton label="Mark as Important (Ctrl+Shift+I)" active={state.important} disabled={state.selectionEmpty} onClick={() => toggleImportantSelection()}><Star size={16}/></ToolbarButton>
      <ToolbarButton label="Copy entire page" onClick={()=>void copyPage()}><Copy size={15}/><span className="copy-page-label">Copy Page</span></ToolbarButton>
      <ToolbarButton label="Copy current line" onClick={()=>{copyCurrentLine(editor);setCopyFeedback('Line copied.');window.setTimeout(()=>setCopyFeedback(''),1500)}}><Copy size={14}/><span className="copy-page-label">Copy Line</span></ToolbarButton>
      <span className="editor-tool-separator"/>
      <ColorPicker label="Text color" icon={<Palette size={15}/>} value={state.textColor ?? textColor} recent={recentColors} saved={savedColors} onSaveColor={saveColor} onRenameColor={renameColor} onDeleteColor={deleteColor} onMoveColor={moveColor} onChange={applyTextColor} onClear={clearTextColor}/>
      <ColorPicker label="Background highlight" icon={<Highlighter size={15}/>} value={state.highlightColor ?? highlightColor} recent={recentColors} onChange={applyHighlight} onClear={clearHighlight}/>
      <span className="editor-tool-separator"/>
      <ColorPicker label="Block text color" icon={<PanelTop size={15}/>} value={state.blockTextColor ?? blockTextColor} recent={recentColors} onChange={applyBlockTextColor} onClear={clearBlockTextColor}/>
      <ColorPicker label="Block background" icon={<Square size={15}/>} value={state.blockBackground ?? blockBackground} recent={recentColors} onChange={applyBlockBackground} onClear={clearBlockBackground}/>
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
        <ToolbarButton label="Add or remove table header row" onClick={() => editor.chain().focus().toggleHeaderRow().run()}><Table2 size={16}/><span className="table-tool-caption">Header</span></ToolbarButton>
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
    <div className="editor-workspace">
      {navigationOpen&&<button type="button" className="editor-nav-backdrop" aria-label="Close note navigation" onClick={()=>setNavigationOpen(false)}/>}
      <aside className={`editor-navigation-rail${navigationOpen?' is-open':''}`} aria-label="Note navigation">
        <div className="editor-nav-mobile-head"><strong>Note navigation</strong><button type="button" aria-label="Close note navigation" onClick={()=>setNavigationOpen(false)}><X size={16}/></button></div>
        <section className="editor-outline" aria-label="In this note"><div className="important-notes-heading"><h2>In this note</h2><span>{outlineCount(outline)}</span></div>{outline.length?<nav aria-label="Section and heading outline">{renderOutline(outline)}</nav>:<p>Add headings or sections to create an outline.</p>}</section>
        <section className="important-notes" aria-label="Important Notes">
          <div className="important-notes-heading"><h2><Star size={15}/>Important Notes</h2><span>{importantNotes.length}</span></div>
          {importantNotes.length ? <ol>{importantNotes.map((note, index) => <li key={note.id}>
            <button className="important-source-link" type="button" aria-label={`Jump to important note ${index + 1}`} onClick={() => jumpToSource(note)}><span className="important-number">{String(index + 1).padStart(2,'0')}.</span><span>{note.text}</span><CornerUpRight size={14}/></button>
            <button className="important-remove" type="button" aria-label={`Remove important marker ${index + 1}`} title="Remove marker" onClick={() => removeImportant(note)}><Trash2 size={14}/></button>
          </li>)}</ol> : <p>Select text and use <Star size={12}/> to collect it here.</p>}
        </section>
      </aside>
      <div className="editor-main-content"><EditorContent editor={editor} className="editor-content" onClick={onEditorClick} onContextMenu={onEditorContextMenu} /></div>
    </div>
    {linkMessage&&<div className="link-message" role="status"><span>{linkMessage}</span><button type="button" onClick={()=>setLinkMessage('')} aria-label="Dismiss message"><X size={13}/></button></div>}
    {importantFeedback&&<div className="editor-feedback" role="status">⭐ {importantFeedback}</div>}
    {copyFeedback&&<div className="editor-feedback copy-feedback" role="status">{copyFeedback}</div>}
    {selectionMenu&&<div className="link-context-menu selection-context-menu" role="menu" style={{left:selectionMenu.x,top:selectionMenu.y}} onMouseDown={event=>event.preventDefault()}><button type="button" role="menuitem" onClick={()=>{toggleImportantSelection();setSelectionMenu(null)}}><Star size={14}/>Mark as Important <kbd>Ctrl ⇧ I</kbd></button></div>}
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
