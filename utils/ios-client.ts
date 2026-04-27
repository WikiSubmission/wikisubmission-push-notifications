import { NotificationPayload } from "../notifications/notification-types";
import { getEnv } from "./get-env";
import { supabaseInternalClient } from "./supabase-client";
import { logger } from "./logger";
import http2 from "http2";
import jwt from "jsonwebtoken";
import z from "zod";

export class IOSClient {

    private static clients: Partial<Record<'production' | 'sandbox', http2.ClientHttp2Session>> = {};
    private static cachedToken = '';
    private static tokenCreatedAt = 0;

    private primaryEnv: 'production' | 'sandbox' = getEnv('APNS_ENV') === 'production' ? 'production' : 'sandbox';

    async send(input: z.infer<typeof NotificationPayload>) {

        const { data, error } = await supabaseInternalClient()
            .from('ws_push_notifications_users')
            .select("*")
            .eq('device_token', input.deviceToken)
            .single();

        if (error) {
            logger.error(`[IOSClient] Error fetching user for ${input.deviceToken.slice(0, 8)}...`, error);
            return;
        }

        const env: 'production' | 'sandbox' = data.is_sandbox ? 'sandbox' : 'production';

        // Try primary environment first
        try {
            await this.sendToEnvironment(input, env);
            return;
        } catch (error: any) {
            logger.warn(`[IOSClient] Send failed via ${env} for ${input.deviceToken.slice(0, 8)}...`, error.message);

            // Try alternate environment
            const alternateEnv: 'production' | 'sandbox' = env === 'production' ? 'sandbox' : 'production';
            logger.info(`[IOSClient] Retrying ${input.deviceToken.slice(0, 8)}... via ${alternateEnv}`);

            try {
                await this.sendToEnvironment(input, alternateEnv);

                if (alternateEnv === "sandbox") {
                    await supabaseInternalClient()
                        .from('ws_push_notifications_users')
                        .update({ is_sandbox: true })
                        .eq('device_token', input.deviceToken);
                }

                return;
            } catch (alternateError: any) {
                logger.error(`[IOSClient] APNS failed in both environments for ${input.deviceToken.slice(0, 8)}...`, alternateError.message);

                // Check if the error is due to an invalid device token
                const shouldDeleteToken = this.shouldDeleteDeviceToken(error.message) ||
                    this.shouldDeleteDeviceToken(alternateError.message);

                if (shouldDeleteToken) {
                    logger.warn(`[IOSClient] Invalid device token ${input.deviceToken.slice(0, 8)}..., removing from database`);
                    const { error: deleteError } = await supabaseInternalClient()
                        .from('ws_push_notifications_users')
                        .delete()
                        .eq('device_token', input.deviceToken);

                    if (deleteError) {
                        logger.error(`[IOSClient] Failed to delete invalid device token ${input.deviceToken.slice(0, 8)}...`, deleteError);
                    } else {
                        logger.info(`[IOSClient] Removed invalid token ${input.deviceToken.slice(0, 8)}...`);
                    }
                }

                throw new Error(`APNS failed in both environments`);
            }
        }
    }

    private async sendToEnvironment(input: z.infer<typeof NotificationPayload>, env: 'production' | 'sandbox'): Promise<any> {
        const headers = this.generateHeaders(input.expirationHours, input.deviceToken);
        const payload = IOSClient.parseNotificationPayload(input);

        return new Promise((resolve, reject) => {
            let client: http2.ClientHttp2Session;

            try {
                client = this.getClient(env);
            } catch (err: any) {
                // Force reconnection on next attempt
                delete IOSClient.clients[env];
                reject(new Error(`Failed to get HTTP/2 client: ${err.message}`));
                return;
            }

            // Check if client is still usable
            if (client.destroyed || client.closed) {
                delete IOSClient.clients[env];
                reject(new Error('HTTP/2 client is not available, will reconnect on next request'));
                return;
            }

            const req = client.request(headers);
            let data = '';
            let isResolved = false;

            // Add timeout for the request
            const timeout = setTimeout(() => {
                if (!isResolved) {
                    isResolved = true;
                    req.close();
                    reject(new Error('APNS request timed out after 30 seconds'));
                }
            }, 30000);

            req.on('response', (headers) => {
                const status = headers[':status'];

                if (status !== 200) {
                    req.on('data', (chunk) => {
                        data += chunk;
                    });
                    req.on('end', () => {
                        if (!isResolved) {
                            isResolved = true;
                            clearTimeout(timeout);
                            reject(new Error(`APNS request failed with status ${status}: ${data}`));
                        }
                    });
                } else {
                    req.on('data', (chunk) => {
                        data += chunk;
                    });
                    req.on('end', () => {
                        if (!isResolved) {
                            isResolved = true;
                            clearTimeout(timeout);
                            logger.info(`[${input.category}] Delivered → ${input.deviceToken.slice(0, 8)}... (${env})`);
                            resolve(data ? JSON.parse(data) : {});
                        }
                    });
                }
            });

            req.on('error', (err) => {
                if (!isResolved) {
                    isResolved = true;
                    clearTimeout(timeout);
                    // Force client reconnection on connection errors
                    if (err.message.includes('ECONNRESET') || err.message.includes('GOAWAY') || err.message.includes('socket hang up')) {
                        delete IOSClient.clients[env];
                    }
                    reject(new Error(`APNS request error: ${err.message}`));
                }
            });

            req.write(JSON.stringify(payload));
            req.end();
        });
    }

