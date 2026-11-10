import cors from "@fastify/cors";
import Fastify from "fastify";
import { AnalysisError, analyzeDocument } from "./analyze.js";

// bodyLimit: allow pages up to 2 MB of text.
const app = Fastify({ logger: true, bodyLimit: 2 * 1024 * 1024 });

// Lets the Chrome extension call this server. (Locked down further in Week 3.)
await app.register(cors, { origin: true });

app.get("/version", async () => {
  return { version: "0.1.0" };
});

interface AnalyzeBody {
  url?: string;
  text: string;
}

app.post<{ Body: AnalyzeBody }>(
  "/analyze",
  {
    schema: {
      body: {
        type: "object",
        required: ["text"],
        properties: {
          url: { type: "string" },
          text: { type: "string" },
        },
      },
    },
  },
  async (request, reply) => {
    try {
      return await analyzeDocument(request.body.text);
    } catch (err) {
      if (err instanceof AnalysisError) {
        return reply.code(422).send({ error: err.code, message: err.message });
      }
      throw err; // anything else becomes a 500 and is logged
    }
  }
);

await app.listen({ port: 3000 });
