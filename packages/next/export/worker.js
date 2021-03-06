import mkdirpModule from 'mkdirp'
import { promisify } from 'util'
import { extname, join, dirname, sep } from 'path'
import { renderToHTML } from 'next-server/dist/server/render'
import { writeFile } from 'fs'
import Sema from 'async-sema'
import { loadComponents } from 'next-server/dist/server/load-components'

import loadConfig from 'next-server/next-config' // Testing export bug fix

const envConfig = require('next-server/config')
const mkdirp = promisify(mkdirpModule)

global.__NEXT_DATA__ = {
  nextExport: true
}

process.on(
  'message',
  async ({
    distDir,
    buildId,
    exportPaths,
    exportPathMap,
    outDir,
    renderOpts,
    serverRuntimeConfig,
    concurrency
  }) => {
    const sema = new Sema(concurrency, { capacity: exportPaths.length })
    try {
      const work = async path => {
        await sema.acquire()
        const { page, query = {} } = exportPathMap[path]
        const req = { url: path }
        const res = {}
        envConfig.setConfig({
          serverRuntimeConfig,
          publicRuntimeConfig: renderOpts.runtimeConfig
        })

        // Testing export bug fix
        const PHASE_EXPORT = 'phase_export'
        // const nextConfig = loadConfig(PHASE_EXPORT, dir)
        // const nextConfig = loadConfig(PHASE_EXPORT)
        loadConfig(PHASE_EXPORT)

        let htmlFilename = `${path}${sep}index.html`
        const pageExt = extname(page)
        const pathExt = extname(path)
        // Make sure page isn't a folder with a dot in the name e.g. `v1.2`
        if (pageExt !== pathExt && pathExt !== '') {
          // If the path has an extension, use that as the filename instead
          htmlFilename = path
        } else if (path === '/') {
          // If the path is the root, just use index.html
          htmlFilename = 'index.html'
        }
        const baseDir = join(outDir, dirname(htmlFilename))
        const htmlFilepath = join(outDir, htmlFilename)

        await mkdirp(baseDir)
        const components = await loadComponents(distDir, buildId, page)
        const html = await renderToHTML(req, res, page, query, { ...components, ...renderOpts })
        await new Promise((resolve, reject) =>
          writeFile(
            htmlFilepath,
            html,
            'utf8',
            err => (err ? reject(err) : resolve())
          )
        )
        process.send({ type: 'progress' })
        sema.release()
      }
      await Promise.all(exportPaths.map(work))
      process.send({ type: 'done' })
    } catch (err) {
      console.error(err)
      process.send({ type: 'error', payload: err })
    }
  }
)
