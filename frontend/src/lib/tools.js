// Everything SnapBuy can do. Photo tools share one page (the photo is used
// for the chosen purpose). Each tool has its own colour (tone) and an emoji
// for its tile; `featured` tools get the big tiles on the home page.
export const TOOL_LIST = [
  { key: "photo", icon: "camera", emoji: "📸", tone: "violet", featured: true, title: "Search by photo", text: "Snap or upload a product; see every store and the cheapest price." },
  { key: "outfit", icon: "shirt", emoji: "👗", tone: "pink", featured: true, title: "Find the outfit", text: "Shop every item someone is wearing in a photo." },
  { key: "plan", icon: "tag", emoji: "🎯", tone: "amber", featured: true, title: "Plan a look on a budget", text: "A complete outfit for any occasion that fits your budget." },
  { key: "gift", icon: "heart", emoji: "🎁", tone: "rose", featured: true, title: "Find a gift", text: "Six thoughtful gift ideas for anyone, at any budget." },
  { key: "rate", icon: "star", emoji: "⭐", tone: "orange", title: "Rate my outfit", text: "A style score out of 10, with tips you can shop." },
  { key: "colours", icon: "palette", emoji: "🎨", tone: "teal", title: "Colours that suit me", text: "One selfie tells us the colours that flatter you." },
  { key: "tryon", icon: "sparkles", emoji: "🕶️", tone: "indigo", title: "Try it on", text: "See clothes, glasses or a watch on your own photo." },
  { key: "list", icon: "bag", emoji: "📝", tone: "green", title: "Shop my list", text: "Photograph or type a shopping list; get every item in one cart." },
  { key: "room", icon: "box", emoji: "🛋️", tone: "cyan", title: "Shop a room", text: "Find the furniture and decor from any room photo." },
  { key: "watch", icon: "bell", emoji: "🔔", tone: "blue", title: "Price watch", text: "Tap the bell on any product; we'll tell you when it gets cheaper." },
];

export const TOOLS = Object.fromEntries(TOOL_LIST.map((tool) => [tool.key, tool]));
