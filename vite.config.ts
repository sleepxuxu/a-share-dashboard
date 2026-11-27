import { defineConfig, loadEnv } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import { createApiHandler } from './server/api.mjs'
import { createFileCandidateStore } from './server/auction-candidates-file.mjs'
export default defineConfig(({ mode }) => {
  const allowedHosts = ['s66fbec3.natappfree.cc']
  const handler = createApiHandler({
    ...loadEnv(mode, process.cwd(), ''),
    ...process.env,
  }, { candidateStore: createFileCandidateStore() })
  const middleware = (server: {
    middlewares: {
      use: (
        fn: (
          req: import('node:http').IncomingMessage,
          res: import('node:http').ServerResponse,
          next: () => void,
        ) => void,
      ) => void
    }
  }) => {
    server.middlewares.use((req, res, next) => {
      void handler(req, res).then((handled) => {
        if (!handled) next()
      })
    })
  }
  return {
    plugins: [
      react(),
      tailwindcss(),
      {
        name: 'gujian-api',
        configureServer: middleware,
        configurePreviewServer: middleware,
      },
    ],
    server: { host: '127.0.0.1', allowedHosts },
    preview: { allowedHosts },
  }
})
