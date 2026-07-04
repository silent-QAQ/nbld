import type { ChunkWindowResponse, EnterWorldResponse, GuestLoginResponse, MoveResponse } from "./protocol";

export class ApiClient {
  constructor(private readonly baseUrl: string) {}

  async guestLogin(deviceId: string): Promise<GuestLoginResponse> {
    return this.post("/api/v1/session/guest", { deviceId });
  }

  async enterWorld(token: string): Promise<EnterWorldResponse> {
    return this.post("/api/v1/world/enter", { token });
  }

  async move(token: string, x: number, y: number): Promise<MoveResponse> {
    return this.post("/api/v1/world/move", { token, position: { x, y } });
  }

  async chunks(token: string): Promise<ChunkWindowResponse> {
    return this.get(`/api/v1/world/chunks?token=${encodeURIComponent(token)}`);
  }

  wsUrl(): string {
    const url = new URL(this.baseUrl);
    url.protocol = url.protocol === "https:" ? "wss:" : "ws:";
    url.pathname = "/ws/world";
    url.search = "";
    url.hash = "";
    return url.toString();
  }

  private async get<T>(path: string): Promise<T> {
    const response = await fetch(this.baseUrl + path);
    if (!response.ok) throw new Error(await response.text());
    return response.json() as Promise<T>;
  }

  private async post<T>(path: string, body: unknown): Promise<T> {
    const response = await fetch(this.baseUrl + path, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    if (!response.ok) throw new Error(await response.text());
    return response.json() as Promise<T>;
  }
}
