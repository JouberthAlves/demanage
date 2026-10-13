/**
 * Compatibility shim: the implementation lives in lib/market/*.
 * Pure callers should import lib/market/types, series or providers/* directly
 * so they never load the database client.
 */
export * from '@/lib/market';
