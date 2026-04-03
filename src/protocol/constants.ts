/** Name registered in the native messaging host manifest. */
export const NATIVE_HOST_NAME = 'com.ank1015.llm';

/**
 * Maximum message size from native host -> Chrome extension.
 * Chrome native messaging enforces a strict 1 MB outbound limit.
 */
export const MAX_HOST_TO_CHROME_MESSAGE_SIZE_BYTES = 1024 * 1024;

/**
 * Maximum message size from Chrome extension -> native host.
 * Set larger to support large payloads (for example screenshots).
 */
export const MAX_CHROME_TO_HOST_MESSAGE_SIZE_BYTES = 64 * 1024 * 1024;

/**
 * Maximum message size on the local TCP bridge (agent <-> native host).
 * Set larger than native host outbound limit so large tool results can flow.
 */
export const MAX_TCP_MESSAGE_SIZE_BYTES = 64 * 1024 * 1024;

/**
 * Backward-compatible alias. Prefer directional constants above for new code.
 */
export const MAX_MESSAGE_SIZE_BYTES = MAX_HOST_TO_CHROME_MESSAGE_SIZE_BYTES;

/** Byte length of the uint32 LE length prefix. */
export const LENGTH_PREFIX_BYTES = 4;

/** Default TCP port for the Chrome RPC server. */
export const DEFAULT_PORT = 9224;
