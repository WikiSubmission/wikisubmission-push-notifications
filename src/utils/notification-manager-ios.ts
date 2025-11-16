import http2 from 'http2';
import jwt from 'jsonwebtoken';
import { Notification } from '../types/notification';
import { getEnv } from './get-env';
import z from 'zod';
import { getSupabaseInternalClient } from './get-supabase-client';

export class NotificationManagerIOS {
    private primaryEnv: 'production' | 'sandbox' = getEnv('APNS_ENV') === 'production' ? 'production' : 'sandbox';
    private token = this.createApnsJwt();
    private client: http2.ClientHttp2Session | null = null;
    private currentEnv: 'production' | 'sandbox' = this.primaryEnv;

    private getBaseURL(env: 'production' | 'sandbox'): string {
        return env === 'production'
            ? 'https://api.push.apple.com'
            : 'https://api.sandbox.push.apple.com';
    }

    private getClient(env: 'production' | 'sandbox'): http2.ClientHttp2Session {
        if (!this.client || this.client.destroyed || this.currentEnv !== env) {
            if (this.client && !this.client.destroyed) {
                this.client.close();
            }
            this.currentEnv = env;
            this.client = http2.connect(this.getBaseURL(env));
        }
        return this.client;
    }

    async send(input: z.infer<typeof Notification>): Promise<any> {
        // Try primary environment first
        try {
            return await this.sendToEnvironment(input, this.primaryEnv);
        } catch (error: any) {
            console.error(`Failed to send via ${this.primaryEnv}:`, error.message);

            // Try alternate environment
            const alternateEnv: 'production' | 'sandbox' = this.primaryEnv === 'production' ? 'sandbox' : 'production';
            console.log(`Retrying with ${alternateEnv} APNS...`);

            try {
                return await this.sendToEnvironment(input, alternateEnv);
            } catch (alternateError: any) {
                console.error(`APNS failed in both environments:`, alternateError.message);

                // Check if the error is due to an invalid device token
                const shouldDeleteToken = this.shouldDeleteDeviceToken(error.message) || 
                                         this.shouldDeleteDeviceToken(alternateError.message);

                if (shouldDeleteToken) {
                    console.log(`Invalid device token detected, removing from database...`);
                    const { error: deleteError } = await getSupabaseInternalClient()
                        .from('ws_notifications_ios')
                        .delete()
                        .eq('device_token', input.token);

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

    private async sendToEnvironment(input: z.infer<typeof Notification>, env: 'production' | 'sandbox'): Promise<any> {
        const headers = this.generateHeaders(input.content.expirationHours, input.token);
        const payload = this.generatePayload(input);

        return new Promise((resolve, reject) => {
            const client = this.getClient(env);
            const req = client.request(headers);

            let data = '';

            req.on('response', (headers) => {
                const status = headers[':status'];

                if (status !== 200) {
                    req.on('data', (chunk) => {
                        data += chunk;
                    });
                    req.on('end', () => {
                        reject(new Error(`APNS request failed with status ${status}: ${data}`));
                    });
                } else {
                    req.on('data', (chunk) => {
                        data += chunk;
                    });
                    req.on('end', () => {
                        console.log(`✓ Notification '${input.content.category}' delivery successful (${env})`);
                        resolve(data ? JSON.parse(data) : {});
                    });
                }
            });

            req.on('error', (err) => {
                reject(new Error(`APNS request error: ${err.message}`));
            });

            req.write(JSON.stringify(payload));
            req.end();
        });
    }

    destroy() {
        if (this.client && !this.client.destroyed) {
            this.client.close();
        }
    }

    /**
     * Determines if a device token should be deleted based on APNS error response
     * @param errorMessage The error message from APNS
     * @returns true if the token should be deleted
     */
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

    private generateHeaders(expirationHours: number, deviceToken: string): http2.OutgoingHttpHeaders {
        return {
            ':method': 'POST',
            ':path': `/3/device/${deviceToken}`,
            ':scheme': 'https',
            'apns-topic': getEnv('APNS_BUNDLE_ID'),
            'apns-push-type': 'alert',
            'apns-priority': '10',
            'authorization': `bearer ${this.token}`,
            'apns-expiration': Math.floor(Date.now() / 1000 + expirationHours * 3600).toString(),
            'content-type': 'application/json',
        };
    }

    private generatePayload(input: z.infer<typeof Notification>) {
        const payload: Record<string, any> = {
            aps: {
                alert: {
                    title: input.content.title,
                    body: input.content.body,
                    category: input.content.category,
                    'thread-id': input.content.category.replace(/_/g, '-'),
                    sound: (() => {
                        if (input.options?.critical) {
                            return 'default';
                        }
                        return 'default';
                    })(),
                    deepLink: input.content.deepLink,
                    url: input.content.deepLink
                },
            },
            ...input.content.metadata,
        }

        return payload;
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
}
