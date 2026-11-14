import { isIP } from 'node:net';
import { lookup as dnsLookup } from 'node:dns/promises';
import { ResearchError } from "./types.js";
/**
 * Public URL policy shared by search-result filtering and the reader.
 *
 * These helpers are deliberately pure except where DNS is requested, so the
 * tests can exercise the parsing rules without a network. Rejecting by name is
 * not enough on its own: a hostname can resolve to a private address, so the
 * reader resolves every address and binds the connection to a checked one.
 */
/** Names/IPs that must never be reachable, including cloud metadata endpoints. */
const BLOCKED_EXACT = new Set([
    'localhost',
    'metadata',
    'metadata.google.internal',
    'instance-data',
    'kubernetes.default',
]);
const isPrivateIpv4 = (address) => {
    const parts = address.split('.').map(Number);
    if (parts.length !== 4 || parts.some(part => !Number.isInteger(part) || part < 0 || part > 255))
        return true;
    const [a, b] = parts;
    if (a === 0 || a === 10 || a === 127)
        return true;
    if (a === 100 && b >= 64 && b <= 127)
        return true; // carrier-grade NAT
    if (a === 169 && b === 254)
        return true; // link-local, incl. metadata 169.254.169.254
    if (a === 172 && b >= 16 && b <= 31)
        return true;
    if (a === 192 && b === 168)
        return true;
    if (a === 192 && b === 0)
        return true;
    if (a === 198 && (b === 18 || b === 19))
        return true;
    if (a >= 224)
        return true; // multicast + reserved
    return false;
};
const isPrivateIpv6 = (address) => {
    const normalized = address.toLowerCase().split('%')[0] ?? '';
    if (normalized === '::' || normalized === '::1')
        return true;
    // IPv4-mapped addresses (::ffff:127.0.0.1) inherit the IPv4 verdict.
    const mapped = /^::ffff:(\d+\.\d+\.\d+\.\d+)$/.exec(normalized);
    if (mapped !== null)
        return isPrivateIpv4(mapped[1]);
    if (/^f[cd][0-9a-f]{2}:/.test(normalized))
        return true; // unique local
    if (/^fe[89ab][0-9a-f]:/.test(normalized))
        return true; // link-local
    if (/^ff[0-9a-f]{2}:/.test(normalized))
        return true; // multicast
    return false;
};
/** True for addresses the reader must never connect to. Malformed input is treated as private. */
export function isBlockedAddress(address) {
    const version = isIP(address.replace(/^\[|\]$/g, ''));
    if (version === 4)
        return isPrivateIpv4(address);
    if (version === 6)
        return isPrivateIpv6(address);
    return true;
}
/** Parse and screen a URL before DNS. Throws a stable, model-safe error. */
export function assertPublicUrl(value) {
    let url;
    try {
        url = value instanceof URL ? value : new URL(value);
    }
    catch {
        throw new ResearchError('FETCH_BLOCKED', '网页地址无效。');
    }
    if (url.protocol !== 'http:' && url.protocol !== 'https:')
        throw new ResearchError('FETCH_BLOCKED', '只允许读取 HTTP(S) 公开网页。');
    if (url.username !== '' || url.password !== '')
        throw new ResearchError('FETCH_BLOCKED', '网页地址不能携带账号信息。');
    const host = url.hostname.toLowerCase().replace(/^\[|\]$/g, '');
    if (host === '')
        throw new ResearchError('FETCH_BLOCKED', '网页地址缺少主机名。');
    if (BLOCKED_EXACT.has(host) || host.endsWith('.localhost') || host.endsWith('.local') || host.endsWith('.internal') || host.endsWith('.home.arpa')) {
        throw new ResearchError('FETCH_BLOCKED', '不读取本机或内网地址。');
    }
    if (isIP(host) !== 0) {
        if (isBlockedAddress(host))
            throw new ResearchError('FETCH_BLOCKED', '不读取本机或内网地址。');
    }
    else if (!host.includes('.')) {
        // Single-label names only resolve on local networks.
        throw new ResearchError('FETCH_BLOCKED', '网页主机名无法公开解析。');
    }
    return url;
}
/** Default resolver: every address must be public. A failure to resolve is a normal unavailable error. */
export const resolvePublicAddresses = async (hostname) => {
    let records;
    try {
        records = await dnsLookup(hostname, { all: true, verbatim: true });
    }
    catch {
        throw new ResearchError('FETCH_UNAVAILABLE', '网页主机无法解析。');
    }
    if (records.length === 0)
        throw new ResearchError('FETCH_UNAVAILABLE', '网页主机无法解析。');
    const addresses = records.map(record => record.address);
    // One private address is enough to refuse: a rebinding answer could rotate to it.
    if (addresses.some(address => isBlockedAddress(address)))
        throw new ResearchError('FETCH_BLOCKED', '网页解析到本机或内网地址，已拒绝读取。');
    return addresses;
};
//# sourceMappingURL=safety.js.map