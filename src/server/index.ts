import Fastify, { FastifyInstance, RouteOptions } from "fastify";
import fastifyCors from "@fastify/cors";
import fastifyHelmet from "@fastify/helmet";
import { getFileExports } from "../utils/get-file-exports";
import { getSupabaseInternalClient } from "../utils/get-supabase-client";
import fastifyFormbody from "@fastify/formbody";

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
        await this.periodicallySendNotifications();
    }

    // [Stop]
    async stop() {
        await this.server.close();
    }

    // [Register Routes]
    async registerRoutes() {
        const routes = await getFileExports<RouteOptions>("/routes");
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

    async periodicallySendNotifications() {
        // 1. Prayer Times
        setInterval(async () => {
            const { data, error } = await getSupabaseInternalClient()
                .from('ws_notifications_ios')
                .select('*');

            if (error) {
                this.error(`Error getting notifications`, true);
                return;
            }

            for (const notification of data) {
                // Ensure user has not disabled prayer times
                if (notification.prayer_times_notifications) {
                    const { enabled } = notification.prayer_times_notifications as { enabled: boolean };
                    if (enabled !== false) {
                        // Attempt to send notifications if applicable
                        const response = await fetch(`http://localhost:${this.port}/send-notification?platform=ios&type=prayer_times`, {
                            method: 'POST',
                            body: JSON.stringify({
                                device_token: notification.device_token,
                            }),
                            headers: {
                                'Content-Type': 'application/json',
                            }
                        });

                        if (!response.ok) {
                            console.log(await response.json());
                            this.error(`Error sending prayer times notification`, true);
                        }
                    }
                }
            }
        },
            1000 * 60 * 1.5 // 1.5 minutes 
        );

        // 2. Daily Verse
        setInterval(async () => {
            const { data, error } = await getSupabaseInternalClient()
                .from('ws_notifications_ios')
                .select('*');

            if (error) {
                this.error(`Error getting notifications`, true);
                return;
            }

            for (const notification of data) {
                // Ensure daily verses are enabled
                if (notification.daily_verse_notifications) {
                    // Attempt to send notifications if applicable
                    const response = await fetch(`http://localhost:${this.port}/send-notification?platform=ios&type=daily_verse`, {
                        method: 'POST',
                        body: JSON.stringify({
                            device_token: notification.device_token,
                        }),
                        headers: {
                            'Content-Type': 'application/json',
                        },
                    });

                    if (!response.ok) {
                        console.log(await response.json());
                        this.error(`Error sending daily verse notification`, true);
                    }
                }
            }
        }, 1000 * 60 * 60 * 2 // 2 hours
        );

        // 3. Daily Chapter
        setInterval(async () => {
            const { data, error } = await getSupabaseInternalClient()
                .from('ws_notifications_ios')
                .select('*');

            if (error) {
                this.error(`Error getting notifications`, true);
                return;
            }

            for (const notification of data) {
                // Ensure daily chapters are enabled
                if (notification.daily_chapter_notifications) {
                    // Attempt to send notifications if applicable
                    const response = await fetch(`http://localhost:${this.port}/send-notification?platform=ios&type=daily_chapter`, {
                        method: 'POST',
                        body: JSON.stringify({
                            device_token: notification.device_token,
                        }),
                        headers: {
                            'Content-Type': 'application/json',
                        }
                    });

                    if (!response.ok) {
                        console.log(await response.json());
                        this.error(`Error sending daily chapter notification`, true);
                    }
                }
            }
        }, 1000 * 60 * 60 * 3 // 3 hours
        );
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
