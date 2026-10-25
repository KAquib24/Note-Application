import type { JSONContent } from '@tiptap/core'
import { safeExternalUrl } from '../editor/safeExternalUrl'

export type ExportItem = { id:string; type:'note'|'section'; subjectId:string; parentId:string|null; title:string; icon:string; order:number; createdAt:number; updatedAt:number; content:JSONContent }
export type ExportSubject = { id:string; title:string; icon:string; createdAt:number; updatedAt:number; order:number }
type Node = {type:string; attrs:Record<string,unknown>; text?:string; marks:Array<{type:string;attrs:Record<string,unknown>}>; children:Node[]}
export type ExportDoc = {id:string;title:string;kind:'note'|'section';icon:string;content:Node[];children:ExportDoc[]}
export type ExportWorkspace = {version:1;exportedAt:string;subject:ExportSubject;root:ExportDoc}
const esc=(s:string)=>s.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;')
const text=(n:Node):string=>n.type==='text'?n.text??'':n.children.map(text).join('')
const slug=(s:string)=>s.toLowerCase().normalize('NFKD').replace(/[\u0300-\u036f]/g,'').replace(/[^a-z0-9]+/g,'-').replace(/^-|-$/g,'')||'section'
function nodes(content:JSONContent):Node[]{const cv=(n:JSONContent):Node=>({type:n.type??'text',attrs:(n.attrs??{}) as Record<string,unknown>,text:n.text,marks:(n.marks??[]).map(m=>({type:m.type,attrs:(m.attrs??{}) as Record<string,unknown>})),children:(n.content??[]).map(cv)});return (content.content??[]).map(cv)}
export function buildExport(subject:ExportSubject,items:ExportItem[],root:ExportItem|null):ExportWorkspace{
 const make=(i:ExportItem):ExportDoc=>({id:i.id,title:i.title,kind:i.type,icon:i.icon,content:nodes(i.content),children:items.filter(x=>x.subjectId===subject.id&&x.parentId===i.id).sort((a,b)=>a.order-b.order).map(make)})
 const roots=items.filter(i=>i.subjectId===subject.id&&i.parentId===(root?.id??null)).sort((a,b)=>a.order-b.order).map(make)
 const doc:ExportDoc=root?{...make(root),children:roots}:{id:subject.id,title:subject.title,kind:'section',icon:subject.icon,content:[],children:roots}
 return {version:1,exportedAt:new Date().toISOString(),subject:{...subject},root:doc}
}
const allDocs=(d:ExportDoc):ExportDoc[]=>[d,...d.children.flatMap(allDocs)]
function docAnchor(doc:ExportDoc,all:ExportDoc[]):string{const base=slug(doc.title);const index=all.slice(0,all.indexOf(doc)+1).filter(x=>slug(x.title)===base).length;return index>1?base+'-'+index:base}
function headingEntries(all:ExportDoc[]):Array<{id:string;title:string;anchor:string}>{const entries:Array<{id:string;title:string;anchor:string}>=[];for(const d of all){const walk=(n:Node)=>{if(n.type==='heading'){const title=text(n),base=slug(title),count=entries.filter(x=>slug(x.title)===base).length+1;entries.push({id:String(n.attrs.blockId??''),title,anchor:count>1?base+'-'+count:base})}n.children.forEach(walk)};d.content.forEach(walk)}return entries}
const inline=(n:Node,fmt:'md'|'html'|'txt',all:ExportDoc[]=[]):string=>{
 if(n.type!=='text')return n.children.map(c=>inline(c,fmt,all)).join('')
 let s=fmt==='html'?esc(n.text??''):n.text??''
 for(const m of n.marks){if(m.type==='bold')s=fmt==='md'?'**'+s+'**':fmt==='html'?'<strong>'+s+'</strong>':s
 else if(m.type==='italic')s=fmt==='md'?'*'+s+'*':fmt==='html'?'<em>'+s+'</em>':s
 else if(m.type==='underline')s=fmt==='html'?'<u>'+s+'</u>':fmt==='md'?'<u>'+s+'</u>':s
 else if(m.type==='strike')s=fmt==='md'?'~~'+s+'~~':fmt==='html'?'<del>'+s+'</del>':s
 else if(m.type==='code')s=fmt==='md'?String.fromCharCode(96)+s+String.fromCharCode(96):fmt==='html'?'<code>'+s+'</code>':s
 else if(m.type==='highlight')s=fmt==='html'?'<mark>'+s+'</mark>':s
 else if(m.type==='important')s=fmt==='md'?'**⭐ Important:** '+s:fmt==='html'?'<mark class="important">⭐ '+s+'</mark>':'[IMPORTANT] '+s
 else if(m.type==='textStyle'&&fmt==='html'){const color=m.attrs.color?'color:'+esc(String(m.attrs.color))+';':'';const bg=m.attrs.backgroundColor?'background-color:'+esc(String(m.attrs.backgroundColor))+';':'';if(color||bg)s='<span style="'+color+bg+'">'+s+'</span>'}
 else if(m.type==='link'){const href=safeExternalUrl(String(m.attrs.href??''));if(m.attrs.linkType==='external'&&href)s=fmt==='md'?'['+s+']('+href+')':fmt==='html'?'<a href="'+esc(href)+'" rel="noopener">'+s+'</a>':s;else{const target=all.find(d=>d.id===m.attrs.targetId||d.id===m.attrs.targetNoteId);if(target){const dest='#'+docAnchor(target,all);s=fmt==='md'?'['+s+']('+dest+')':fmt==='html'?'<a href="'+dest+'">'+s+'</a>':s}else if(m.attrs.linkType==='heading'){const entry=headingEntries(all).find(x=>x.id===String(m.attrs.headingId??''));if(entry){const dest='#'+entry.anchor;s=fmt==='md'?'['+s+']('+dest+')':fmt==='html'?'<a href="'+dest+'">'+s+'</a>':s}}}}
 }
 return s
}
function htmlNode(n:Node,all:ExportDoc[]):string{
 const body=n.children.map(c=>c.type==='text'?inline(c,'html',all):htmlNode(c,all)).join('')
 const style=n.attrs.blockStyle as {color?:string;backgroundColor?:string}|null
 const styleAttr=style?['color','backgroundColor'].map(k=>{const value=style[k as 'color'|'backgroundColor'];return typeof value==='string'&&/^#[0-9a-f]{3,8}$/i.test(value)?(k==='color'?'color:':'background-color:')+value:''}).filter(Boolean).join(';'):''
 const attr=styleAttr?' style="'+styleAttr+'"':''
 const tag=(t:string,b=body,extra='')=>'<'+t+extra+attr+'>'+b+'</'+t+'>'
 if(n.type==='paragraph')return tag('p',body||'<br>')
 if(n.type==='heading'){const l=Math.max(1,Math.min(6,Number(n.attrs.level)||1));const id=headingEntries(all).find(x=>x.id===String(n.attrs.blockId??''))?.anchor??slug(text(n));return '<h'+l+' id="'+id+'"'+attr+'>'+body+'</h'+l+'>'}
 if(n.type==='bulletList'||n.type==='orderedList')return tag(n.type==='bulletList'?'ul':'ol',body)
 if(n.type==='listItem')return tag('li',body)
 if(n.type==='blockquote')return tag('blockquote',body)
 if(n.type==='codeBlock')return '<pre'+attr+'><code'+(n.attrs.language?' class="language-'+esc(String(n.attrs.language))+'"':'')+'>'+esc(text(n))+'</code></pre>'
 if(n.type==='horizontalRule')return '<hr>'
 if(n.type==='table')return tag('table',body)
 if(n.type==='tableRow')return tag('tr',body)
 if(n.type==='tableHeader'||n.type==='tableCell'){const t=n.type==='tableHeader'?'th':'td';return '<'+t+(n.attrs.colspan?' colspan="'+Number(n.attrs.colspan)+'"':'')+(n.attrs.rowspan?' rowspan="'+Number(n.attrs.rowspan)+'"':'')+'>'+body+'</'+t+'>'}
 return body
}
function mdNode(n:Node,all:ExportDoc[]):string{
 const body=n.children.map(c=>c.type==='text'?inline(c,'md',all):mdNode(c,all)).join('')
 if(n.type==='paragraph'){const parts=n.children.map(c=>{if(c.type==='text'&&c.marks.some(m=>m.type==='important')){const copy={...c,marks:c.marks.filter(m=>m.type!=='important')};return '> ⭐ **Important**\n>\n> '+inline(copy,'md',all)}return c.type==='text'?inline(c,'md',all):mdNode(c,all)});return parts.join('\n\n')}
 if(n.type==='listItem')return body
 if(n.type==='heading'){const id=headingEntries(all).find(x=>x.id===String(n.attrs.blockId??''))?.anchor??slug(text(n));return '<a id="'+id+'"></a>\n'+'#'.repeat(Math.max(1,Math.min(6,Number(n.attrs.level)||1)))+' '+text(n)}
 if(n.type==='bulletList'||n.type==='orderedList')return n.children.map((c,i)=>(n.type==='bulletList'?'-':(i+1)+'.')+' '+mdNode(c,all).replace(/\n/g,'\n  ')).join('\n')
 if(n.type==='blockquote')return body.split('\n').map(x=>'> '+x).join('\n')
 if(n.type==='codeBlock')return '~~~'+String(n.attrs.language??'')+'\n'+text(n)+'\n~~~'
 if(n.type==='horizontalRule')return '---'
 if(n.type==='table')return n.children.map((row,i)=>mdNode(row,all)+(i===0?'\n| '+row.children.map(()=> '---').join(' | ')+' |':'')).join('\n')
 if(n.type==='tableRow')return '| '+n.children.map(c=>mdNode(c,all)).join(' | ')+' |'
 if(n.type==='tableCell'||n.type==='tableHeader')return body
 return body
}
function txtNode(n:Node):string{
 const body=n.children.map(c=>c.type==='text'?inline(c,'txt'):txtNode(c)).join('')
 if(n.type==='heading')return text(n)+'\n'+'─'.repeat(Math.min(60,Math.max(3,text(n).length)))
 if(n.type==='bulletList'||n.type==='orderedList')return n.children.map((c,i)=>(n.type==='bulletList'?'•':(i+1)+'.')+' '+txtNode(c)).join('\n')
 if(n.type==='codeBlock')return text(n).split('\n').map(s=>'  '+s).join('\n')
 if(n.type==='horizontalRule')return '----------------------------------------'
 if(n.type==='table'||n.type==='tableRow')return n.children.map(txtNode).join(n.type==='tableRow'?' | ':'\n')
 return body
}
const headings=(n:Node):string[]=>n.type==='heading'?[text(n)]:n.children.flatMap(headings)
export function treeMarkdown(d:ExportDoc):string{const out=['# '+d.title];const walk=(x:ExportDoc,depth:number)=>{out.push('  '.repeat(depth)+'- '+x.title);x.content.flatMap(headings).forEach(h=>out.push('  '.repeat(depth+1)+'- '+h));x.children.forEach(c=>walk(c,depth+1))};d.content.flatMap(headings).forEach(h=>out.push('- '+h));d.children.forEach(x=>walk(x,0));return out.join('\n')}
export function treeText(d:ExportDoc):string{const out=[d.title];type T={title:string;children:T[];content?:Node[]};const walk=(x:T,prefix:string,last:boolean)=>{out.push(prefix+(last?'└── ':'├── ')+x.title);const p=prefix+(last?'    ':'│   ');const hs=x.content?.flatMap(headings)??[];const kids:T[]=[...hs.map(title=>({title,children:[]})),...x.children];kids.forEach((c,i)=>walk(c,p,i===kids.length-1))};const rootKids:T[]=[...d.content.flatMap(headings).map(title=>({title,children:[]})),...d.children];rootKids.forEach((x,i)=>walk(x,'',i===rootKids.length-1));return out.join('\n')}
function treeJSON(d:ExportDoc):unknown{return {title:d.title,kind:d.kind,headings:d.content.flatMap(headings),children:d.children.map(treeJSON)}}
export function renderExport(w:ExportWorkspace,fmt:'md'|'html'|'txt'|'json',tree=false):string{
 if(fmt==='json')return JSON.stringify(tree?{version:1,exportedAt:w.exportedAt,subject:w.subject,tree:treeJSON(w.root)}:w,null,2)
 if(tree)return fmt==='md'?treeMarkdown(w.root):treeText(w.root)
 const all=allDocs(w.root)
 const sections=(d:ExportDoc,level:number):string=>{const title=fmt==='md'?'<a id="'+docAnchor(d,all)+'"></a>\n'+'#'.repeat(Math.min(6,level))+' '+d.title:fmt==='html'?'<section id="'+docAnchor(d,all)+'"><h'+Math.min(6,level)+'>'+esc(d.title)+'</h'+Math.min(6,level)+'>':'='.repeat(Math.min(50,d.title.length))+' '+d.title;const content=d.content.map(n=>fmt==='md'?mdNode(n,all):fmt==='html'?htmlNode(n,all):txtNode(n)).filter(Boolean).join(fmt==='html'?'\n':'\n\n');const kids=d.children.map(c=>sections(c,level+1)).join('\n\n');return fmt==='html'?title+content+kids+'</section>':[title,content,kids].filter(Boolean).join('\n\n')}
 const rootTitle=fmt==='md'?'<a id="'+docAnchor(w.root,all)+'"></a>\n# '+w.root.title:fmt==='html'?'<h1 id="'+docAnchor(w.root,all)+'">'+esc(w.root.title)+'</h1>':w.root.title
 const body=[rootTitle,...w.root.content.map(n=>fmt==='md'?mdNode(n,all):fmt==='html'?htmlNode(n,all):txtNode(n)),...w.root.children.map(c=>sections(c,2))].filter(Boolean).join(fmt==='html'?'\n':'\n\n')
 if(fmt!=='html')return body
 return '<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>'+esc(w.root.title)+'</title><style>body{max-width:860px;margin:48px auto;padding:0 24px;color:#182230;font:16px/1.7 system-ui,sans-serif}h1,h2,h3{line-height:1.25;margin-top:1.8em;break-after:avoid}pre{overflow:auto;padding:16px;background:#f1f5f9;border:1px solid #dbe3ec;border-radius:8px;font:14px/1.55 ui-monospace,monospace}table{width:100%;border-collapse:collapse;margin:1em 0}td,th{border:1px solid #cbd5e1;padding:8px;text-align:left}blockquote,.important{display:block;padding:10px 14px;border-left:4px solid #2878e8;background:#eff6ff}hr{border:0;border-top:1px solid #cbd5e1;margin:2em 0}@media(max-width:600px){body{margin:24px auto;padding:0 16px}}@media print{body{max-width:none;margin:0}pre,table{break-inside:avoid}h1,h2,h3{break-after:avoid}}</style></head><body>'+body+'</body></html>'
}
export function safeFilename(name:string,ext:string):string{return (name.normalize('NFKD').replace(/[\\/:*?"<>|]/g,'-').replace(/[. ]+$/g,'').trim().replace(/\s+/g,'-')||'notes')+'.'+ext}
export function downloadText(name:string,content:string,mime:string):void{const url=URL.createObjectURL(new Blob([content],{type:mime}));const a=document.createElement('a');a.href=url;a.download=name;a.style.display='none';document.body.appendChild(a);a.click();a.remove();setTimeout(()=>URL.revokeObjectURL(url),1000)}
