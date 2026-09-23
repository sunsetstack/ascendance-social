export interface ClientFingerprint {
  schemaVersion: 1;
  accept?: string;
  acceptEncoding?: string;
  acceptLanguage?: string;
  secChUa?: string;
  secChUaMobile?: string;
  secChUaPlatform?: string;
  secFetchDest?: string;
  secFetchMode?: string;
  secFetchSite?: string;
  secFetchUser?: string;
  protocol?: string;
  protocolSource: "express_proxy_observed";
}

export interface VisitorObservation {
  schemaVersion: 1;
  path: string;
  referrer?: string;
  language?: string;
  languages?: string[];
  platform?: string;
  timezone?: string;
  screen?: {
    width: number;
    height: number;
    colorDepth: number;
  };
  viewport?: {
    width: number;
    height: number;
  };
  devicePixelRatio?: number;
  hardwareConcurrency?: number;
  deviceMemory?: number;
  maxTouchPoints?: number;
}
