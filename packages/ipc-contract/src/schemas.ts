import { z } from 'zod';
import type {
  DeckLayout,
  DeckSlot,
  VoiceChannelState,
  VoiceUser,
} from '@deckord/shared';

/**
 * Zod schemas for everything that crosses the local WebSocket boundary.
 * These are the runtime trust boundary: the service validates every inbound
 * client message, and the debug UI validates every inbound service message.
 *
 * The domain schemas below mirror the hand-written types in @deckord/shared;
 * the compile-time asserts at the bottom of this file fail the build if the two
 * ever drift apart.
 */

// ---------------------------------------------------------------------------
// Voice domain
// ---------------------------------------------------------------------------

export const VoiceProviderKindSchema = z.enum(['discord-rpc', 'mock']);

export const VoiceUserSchema = z.object({
  userId: z.string(),
  username: z.string(),
  displayName: z.string(),
  avatarHash: z.string().optional(),
  avatarUrl: z.string().optional(),
  avatarLocalPath: z.string().optional(),
  isSpeaking: z.boolean(),
  selfMute: z.boolean(),
  serverMute: z.boolean(),
  selfDeaf: z.boolean(),
  serverDeaf: z.boolean(),
  suppress: z.boolean(),
  volume: z.number().optional(),
});

export const VoiceChannelStateSchema = z.object({
  provider: VoiceProviderKindSchema,
  connected: z.boolean(),
  channelId: z.string().nullable(),
  channelName: z.string().nullable(),
  guildId: z.string().nullable().optional(),
  guildName: z.string().nullable().optional(),
  users: z.array(VoiceUserSchema),
  updatedAt: z.number(),
});

// ---------------------------------------------------------------------------
// Deck domain
// ---------------------------------------------------------------------------

export const DeckSlotKindSchema = z.enum(['user', 'empty', 'status', 'page']);

export const DeckVisualStateSchema = z.object({
  speaking: z.boolean(),
  muted: z.boolean(),
  deafened: z.boolean(),
  disconnected: z.boolean(),
  selected: z.boolean(),
});

export const DeckBadgeTypeSchema = z.enum([
  'self-mute',
  'server-mute',
  'self-deaf',
  'server-deaf',
  'suppress',
  'speaking',
  'page',
]);

export const DeckBadgeSchema = z.object({
  type: DeckBadgeTypeSchema,
  label: z.string(),
});

export const DeckSlotSchema = z.object({
  slotIndex: z.number(),
  kind: DeckSlotKindSchema,
  userId: z.string().optional(),
  title: z.string().optional(),
  subtitle: z.string().optional(),
  visualState: DeckVisualStateSchema,
  image: z.string().optional(),
  badges: z.array(DeckBadgeSchema).optional(),
  accessibilityLabel: z.string().optional(),
});

export const DeckLayoutSchema = z.object({
  rows: z.number(),
  columns: z.number(),
  slotCount: z.number(),
  page: z.number(),
  pageCount: z.number(),
  slots: z.array(DeckSlotSchema),
});

// ---------------------------------------------------------------------------
// Config domain (Phase 9) — user-editable settings that cross the WS boundary.
// This is BOTH the wire contract for the config UI and the shape the service
// persists to settings.json (secrets are handled separately, never here).
// ---------------------------------------------------------------------------

export const LogLevelSchema = z.enum(['debug', 'info', 'warn', 'error']);
export const ProviderPreferenceSchema = z.enum(['auto', 'mock', 'discord-rpc']);
/** Severity of a status/log line surfaced to the UI (also used by diagnostics). */
export const StatusLevelSchema = z.enum(['info', 'warning', 'error']);

/**
 * The editable subset of the service config. Every field is optional: an absent
 * field keeps the env/default value (see mergeConfig). Unknown keys are stripped
 * (default Zod object behavior), so a hand-edited settings.json can't inject
 * arbitrary config. NEVER put secrets here — client secret / access token live in
 * the SecretStore and cross the wire only as one-way writes (see set_config).
 */
export const DeckordSettingsSchema = z.object({
  appName: z.string().min(1).max(64).optional(),
  logLevel: LogLevelSchema.optional(),
  provider: ProviderPreferenceSchema.optional(),
  deckAdapter: z.string().min(1).max(64).optional(),
  ws: z
    .object({
      host: z.string().min(1).optional(),
      port: z.number().int().min(1).max(65535).optional(),
      token: z.string().optional(),
    })
    .optional(),
  discord: z
    .object({
      clientId: z.string().max(64).optional(),
      redirectUri: z.string().max(512).optional(),
    })
    .optional(),
  openDeck: z
    .object({
      enabled: z.boolean().optional(),
      host: z.string().min(1).optional(),
      port: z.number().int().min(1).max(65535).optional(),
      iconSize: z.number().int().min(16).max(512).optional(),
    })
    .optional(),
  mock: z
    .object({
      autoStart: z.boolean().optional(),
      initialUsers: z.number().int().min(0).max(64).optional(),
      speakingIntervalMs: z.number().int().min(100).max(60_000).optional(),
    })
    .optional(),
});

