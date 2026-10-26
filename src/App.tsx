import { createContext, lazy, Suspense, useCallback, useContext, useEffect, useMemo, useRef, useState, type FormEvent } from 'react'
import { Link, Navigate, Route, Routes, useLocation, useNavigate, useParams } from 'react-router-dom'
import { ArrowLeft, ArrowRight, BookOpen, ChevronDown, ChevronRight, Clock3, Download, Eye, FileText, Home, List, Menu, MoreHorizontal, Pencil, Plus, Search, Star, Sun, Tag, Trash2, X, Settings as SettingsIcon } from 'lucide-react'
import { storage } from './storage'
import type { JSONContent } from '@tiptap/core'
import { EMPTY_DOCUMENT, toDocument } from './editor/document'
import { buildExport, downloadText, renderExport, safeFilename, type ExportItem, type ExportSubject } from './export/pipeline'
const RichNoteEditor = lazy(() => import('./editor/RichNoteEditor').then(module => ({ default: module.RichNoteEditor })))
const ReaderView = lazy(() => import('./reader/ReaderView').then(module => ({ default: module.ReaderView })))

type Theme = 'dark' | 'light' | 'system'
type Metadata = { description?: string; tags?: string[]; favorite?: boolean }
type Subject = Metadata & { id: string; title: string; icon: string; createdAt: number; updatedAt: number; order: number }
type HierarchyItem = Metadata & { id: string; type: 'note' | 'section'; subjectId: string; parentId: string | null; title: string; icon: string; order: number; createdAt: number; updatedAt: number; content: JSONContent }
type Workspace = { subjects: Subject[]; items: HierarchyItem[] }
const isItem = (value: Subject | HierarchyItem): value is HierarchyItem => 'subjectId' in value
type Draft = { mode: 'create-subject' | 'create-item' | 'rename'; subjectId?: string; parentId?: string | null; itemType?: 'note' | 'section'; targetId?: string }
type HierarchyApi = {
  data: Workspace; expanded: Set<string>; error: string; location: string
  openDialog: (draft: Draft) => void; closeDialog: () => void
  createSubject: (title: string, icon: string, metadata: Metadata) => string | null
  createItem: (draft: Omit<HierarchyItem, 'id' | 'createdAt' | 'updatedAt' | 'order' | 'content'>) => string | null
  rename: (id: string, title: string, icon: string, metadata: Metadata) => void; toggleFavorite: (id: string) => void; remove: (id: string) => void; reorder: (type: 'subject' | 'item', id: string, delta: number) => void; moveBefore: (type:'subject'|'item',id:string,targetId:string)=>void
  toggleExpanded: (id: string) => void; setExpanded: (values: Set<string>) => void; openDelete: (target: { type: 'subject' | 'item'; id: string }) => void
  closeDelete: () => void
  saveDocument: (id: string, doc: JSONContent) => boolean
}
const Ctx = createContext<HierarchyApi | null>(null)
const useHierarchy = () => { const c = useContext(Ctx); if (!c) throw new Error('Hierarchy context is missing'); return c }
const iconChoices = ['📚','🐍','⚡','🟨','☁️','⚙️','🧩','🧠','🧪','🌱','🔷','📐','📝','🎯','🗂️','💡','🏗️','🛢️','🟩','🚀','🇯🇵','📄','📁','🌐','🎨','🐳','🧮','📖','✍️','🧬','🔬','🧱','🗃️','💻']
const makeId = () => crypto.randomUUID()
function owningNote(items: HierarchyItem[], item?: HierarchyItem): HierarchyItem | undefined {
  let current = item
  const seen = new Set<string>()
  while (current && !seen.has(current.id)) {
    seen.add(current.id)
    if (current.type === 'note') return current
    current = current.parentId ? items.find(entry => entry.id === current!.parentId) : undefined
  }
  return undefined
}
function sectionDepth(items: HierarchyItem[], parent?: HierarchyItem): number {
  let depth = 2, current = parent
  const seen = new Set<string>()
  while (current?.type === 'section' && !seen.has(current.id)) {
    seen.add(current.id); depth++; current = current.parentId ? items.find(entry => entry.id === current!.parentId) : undefined
  }
  return Math.min(6, depth)
}
function updateSectionHeadings(doc: JSONContent, changes: Map<string, string | null>): JSONContent {
  const visit = (node: JSONContent): JSONContent | null => {
    const blockId = typeof node.attrs?.blockId === 'string' ? node.attrs.blockId : ''
    if (node.type === 'heading' && changes.has(blockId)) {
      const title = changes.get(blockId)
      return title === null ? null : { ...node, content: [{ type: 'text', text: title }] }
    }
    if (!node.content) return node
    return { ...node, content: node.content.map(visit).filter((child): child is JSONContent => child !== null) }
  }
  return visit(doc) ?? EMPTY_DOCUMENT
}
function seedWorkspace(): Workspace {
  return {subjects:[],items:[]}
}
function validWorkspace(value: Workspace): Workspace {
  const seenSubjects=new Set<string>()
  const subjects = Array.isArray(value?.subjects) ? value.subjects.filter(s=>{if(!s||typeof s.id!=='string'||typeof s.title!=='string'||typeof s.icon!=='string'||seenSubjects.has(s.id))return false;seenSubjects.add(s.id);return true}).map(s=>({...s,description:typeof s.description==='string'?s.description:'',tags:Array.isArray(s.tags)?s.tags.filter((tag):tag is string=>typeof tag==='string'):[],favorite:Boolean(s.favorite)})) : []
  const subjectIds = new Set(subjects.map(s=>s.id))
  const seen=new Set<string>()
  const raw = Array.isArray(value?.items) ? value.items.filter(i=>{if(!i||typeof i.id!=='string'||typeof i.title!=='string'||(i.type!=='note'&&i.type!=='section')||!subjectIds.has(i.subjectId)||seen.has(i.id))return false;seen.add(i.id);return true}) : []
  const ids = new Set(raw.map(i=>i.id))
  const byId=new Map(raw.map(i=>[i.id,i]))
  const items = raw.map(i=>{let parent=i.parentId&&ids.has(i.parentId)?byId.get(i.parentId):undefined;if(parent?.subjectId!==i.subjectId||parent?.id===i.id)parent=undefined;const seenParents=new Set([i.id]);let cursor=parent;while(cursor){if(seenParents.has(cursor.id)){parent=undefined;break}seenParents.add(cursor.id);cursor=cursor.parentId?byId.get(cursor.parentId):undefined}return {...i,parentId:parent?.id??null,description:typeof i.description==='string'?i.description:'',tags:Array.isArray(i.tags)?i.tags.filter((tag):tag is string=>typeof tag==='string'):[],favorite:Boolean(i.favorite),content:toDocument(i.content)}})
  return {subjects,items}
}
function App() {
  const [theme,setTheme] = useState<Theme>(()=>storage.get<Theme>('theme','dark'))
  const [data,setData] = useState<Workspace>(()=>validWorkspace(storage.get<Workspace>('workspace-v1',seedWorkspace())))
  const dataRef = useRef(data)
  const [expanded,setExpandedState] = useState<Set<string>>(()=>new Set(storage.get<string[]>('expanded-v1',[data.subjects[0]?.id].filter((id):id is string=>Boolean(id)))))
  const [draft,setDraft] = useState<Draft|null>(null)
  const [deleteTarget,setDeleteTarget] = useState<{type:'subject'|'item';id:string}|null>(null)
  const [error,setError] = useState('')
  const location = useLocation()
  const navigate = useNavigate()
  useEffect(()=>{const resolved=theme==='system'?(window.matchMedia('(prefers-color-scheme: light)').matches?'light':'dark'):theme;document.documentElement.dataset.theme=resolved;storage.set('theme',theme)},[theme])
  useEffect(()=>{if(theme!=='system')return;const media=window.matchMedia('(prefers-color-scheme: light)');const update=()=>{document.documentElement.dataset.theme=media.matches?'light':'dark'};media.addEventListener('change',update);return()=>media.removeEventListener('change',update)},[theme])
  const commit = (next: Workspace) => { dataRef.current=next;setData(next); if (!storage.set('workspace-v1',next)) setError('Could not save your changes. Check browser storage and try again.') }
  const saveDocument = (id:string,doc:JSONContent) => {
    const current=dataRef.current;const item=current.items.find(entry=>entry.id===id);if(!item)return false
    const next={...current,items:current.items.map(entry=>entry.id===id?{...entry,content:doc,updatedAt:Date.now()}:entry)}
    dataRef.current=next;setData(next)
    if(!storage.set('workspace-v1',next)){dataRef.current=current;setData(current);return false}
    return true
  }
  const openDialog = (d:Draft) => { setError('');setDraft(d) }
  const createSubject = (title:string,icon:string,metadata:Metadata) => {
    const clean=title.trim(); if(!clean){setError('Enter a name.');return null} if(data.subjects.some(s=>s.title.toLocaleLowerCase()===clean.toLocaleLowerCase())){setError('A subject with this name already exists.');return null}
    const now=Date.now(),id=makeId();commit({...data,subjects:[...data.subjects,{id,title:clean,icon,...metadata,createdAt:now,updatedAt:now,order:data.subjects.length}]});setDraft(null);navigate(`/subject/${id}`);return id
  }
  const createItem = (input:Omit<HierarchyItem,'id'|'createdAt'|'updatedAt'|'order'|'content'>) => {
    const clean=input.title.trim();if(!clean){setError('Enter a name.');return null} if(!data.subjects.some(s=>s.id===input.subjectId)){setError('Choose an existing subject.');return null}
    const parent=input.parentId?data.items.find(i=>i.id===input.parentId):undefined
    if(input.parentId&&!parent){setError('The selected parent no longer exists.');return null}if(parent&&parent.subjectId!==input.subjectId){setError('The selected parent belongs to a different subject.');return null}
    const siblings=data.items.filter(i=>i.subjectId===input.subjectId&&i.parentId===input.parentId);if(siblings.some(i=>i.title.toLocaleLowerCase()===clean.toLocaleLowerCase())){setError('A sibling with this name already exists.');return null}
    const now=Date.now(),id=makeId();const item:HierarchyItem={...input,id,title:clean,description:input.description??'',tags:input.tags??[],favorite:Boolean(input.favorite),createdAt:now,updatedAt:now,order:siblings.length,content:EMPTY_DOCUMENT}
    let nextItems=[...data.items,item]
    if(input.type==='section'&&parent){
      const owner=owningNote(data.items,parent)
      if(owner){
        const parentDoc=toDocument(owner.content)
        const heading:JSONContent={type:'heading',attrs:{level:sectionDepth(data.items,parent),blockId:id},content:[{type:'text',text:clean}]}
        nextItems=nextItems.map(entry=>entry.id===owner.id?{...entry,content:{...parentDoc,content:[...(parentDoc.content??[]),heading]},updatedAt:now}:entry)
      }
    }
    commit({...data,items:nextItems});setDraft(null)
    setExpanded(new Set([...expanded,input.parentId??input.subjectId]));navigate(`/note/${id}`,{state:{focusEditor:true}});return id
  }
  const rename = (id:string,title:string,icon:string,metadata:Metadata) => {
    const clean=title.trim();if(!clean){setError('Enter a name.');return} const subject=data.subjects.find(s=>s.id===id)
    if(subject){if(data.subjects.some(s=>s.id!==id&&s.title.toLocaleLowerCase()===clean.toLocaleLowerCase())){setError('A subject with this name already exists.');return}commit({...data,subjects:data.subjects.map(s=>s.id===id?{...s,title:clean,icon,...metadata,updatedAt:Date.now()}:s)})}
    else {const item=data.items.find(i=>i.id===id);if(!item){setError('This item no longer exists.');return}if(data.items.some(i=>i.id!==id&&i.subjectId===item.subjectId&&i.parentId===item.parentId&&i.title.toLocaleLowerCase()===clean.toLocaleLowerCase())){setError('A sibling with this name already exists.');return}
      const now=Date.now(),owner=item.type==='section'?owningNote(data.items,item):undefined
      const items=data.items.map(i=>i.id===id?{...i,title:clean,icon,...metadata,updatedAt:now}:i)
      if(owner&&item.type==='section')items.splice(items.findIndex(i=>i.id===owner.id),1,{...owner,content:updateSectionHeadings(toDocument(owner.content),new Map([[id,clean]])),updatedAt:now})
      commit({...data,items})}
    setDraft(null)
  }
  const toggleFavorite=(id:string)=>{const subject=data.subjects.find(entry=>entry.id===id);if(subject)commit({...data,subjects:data.subjects.map(entry=>entry.id===id?{...entry,favorite:!entry.favorite,updatedAt:Date.now()}:entry)});else commit({...data,items:data.items.map(entry=>entry.id===id?{...entry,favorite:!entry.favorite,updatedAt:Date.now()}:entry)})}
  const descendants=(id:string):string[]=>{const children=data.items.filter(i=>i.parentId===id).flatMap(i=>[i.id,...descendants(i.id)]);return children}
  const remove = (id:string) => {
    const subject=data.subjects.find(s=>s.id===id)
    const currentId=location.pathname.match(/^\/note\/([^/]+)/)?.[1];const currentItem=data.items.find(i=>i.id===currentId)
    if(subject){const gone=new Set(data.items.filter(i=>i.subjectId===id).flatMap(i=>[i.id,...descendants(i.id)]));commit({subjects:data.subjects.filter(s=>s.id!==id),items:data.items.filter(i=>!gone.has(i.id))});setExpanded(new Set([...expanded].filter(x=>x!==id&&!gone.has(x))));if(location.pathname.includes(id)||currentItem?.subjectId===id)navigate('/')}
    else {const item=data.items.find(i=>i.id===id),gone=new Set([id,...descendants(id)]);let items=data.items.filter(i=>!gone.has(i.id));if(item?.type==='section'){const owner=owningNote(data.items,item);if(owner){const markers=new Map([...gone].filter(key=>data.items.find(entry=>entry.id===key)?.type==='section').map(key=>[key,null] as [string,null]));items=items.map(entry=>entry.id===owner.id?{...entry,content:updateSectionHeadings(toDocument(owner.content),markers),updatedAt:Date.now()}:entry)}}commit({...data,items});setExpanded(new Set([...expanded].filter(x=>!gone.has(x))));if(currentId&&gone.has(currentId)){const item=data.items.find(i=>i.id===id),parent=item?.parentId?owningNote(data.items,data.items.find(entry=>entry.id===item.parentId)):undefined;navigate(parent?`/note/${parent.id}`:item?`/subject/${item.subjectId}`:'/')}}
    setDeleteTarget(null)
  }
  const reorder = (type:'subject'|'item',id:string,delta:number) => {
    if(type==='subject'){const sorted=[...data.subjects].sort((a,b)=>a.order-b.order),at=sorted.findIndex(s=>s.id===id),to=Math.max(0,Math.min(sorted.length-1,at+delta));if(at<0||at===to)return;[sorted[at],sorted[to]]=[sorted[to],sorted[at]];commit({...data,subjects:sorted.map((s,order)=>({...s,order}))})}
    else {const node=data.items.find(i=>i.id===id);if(!node)return;const sorted=data.items.filter(i=>i.subjectId===node.subjectId&&i.parentId===node.parentId).sort((a,b)=>a.order-b.order),at=sorted.findIndex(i=>i.id===id),to=Math.max(0,Math.min(sorted.length-1,at+delta));if(at<0||at===to)return;[sorted[at],sorted[to]]=[sorted[to],sorted[at]];const rank=new Map(sorted.map((x,order)=>[x.id,order]));commit({...data,items:data.items.map(i=>rank.has(i.id)?{...i,order:rank.get(i.id)!}:i)})}
  }
  const moveBefore=(type:'subject'|'item',id:string,targetId:string)=>{
    if(id===targetId)return
    if(type==='subject'){const sorted=[...data.subjects].sort((a,b)=>a.order-b.order),from=sorted.findIndex(s=>s.id===id);if(from<0)return;const [entry]=sorted.splice(from,1),to=sorted.findIndex(s=>s.id===targetId);if(to<0)return;sorted.splice(to,0,entry);commit({...data,subjects:sorted.map((s,order)=>({...s,order}))})}
    else {const source=data.items.find(i=>i.id===id),target=data.items.find(i=>i.id===targetId);if(!source||!target||source.subjectId!==target.subjectId||source.parentId!==target.parentId)return;const sorted=data.items.filter(i=>i.subjectId===source.subjectId&&i.parentId===source.parentId).sort((a,b)=>a.order-b.order),from=sorted.findIndex(i=>i.id===id);const [entry]=sorted.splice(from,1),to=sorted.findIndex(i=>i.id===targetId);if(to<0)return;sorted.splice(to,0,entry);const ranks=new Map(sorted.map((i,order)=>[i.id,order]));commit({...data,items:data.items.map(i=>ranks.has(i.id)?{...i,order:ranks.get(i.id)!}:i)})}
  }
  const setExpanded=(values:Set<string>)=>{setExpandedState(values);storage.set('expanded-v1',[...values])}
  const toggleExpanded=(id:string)=>{const next=new Set(expanded);next.has(id)?next.delete(id):next.add(id);setExpanded(next)}
  const api:HierarchyApi={data,expanded,error,location:location.pathname,openDialog,closeDialog:()=>{setDraft(null);setError('')},createSubject,createItem,rename,toggleFavorite,remove,reorder,moveBefore,toggleExpanded,setExpanded,openDelete:setDeleteTarget,closeDelete:()=>setDeleteTarget(null),saveDocument}
  const [mobileOpen,setMobileOpen]=useState(false)
  useEffect(()=>{if(!mobileOpen)return;const close=(event:KeyboardEvent)=>{if(event.key==='Escape')setMobileOpen(false)};window.addEventListener('keydown',close);return()=>window.removeEventListener('keydown',close)},[mobileOpen])
  return <Ctx.Provider value={api}><div className="app-shell"><Topbar theme={theme} toggle={()=>setTheme(theme==='dark'?'light':'dark')} setTheme={setTheme}/>
    <div className="dashboard-layout phase1-shell">{mobileOpen&&<button className="mobile-sidebar-backdrop" aria-label="Close navigation" onClick={()=>setMobileOpen(false)}/>}<Sidebar mobileOpen={mobileOpen} closeMobile={()=>setMobileOpen(false)} />
      <Routes><Route path="/" element={<Dashboard openMobile={()=>setMobileOpen(true)} />} /><Route path="/subject/:subjectId" element={<Dashboard openMobile={()=>setMobileOpen(true)} />} /><Route path="/note/:noteId" element={<NotePage openMobile={()=>setMobileOpen(true)} />} /><Route path="*" element={<Dashboard openMobile={()=>setMobileOpen(true)} />} /></Routes>
    </div>{draft&&<EditDialog draft={draft}/ >}{deleteTarget&&<DeleteDialog target={deleteTarget}/ >}{error&&<div className="toast-error" role="alert">{error}<button onClick={()=>setError('')} aria-label="Dismiss"><X size={15}/></button></div>}
  </div></Ctx.Provider>
}
export default App