    private static parseNotificationPayload(input: z.infer<typeof NotificationPayload>) {
        const payload: Record<string, any> = {
            aps: {
                alert: {
                    title: input.title,
                    body: input.body,
                },
                category: input.category,
                'thread-id': input.category.replace(/_/g, '-'),
                'interruption-level': input.critical ? 'critical' : 'time-sensitive',
                sound: input.critical ? {
                    critical: 1,
                    name: input.sound ?? 'default',
                    volume: 1.0
                } : (input.sound ?? 'default'),
            },
            category: input.category,
            deepLink: input.deepLink,
            url: input.deepLink,
            ...input.metadata,
        }

        return payload;
    }

    private getBaseURL(env: 'production' | 'sandbox'): string {
        return env === 'production'
            ? 'https://api.push.apple.com'
            : 'https://api.sandbox.push.apple.com';
    }

    private getToken(): string {
        // JWT tokens expire after 1 hour, refresh if older than 50 minutes
        const fiftyMinutesInMs = 50 * 60 * 1000;
        if (!IOSClient.cachedToken || Date.now() - IOSClient.tokenCreatedAt > fiftyMinutesInMs) {
            logger.info('[IOSClient] Refreshing APNS JWT token');
            IOSClient.cachedToken = this.createApnsJwt();
            IOSClient.tokenCreatedAt = Date.now();
        }
        return IOSClient.cachedToken;
    }

    private getClient(env: 'production' | 'sandbox'): http2.ClientHttp2Session {
        const existing = IOSClient.clients[env];
        if (!existing || existing.destroyed || existing.closed) {
            if (existing && !existing.destroyed) {
                try { existing.close(); } catch { }
            }
            const client = http2.connect(this.getBaseURL(env));

            client.on('error', (err) => {
                logger.error(`[IOSClient] HTTP/2 connection error (${env})`, err.message);
                try { IOSClient.clients[env]?.close(); } catch { }
                delete IOSClient.clients[env];
            });

            client.on('close', () => {
                delete IOSClient.clients[env];
            });

            IOSClient.clients[env] = client;
            return client;
        }
        return existing;
    }

    private generateHeaders(expirationHours: number, deviceToken: string): http2.OutgoingHttpHeaders {
        return {
            ':method': 'POST',
            ':path': `/3/device/${deviceToken}`,
            ':scheme': 'https',
            'apns-topic': getEnv('APNS_BUNDLE_ID'),
            'apns-push-type': 'alert',
            'apns-priority': '10',
            'authorization': `bearer ${this.getToken()}`,
            'apns-expiration': Math.floor(Date.now() / 1000 + expirationHours * 3600).toString(),
            'content-type': 'application/json',
        };
    }

    private createApnsJwt(): string {
        const now = Math.floor(Date.now() / 1000);
        const payload = { iss: getEnv('APNS_TEAM_ID'), iat: now };

        let privateKey = getEnv('APNS_PRIVATE_KEY');
        if (!privateKey.includes('-----BEGIN PRIVATE KEY-----')) {
            privateKey = privateKey.replace(/\\n/g, '\n');
            if (!privateKey.startsWith('-----BEGIN PRIVATE KEY-----')) {
                privateKey = `-----BEGIN PRIVATE KEY-----\n${privateKey}\n-----END PRIVATE KEY-----`;
            }
        }

        return jwt.sign(payload, privateKey, {
            algorithm: 'ES256',
            header: { alg: 'ES256', kid: getEnv('APNS_KEY_ID'), typ: 'JWT' },
        });
    }

    private shouldDeleteDeviceToken(errorMessage: string): boolean {
        // APNS error reasons that indicate the token is permanently invalid
        const invalidTokenReasons = [
            'BadDeviceToken',      // The device token is invalid
            'Unregistered',        // The device token is inactive for the specified topic
            'DeviceTokenNotForTopic', // The device token does not match the specified topic
            'TopicDisallowed',     // Pushing to this topic is not allowed
        ];

        return invalidTokenReasons.some(reason => errorMessage.includes(reason));
    }
}
