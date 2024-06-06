import fs, { Stats } from 'fs';
import readline from 'node:readline';
import http from 'node:http';
import invariant from 'tiny-invariant';
import { v4 as uuidv4 } from 'uuid';
import next from 'next';
import { parse } from 'node:url';
import path from 'node:path';

import debounce from 'debounce';
import express from 'express';
import cors from 'cors';
import compression from 'compression';
import opener from 'opener';
import { Server as SocketIOServer } from 'socket.io';
import promptfoo, {
  EvaluateTestSuiteWithEvaluateOptions,
  Job,
  Prompt,
  PromptWithMetadata,
  TestCase,
  TestSuite,
} from '../index';

import logger from '../logger';
import { getDirectory } from '../esm';
import {
  getPrompts,
  getPromptsForTestCasesHash,
  listPreviousResults,
  readResult,
  getTestCases,
  updateResult,
  readLatestResults,
  migrateResultsFromFileSystemToDatabase,
  getStandaloneEvals,
  deleteEval,
} from '../util';
import { synthesizeFromTestSuite } from '../testCases';
import { getDbPath, getDbSignalPath } from '../database';

// Running jobs
const evalJobs = new Map<string, Job>();

// Prompts cache
let allPrompts: PromptWithMetadata[] | null = null;

interface IServerOptions {
  port?: number;
  apiBaseUrl?: string;
  browserBehavior: BrowserBehavior;
  filterDescription?: string;
}

export enum BrowserBehavior {
  ASK = 0,
  OPEN = 1,
  SKIP = 2,
}

const DEFAULT_SERVER_PORT = 15500;

/**
 * We actually run 2 servers as of this writing-- one for the Next application and one
 * for the Express server. In the future it would be ideal if we could
 * just re-use the NextJS API routes
 */