function Topbar({theme,toggle,setTheme}:{theme:Theme;toggle:()=>void;setTheme:(value:Theme)=>void}) {const {data}=useHierarchy();const navigate=useNavigate();const [query,setQuery]=useState(''),[open,setOpen]=useState(false),[settings,setSettings]=useState(false),[selected,setSelected]=useState(0);const input=useRef<HTMLInputElement>(null);const results=useMemo(()=>{const q=query.trim().toLocaleLowerCase();if(!q)return [];const text=(node:JSONContent):string=>[node.text,...(node.content??[]).map(text)].filter(Boolean).join(' ');return data.items.filter(item=>item.title.toLocaleLowerCase().includes(q)||(item.description??'').toLocaleLowerCase().includes(q)||(item.tags??[]).some(tag=>tag.includes(q))||text(item.content).toLocaleLowerCase().includes(q)).map(item=>{const subject=data.subjects.find(s=>s.id===item.subjectId);const parents:HierarchyItem[]=[];let parent=item.parentId?data.items.find(i=>i.id===item.parentId):undefined;while(parent){parents.unshift(parent);parent=parent.parentId?data.items.find(i=>i.id===parent!.parentId):undefined}const body=text(item.content);const at=body.toLocaleLowerCase().indexOf(q);return {item,path:[subject?.title,...parents.map(p=>p.title)].filter(Boolean).join(' → '),snippet:at<0?(item.tags??[]).filter(tag=>tag.includes(q)).map(tag=>`#${tag}`).join(' '):`…${body.slice(Math.max(0,at-48),Math.min(body.length,at+100))}…`}}).slice(0,30)},[data,query]);
  const show=()=>{setOpen(true);setSettings(false);requestAnimationFrame(()=>input.current?.focus())};useEffect(()=>{const key=(e:KeyboardEvent)=>{if((e.ctrlKey||e.metaKey)&&e.shiftKey&&e.key.toLowerCase()==='k'){e.preventDefault();show()}if(e.key==='Escape'){setOpen(false);setSettings(false)}};window.addEventListener('keydown',key);return()=>window.removeEventListener('keydown',key)},[]);
  const select=(index:number)=>{const result=results[index];if(result){setOpen(false);setQuery('');navigate(`/note/${result.item.id}`)}};
  return <><header className="topbar"><Link to="/" className="brand"><span className="brand-icon"><BookOpen size={25}/></span><span>NoteHub</span></Link><label className="global-search" onClick={show}><Search size={16}/><input value={query} onFocus={show} onChange={e=>setQuery(e.target.value)} placeholder="Search notes, topics..." readOnly/><kbd>Ctrl ⇧ K</kbd></label><div className="top-actions"><span className="sun-icon"><Sun size={18}/></span><button className="theme-switch" onClick={toggle} aria-label={`Switch to ${theme==='dark'?'light':'dark'} mode`}><span/></button><button className="avatar" onClick={()=>setSettings(true)} aria-label="Settings"><SettingsIcon size={15}/></button></div></header>
    {open&&<div className="search-backdrop" onMouseDown={e=>{if(e.target===e.currentTarget)setOpen(false)}}><section className="search-dialog" role="dialog" aria-modal="true" aria-label="Search notes"><div className="search-dialog-input"><Search size={18}/><input ref={input} value={query} onChange={e=>{setQuery(e.target.value);setSelected(0)}} onKeyDown={e=>{if(e.key==='ArrowDown'){e.preventDefault();setSelected(i=>Math.min(results.length-1,i+1))}if(e.key==='ArrowUp'){e.preventDefault();setSelected(i=>Math.max(0,i-1))}if(e.key==='Enter'){e.preventDefault();select(selected)}if(e.key==='Escape')setOpen(false)}} placeholder="Search titles, sections, and note content…"/><kbd>ESC</kbd></div>{query.trim()&&results.length===0?<div className="search-empty"><strong>No results for “{query}”</strong><span>Try checking the spelling, using a shorter term, or searching another keyword.</span></div>:<div className="search-results" role="listbox">{results.map((r,i)=><button role="option" aria-selected={selected===i} key={r.item.id} onMouseEnter={()=>setSelected(i)} onClick={()=>select(i)}><strong>{r.item.icon} {r.item.title}</strong><small>{r.path}</small>{r.snippet&&<span>{r.snippet}</span>}</button>)}</div>}<footer><span>↑↓ Navigate</span><span>↵ Open</span><button onClick={()=>setOpen(false)}>Esc Close</button></footer></section></div>}
    {settings&&<div className="search-backdrop" onMouseDown={e=>{if(e.target===e.currentTarget)setSettings(false)}}><section className="settings-dialog" role="dialog" aria-modal="true" aria-labelledby="settings-title"><div className="dialog-head"><h2 id="settings-title">Settings</h2><button onClick={()=>setSettings(false)} aria-label="Close settings"><X size={18}/></button></div><nav className="settings-tabs"><a href="#appearance">Appearance</a><a href="#keyboard">Keyboard shortcuts</a><a href="#storage">Data / Storage</a></nav><section id="appearance"><h3>Appearance</h3><label className="dialog-label">Theme<select value={theme} onChange={e=>setTheme(e.target.value as Theme)}><option value="dark">Dark</option><option value="light">Light</option><option value="system">System</option></select></label><p>Dark mode is the default. System follows your device appearance.</p></section><section id="keyboard"><h3>Keyboard shortcuts</h3><dl className="shortcut-list"><div><dt>Bold</dt><dd>Ctrl + B</dd></div><div><dt>Italic</dt><dd>Ctrl + I</dd></div><div><dt>Underline</dt><dd>Ctrl + U</dd></div><div><dt>Insert link</dt><dd>Ctrl + K</dd></div><div><dt>Search notes</dt><dd>Ctrl + Shift + K</dd></div><div><dt>Move line</dt><dd>Alt + ↑ / ↓</dd></div></dl><p>Search uses Ctrl + Shift + K to keep the editor’s Ctrl + K link shortcut available.</p></section><section id="storage"><h3>Data / Storage</h3><p>Your workspace and appearance preference are stored locally in this browser. Export notes regularly to keep a separate backup.</p></section></section></div>}
  </>}

