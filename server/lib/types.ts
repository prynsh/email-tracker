export interface TrackedEmail {
  id: string;
  to: string;
  subject: string;
  sentAt: string;
  pixelUrl: string;
}

export interface OpenEvent {
  id: number;
  emailId: string;
  openedAt: string;
  ip: string | null;
  userAgent: string | null;
  country: string | null;
  isProxy: boolean;
  proxyReason: string | null;
}

export interface TrackedEmailWithStats extends TrackedEmail {
  /** Opens from real humans (non-proxy) */
  openCount: number;
  /** Opens from email proxies / bots */
  machineOpenCount: number;
  lastOpenedAt: string | null;
  opens?: OpenEvent[];
}

export interface TrackRequest {
  id?: string;
  to: string;
  subject: string;
  sentAt?: string;
}

export interface TrackResponse {
  id: string;
  pixelUrl: string;
}
