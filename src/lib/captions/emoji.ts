/** Keyword → emoji map for viral caption styles (applied per token when enabled). */
const MAP: Record<string, string> = {
  money: "💰", cash: "💰", dollar: "💰", dollars: "💰", rich: "💰", profit: "💰", price: "💸", cost: "💸", pay: "💸", paid: "💸",
  fire: "🔥", lit: "🔥", hot: "🔥", insane: "🔥", crazy: "🤯", mind: "🧠", brain: "🧠", think: "🧠", idea: "💡", ideas: "💡",
  rocket: "🚀", launch: "🚀", grow: "📈", growth: "📈", views: "📈", up: "⬆️", down: "⬇️", time: "⏰", clock: "⏰", today: "📅",
  warning: "⚠️", danger: "⚠️", mistake: "❌", wrong: "❌", never: "🚫", stop: "🛑", star: "⭐", best: "🏆", win: "🏆", winner: "🏆", won: "🏆",
  food: "🍔", eat: "🍔", pizza: "🍕", coffee: "☕", phone: "📱", video: "🎥", camera: "📷", music: "🎵", song: "🎵", world: "🌍",
  love: "❤️", heart: "❤️", happy: "😊", smile: "😊", sad: "😢", cry: "😭", laugh: "😂", funny: "😂", cool: "😎", eyes: "👀", look: "👀", watch: "👀",
  hundred: "💯", "100": "💯", party: "🎉", book: "📚", read: "📚", work: "💼", job: "💼", gym: "💪", strong: "💪", health: "🩺",
  car: "🚗", home: "🏠", house: "🏠", dog: "🐶", cat: "🐱", sun: "☀️", rain: "🌧️", secret: "🤫", question: "❓", free: "🆓", new: "🆕",
  sleep: "😴", bed: "🛏️", key: "🔑", lock: "🔒", gift: "🎁", game: "🎮", games: "🎮", goal: "🎯", target: "🎯", hack: "🧩", trick: "🪄", magic: "🪄",
};

export function emojiFor(token: string): string | null {
  const key = token.toLowerCase().replace(/[^\p{L}\p{N}]/gu, "");
  return MAP[key] ?? null;
}
