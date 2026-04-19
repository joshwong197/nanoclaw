/**
 * Prepends a Persona 5 codename + emoji to outbound WhatsApp messages so the
 * user can see at a glance which thief is speaking. Only applies to WhatsApp
 * JIDs (`@s.whatsapp.net`, `@g.us`) — Telegram uses pool bots for identity.
 */

interface AgentIdentity {
  emoji: string;
  codename: string;
}

// Accepts real name OR codename (case-insensitive) as the key.
const AGENTS: Record<string, AgentIdentity> = {
  ren: { emoji: '🃏', codename: 'Joker' },
  joker: { emoji: '🃏', codename: 'Joker' },
  futaba: { emoji: '🛸', codename: 'Oracle' },
  oracle: { emoji: '🛸', codename: 'Oracle' },
  haru: { emoji: '🌹', codename: 'Noir' },
  noir: { emoji: '🌹', codename: 'Noir' },
  yusuke: { emoji: '🦊', codename: 'Fox' },
  fox: { emoji: '🦊', codename: 'Fox' },
  kasumi: { emoji: '🩰', codename: 'Violet' },
  violet: { emoji: '🩰', codename: 'Violet' },
  ryuji: { emoji: '💀', codename: 'Skull' },
  skull: { emoji: '💀', codename: 'Skull' },
  morgana: { emoji: '🐱', codename: 'Mona' },
  mona: { emoji: '🐱', codename: 'Mona' },
  anne: { emoji: '🐆', codename: 'Panther' },
  ann: { emoji: '🐆', codename: 'Panther' },
  panther: { emoji: '🐆', codename: 'Panther' },
  makoto: { emoji: '👑', codename: 'Queen' },
  queen: { emoji: '👑', codename: 'Queen' },
  akechi: { emoji: '⚖️', codename: 'Crow' },
  crow: { emoji: '⚖️', codename: 'Crow' },
};

// Map group folder → agent identity. Currently only the Midori WhatsApp
// context is Oracle; add entries as more agents join WhatsApp.
const FOLDER_TO_AGENT: Record<string, AgentIdentity> = {
  whatsapp_midori: AGENTS.oracle,
};

// Canonical thief emojis used to detect/strip trailing sign-off emojis
// (e.g. agent writes "…standing by. 🛸" — the trailing 🛸 is redundant).
const THIEF_EMOJIS = ['🃏', '🛸', '🌹', '🦊', '🩰', '💀', '🐱', '🐆', '👑', '⚖️'];
const TRAILING_EMOJI_RE = new RegExp(
  `(?:\\s*(?:${THIEF_EMOJIS.join('|')}))+\\s*$`,
);

function lookup(key: string | undefined): AgentIdentity | undefined {
  if (!key) return undefined;
  return AGENTS[key.trim().toLowerCase()];
}

// Matches a leading thief badge like "🛸 Oracle:", "🃏 Joker:", "💚 Futaba:",
// etc. Includes BOTH real names and codenames — the agent sometimes signs
// with the real name (e.g. `💚 Futaba:`) and we want to collapse those into
// the canonical codename badge.
// Tolerates VS-16 (U+FE0F) after emojis and stray "Midori:" prefixes the
// agent sometimes still produces — strip those so the real thief badge leads.
const CODENAMES = [
  'Joker', 'Ren',
  'Oracle', 'Futaba',
  'Noir', 'Haru',
  'Fox', 'Yusuke',
  'Violet', 'Kasumi',
  'Skull', 'Ryuji',
  'Mona', 'Morgana',
  'Panther', 'Ann', 'Anne',
  'Queen', 'Makoto',
  'Crow', 'Akechi',
];
// One leading badge like "🛸 Oracle: ". Tolerates:
//   - optional markdown wrap (*bold*, _italic_)
//   - any single non-whitespace token as the emoji slot
//   - variation selectors (U+FE0F) / ZWJ inside emoji
//   - `*Oracle:*` with no emoji at all
//   - uppercase names (`RYUJI`, `ORACLE`) — case-insensitive match
//   - parenthetical codename after real name: `RYUJI (Skull):`
const MD = '[*_~]*';
const LEADING_BADGE_RE = new RegExp(
  `^\\s*${MD}(?:\\S+\\s+)?(${CODENAMES.join('|')})${MD}(?:\\s*\\([^)]*\\))?${MD}\\s*:${MD}\\s*`,
  'i',
);

export function prefixAgentMessage(
  jid: string,
  text: string,
  opts: { sender?: string; folder?: string } = {},
): string {
  if (!text) return text;

  let body = text;
  let lastCodename: string | undefined;

  // Repeatedly strip leading "Midori: " and thief badges. The LAST badge
  // in a chain wins — so "Midori: 🛸 Oracle: 🃏 Joker: hi" collapses to
  // "🃏 Joker: hi" (Oracle was just framing; Joker is the real speaker).
  for (;;) {
    const stripped = body.replace(/^\s*Midori\s*:\s*/, '');
    const m = stripped.match(LEADING_BADGE_RE);
    if (!m) {
      body = stripped;
      break;
    }
    lastCodename = m[1];
    body = stripped.slice(m[0].length);
  }

  // Strip trailing thief-emoji sign-offs (e.g. "…standing by. 🛸").
  body = body.replace(TRAILING_EMOJI_RE, '').trimEnd();

  // If a badge chain was present, use the final codename's canonical emoji.
  if (lastCodename) {
    const identity = lookup(lastCodename);
    if (identity) {
      return `${identity.emoji} ${identity.codename}: ${body}`;
    }
  }

  // No badge written — fall back to sender/folder mapping (Oracle by default).
  const identity =
    lookup(opts.sender) ??
    (opts.folder ? FOLDER_TO_AGENT[opts.folder] : undefined);

  if (!identity) return body;

  return `${identity.emoji} ${identity.codename}: ${body}`;
}
