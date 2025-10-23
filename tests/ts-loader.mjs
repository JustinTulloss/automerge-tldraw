import { readFile } from 'node:fs/promises'
import { createRequire } from 'node:module'
import path from 'node:path'
import { pathToFileURL } from 'node:url'

const require = createRequire(import.meta.url)
const ts = require('typescript')

const extensions = new Set(['.ts', '.tsx'])
const coreJsRewrites = new Map([
  ['core-js/stable/array/at', 'core-js/stable/array/at.js'],
  ['core-js/stable/array/flat', 'core-js/stable/array/flat.js'],
  ['core-js/stable/array/flat-map', 'core-js/stable/array/flat-map.js'],
  ['core-js/stable/string/at', 'core-js/stable/string/at.js'],
  ['core-js/stable/string/replace-all', 'core-js/stable/string/replace-all.js'],
])
const cjsWrappers = new Map([
  [
    'eventemitter3',
    (moduleUrl) =>
      `import mod from "${moduleUrl}"; const EventEmitter = mod?.EventEmitter ?? mod; export { EventEmitter }; export default EventEmitter;`,
  ],
  [
    'lz-string',
    (moduleUrl) =>
      `import mod from "${moduleUrl}"; const base = mod?.default ?? mod; export default base; export const compressToBase64 = base.compressToBase64.bind(base); export const decompressFromBase64 = base.decompressFromBase64.bind(base); export const compressToEncodedURIComponent = base.compressToEncodedURIComponent.bind(base); export const decompressFromEncodedURIComponent = base.decompressFromEncodedURIComponent.bind(base); export const compress = base.compress.bind(base); export const decompress = base.decompress.bind(base);`,
  ],
])

export async function resolve(specifier, context, defaultResolve) {
  const rewrite = coreJsRewrites.get(specifier)
  if (rewrite) {
    const resolved = require.resolve(rewrite)
    return {
      url: pathToFileURL(resolved).href,
      shortCircuit: true,
    }
  }

  const wrap = cjsWrappers.get(specifier)
  if (wrap) {
    const resolved = require.resolve(specifier)
    const moduleUrl = pathToFileURL(resolved).href
    const source = wrap(moduleUrl)
    return {
      url: `data:text/javascript,${encodeURIComponent(source)}`,
      shortCircuit: true,
    }
  }

  if (specifier.startsWith('.') && !path.extname(specifier)) {
    const url = new URL(specifier + '.ts', context.parentURL)
    return {
      url: url.href,
      shortCircuit: true,
    }
  }

  return defaultResolve(specifier, context, defaultResolve)
}

export async function load(url, context, defaultLoad) {
  const ext = path.extname(new URL(url).pathname)

  if (extensions.has(ext)) {
    const source = await readFile(new URL(url), 'utf8')
    const transpiled = ts.transpileModule(source, {
      fileName: new URL(url).pathname,
      compilerOptions: {
        module: ts.ModuleKind.ESNext,
        moduleResolution: ts.ModuleResolutionKind.NodeNext,
        target: ts.ScriptTarget.ES2020,
        jsx: ts.JsxEmit.ReactJSX,
        esModuleInterop: true,
        sourceMap: false,
      },
    })

    return {
      format: 'module',
      source: transpiled.outputText,
      shortCircuit: true,
    }
  }

  return defaultLoad(url, context, defaultLoad)
}
