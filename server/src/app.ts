import cors from "@fastify/cors";
import Fastify from "fastify";
import { AnalysisError } from "./analyze.js";
import { requireInvite } from "./auth.js";
import { analyzeWithCache } from "./cache.js";
import { checkDb } from "./db.js";
import { LimitError, releaseScan, reserveScan, scansLeftToday, USER_DAILY_LIMIT } from "./limits.js";
import { MAX_NOTE_LENGTH, ReportError, saveReport, type ReportInput } from "./reports.js";

// All the routes. Started by src/index.ts on your computer, and by api/index.js on Vercel.

// bodyLimit: allow pages up to 2 MB of text.
export const app = Fastify({ logger: true, bodyLimit: 2 * 1024 * 1024 });

// Browsers may only call this server from a Chrome extension, not from websites.
// (Tools like curl send no Origin and are still checked by the invite code.)
await app.register(cors, { origin: /^chrome-extension:\/\// });

app.get("/version", async () => {
  return { version: "0.1.0" };
});

// Quick check that the server and database are up.
app.get("/health", async (_request, reply) => {
  const db = await checkDb();
  return reply.code(db ? 200 : 503).send({ server: "ok", database: db ? "ok" : "unavailable" });
});

// Checks an invite code (used by the welcome screen) and shows today's scans left.
app.get("/me", { preHandler: requireInvite }, async (request) => {
  const user = request.user!;
  return { name: user.name, dailyLimit: USER_DAILY_LIMIT, scansLeftToday: await scansLeftToday(user.id) };
});

interface AnalyzeBody {
  url?: string;
  text: string;
  upload?: boolean; // a file the person uploaded: keep only its fingerprint, never its text
}

app.post<{ Body: AnalyzeBody }>(
  "/analyze",
  {
    preHandler: requireInvite,
    schema: {
      body: {
        type: "object",
        required: ["text"],
        properties: {
          url: { type: "string" },
          text: { type: "string" },
          upload: { type: "boolean" },
        },
      },
    },
  },
  async (request, reply) => {
    try {
      const userId = request.user!.id;
      const upload = request.body.upload === true;
      return await analyzeWithCache(
        request.body.text,
        upload ? undefined : request.body.url,
        { beforeNewScan: () => reserveScan(userId), onNewScanFailed: () => releaseScan(userId) },
        { keepText: !upload }
      );
    } catch (err) {
      if (err instanceof LimitError) {
        return reply.code(err.status).send({ error: err.code, message: err.message });
      }
      if (err instanceof AnalysisError) {
        return reply.code(422).send({ error: err.code, message: err.message });
      }
      throw err; // anything else becomes a 500 and is logged
    }
  }
);

// "This flag is wrong" button in the popup.
app.post<{ Body: ReportInput }>(
  "/report",
  {
    preHandler: requireInvite,
    schema: {
      body: {
        type: "object",
        required: ["analysisId", "flag"],
        properties: {
          analysisId: { type: "integer", minimum: 1 },
          flag: {
            type: "object",
            required: ["type", "quote"],
            properties: {
              type: { type: "integer", minimum: 1, maximum: 12 },
              quote: { type: "string", minLength: 1 },
            },
          },
          note: { type: "string", maxLength: MAX_NOTE_LENGTH },
        },
      },
    },
  },
  async (request, reply) => {
    try {
      const saved = await saveReport(request.user!.id, request.body);
      return reply.code(saved.duplicate ? 200 : 201).send({ ok: true, ...saved });
    } catch (err) {
      if (err instanceof ReportError) {
        return reply.code(err.status).send({ error: err.code, message: err.message });
      }
      throw err;
    }
  }
);
