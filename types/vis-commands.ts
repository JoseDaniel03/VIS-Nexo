/**
 * VIS Nexo frontend/backend contract: useful types for incremental migration
 * of the existing plain-JavaScript UI. Checked with tsc --strict.
 * This is NOT a claim that all legacy app.js DOM code is typechecked.
 */
export type UserRole = 'user' | 'admin';
export type InstanceLoader = 'vanilla' | 'fabric' | 'horizon';
export type InstanceEngine = 'java' | 'horizon';
export type Presence = 'online' | 'away' | 'busy' | 'invisible' | 'offline';
export type Instance = {
  name: string; project_id: string; version: string; game_dir: string;
  ram_mb: number; fullscreen: boolean; installed: boolean;
  loader: InstanceLoader; loader_version: string; engine: InstanceEngine;
  share_offline: boolean; horizon_build_dir: string; horizon_minecraft_dir: string;
  horizon_server_jar: string; java_path: string; player_name: string; source_owner: string;
};
export type SafeUser = {
  username: string; role: UserRole; avatar: string; skin: string;
  cape: string; avatar_layer: string; profile_banner: string; presence: Presence;
};
export type Message = { from: string; to: string; body: string; created: string };
export type Snapshot = {
  user: SafeUser | null; projects: unknown[]; instances: Instance[];
  friends: {username: string; presence: string}[];
  incoming_requests: string[]; outgoing_requests: string[];
  messages: Message[]; branding: Record<string, unknown>;
  project_execution: Record<string, boolean>;
  paused_projects: string[];
  recent_accounts: {username: string; provider: string}[];
  mode: 'local' | 'offline';
};
export type LaunchResult = {pid: number; log_file: string; offline: boolean};
export type LaunchExit = {
  pid: number; success: boolean; exit_code: number | null;
  log_file: string; error: string;
};
export type UpdateInfo = {
  configured: boolean; current_version: string; available: boolean;
  version: string; notes: string;
};
export type MaintenanceReport = {
  mode: 'preview' | 'cleaned'; total_files: number; total_bytes: number;
  deleted_files: number; freed_bytes: number;
  areas: {label:string; folder:string; retained_days:number;
    candidate_files:number; candidate_bytes:number;
    deleted_files:number; freed_bytes:number}[];
  protected: string[];
};
export type NativeCommandMap = {
  get_state: { args: Record<string, never>; result: Snapshot };
  register: { args: { username: string; password: string; confirm: string }; result: Snapshot };
  login: { args: { username: string; password: string }; result: Snapshot };
  logout: { args: Record<string, never>; result: Snapshot };
  login_offline: {args: {nickname: string}; result: Snapshot};
  minecraft_versions: {args: Record<string, never>; result: {id: string;kind: string}[]};
  fabric_loaders: {args: {version: string}; result: string[]};
  horizon_probe: {args: {projectId:string;name:string};result:{build:string;minecraft:string;api:string;java_major:number;resources_ready:boolean}};
  horizon_installed_builds: {args: Record<string, never>;result:{tag:string;build_dir:string;integrity:string;detail:string}[]};
  horizon_latest_release: {args: Record<string, never>;result:{tag:string;archive:string;size:number;published:string}};
  horizon_install_release: {args:{expectedTag:string};result:{tag:string;build_dir:string;archive_sha256:string}};
  launch_horizon: {args: {projectId:string;name:string;sessionFile:string;sourceOwner:string|null};result: LaunchResult};
  ensure_project_instance: {args: {projectId:string;gameDir:string;ramMb:number};result: Snapshot};
  set_project_active: {args: {projectId:string;enabled:boolean};result: Snapshot};
  sync_project_content: {args: {projectId:string;name:string};result: string[]};
  configure_shared_ram: {args:{sourceOwner:string;projectId:string;name:string;ramMb:number};result:Snapshot};
  install_minecraft: {args: {projectId: string;name: string}; result: Snapshot};
  launch_minecraft: {args: {projectId: string;name: string;sourceOwner: string|null}; result: LaunchResult};
  maintenance_preview: {args: Record<string, never>; result: MaintenanceReport};
  maintenance_clean: {args: {confirmed: boolean}; result: MaintenanceReport};
  check_app_update: {args: Record<string, never>; result: UpdateInfo};
  install_app_update: {args: {confirmed: boolean}; result: void};
  fetch_cloud_catalog: {args: Record<string, never>; result: {source: string; projects: unknown[]}};
  download_cloud_bundle: {args: {projectId: string}; result: string};
};
export type NativeCommandName = keyof NativeCommandMap;
export type NativeCommandArgs<K extends NativeCommandName> = NativeCommandMap[K]['args'];
export type NativeCommandResult<K extends NativeCommandName> = NativeCommandMap[K]['result'];
// Explicitly typed wrapper for the commands that have already been migrated.
export async function typedInvoke<K extends NativeCommandName>(
  invoke: (command: string, args?: Record<string, unknown>) => Promise<unknown>,
  command: K, args: NativeCommandArgs<K>,
): Promise<NativeCommandResult<K>> {
  return await invoke(command, args) as NativeCommandResult<K>;
}
