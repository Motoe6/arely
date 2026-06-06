import type { IncomingMessage, ServerResponse } from "node:http";
import type { Middleware } from "./middleware.js";

type RouteHandler = (
  req: IncomingMessage,
  res: ServerResponse,
  params: Record<string, string>,
) => void;

export class Router {
  private middleware: Middleware[] = [];

  private routes: {
    method: string;
    pattern: RegExp;
    paramNames: string[];
    handler: RouteHandler;
  }[] = [];

  use(mw: Middleware): void {
    this.middleware.push(mw);
  }

  get(path: string, handler: RouteHandler): void {
    this.addRoute("GET", path, handler);
  }

  post(path: string, handler: RouteHandler): void {
    this.addRoute("POST", path, handler);
  }

  put(path: string, handler: RouteHandler): void {
    this.addRoute("PUT", path, handler);
  }

  delete(path: string, handler: RouteHandler): void {
    this.addRoute("DELETE", path, handler);
  }

  private addRoute(method: string, path: string, handler: RouteHandler): void {
    const paramNames: string[] = [];
    const patternStr = path.replace(/:([a-zA-Z_]+)/g, (_: string, name: string) => {
      paramNames.push(name);
      return "([^/]+)";
    });
    const pattern = new RegExp(`^${patternStr}$`);
    this.routes.push({ method, pattern, paramNames, handler });
  }

  dispatch(req: IncomingMessage, res: ServerResponse): void {
    let idx = 0;

    const next = (): void => {
      const mw = this.middleware[idx++];
      if (mw) { // eslint-disable-line @typescript-eslint/no-unnecessary-condition
        try {
          mw(req, res, next);
        } catch (err) {
          this.sendError(res, 500, String(err));
        }
      } else {
        this.matchRoute(req, res);
      }
    };

    try {
      next();
    } catch (err) {
      this.sendError(res, 500, String(err));
    }
  }

  private matchRoute(req: IncomingMessage, res: ServerResponse): void {
    const url = new URL(req.url ?? "/", `http://${req.headers.host ?? "localhost"}`);
    const method = req.method ?? "GET";
    const pathname = url.pathname;

    for (const route of this.routes) {
      if (route.method !== method) continue;
      const match = pathname.match(route.pattern);
      if (!match) continue;

      const params: Record<string, string> = {};
      route.paramNames.forEach((name, i) => {
        params[name] = match[i + 1];
      });

      try {
        route.handler(req, res, params);
      } catch (err) {
        this.sendError(res, 500, String(err));
      }
      return;
    }

    this.sendError(res, 404, "Not found");
  }

  private sendError(res: ServerResponse, status: number, message: string): void {
    res.writeHead(status, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ error: message }));
  }
}
