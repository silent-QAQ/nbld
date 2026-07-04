import type {
  CharacterAppearance,
  CharacterListResponse,
  CharacterMutationResponse,
  ChunkWindowResponse,
  EnterWorldResponse,
  GuestLoginResponse,
  LoginResponse,
  MoveResponse,
  RegisterResponse,
} from "./protocol";

export class ApiClient {
  constructor(private readonly baseUrl: string) {}

  async guestLogin(deviceId: string): Promise<GuestLoginResponse> {
    return this.post("/api/v1/session/guest", { deviceId });
  }

  async register(email: string, username: string, password: string, confirmPassword: string): Promise<RegisterResponse> {
    return this.post("/api/v1/session/register", { email, username, password, confirmPassword });
  }

  async login(email: string, password: string): Promise<LoginResponse> {
    return this.post("/api/v1/session/login", { email, password });
  }

  async characters(token: string): Promise<CharacterListResponse> {
    return this.get(`/api/v1/characters?token=${encodeURIComponent(token)}`);
  }

  async createCharacter(token: string, name: string): Promise<CharacterMutationResponse> {
    return this.post("/api/v1/characters/create", { token, name });
  }

  async deleteCharacter(token: string, characterId: string): Promise<CharacterMutationResponse> {
    return this.post("/api/v1/characters/delete", { token, characterId });
  }

  async updateCharacterAppearance(token: string, characterId: string, appearance: CharacterAppearance): Promise<CharacterMutationResponse> {
    return this.post("/api/v1/characters/appearance", { token, characterId, appearance });
  }

  async enterWorld(token: string, characterId: string): Promise<EnterWorldResponse> {
    return this.post("/api/v1/world/enter", { token, characterId });
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
