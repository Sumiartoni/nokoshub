import http from 'node:http';
import https from 'node:https';
import type { AxiosRequestConfig, RawAxiosRequestHeaders } from 'axios';

export const SHARED_HTTP_AGENT = new http.Agent({
    keepAlive: true,
    keepAliveMsecs: 15_000,
    maxSockets: 50,
    maxFreeSockets: 10,
    scheduling: 'lifo',
});

export const SHARED_HTTPS_AGENT = new https.Agent({
    keepAlive: true,
    keepAliveMsecs: 15_000,
    maxSockets: 50,
    maxFreeSockets: 10,
    scheduling: 'lifo',
});

export function buildOutboundAxiosConfig(config: {
    baseURL?: string;
    timeout?: number;
    headers?: RawAxiosRequestHeaders;
} = {}): AxiosRequestConfig {
    return {
        baseURL: config.baseURL,
        timeout: config.timeout ?? 15_000,
        headers: config.headers,
        family: 4,
        httpAgent: SHARED_HTTP_AGENT,
        httpsAgent: SHARED_HTTPS_AGENT,
    };
}
