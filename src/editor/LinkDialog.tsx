import { useMemo, useState, type FormEvent } from 'react'
import { X, Search, Link2, FileText, ListTree, Heading, ExternalLink } from 'lucide-react'
import type { JSONContent } from '@tiptap/core'
import type { LinkType, NoteLinkAttrs } from './links'

export type LinkSubject = { id: string; title: string; icon: string }
export type LinkItem = { id: string; type: 'note' | 'section'; subjectId: string; parentId: string | null; title: string; icon: string; content: JSONContent }
export type LinkTarget = Pick<NoteLinkAttrs, 'href' | 'linkType' | 'targetId' | 'targetNoteId' | 'headingId'>
type HeadingTarget = { noteId: string; headingId: string; title: string; path: string }
type Props = { text: string; attrs: Partial<NoteLinkAttrs> | null; subjects: LinkSubject[]; items: LinkItem[]; onClose: () => void; onSave: (text: string, target: LinkTarget) => void; onRemove: () => void }

function hierarchyPath(item: LinkItem, items: LinkItem[], subjects: LinkSubject[]) {
  const parts = [item.title]
  let parentId = item.parentId
  while (parentId) { const parent = items.find(entry => entry.id === parentId); if (!parent) break; parts.unshift(parent.title); parentId = parent.parentId }
  const subject = subjects.find(entry => entry.id === item.subjectId)
  if (subject) parts.unshift(subject.title)
  return parts.join(' / ')
}

function contentText(node: JSONContent): string { return node.text ?? (node.content ?? []).map(contentText).join('') }
function findHeadings(noteId: string, content: JSONContent, path: string): HeadingTarget[] {
  const result: HeadingTarget[] = []
  const visit = (node: JSONContent, stack: string[]) => {
    let next = stack
    if (node.type === 'heading') {
      const title = contentText(node).trim()
      const id = node.attrs?.blockId
      if (title && typeof id === 'string' && id) { next = [...stack, title]; result.push({ noteId, headingId: id, title, path: `${path} / ${next.join(' / ')}` }) }
    }
    node.content?.forEach(child => visit(child, next))
  }
  visit(content, [])
  return result
}

