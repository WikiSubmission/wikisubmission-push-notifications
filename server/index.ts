import Fastify, { FastifyInstance, RouteOptions } from "fastify";
import fastifyCors from "@fastify/cors";
import fastifyHelmet from "@fastify/helmet";
import fastifyRateLimit from "@fastify/rate-limit";
import { getFileExports } from "../utils/get-file-exports";
import fastifyFormbody from "@fastify/formbody";
import { logger } from "../utils/logger";

export class Server {
    static instance = new Server();

    server: FastifyInstance;

    port = parseInt(process.env.PORT || "8080");

    constructor() {
        this.server = Fastify({
            logger: {
                enabled: true,
                transport: {
                    targets: [
                        // [Pino Pretty - Pretty logs]
                        {
                            target: "pino-pretty",
                            options: {
                                translateTime: true,
                                ignorePaths: ["req.headers", "req.body"],
                                colorize: true,
                                singleLine: true,
                                messageFormat:
                                    "{msg}{if req} [{req.id}] {req.method} \"{req.url}\"{end}{if res} [{res.id}] {res.statusCode} ({res.responseTime}ms){end}",
                            },
                            level: "warn",
                        },
                    ],
                },
                serializers: {
                    // [Request Serializer]
                    req(request) {
                        return {
                            url: request.url,
                            method: request.method,
                            id: request.id,
                            ip: request.ip,
                        };
                    },
                    // [Response Serializer]
                    res(reply) {
                        return {
                            statusCode: reply.statusCode,
                            id: reply.request?.id || "--",
                            responseTime: reply.elapsedTime?.toFixed(1) || 0,
                        };
                    },
                },
            }
        });
    }

    // [Start]
    async start() {
        logger.info(`[Server] Starting on port ${this.port}`);
        this.registerPlugins();
        await this.registerRoutes();
        await this.server.listen({ port: this.port, host: "0.0.0.0" });
        logger.info(`[Server] Listening on port ${this.port}`);
    }

    // [Stop]
    async stop() {
        await this.server.close();
    }

    // [Register Routes]
    async registerRoutes() {
        const routes = await getFileExports<RouteOptions>("/server/routes");
        if (routes.length === 0) {
            logger.warn(`[Server] No routes found`);
            return;
        }
        logger.info(`[Server] ${routes.length} route(s): ${routes.map(r => r.url).join(", ")}`);
        for (const route of routes) {
            try {
                this.server.route(route);
            } catch (error) {
                logger.error(`[Server] Failed to register route ${route.url}`, error);
            }
        }
    }

    // [Register Plugins]
    async registerPlugins() {
        // [CORS - Allow all origins]
        this.server.register(fastifyCors, { origin: "*" });

        // [Helmet - Security]
        this.server.register(fastifyHelmet, { global: true });

        // [Body Parser - Parse JSON bodies]
        this.server.register(fastifyFormbody);

        // [Rate Limiting - 60 requests per minute per IP]
        this.server.register(fastifyRateLimit, {
            max: 60,
            timeWindow: '1 minute',
        });
    }

    log(message: any) {
        logger.info(String(message));
    }

    warn(message: any) {
        logger.warn(String(message));
    }

    error(message: any, fatal: boolean = false) {
        logger.error(String(message));
        if (fatal) {
            process.exit(1);
        }
    }
}
