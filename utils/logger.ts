const RESET = '\x1b[0m';
const DIM = '\x1b[2m';
const GREEN = '\x1b[32m';
const YELLOW = '\x1b[33m';
const RED = '\x1b[31m';
const BOLD = '\x1b[1m';

function ts(): string {
    return new Date().toISOString().replace('T', ' ').slice(0, 23);
}

function fmt(ctx: unknown): string {
    if (ctx === undefined || ctx === null) return '';
    if (ctx instanceof Error) return `  ${DIM}→ ${ctx.message}${RESET}`;
    if (typeof ctx === 'string') return `  ${DIM}→ ${ctx}${RESET}`;
    try { return `  ${DIM}→ ${JSON.stringify(ctx)}${RESET}`; } catch { return ''; }
}

export const logger = {
    info: (msg: string) =>
        console.log(`${DIM}${ts()}${RESET}  ${GREEN}INFO${RESET}  ${msg}`),
    warn: (msg: string, ctx?: unknown) =>
        console.warn(`${DIM}${ts()}${RESET}  ${YELLOW}WARN${RESET}  ${msg}${fmt(ctx)}`),
    error: (msg: string, ctx?: unknown) =>
        console.error(`${DIM}${ts()}${RESET}  ${BOLD}${RED}ERR!${RESET}  ${msg}${fmt(ctx)}`),
};
