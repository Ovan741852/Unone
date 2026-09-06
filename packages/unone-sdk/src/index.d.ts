export interface EngineResult<T = unknown> {
  ok: boolean;
  value: T;
  diagnostics?: Array<Record<string, unknown>>;
  effects?: string[];
}

export interface GameOptions {
  projectDir: string;
  enginePath?: string;
  enginePrefixArgs?: string[];
}

export interface RunOptions {
  frames?: number;
  seed?: number;
  action?: string;
  inputSequence?: string;
}

export declare function resolveEnginePath(explicit?: string): Promise<string>;

export declare class UnoneGame {
  readonly projectDir: string;
  constructor(options: GameOptions);
  invoke(args: string[]): Promise<EngineResult>;
  verify(): Promise<EngineResult>;
  test(): Promise<EngineResult>;
  run(options?: RunOptions): Promise<EngineResult>;
  pack(): Promise<EngineResult>;
  inspect(): Promise<EngineResult>;
  pluginList(): Promise<EngineResult>;
  pluginInspect(id: string): Promise<EngineResult>;
  pluginTest(id: string): Promise<EngineResult>;
  pluginCall(options: { id: string; tool: string; input?: string }): Promise<EngineResult>;
}

export declare function openGame(options: GameOptions): UnoneGame;

export declare function createGame(options: {
  dir: string;
  name: string;
  enginePath?: string;
  enginePrefixArgs?: string[];
  writePackage?: boolean;
}): Promise<EngineResult & { projectDir: string; game: UnoneGame }>;

export declare const unone: {
  createGame: typeof createGame;
  openGame: typeof openGame;
  resolveEnginePath: typeof resolveEnginePath;
  UnoneGame: typeof UnoneGame;
};
