import hljs from 'highlight.js/lib/core'
import python from 'highlight.js/lib/languages/python'
import javascript from 'highlight.js/lib/languages/javascript'
import typescript from 'highlight.js/lib/languages/typescript'
import java from 'highlight.js/lib/languages/java'
import c from 'highlight.js/lib/languages/c'
import cpp from 'highlight.js/lib/languages/cpp'
import xml from 'highlight.js/lib/languages/xml'
import css from 'highlight.js/lib/languages/css'
import sql from 'highlight.js/lib/languages/sql'
import bash from 'highlight.js/lib/languages/bash'
import json from 'highlight.js/lib/languages/json'
import yaml from 'highlight.js/lib/languages/yaml'
import markdown from 'highlight.js/lib/languages/markdown'

const grammars: Record<string, typeof python> = {
  python, javascript, typescript, jsx: javascript, java, c, cpp,
  html: xml, xml, css, sql, bash, shell: bash, json, yaml, markdown,
}
Object.entries(grammars).forEach(([name, grammar]) => {
  if (!hljs.getLanguage(name)) hljs.registerLanguage(name, grammar)
})

export function highlightCode(source: string, language: string) {
  const normalized = language.toLowerCase()
  if (normalized === 'plaintext' || normalized === 'text' || !hljs.getLanguage(normalized)) return null
  try { return hljs.highlight(source, { language: normalized, ignoreIllegals: true }).value } catch { return null }
}
