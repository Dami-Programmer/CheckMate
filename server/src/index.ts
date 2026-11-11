// Runs the server on your computer (npm run dev). Vercel uses api/index.js instead.
import { app } from "./app.js";

await app.listen({ port: Number(process.env.PORT ?? 3000) });
