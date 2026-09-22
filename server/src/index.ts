import express from "express";
import { currentHealth } from "./health";

const DEFAULT_PORT = 9000;

export function createApp(): express.Express {
  const app = express();
  app.use(express.json());

  app.get("/api/status", (_request, response) => {
    response.json(currentHealth());
  });

  return app;
}

function resolvePort(): number {
  const configured = process.env.PORT;
  if (!configured) {
    return DEFAULT_PORT;
  }
  const parsed = Number(configured);
  return Number.isFinite(parsed) ? parsed : DEFAULT_PORT;
}

const isMainModule = process.argv[1]
  ? import.meta.url === new URL(`file://${process.argv[1]}`).href
  : false;

if (isMainModule) {
  const port = resolvePort();
  createApp().listen(port, () => {
    console.log(`Server listening on port ${port}...`);
  });
}