/** service → UI: the current effective settings plus runtime status. */
export const ConfigPayloadSchema = z.object({
  settings: DeckordSettingsSchema,
  /** Presence flags only — the secret values themselves are never sent back. */
  secrets: z.object({ hasClientSecret: z.boolean(), hasToken: z.boolean() }),
  runtime: z.object({
    provider: VoiceProviderKindSchema,
    /** True when persisted settings differ from what the running service loaded. */
    restartRequired: z.boolean(),
    dataDir: z.string(),
  }),
});

/** service → UI: a redacted diagnostics bundle for support/troubleshooting. */
export const DiagnosticsPayloadSchema = z.object({
  generatedAt: z.number(),
  appName: z.string(),
  protocolVersion: z.number(),
  platform: z.string(),
  nodeVersion: z.string(),
  dataDir: z.string(),
  provider: z.object({
    preference: ProviderPreferenceSchema,
    active: VoiceProviderKindSchema,
    connected: z.boolean(),
    channelName: z.string().nullable(),
    users: z.number(),
  }),
  deck: z.object({
    adapter: z.string(),
    rows: z.number(),
    columns: z.number(),
    slotCount: z.number(),
  }),
  /** Effective settings, redacted (no secret values; ws.token shown as '***'). */
  settings: DeckordSettingsSchema,
  secrets: z.object({ hasClientSecret: z.boolean(), hasToken: z.boolean() }),
  recentEvents: z.array(
    z.object({ level: StatusLevelSchema, message: z.string(), code: z.string().optional() }),
  ),
  /** Path the bundle was also written to, when exported. */
  exportedTo: z.string().optional(),
});

/** UI → service: write settings and/or secrets (loopback only). */
export const SetConfigPayloadSchema = z.object({
  settings: DeckordSettingsSchema.optional(),
  secrets: z
    .object({
      clientSecret: z.string().optional(),
      accessToken: z.string().optional(),
      /** Forget the stored Discord token (e.g. "Disconnect"). */
      clearToken: z.boolean().optional(),
    })
    .optional(),
});

// ---------------------------------------------------------------------------
// Wire messages
// ---------------------------------------------------------------------------

export const ServiceToClientMessageSchema = z.discriminatedUnion('type', [
  z.object({
    type: z.literal('snapshot'),
    payload: z.object({ voice: VoiceChannelStateSchema, deck: DeckLayoutSchema }),
  }),
  z.object({
    type: z.literal('slot_update'),
    payload: z.object({ slotIndex: z.number(), slot: DeckSlotSchema }),
  }),
  z.object({ type: z.literal('voice_update'), payload: VoiceChannelStateSchema }),
  z.object({ type: z.literal('deck_update'), payload: DeckLayoutSchema }),
  z.object({
    type: z.literal('status'),
    payload: z.object({
      level: StatusLevelSchema,
      message: z.string(),
      code: z.string().optional(),
    }),
  }),
  z.object({ type: z.literal('config'), payload: ConfigPayloadSchema }),
  z.object({ type: z.literal('diagnostics'), payload: DiagnosticsPayloadSchema }),
]);

export const MockCommandSchema = z.enum([
  'start',
  'stop',
  'random_speaking',
  'toggle_mute',
  'toggle_deafen',
  'add_user',
  'remove_user',
  'reset',
]);

export const ClientToServiceMessageSchema = z.discriminatedUnion('type', [
  z.object({
    type: z.literal('hello'),
    payload: z.object({ client: z.literal('debug-deck'), version: z.string() }),
  }),
  z.object({ type: z.literal('button_down'), payload: z.object({ slotIndex: z.number() }) }),
  z.object({ type: z.literal('button_up'), payload: z.object({ slotIndex: z.number() }) }),
  z.object({
    type: z.literal('mock_command'),
    payload: z.object({ command: MockCommandSchema, userId: z.string().optional() }),
  }),
  // --- config (Phase 9) ---
  z.object({ type: z.literal('get_config') }),
  z.object({ type: z.literal('set_config'), payload: SetConfigPayloadSchema }),
  /** Set provider = discord-rpc and restart into it (interactive AUTHORIZE). */
  z.object({ type: z.literal('connect_discord') }),
  /** Apply pending settings by restarting the service pipeline. */
  z.object({ type: z.literal('restart_service') }),
  /** Request a redacted diagnostics bundle (also exported to a file). */
  z.object({ type: z.literal('get_diagnostics') }),
]);

// ---------------------------------------------------------------------------
// Compile-time drift guards: schema-inferred types must be mutually assignable
// with the canonical @deckord/shared types. If someone edits one and not the
// other, `tsc` fails here.
// ---------------------------------------------------------------------------

type Extends<A, B> = [A] extends [B] ? true : false;
type BiExtends<A, B> = Extends<A, B> extends true ? Extends<B, A> : false;
type Expect<T extends true> = T;

type _CheckVoiceUser = Expect<BiExtends<z.infer<typeof VoiceUserSchema>, VoiceUser>>;
type _CheckVoiceState = Expect<BiExtends<z.infer<typeof VoiceChannelStateSchema>, VoiceChannelState>>;
type _CheckDeckSlot = Expect<BiExtends<z.infer<typeof DeckSlotSchema>, DeckSlot>>;
type _CheckDeckLayout = Expect<BiExtends<z.infer<typeof DeckLayoutSchema>, DeckLayout>>;
