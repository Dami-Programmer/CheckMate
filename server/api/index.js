// Vercel entry point: every request is handed to the Fastify app.
// The app is compiled from src/ into dist/ by "npm run build" first.
import { app } from "../dist/src/app.js";

export default async function handler(req, res) {
  await app.ready();
  app.server.emit("request", req, res);
}
