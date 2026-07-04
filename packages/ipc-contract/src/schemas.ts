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
// Wire messages
// ---------------------------------------------------------------------------

export const StatusLevelSchema = z.enum(['info', 'warning', 'error']);

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
