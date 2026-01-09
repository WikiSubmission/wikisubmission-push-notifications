import Fastify, { FastifyInstance, RouteOptions } from "fastify";
import fastifyCors from "@fastify/cors";
import fastifyHelmet from "@fastify/helmet";
import { getFileExports } from "../utils/get-file-exports";
import fastifyFormbody from "@fastify/formbody";
import { supabaseClient } from "../utils/supabase-client";

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
        this.server.log.info(`=== Starting ===`);
        this.registerPlugins();
        await this.registerRoutes();
        await this.server.listen({ port: this.port, host: "0.0.0.0" });
    }

    // [Stop]
    async stop() {
        await this.server.close();
    }

    // [Register Routes]
    async registerRoutes() {
        const routes = await getFileExports<RouteOptions>("/server/routes");
        if (routes.length === 0) {
            this.server.log.warn(`No routes found`);
            return;
        }
        this.server.log.info(`${routes.length} routes: ${routes.map(r => `${r.url}`).join(", ")}`);
        for (const route of routes) {
            try {
                this.server.route(route);
            } catch (error) {
                this.server.log.error(`Error registering route ${route.url}: ${error}`);
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
    }

    log(message: any) {
        this.server.log.info(message);
    }

    warn(message: any) {
        this.server.log.warn(message);
    }

    error(message: any, fatal: boolean = false) {
        this.server.log.error(message);
        if (fatal) {
            process.exit(1);
        }
    }
}