function Sidebar({mobileOpen,closeMobile}:{mobileOpen:boolean;closeMobile:()=>void}) {
  const {data,expanded,toggleExpanded,openDialog,openDelete,reorder,moveBefore}=useHierarchy();const navigate=useNavigate();const location=useLocation();const subjectMatch=location.pathname.match(/^\/subject\/([^/]+)/),activeSubject=subjectMatch?.[1];const noteMatch=location.pathname.match(/^\/note\/([^/]+)/),activeNote=noteMatch?.[1]
  const itemsFor=(subjectId:string,parentId:string|null)=>data.items.filter(i=>i.subjectId===subjectId&&i.parentId===parentId).sort((a,b)=>a.order-b.order)
  return <aside className={`main-sidebar phase1-sidebar ${mobileOpen?'mobile-open':''}`}><div className="sidebar-mobile-head"><strong>Browse</strong><button onClick={closeMobile} aria-label="Close navigation"><X size={18}/></button></div>
    <nav className="primary-nav"><Link to="/" onClick={closeMobile} className={`side-link ${location.pathname==='/'?'selected':''}`}><Home size={16}/><span>Home</span></Link><Link to="/" onClick={closeMobile} className="side-link"><FileText size={16}/><span>All Notes</span></Link><button className="side-link" onClick={()=>navigate('/?view=favorites')}><Star size={16}/><span>Favorites</span></button><button className="side-link" onClick={()=>navigate('/?view=recent')}><Clock3 size={16}/><span>Recent</span></button><button className="side-link" onClick={()=>navigate('/?view=tags')}><Tag size={16}/><span>Tags</span></button></nav>
    <div className="sidebar-divider"/><div className="section-label"><span>SUBJECTS</span><button title="Create subject" onClick={()=>openDialog({mode:'create-subject'})}><Plus size={15}/></button></div>
    <nav className="subject-nav phase1-tree">{[...data.subjects].sort((a,b)=>a.order-b.order).map(subject=><div key={subject.id}><div className={`tree-row subject-tree-row ${activeSubject===subject.id?'tree-active':''}`} onDragOver={e=>e.preventDefault()} onDrop={e=>{const id=e.dataTransfer.getData('application/notehub-subject');if(id)moveBefore('subject',id,subject.id)}}><button className="tree-expander" title={`${expanded.has(subject.id)?'Collapse':'Expand'} ${subject.title}`} aria-label={`${expanded.has(subject.id)?'Collapse':'Expand'} ${subject.title}`} onClick={()=>toggleExpanded(subject.id)}>{expanded.has(subject.id)?<ChevronDown size={13}/>:<ChevronRight size={13}/>}</button><button className="tree-main" draggable onDragStart={e=>e.dataTransfer.setData('application/notehub-subject',subject.id)} onClick={()=>{navigate(`/subject/${subject.id}`);closeMobile()}}><span className="tree-emoji">{subject.icon}</span><span>{subject.title}</span></button><TreeActions onAdd={()=>openDialog({mode:'create-item',subjectId:subject.id,parentId:null,itemType:'note'})} onRename={()=>openDialog({mode:'rename',targetId:subject.id})} onDelete={()=>openDelete({type:'subject',id:subject.id})} onUp={()=>reorder('subject',subject.id,-1)} onDown={()=>reorder('subject',subject.id,1)}/></div>{expanded.has(subject.id)&&itemsFor(subject.id,null).map(item=><TreeItem key={item.id} item={item} depth={1} itemsFor={itemsFor} activeId={activeNote} onOpen={id=>{const target=data.items.find(entry=>entry.id===id),owner=target?.type==='section'?owningNote(data.items,target):undefined;navigate(target?.type==='section'&&owner?`/note/${owner.id}`:`/note/${id}`,target?.type==='section'&&owner?{state:{jumpToSectionId:target.id}}:undefined);closeMobile()}} onToggle={toggleExpanded} expanded={expanded} openDialog={openDialog} openDelete={openDelete} reorder={reorder}/>)}</div>)}</nav>
    <button className="add-subject" onClick={()=>openDialog({mode:'create-subject'})}><Plus size={16}/>New Subject</button>
  </aside>
}
function TreeItem({item,depth,itemsFor,activeId,onOpen,onToggle,expanded,openDialog,openDelete,reorder}:{item:HierarchyItem;depth:number;itemsFor:(s:string,p:string|null)=>HierarchyItem[];activeId?:string;onOpen:(id:string)=>void;onToggle:(id:string)=>void;expanded:Set<string>;openDialog:(d:Draft)=>void;openDelete:(t:{type:'subject'|'item';id:string})=>void;reorder:(type:'subject'|'item',id:string,delta:number)=>void}) {
  const children=itemsFor(item.subjectId,item.id),sections=children.filter(child=>child.type==='section'),notes=children.filter(child=>child.type==='note'),hasChildren=children.length>0
  const renderItems=(values:HierarchyItem[])=>values.map(child=><TreeItem key={child.id} item={child} depth={depth+1} itemsFor={itemsFor} activeId={activeId} onOpen={onOpen} onToggle={onToggle} expanded={expanded} openDialog={openDialog} openDelete={openDelete} reorder={reorder}/> )
  return <div><div className={`tree-row note-tree-row ${activeId===item.id?'tree-active':''}`} style={{'--tree-depth':depth} as React.CSSProperties}><button className="tree-expander" title={hasChildren?`${expanded.has(item.id)?'Collapse':'Expand'} ${item.title}`:'No nested items'} aria-label={hasChildren?`${expanded.has(item.id)?'Collapse':'Expand'} ${item.title}`:`${item.title} has no nested items`} onClick={()=>hasChildren&&onToggle(item.id)}>{hasChildren?(expanded.has(item.id)?<ChevronDown size={13}/>:<ChevronRight size={13}/>):<span className="tree-dot"/>}</button><button className="tree-main" draggable onDragStart={e=>e.dataTransfer.setData('application/notehub-item',item.id)} onClick={()=>onOpen(item.id)}><span className="tree-emoji">{item.icon}</span><span>{item.title}</span></button><TreeActions onAdd={()=>openDialog({mode:'create-item',subjectId:item.subjectId,parentId:item.id,itemType:'note'})} onAddSection={()=>openDialog({mode:'create-item',subjectId:item.subjectId,parentId:item.id,itemType:'section'})} onRename={()=>openDialog({mode:'rename',targetId:item.id})} onDelete={()=>openDelete({type:'item',id:item.id})} onUp={()=>reorder('item',item.id,-1)} onDown={()=>reorder('item',item.id,1)}/></div>{expanded.has(item.id)&&item.type==='note'&&sections.length>0&&<><div className="tree-group-label" style={{'--tree-depth':depth+1} as React.CSSProperties}>SECTIONS</div>{renderItems(sections)}</>}{expanded.has(item.id)&&item.type==='note'&&notes.length>0&&<><div className="tree-group-label" style={{'--tree-depth':depth+1} as React.CSSProperties}>NESTED NOTES</div>{renderItems(notes)}</>}{expanded.has(item.id)&&item.type==='section'&&renderItems(children)}</div>
}
function TreeActions({onAdd,onAddSection,onRename,onDelete,onUp,onDown}:{onAdd:()=>void;onAddSection?:()=>void;onRename:()=>void;onDelete:()=>void;onUp:()=>void;onDown:()=>void}) {return <details className="tree-actions"><summary aria-label="Item actions" title="Item actions"><MoreHorizontal size={16}/></summary><div className="tree-menu"><button onClick={onAdd}><Plus size={13}/>Add note</button>{onAddSection&&<button onClick={onAddSection}><List size={13}/>Add section</button>}<button onClick={onUp}><ArrowLeft size={13}/>Move up</button><button onClick={onDown}><ArrowRight size={13}/>Move down</button><button onClick={onRename}><Pencil size={13}/>Edit details</button><button className="danger-action" onClick={onDelete}><Trash2 size={13}/>Delete</button></div></details>}

