export type CardTone = {
  key: string;
  fill: string;
  panel: string;
  accent: string;
  chip: string;
};

const FALLBACK_TONES: CardTone[] = [
  {
    key: 'amber',
    fill: '#FFB800',
    panel: 'from-amber-500/25 via-card to-card',
    accent: 'text-neon-amber',
    chip: 'bg-neon-amber/20',
  },
  {
    key: 'green',
    fill: '#34D399',
    panel: 'from-emerald-500/25 via-card to-card',
    accent: 'text-neon-green',
    chip: 'bg-neon-green/20',
  },
  {
    key: 'sky',
    fill: '#38BDF8',
    panel: 'from-sky-500/25 via-card to-card',
    accent: 'text-sky-300',
    chip: 'bg-sky-500/20',
  },
  {
    key: 'violet',
    fill: '#A78BFA',
    panel: 'from-violet-500/25 via-card to-card',
    accent: 'text-violet-300',
    chip: 'bg-violet-500/20',
  },
  {
    key: 'rose',
    fill: '#FB7185',
    panel: 'from-rose-500/25 via-card to-card',
    accent: 'text-rose-300',
    chip: 'bg-rose-500/20',
  },
  {
    key: 'cyan',
    fill: '#22D3EE',
    panel: 'from-cyan-500/25 via-card to-card',
    accent: 'text-cyan-300',
    chip: 'bg-cyan-500/20',
  },
];

const BRAND_TONES: Array<{ match: RegExp; tone: CardTone }> = [
  {
    match: /\bnu\b|nubank/,
    tone: {
      key: 'nubank',
      fill: '#8B5CF6',
      panel: 'from-violet-600/35 via-card to-card',
      accent: 'text-violet-300',
      chip: 'bg-violet-500/25',
    },
  },
  {
    match: /\binter\b/,
    tone: {
      key: 'inter',
      fill: '#FF7A00',
      panel: 'from-orange-500/30 via-card to-card',
      accent: 'text-orange-300',
      chip: 'bg-orange-500/20',
    },
  },
  {
    match: /\bc6\b/,
    tone: {
      key: 'c6',
      fill: '#F5C518',
      panel: 'from-yellow-500/25 via-card to-card',
      accent: 'text-yellow-300',
      chip: 'bg-yellow-500/20',
    },
  },
  {
    match: /ita[uú]/,
    tone: {
      key: 'itau',
      fill: '#EC7000',
      panel: 'from-orange-600/30 via-card to-card',
      accent: 'text-orange-400',
      chip: 'bg-orange-600/20',
    },
  },
  {
    match: /bradesco/,
    tone: {
      key: 'bradesco',
      fill: '#CC092F',
      panel: 'from-red-600/30 via-card to-card',
      accent: 'text-red-300',
      chip: 'bg-red-600/20',
    },
  },
  {
    match: /santander/,
    tone: {
      key: 'santander',
      fill: '#EC0000',
      panel: 'from-red-500/30 via-card to-card',
      accent: 'text-red-300',
      chip: 'bg-red-500/20',
    },
  },
  {
    match: /\bbb\b|banco do brasil/,
    tone: {
      key: 'bb',
      fill: '#FCD34D',
      panel: 'from-yellow-400/25 via-card to-card',
      accent: 'text-yellow-300',
      chip: 'bg-yellow-400/20',
    },
  },
  {
    match: /\bxp\b/,
    tone: {
      key: 'xp',
      fill: '#EAB308',
      panel: 'from-yellow-500/25 via-zinc-800/40 to-card',
      accent: 'text-yellow-300',
      chip: 'bg-yellow-500/20',
    },
  },
  {
    match: /picpay/,
    tone: {
      key: 'picpay',
      fill: '#21C25E',
      panel: 'from-green-500/30 via-card to-card',
      accent: 'text-green-300',
      chip: 'bg-green-500/20',
    },
  },
  {
    match: /\bneon\b/,
    tone: {
      key: 'neon',
      fill: '#00E4B8',
      panel: 'from-teal-400/30 via-card to-card',
      accent: 'text-teal-300',
      chip: 'bg-teal-400/20',
    },
  },
  {
    match: /mercado\s*pago|mercadopago/,
    tone: {
      key: 'mercadopago',
      fill: '#00B1EA',
      panel: 'from-sky-500/30 via-card to-card',
      accent: 'text-sky-300',
      chip: 'bg-sky-500/20',
    },
  },
  {
    match: /\bwill\b/,
    tone: {
      key: 'will',
      fill: '#00D959',
      panel: 'from-emerald-400/30 via-card to-card',
      accent: 'text-emerald-300',
      chip: 'bg-emerald-400/20',
    },
  },
];

function hashString(value: string) {
  let hash = 0;
  for (let i = 0; i < value.length; i += 1) {
    hash = (hash * 31 + value.charCodeAt(i)) >>> 0;
  }
  return hash;
}

/** Cor estável do cartão (marca pelo nome ou hash do id). Mesma em perfil e gráficos. */
export function getCardTone(card: { id: string; name: string }): CardTone {
  const normalized = card.name.trim().toLowerCase();

  for (const brand of BRAND_TONES) {
    if (brand.match.test(normalized)) {
      return brand.tone;
    }
  }

  return FALLBACK_TONES[hashString(card.id) % FALLBACK_TONES.length];
}