export async function startServer(options: IServerOptions) {
  const port = options.port || Number.parseInt(process.env.PORT || '') || DEFAULT_SERVER_PORT;
  const nextJsRootDir = path.join(getDirectory(), 'web/nextui');
  const app = express();

  app.use(cors());
  app.use(compression());
  app.use(express.json({ limit: '100mb' }));
  app.use(express.urlencoded({ limit: '100mb', extended: true }));

  // see https://github.com/trpc/examples-next-prisma-websockets-starter/blob/main/src/server/prodServer.ts
  const isDev = process.argv[1]?.endsWith('src/main.ts') || false;
  const nextApp = next({ dev: isDev, dir: nextJsRootDir });
  const handle = nextApp.getRequestHandler();
  await nextApp.prepare();

  const httpServer = http.createServer(async (req, res) => {
    if (!req.url) return;
    if (req.url.startsWith('/api')) {
      return await app(req, res);
    } else {
      const parsedUrl = parse(req.url, true);
      return await handle(req, res, parsedUrl);
    }
  });

  const io = new SocketIOServer(httpServer, {
    // @ts-expect-error bad typings from the socket.io library
    cors: {
      origin: '*',
    },
  });

  process.on('SIGINT', () => {
    console.log('SIGINT received, exiting');
    process.exit(0);
  });

  // Keep the next.js upgrade handler from being added to our custom server
  // so sockets stay open even when not HMR.
  const originalOn = httpServer.on.bind(httpServer);
  httpServer.on = function (event, listener) {
    if (event !== 'upgrade') return originalOn(event, listener);
    return httpServer;
  };

  await migrateResultsFromFileSystemToDatabase();

  const watchFilePath = getDbSignalPath();
  const watcher = debounce(async (curr: Stats, prev: Stats) => {
    if (curr.mtime !== prev.mtime) {
      io.emit('update', await readLatestResults(options.filterDescription));
      allPrompts = null;
    }
  }, 250);
  fs.watchFile(watchFilePath, watcher);

  io.on('connection', async (socket) => {
    socket.emit('init', await readLatestResults(options.filterDescription));
  });

  app.get('/api/results', (req, res) => {
    const previousResults = listPreviousResults(undefined /* limit */, options.filterDescription);
    res.json({
      data: previousResults.map((meta) => {
        return {
          id: meta.evalId,
          label: meta.description ? `${meta.description} (${meta.evalId})` : meta.evalId,
        };
      }),
    });
  });

  app.post('/api/eval/job', (req, res) => {
    const { evaluateOptions, ...testSuite } = req.body as EvaluateTestSuiteWithEvaluateOptions;
    const id = uuidv4();
    evalJobs.set(id, { status: 'in-progress', progress: 0, total: 0, result: null });

    promptfoo
      .evaluate(
        Object.assign({}, testSuite, {
          writeLatestResults: true,
          sharing: testSuite.sharing ?? true,
        }),
        Object.assign({}, evaluateOptions, {
          eventSource: 'web',
          progressCallback: (progress: number, total: number) => {
            const job = evalJobs.get(id);
            invariant(job, 'Job not found');
            job.progress = progress;
            job.total = total;
            console.log(`[${id}] ${progress}/${total}`);
          },
        }),
      )
      .then((result) => {
        const job = evalJobs.get(id);
        invariant(job, 'Job not found');
        job.status = 'complete';
        job.result = result;
        console.log(`[${id}] Complete`);
      });

    res.json({ id });
  });

  app.get('/api/eval/job/:id', (req, res) => {
    const id = req.params.id;
    const job = evalJobs.get(id);
    if (!job) {
      res.status(404).json({ error: 'Job not found' });
      return;
    }
    if (job.status === 'complete') {
      res.json({ status: 'complete', result: job.result });
    } else {
      res.json({ status: 'in-progress', progress: job.progress, total: job.total });
    }
  });

  app.patch('/api/eval/:id', (req, res) => {
    const id = req.params.id;
    const { table, config } = req.body;

    if (!id) {
      res.status(400).json({ error: 'Missing id' });
      return;
    }

    try {
      updateResult(id, config, table);
      res.json({ message: 'Eval updated successfully' });
    } catch (error) {
      res.status(500).json({ error: 'Failed to update eval table' });
    }
  });

  app.delete('/api/eval/:id', async (req, res) => {
    const { id } = req.params;
    try {
      await deleteEval(id);
      res.json({ message: 'Eval deleted successfully' });
    } catch (error) {
      res.status(500).json({ error: 'Failed to delete eval' });
    }
  });

  app.get('/api/results/:id', async (req, res) => {
    const { id } = req.params;
    const file = await readResult(id);
    if (!file) {
      res.status(404).send('Result not found');
      return;
    }
    res.json({ data: file.result });
  });

  app.get('/api/prompts', async (req, res) => {
    if (allPrompts == null) {
      allPrompts = await getPrompts();
    }
    res.json({ data: allPrompts });
  });

  app.get('/api/progress', async (req, res) => {
    const results = await getStandaloneEvals();
    res.json({
      data: results,
    });
  });

  app.get('/api/prompts/:sha256hash', async (req, res) => {
    const sha256hash = req.params.sha256hash;
    const prompts = await getPromptsForTestCasesHash(sha256hash);
    res.json({ data: prompts });
  });

  app.get('/api/datasets', async (req, res) => {
    res.json({ data: await getTestCases() });
  });

  app.get('/api/config', (req, res) => {
    res.json({
      apiBaseUrl: options.apiBaseUrl || '',
    });
  });

  app.post('/api/dataset/generate', async (req, res) => {
    const testSuite: TestSuite = {
      prompts: req.body.prompts as Prompt[],
      tests: req.body.tests as TestCase[],
      providers: [],
    };

    const results = await synthesizeFromTestSuite(testSuite, {});
    return {
      results,
    };
  });

  httpServer.listen(port, () => {
    const url = `http://localhost:${port}`;
    logger.info(`API Server running at ${url} and monitoring for new evals.`);

    const openUrl = async () => {
      try {
        logger.info('Press Ctrl+C to stop the server');
        await opener(url);
      } catch (err) {
        logger.error(`Failed to open browser: ${String(err)}`);
      }
    };

    if (options.browserBehavior === BrowserBehavior.OPEN) {
      openUrl();
    } else if (options.browserBehavior === BrowserBehavior.ASK) {
      const rl = readline.createInterface({
        input: process.stdin,
        output: process.stdout,
      });
      rl.question('Open URL in browser? (y/N): ', async (answer) => {
        if (answer.toLowerCase().startsWith('y')) {
          openUrl();
        }
        rl.close();
      });
    }
  });
}
