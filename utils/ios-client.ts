import { NotificationPayload } from "../notifications/notification-types";
import { getEnv } from "./get-env";
import { supabaseInternalClient } from "./supabase-client";
import http2 from "http2";
import jwt from "jsonwebtoken";
import z from "zod";

export class IOSClient {

    private client: http2.ClientHttp2Session | null = null;
    private primaryEnv: 'production' | 'sandbox' = getEnv('APNS_ENV') === 'production' ? 'production' : 'sandbox';
    private currentEnv: 'production' | 'sandbox' = this.primaryEnv;
    private token = this.createApnsJwt();
    private tokenCreatedAt = Date.now();

    async send(input: z.infer<typeof NotificationPayload>) {

        const { data, error } = await supabaseInternalClient()
            .from('ws_push_notifications_users')
            .select("*")
            .eq('device_token', input.deviceToken)
            .single();

        if (error) {
            console.error("[IOSClient] Error getting user", error);
            return;
        }

        if (data.is_sandbox) {
            this.currentEnv = 'sandbox';
        } else {
            this.currentEnv = 'production';
        }

        // Try current environment first
        try {
            await this.sendToEnvironment(input, this.currentEnv);
            return;
        } catch (error: any) {
            console.error(`Failed to send via ${this.currentEnv}:`, error.message);

            // Try alternate environment
            const alternateEnv: 'production' | 'sandbox' = this.primaryEnv === 'production' ? 'sandbox' : 'production';
            console.log(`Retrying with ${alternateEnv} APNS...`);

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
                console.error(`APNS failed in both environments:`, alternateError.message);

                // Check if the error is due to an invalid device token
                const shouldDeleteToken = this.shouldDeleteDeviceToken(error.message) ||
                    this.shouldDeleteDeviceToken(alternateError.message);

                if (shouldDeleteToken) {
                    console.log(`Invalid device token detected, removing from database...`);
                    const { error: deleteError } = await supabaseInternalClient()
                        .from('ws_push_notifications_users')
                        .delete()
                        .eq('device_token', input.deviceToken);

                    if (deleteError) {
                        console.error(`Error deleting device token:`, deleteError);
                    } else {
                        console.log(`✓ Deleted invalid device token from database`);
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
                this.client = null;
                reject(new Error(`Failed to get HTTP/2 client: ${err.message}`));
                return;
            }

            // Check if client is still usable
            if (client.destroyed || client.closed) {
                this.client = null;
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
                            console.log(`[${input.category}] ✓ Delivery succeeded to ${input.deviceToken.slice(0, 5)}...`);
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
                        this.client = null;
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
                    name: 'default',
                    volume: 1.0
                } : 'default',
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
        if (Date.now() - this.tokenCreatedAt > fiftyMinutesInMs) {
            console.log('Refreshing expired APNS JWT token...');
            this.token = this.createApnsJwt();
            this.tokenCreatedAt = Date.now();
        }
        return this.token;
    }

    private getClient(env: 'production' | 'sandbox'): http2.ClientHttp2Session {
        if (!this.client || this.client.destroyed || this.client.closed || this.currentEnv !== env) {
            if (this.client && !this.client.destroyed) {
                try {
                    this.client.close();
                } catch { }
            }
            this.currentEnv = env;
            this.client = http2.connect(this.getBaseURL(env));

            // Handle connection errors gracefully
            this.client.on('error', (err) => {
                console.error(`HTTP/2 connection error (${env}):`, err.message);
                // Force reconnection on next request
                if (this.client) {
                    try {
                        this.client.close();
                    } catch { }
                    this.client = null;
                }
            });

            // Handle connection close
            this.client.on('close', () => {
                this.client = null;
            });
        }
        return this.client;
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