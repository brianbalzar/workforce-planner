import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';

const repository = process.env.GITHUB_REPOSITORY?.split('/')[1];
const localDataFile = resolve(
  process.env.WFP_DATA_FILE ??
    '../workforce-planner-data/forecast-pipeline/output/workforce-planner.json',
);

const localPlannerData = {
  name: 'local-workforce-planner-data',
  configureServer(server: {
    middlewares: {
      use: (
        handler: (
          request: { url?: string },
          response: {
            statusCode: number;
            setHeader: (name: string, value: string) => void;
            end: (body?: string | Buffer) => void;
          },
          next: () => void,
        ) => void,
      ) => void;
    };
  }) {
    server.middlewares.use(async (request, response, next) => {
      if (request.url?.split('?')[0] !== '/data/workforce-planner.json') {
        next();
        return;
      }
      try {
        const body = await readFile(localDataFile);
        response.statusCode = 200;
        response.setHeader('Content-Type', 'application/json; charset=utf-8');
        response.setHeader('Cache-Control', 'no-cache');
        response.end(body);
      } catch {
        response.statusCode = 404;
        response.setHeader('Content-Type', 'text/plain; charset=utf-8');
        response.end(`Local planner data was not found at ${localDataFile}`);
      }
    });
  },
};

export default defineConfig({
  base: process.env.GITHUB_ACTIONS && repository ? `/${repository}/` : '/',
  plugins: [react(), localPlannerData],
});