function Dashboard({openMobile}:{openMobile:()=>void}) {
  const {data,openDialog,moveBefore,openDelete,toggleFavorite}=useHierarchy();const {subjectId}=useParams();const location=useLocation();const params=new URLSearchParams(location.search);const subject=data.subjects.find(s=>s.id===subjectId);const isAll=!subjectId;const view=params.get('view'),selectedTag=params.get('tag');
  const [dragged,setDragged]=useState<string|null>(null);const [exportOpen,setExportOpen]=useState(false)
  const children=subject?data.items.filter(i=>i.subjectId===subject.id&&i.parentId===null).sort((a,b)=>a.order-b.order):[]
  const childCount=(id:string):number=>{const direct=data.items.filter(i=>i.parentId===id);return direct.length+direct.reduce((sum,i)=>sum+childCount(i.id),0)}
  const crumbs=subject?[{title:subject.title,icon:subject.icon,to:`/subject/${subject.id}`}]:[]
  const invalidSubject=Boolean(subjectId&&!subject)
  const favoriteCards:Array<Subject|HierarchyItem>= [...data.subjects.filter(s=>s.favorite),...data.items.filter(i=>i.type==='note'&&i.favorite)]
  const recentCards:HierarchyItem[]=data.items.filter(i=>i.type==='note').sort((a,b)=>b.updatedAt-a.updatedAt).slice(0,30)
  const allTags=[...new Set([...data.subjects.flatMap(s=>s.tags??[]),...data.items.flatMap(i=>i.tags??[])])].sort()
  const taggedCards=[...data.subjects.filter(s=>(s.tags??[]).includes(selectedTag??'')),...data.items.filter(i=>i.type==='note'&&(i.tags??[]).includes(selectedTag??''))]
  const title=invalidSubject?'Subject not found':selectedTag?`#${selectedTag}`:view==='favorites'?'Favorites':view==='recent'?'Recent':view==='tags'?'Tags':subject?.title??'All Notes'
  const cards=subject?children:view==='favorites'?favoriteCards:view==='recent'?recentCards:selectedTag?taggedCards:data.subjects
  const createForSubject=(s:Subject)=>openDialog({mode:'create-item',subjectId:s.id,parentId:null,itemType:'note'})
  const drop=(target:Subject|HierarchyItem)=>{if(!dragged)return;if(isItem(target))moveBefore('item',dragged,target.id);else moveBefore('subject',dragged,target.id);setDragged(null)}
  return <main className="dashboard-main phase1-main"><div className="dashboard-heading phase1-heading"><button className="mobile-menu" onClick={openMobile} aria-label="Open navigation"><Menu/></button><div><div className="breadcrumbs"><Link to="/">Home</Link>{crumbs.map(c=><span key={c.to}><span className="crumb-slash">/</span><span>{c.icon} {c.title}</span></span>)}</div><h1>{title}</h1><p>{subject?subject.description||`Notes in ${subject.title}.`:selectedTag?`Notes and subjects tagged #${selectedTag}.`:'Your learning notes, organized by subject.'}</p>{subject&&(subject.tags?.length??0)>0&&<div className="note-tags subject-heading-tags">{subject.tags?.map(tag=><Link key={tag} to={`/?tag=${encodeURIComponent(tag)}`} className="tag-chip">#{tag}</Link>)}</div>}</div><div className="heading-actions">{subject&&<><button className="secondary-button" onClick={()=>setExportOpen(true)}><Download size={15}/>Export</button><button className="secondary-button" onClick={()=>openDialog({mode:'rename',targetId:subject.id})}><Pencil size={14}/>Edit details</button><button className="primary-button" onClick={()=>createForSubject(subject)}><Plus size={17}/>New Note</button></>}{isAll&&!view&&!selectedTag&&<button className="primary-button" onClick={()=>openDialog({mode:'create-subject'})}><Plus size={17}/>New Subject</button>}</div></div>
    {invalidSubject&&<div className="empty-state"><div className="empty-emoji">📂</div><h2>This subject no longer exists</h2><p>It may have been deleted or moved.</p><Link to="/" className="secondary-button">Back to all subjects</Link></div>}
    {view==='tags'&&!selectedTag&&allTags.length>0&&<div className="tag-browser">{allTags.map(tag=><Link key={tag} to={`/?tag=${encodeURIComponent(tag)}`} className="tag-chip">#{tag}<span>{[...data.subjects,...data.items].filter(entry=>(entry.tags??[]).includes(tag)).length}</span></Link>)}</div>}
    {((view==='tags'&&!selectedTag&&allTags.length===0)||(view==='favorites'&&favoriteCards.length===0)||(view==='recent'&&recentCards.length===0)||(selectedTag&&taggedCards.length===0))&&<div className="empty-state"><div className="empty-emoji">{view==='favorites'?'☆':view==='recent'?'◷':'#'}</div><h2>{view==='favorites'?'No favorites yet':view==='recent'?'No recent notes':view==='tags'?'No tags yet':`No results for #${selectedTag}`}</h2><p>{view==='recent'?'Recent activity will appear here as you work.':'Add details to a subject or note to make it appear here.'}</p><Link to="/" className="secondary-button">Browse subjects</Link></div>}
    {!view&&!invalidSubject&&isAll&&cards.length===0&&<div className="empty-state"><div className="empty-emoji">📚</div><h2>No subjects yet</h2><p>Create your first subject to start organizing your notes.</p><button className="primary-button" onClick={()=>openDialog({mode:'create-subject'})}><Plus size={16}/>Create Subject</button></div>}
    {!view&&!invalidSubject&&subject&&cards.length===0&&<div className="empty-state"><div className="empty-emoji">📝</div><h2>No notes yet</h2><p>Create a note to start building {subject.title}.</p><div className="empty-actions"><button className="primary-button" onClick={()=>createForSubject(subject)}><Plus size={16}/>New Note</button></div></div>}
    {(!view||view==='favorites'||view==='recent'||selectedTag)&&!invalidSubject&&cards.length>0&&<div className="subject-grid phase1-cards">{cards.map(card=>{const item=isItem(card);const count=item?childCount(card.id):data.items.filter(i=>i.subjectId===card.id).length;const to=item?`/note/${card.id}`:`/subject/${card.id}`;const description=card.description|| (item?(card.type==='section'?'Section · grouped content':`Inside ${data.subjects.find(s=>s.id===card.subjectId)?.title??'subject'}`):'Organized notes and study topics.');return <article key={card.id} className="subject-card phase1-card" draggable onDragStart={e=>{setDragged(card.id);e.dataTransfer.setData('text/plain',card.id)}} onDragEnd={()=>setDragged(null)} onDragOver={e=>e.preventDefault()} onDrop={()=>drop(card)}><Link to={to} className="card-open"><div className="card-icon emoji-card">{card.icon}</div><div className="card-copy"><h2>{card.title}</h2><p>{description}</p>{(card.tags?.length??0)>0&&<div className="card-tags">{card.tags?.slice(0,3).map(tag=><span key={tag}>#{tag}</span>)}</div>}</div><span className="note-count">{count} {count===1?'item':'items'}</span><ArrowRight className="card-arrow" size={18}/></Link><div className="card-actions"><button aria-label={`Favorite ${card.title}`} title={card.favorite?'Remove from favorites':'Add to favorites'} onClick={()=>toggleFavorite(card.id)}><Star size={14} fill={card.favorite?'currentColor':'none'}/></button><button aria-label={`Add note inside ${card.title}`} title="Add nested note" onClick={()=>openDialog({mode:'create-item',subjectId:item?card.subjectId:card.id,parentId:item?card.id:null,itemType:'note'})}><Plus size={14}/></button><button aria-label={`Edit details for ${card.title}`} title="Edit details" onClick={()=>openDialog({mode:'rename',targetId:card.id})}><Pencil size={14}/></button><button aria-label={`Delete ${card.title}`} title="Delete" onClick={()=>openDelete({type:item?'item':'subject',id:card.id})}><Trash2 size={14}/></button></div></article>})}</div>}
  {exportOpen&&subject&&<ExportDialog subject={subject} items={data.items} onClose={()=>setExportOpen(false)}/>}</main>
}

function NotePage({openMobile}:{openMobile:()=>void}) {
  const {noteId}=useParams();const {data,openDialog,openDelete,reorder,saveDocument,toggleFavorite}=useHierarchy();const location=useLocation();const navigate=useNavigate();const item=data.items.find(i=>i.id===noteId);const subject=item&&data.subjects.find(s=>s.id===item.subjectId);const parent=item?.parentId?data.items.find(i=>i.id===item.parentId):undefined;const sectionOwner=item?.type==='section'?owningNote(data.items,item):undefined;const [headingJumpError,setHeadingJumpError]=useState('');const [exportOpen,setExportOpen]=useState(false);const [readerMode,setReaderMode]=useState(false);const [readerContent,setReaderContent]=useState<{noteId:string;content:JSONContent}|null>(null);const editorFlush=useRef<{noteId:string;flush:()=>JSONContent}>({noteId:noteId??'',flush:()=>item?.content??EMPTY_DOCUMENT});const registerEditorFlush=useCallback((flush:()=>JSONContent)=>{editorFlush.current={noteId:noteId??'',flush}},[noteId])
  useEffect(()=>{
    const navState=location.state as {jumpToHeadingId?:string;jumpToSectionId?:string}|null
    const headingId=navState?.jumpToHeadingId??navState?.jumpToSectionId
    if(!headingId||!item)return
    setHeadingJumpError('')
    let attempts=0,timer:number|undefined
    const findTarget=()=>{const target=document.querySelector<HTMLElement>(`[data-block-id="${CSS.escape(headingId)}"]`);if(target){target.scrollIntoView({behavior:'smooth',block:'start'});target.classList.add('link-target-flash');window.setTimeout(()=>target.classList.remove('link-target-flash'),1500);return}if(++attempts<30)timer=window.setTimeout(findTarget,60);else setHeadingJumpError('The linked heading could not be found. It may have been removed.')}
    findTarget()
    return()=>{if(timer!==undefined)window.clearTimeout(timer)}
  },[item?.id,location.key,location.state])
  const trail:HierarchyItem[]=[];let cursor=item;while(cursor?.parentId){const p=data.items.find(i=>i.id===cursor?.parentId);if(!p)break;trail.unshift(p);cursor=p}
  const enterReader=()=>{if(!item)return;try{const latest=editorFlush.current.noteId===item.id?editorFlush.current.flush():item.content;setReaderContent({noteId:item.id,content:latest});setReaderMode(true)}catch(error){setHeadingJumpError(error instanceof Error?error.message:'Unable to save the latest changes.')}}
  const enterEditor=()=>{setReaderMode(false);setReaderContent(null)}
  if(item?.type==='section'&&sectionOwner)return <Navigate to={`/note/${sectionOwner.id}`} replace state={{jumpToSectionId:item.id}}/>
  if(!item||!subject)return <main className="dashboard-main phase1-main"><button className="mobile-menu" onClick={openMobile}><Menu/></button><div className="empty-state"><h2>This note no longer exists</h2><p>It may have been deleted or moved.</p><Link to="/" className="secondary-button">Back to all notes</Link></div></main>
  const children=data.items.filter(i=>i.parentId===item.id).sort((a,b)=>a.order-b.order)
  return <main className="dashboard-main phase1-main note-workspace"><button className="mobile-menu" onClick={openMobile} aria-label="Open navigation"><Menu size={18}/></button><nav className="breadcrumbs note-breadcrumbs"><Link to="/">Home</Link><span className="crumb-slash">/</span><Link to={`/subject/${subject.id}`}>{subject.icon} {subject.title}</Link>{trail.map(t=><span key={t.id}><span className="crumb-slash">/</span><Link to={`/note/${t.id}`}>{t.icon} {t.title}</Link></span>)}<span className="crumb-slash">/</span><span>{item.icon} {item.title}</span></nav>
    <div className="note-placeholder-actions reader-actions"><div className="reader-mode-switch" role="group" aria-label="Note view mode"><button type="button" className={!readerMode?'selected':''} aria-pressed={!readerMode} onClick={enterEditor}><Pencil size={14}/>Edit</button><button type="button" className={readerMode?'selected':''} aria-pressed={readerMode} onClick={enterReader}><Eye size={14}/>Preview</button></div><button className="secondary-button" onClick={()=>setExportOpen(true)}><Download size={15}/>Export</button>{!readerMode&&<><button className="secondary-button" onClick={()=>openDialog({mode:'create-item',subjectId:item.subjectId,parentId:item.id,itemType:'note'})}><Plus size={15}/>New nested note</button><button className="secondary-button" onClick={()=>openDialog({mode:'create-item',subjectId:item.subjectId,parentId:item.id,itemType:'section'})}><List size={15}/>New section</button><button className="secondary-button" onClick={()=>toggleFavorite(item.id)} aria-label={item.favorite?'Remove from favorites':'Add to favorites'} title={item.favorite?'Remove from favorites':'Add to favorites'}><Star size={15} fill={item.favorite?'currentColor':'none'}/></button><button className="secondary-button" onClick={()=>reorder('item',item.id,-1)} title="Move this item up"><ChevronDown className="move-up" size={15}/></button><button className="secondary-button" onClick={()=>openDialog({mode:'rename',targetId:item.id})} aria-label="Edit note details"><Pencil size={15}/></button><button className="secondary-button danger-action" onClick={()=>openDelete({type:'item',id:item.id})} aria-label="Delete note"><Trash2 size={15}/></button></>}</div>
    <div className="note-editor-shell"><header className="note-editor-heading"><div className="placeholder-icon" aria-hidden="true">{item.icon}</div><span className="note-type-label">{item.type==='section'?'SECTION':'NOTE'}</span><h1>{item.title}</h1>{item.description&&<p className="note-description">{item.description}</p>}{(item.tags?.length??0)>0&&<div className="note-tags">{item.tags?.map(tag=><Link key={tag} to={`/?tag=${encodeURIComponent(tag)}`} className="tag-chip">#{tag}</Link>)}</div>}<div className="placeholder-parent">In {parent?<><Link to={`/note/${parent.id}`}>{parent.title}</Link> · </>:null}<Link to={`/subject/${subject.id}`}>{subject.title}</Link></div></header>
      {headingJumpError&&<p className="link-message" role="status">{headingJumpError}</p>}
      {readerMode?<Suspense fallback={<div className="reader-loading" role="status">Preparing reader…</div>}><ReaderView key={item.id+'-reader'} noteId={item.id} title={item.title} content={readerContent?.noteId===item.id?readerContent.content:item.content} items={data.items}/></Suspense>:<Suspense fallback={<div className="editor-loading" role="status">Preparing editor…</div>}><RichNoteEditor key={item.id} noteId={item.id} content={item.content} subjects={data.subjects} items={data.items} focusOnMount={Boolean((location.state as {focusEditor?:boolean}|null)?.focusEditor)} save={saveDocument} onFlushReady={registerEditorFlush}/></Suspense>}
  {children.some(child=>child.type==='section')&&<div className="nested-list"><h2>Sections in this note</h2>{children.filter(child=>child.type==='section').map(child=><button type="button" key={child.id} className="nested-link" onClick={()=>navigate(`/note/${item.id}`,{state:{jumpToSectionId:child.id}})}><span>📌</span>{child.title}<ArrowRight size={15}/></button>)}</div>}
  {children.some(child=>child.type==='note')&&<div className="nested-list"><h2>Nested notes</h2>{children.filter(child=>child.type==='note').map(child=><Link to={`/note/${child.id}`} key={child.id} className="nested-link"><span>{child.icon}</span>{child.title}<ArrowRight size={15}/></Link>)}</div>}
    </div>{exportOpen&&<ExportDialog subject={subject} items={data.items} current={item} flushCurrent={()=>editorFlush.current.noteId===item.id?editorFlush.current.flush():item.content} onClose={()=>setExportOpen(false)}/>}</main>
}

function ExportDialog({subject,items,current,flushCurrent,onClose}:{subject:ExportSubject;items:ExportItem[];current?:ExportItem;flushCurrent?:()=>JSONContent;onClose:()=>void}) {
  const [scope,setScope]=useState<'note'|'subject'|'tree'>(current?'note':'subject')
  const [format,setFormat]=useState<'md'|'html'|'txt'|'pdf'|'json'>('md')
  const [error,setError]=useState('')
  useEffect(()=>{const key=(event:KeyboardEvent)=>{if(event.key==='Escape')onClose()};window.addEventListener('keydown',key);return()=>window.removeEventListener('keydown',key)},[onClose])
  const tree=scope==='tree', ext=tree?(format==='html'||format==='pdf'?'md':format):format
  const run=()=>{try{
    const latest=flushCurrent?.()
    const exportItems=current&&latest?items.map(i=>i.id===current.id?{...i,content:latest}:i):items
    const workspace=buildExport(subject,exportItems,scope==='note'?(current??null):null)
    const outputFormat=tree&&format==='html'?'md':tree&&format==='pdf'?'md':format==='pdf'?'html':format
    const content=renderExport(workspace,outputFormat as 'md'|'html'|'txt'|'json',tree)
    const filename=safeFilename(tree?subject.title+'-tree':scope==='subject'?subject.title:current?.title??subject.title,ext)
    if(format==='pdf'){
      const win=window.open('','_blank')
      if(!win)throw new Error('Allow pop-ups to open the print-ready PDF document.')
      win.document.open();win.document.write(content);win.document.close();win.focus();window.setTimeout(()=>win.print(),350)
    }else downloadText(filename,content,format==='json'?'application/json;charset=utf-8':format==='html'?'text/html;charset=utf-8':format==='md'?'text/markdown;charset=utf-8':'text/plain;charset=utf-8')
    onClose()
  }catch(e){setError(e instanceof Error?e.message:'Unable to export this note. Please try again.')}}
  return <div className="dialog-backdrop export-backdrop" onMouseDown={e=>{if(e.target===e.currentTarget)onClose()}}><section className="hierarchy-dialog export-dialog" role="dialog" aria-modal="true" aria-labelledby="export-title"><div className="dialog-head"><h2 id="export-title">Export</h2><button type="button" onClick={onClose} aria-label="Close export dialog"><X size={18}/></button></div><label className="dialog-label">Scope<select value={scope} onChange={e=>{setScope(e.target.value as typeof scope);if(e.target.value==='tree'&&(format==='html'||format==='pdf'))setFormat('md')}}>{current&&<option value="note">Current note — {current.title}</option>}<option value="subject">Complete subject — {subject.title}</option><option value="tree">Tree only</option></select></label><label className="dialog-label">Format<select value={format} onChange={e=>setFormat(e.target.value as typeof format)}><option value="md">Markdown (.md)</option>{!tree&&<option value="html">HTML (.html)</option>}<option value="txt">Plain text (.txt)</option>{!tree&&<option value="pdf">PDF — print or save as PDF</option>}<option value="json">Structured JSON (.json)</option></select></label>{format==='pdf'&&<p className="export-help">A print-ready document opens in a new tab. Choose “Save as PDF” in the print dialog.</p>}{error&&<p className="dialog-error" role="alert">{error}</p>}<div className="dialog-actions"><button type="button" className="secondary-button" onClick={onClose}>Cancel</button><button type="button" className="primary-button" onClick={run}><Download size={15}/>Export {format==='pdf'?'PDF':'.'+ext}</button></div></section></div>
}
function EditDialog({draft}:{draft:Draft}) {
  const {data,createSubject,createItem,rename,closeDialog}=useHierarchy();const current=draft.targetId?data.subjects.find(s=>s.id===draft.targetId)??data.items.find(i=>i.id===draft.targetId):undefined
  const [title,setTitle]=useState(current?.title??'');const [icon,setIcon]=useState(current?.icon??(draft.itemType==='section'?'📁':'📝'));const [description,setDescription]=useState(current?.description??'');const [tagsText,setTagsText]=useState((current?.tags??[]).join(', '));const [favorite,setFavorite]=useState(Boolean(current?.favorite));const [subjectId,setSubjectId]=useState(draft.subjectId??'');const [error,setError]=useState('')
  const metadata={description:description.trim(),tags:[...new Set(tagsText.split(/[\s,]+/).map(tag=>tag.replace(/^#/, '').trim().toLocaleLowerCase()).filter(Boolean))],favorite}
  const submit=(e:FormEvent)=>{e.preventDefault();setError('');if(draft.mode==='create-subject'){if(!createSubject(title,icon,metadata))setError('Check the name and try again.');return}if(draft.mode==='rename'){if(title.trim())rename(draft.targetId!,title,icon,metadata);else setError('Enter a name.');return}const destination=draft.parentId?data.items.find(i=>i.id===draft.parentId)?.subjectId:subjectId||draft.subjectId;if(!destination){setError('Choose a subject.');return}if(!createItem({type:draft.itemType??'note',subjectId:destination,parentId:draft.parentId??null,title,icon,...metadata}))setError('Check the name and try again.')}
  const heading=draft.mode==='create-subject'?'Create subject':draft.mode==='rename'?'Edit details':draft.itemType==='section'?'Create section':'Create note'
  const knownTags=[...new Set([...data.subjects.flatMap(s=>s.tags??[]),...data.items.flatMap(i=>i.tags??[])])]
  return <div className="dialog-backdrop" role="presentation" onKeyDown={e=>{if(e.key==='Escape')closeDialog()}} onMouseDown={e=>{if(e.target===e.currentTarget)closeDialog()}}><form className="hierarchy-dialog metadata-dialog" role="dialog" aria-modal="true" aria-labelledby="dialog-title" onSubmit={submit}><div className="dialog-head"><h2 id="dialog-title">{heading}</h2><button type="button" onClick={closeDialog} aria-label="Close dialog"><X size={18}/></button></div><label className="dialog-label">Name<input autoFocus required value={title} onChange={e=>setTitle(e.target.value)} placeholder={draft.mode==='create-subject'?'e.g. Programming':draft.itemType==='section'?'e.g. Algorithms':'e.g. Python Basics'} maxLength={80}/></label>{draft.mode==='create-item'&&!draft.parentId&&!draft.subjectId&&<label className="dialog-label">Subject<select value={subjectId} onChange={e=>setSubjectId(e.target.value)}><option value="">Choose a subject</option>{data.subjects.map(s=><option key={s.id} value={s.id}>{s.icon} {s.title}</option>)}</select></label>}<label className="dialog-label">Description <span className="field-optional">Optional</span><textarea rows={2} value={description} onChange={e=>setDescription(e.target.value)} placeholder="A short description" maxLength={240}/></label><label className="dialog-label">Tags <span className="field-optional">Optional · separate with spaces or commas</span><input list="notehub-known-tags" value={tagsText} onChange={e=>setTagsText(e.target.value)} placeholder="#web, #frontend"/><datalist id="notehub-known-tags">{knownTags.map(tag=><option key={tag} value={tag}/>)}</datalist></label><fieldset className="icon-picker"><legend>Icon</legend><div>{iconChoices.map(choice=><button type="button" key={choice} className={icon===choice?'icon-choice active':'icon-choice'} aria-label={`Choose ${choice}`} aria-pressed={icon===choice} onClick={()=>setIcon(choice)}>{choice}</button>)}</div></fieldset><label className="metadata-favorite"><input type="checkbox" checked={favorite} onChange={e=>setFavorite(e.target.checked)}/><Star size={16} fill={favorite?'currentColor':'none'}/>Add to Favorites</label>{error&&<p className="dialog-error" role="alert">{error}</p>}<div className="dialog-actions"><button type="button" className="secondary-button" onClick={closeDialog}>Cancel</button><button className="primary-button" type="submit">{draft.mode==='rename'?'Save details':'Create'}</button></div></form></div>
}
function DeleteDialog({target}:{target:{type:'subject'|'item';id:string}}) {const {data,remove,closeDelete}=useHierarchy();const subject=data.subjects.find(s=>s.id===target.id);const item=data.items.find(i=>i.id===target.id);const name=subject?.title??item?.title??'item';const count=subject?1+data.items.filter(i=>i.subjectId===subject.id).length:item?1+countDesc(data.items,item.id):0;return <div className="dialog-backdrop" onKeyDown={e=>{if(e.key==='Escape')closeDelete()}}><section className="hierarchy-dialog" role="alertdialog" aria-modal="true" aria-labelledby="delete-title" aria-describedby="delete-description"><div className="dialog-head"><h2 id="delete-title">Delete “{name}”?</h2><button onClick={closeDelete} aria-label="Close dialog"><X size={18}/></button></div><p id="delete-description" className="delete-description">This will permanently remove {count>1?`this item and its ${count-1} nested ${count-1===1?'item':'items'}`:'this item'} from your workspace. This cannot be undone.</p><div className="dialog-actions"><button className="secondary-button" onClick={closeDelete}>Cancel</button><button className="delete-button" onClick={()=>remove(target.id)}><Trash2 size={15}/>Delete</button></div></section></div>}
function countDesc(items:HierarchyItem[],id:string):number{return items.filter(i=>i.parentId===id).reduce((sum,i)=>sum+1+countDesc(items,i.id),0)}