export function LinkDialog({ text, attrs, subjects, items, onClose, onSave, onRemove }: Props) {
  const initialType: LinkType = attrs?.linkType === 'note' || attrs?.linkType === 'section' || attrs?.linkType === 'heading' ? attrs.linkType : 'external'
  const [type, setType] = useState<LinkType>(initialType)
  const [label, setLabel] = useState(text)
  const [url, setUrl] = useState(attrs?.href ?? '')
  const [targetId, setTargetId] = useState(attrs?.targetId ?? '')
  const [targetNoteId, setTargetNoteId] = useState(attrs?.targetNoteId ?? '')
  const [headingId, setHeadingId] = useState(attrs?.headingId ?? '')
  const [query, setQuery] = useState('')
  const [error, setError] = useState('')
  const headings = useMemo(() => items.flatMap(item => findHeadings(item.id, item.content, hierarchyPath(item, items, subjects))), [items, subjects])
  const candidates = useMemo(() => {
    const q = query.trim().toLocaleLowerCase()
    if (type === 'heading') return headings.filter(entry => !q || `${entry.title} ${entry.path}`.toLocaleLowerCase().includes(q))
    return items.filter(item => item.type === (type === 'note' ? 'note' : 'section') && (!q || `${item.title} ${hierarchyPath(item, items, subjects)}`.toLocaleLowerCase().includes(q)))
  }, [headings, items, query, subjects, type])
  const selectedPath = type === 'heading'
    ? headings.find(entry => entry.noteId === targetNoteId && entry.headingId === headingId)?.path
    : items.find(item => item.id === targetId) ? hierarchyPath(items.find(item => item.id === targetId)!, items, subjects) : undefined

  const submit = (event: FormEvent) => {
    event.preventDefault(); setError('')
    if (!label.trim()) { setError('Enter link text.'); return }
    if (type === 'external') {
      const clean = url.trim()
      let parsed: URL
      try { parsed = new URL(/^[a-z][a-z\d+.-]*:/i.test(clean) ? clean : `https://${clean}`) } catch { setError('Please enter a valid URL.'); return }
      if ((parsed.protocol !== 'http:' && parsed.protocol !== 'https:') || !parsed.hostname || parsed.username || parsed.password) { setError('Please enter a valid URL.'); return }
      onSave(label, { linkType: 'external', href: parsed.toString(), targetId: null, targetNoteId: null, headingId: null }); return
    }
    if (type === 'heading') {
      if (!targetNoteId || !headingId || !headings.some(entry => entry.noteId === targetNoteId && entry.headingId === headingId)) { setError('Choose a heading.'); return }
      onSave(label, { linkType: 'heading', href: null, targetId: headingId, targetNoteId, headingId }); return
    }
    if (!targetId || !items.some(item => item.id === targetId && item.type === (type === 'note' ? 'note' : 'section'))) { setError(`Choose a ${type}.`); return }
    onSave(label, { linkType: type, href: null, targetId, targetNoteId: null, headingId: null })
  }

  return <div className="link-dialog-backdrop" role="presentation" onMouseDown={event => { if (event.target === event.currentTarget) onClose() }} onKeyDown={event => { if (event.key === 'Escape') onClose() }}>
    <form className="link-dialog" role="dialog" aria-modal="true" aria-labelledby="link-dialog-title" onSubmit={submit}>
      <div className="dialog-head"><h2 id="link-dialog-title">{attrs ? 'Edit link' : 'Insert link'}</h2><button type="button" onClick={onClose} aria-label="Close dialog"><X size={18}/></button></div>
      <fieldset className="link-type-picker"><legend>Link type</legend>{([['external',<ExternalLink size={15}/>, 'External URL'],['note',<FileText size={15}/>, 'Note'],['section',<ListTree size={15}/>, 'Section'],['heading',<Heading size={15}/>, 'Heading']] as const).map(([value,icon,name])=><button type="button" key={value} className={type===value?'is-selected':''} aria-pressed={type===value} onClick={()=>{setType(value);setError('')}}>{icon}{name}</button>)}</fieldset>
      <label className="dialog-label">Link text<input autoFocus value={label} onChange={event => setLabel(event.target.value)} placeholder="Text to display" maxLength={240}/></label>
      {type === 'external' ? <label className="dialog-label">URL<input type="url" value={url} onChange={event => setUrl(event.target.value)} placeholder="https://example.com" autoComplete="url"/></label> : <>
        <label className="dialog-label link-search"><span>Search {type === 'heading' ? 'headings' : type === 'section' ? 'sections' : 'notes'}</span><span><Search size={15}/><input value={query} onChange={event => setQuery(event.target.value)} placeholder={type === 'heading' ? 'Search headings...' : `Search ${type}s...`}/></span></label>
        <div className="link-target-list" role="listbox" aria-label={`Available ${type} destinations`}>
          {candidates.map(candidate => type === 'heading' ? <button type="button" role="option" aria-selected={targetNoteId === (candidate as HeadingTarget).noteId && headingId === (candidate as HeadingTarget).headingId} key={`${(candidate as HeadingTarget).noteId}:${(candidate as HeadingTarget).headingId}`} onClick={()=>{const value=candidate as HeadingTarget;setTargetNoteId(value.noteId);setHeadingId(value.headingId)}}><span><Heading size={14}/><strong>{(candidate as HeadingTarget).title}</strong></span><small>{(candidate as HeadingTarget).path}</small></button> : <button type="button" role="option" aria-selected={targetId === (candidate as LinkItem).id} key={(candidate as LinkItem).id} onClick={()=>setTargetId((candidate as LinkItem).id)}><span><span>{(candidate as LinkItem).icon}</span><strong>{(candidate as LinkItem).title}</strong></span><small>{hierarchyPath(candidate as LinkItem, items, subjects)}</small></button>)}
          {!candidates.length&&<p className="link-target-empty">No matching {type} destinations.</p>}
        </div>
        {selectedPath&&<p className="link-selected-path"><Link2 size={13}/>{selectedPath}</p>}
      </>}
      {error&&<p className="dialog-error" role="alert">{error}</p>}
      <div className="dialog-actions">{attrs&&<button type="button" className="link-remove-button" onClick={onRemove}>Remove link</button>}<button type="button" className="secondary-button" onClick={onClose}>Cancel</button><button type="submit" className="primary-button">{attrs?'Save link':'Insert link'}</button></div>
    </form>
  </div>
}
