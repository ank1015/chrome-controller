/** Name registered in the native messaging host manifest. */
export declare const NATIVE_HOST_NAME = "com.ank1015.llm";
/**
 * Maximum message size from native host -> Chrome extension.
 * Chrome native messaging enforces a strict 1 MB outbound limit.
 */
export declare const MAX_HOST_TO_CHROME_MESSAGE_SIZE_BYTES: number;
/**
 * Maximum message size from Chrome extension -> native host.
 * Set larger to support large payloads (for example screenshots).
 */
export declare const MAX_CHROME_TO_HOST_MESSAGE_SIZE_BYTES: number;
/**
 * Maximum message size on the local TCP bridge (agent <-> native host).
 * Set larger than native host outbound limit so large tool results can flow.
 */
export declare const MAX_TCP_MESSAGE_SIZE_BYTES: number;
/**
 * Backward-compatible alias. Prefer directional constants above for new code.
 */
export declare const MAX_MESSAGE_SIZE_BYTES: number;
/** Byte length of the uint32 LE length prefix. */
export declare const LENGTH_PREFIX_BYTES = 4;
/** Default TCP port for the Chrome RPC server. */
export declare const DEFAULT_PORT = 9224;
//# sourceMappingURL=constants.d.ts.map